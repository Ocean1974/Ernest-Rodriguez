const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const root = path.join(__dirname, "..");
const COUNTY_ID = "tarrant-county-tad";
const HOST = "mapit.tarrantcounty.com";
const rawSha = (value) => createHash("sha256").update(value).digest("hex");
const specs = [
  { sourceId: "tarrant-fema-estimated-2025", role: "planning-estimate-only", layerUrl: `https://${HOST}/arcgis/rest/services/Transportation/FEMA_2025/MapServer/4`, sourceIdField: "EST_AR_ID", versionField: "VERSION_ID" },
  { sourceId: "tarrant-fema-flood-hazards-2025", role: "regulatory-candidate", layerUrl: `https://${HOST}/arcgis/rest/services/Transportation/FEMA_FloodHazards_2025/MapServer/0`, sourceIdField: "FLD_AR_ID", versionField: "VERSION_ID" },
  { sourceId: "tarrant-dfirm-2009-floodway", role: "historical-only", layerUrl: `https://${HOST}/arcgis/rest/services/Dynamic/Floodplains/MapServer/0`, sourceIdField: "FLD_AR_ID", versionField: "" },
  { sourceId: "tarrant-dfirm-2009-zone-ae", role: "historical-only", layerUrl: `https://${HOST}/arcgis/rest/services/Dynamic/Floodplains/MapServer/1`, sourceIdField: "FLD_AR_ID", versionField: "" },
  { sourceId: "tarrant-dfirm-2009-zone-a", role: "historical-only", layerUrl: `https://${HOST}/arcgis/rest/services/Dynamic/Floodplains/MapServer/2`, sourceIdField: "FLD_AR_ID", versionField: "" },
];

async function get(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== HOST) throw new Error("Flood probe URL is not allowlisted");
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Flood probe failed with HTTP ${response.status}`);
  const value = JSON.parse(text);
  if (value.error) throw new Error(`Flood source error: ${value.error.message || "unknown"}`);
  return { value, sha256: rawSha(text), bytes: Buffer.byteLength(text) };
}

async function probe(spec) {
  const serviceUrl = spec.layerUrl.replace(/\/\d+$/, "");
  const taxonomyFields = ["FLD_ZONE", "SFHA_TF", spec.versionField].filter(Boolean);
  const query = `${spec.layerUrl}/query`;
  const [metadata, count, identityCount, taxonomy] = await Promise.all([
    get(`${spec.layerUrl}?f=json`),
    get(`${query}?where=1%3D1&returnCountOnly=true&f=json`),
    get(`${query}?where=${encodeURIComponent(`${spec.sourceIdField} IS NOT NULL`)}&returnCountOnly=true&f=json`),
    get(`${query}?where=1%3D1&outFields=${encodeURIComponent(taxonomyFields.join(","))}&returnGeometry=false&returnDistinctValues=true&orderByFields=${encodeURIComponent(taxonomyFields.join(","))}&f=json`),
  ]);
  const sr = metadata.value.extent?.spatialReference || {};
  return {
    input: {
      countyId: COUNTY_ID,
      sourceId: spec.sourceId,
      publisher: spec.role === "historical-only" ? "Tarrant County / FEMA DFIRM 2009" : "Tarrant County Transportation / FEMA",
      role: spec.role,
      serviceUrl,
      layerUrl: spec.layerUrl,
      layerName: metadata.value.name,
      sourceIdField: spec.sourceIdField,
      zoneField: "FLD_ZONE",
      sfhaField: "SFHA_TF",
      geometryType: metadata.value.geometryType,
      spatialReference: `EPSG:${sr.latestWkid || sr.wkid}`,
      featureCount: count.value.count,
      nonNullSourceIdCount: identityCount.value.count,
      sourceIdUniqueness: "unverified",
      zoneTuples: taxonomy.value.features.map((feature) => ({ zone: feature.attributes.FLD_ZONE, sfhaFlag: feature.attributes.SFHA_TF, versionId: spec.versionField ? feature.attributes[spec.versionField] : "" })),
      metadataSha256: metadata.sha256,
      countResponseSha256: count.sha256,
      identityCountResponseSha256: identityCount.sha256,
      taxonomyResponseSha256: taxonomy.sha256,
      observedAt: new Date().toISOString(),
    },
    transport: { metadataBytes: metadata.bytes, countResponseBytes: count.bytes, identityCountResponseBytes: identityCount.bytes, taxonomyResponseBytes: taxonomy.bytes },
  };
}

(async () => {
  const flood = await import("../src/operations/countyFloodIntelligence.mjs");
  const raw = await Promise.all(specs.map(probe));
  const probes = raw.map((item) => flood.createCountyFloodSourceProbe(item.input));
  const reconciliation = flood.reconcileCountyFloodSources({ countyId: COUNTY_ID, probes });
  const regulatory = probes.find((item) => item.role === "regulatory-candidate");
  const snapshotPolicy = flood.createCountyFloodSnapshotPolicy({ countyId: COUNTY_ID, reconciliationSha256: reconciliation.reconciliationSha256, reconciliationStatus: reconciliation.status, sourceProbeSha256: regulatory.probeSha256, sourceIdUniqueness: regulatory.sourceIdUniqueness, effectiveAt: new Date().toISOString(), countyBoundarySnapshotSha256: "", rights: [], rightsEvidenceRef: "", approvalRefs: [] });
  const artifact = { probes: probes.map((item, index) => ({ ...item, transport: raw[index].transport })), reconciliation, snapshotPolicy, geometryCaptured: false, parcelClassificationAuthorized: false, activationAuthorized: false };
  const directory = path.join(root, "output/tarrant/flood-readiness");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-flood-readiness.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  const lines = [
    "# Tarrant Flood Intelligence Readiness",
    "",
    `Observed: ${regulatory.observedAt}`,
    "",
    "This metadata-only probe captured no flood geometry and cannot classify parcels, determine insurance requirements, or authorize UI activation.",
    "",
    "| Source | Role | Features | Non-null IDs | Unique IDs | Zone tuples | Status |",
    "| --- | --- | ---: | ---: | --- | ---: | --- |",
    ...probes.map((item) => `| ${item.sourceId} | ${item.role} | ${item.featureCount} | ${item.nonNullSourceIdCount} | ${item.sourceIdUniqueness} | ${item.zoneTuples.length} | ${item.status} |`),
    "",
    "## Source-use controls",
    "",
    "- The 2025 DFIRM-style hazard layer is a regulatory candidate, not yet a certified regulatory snapshot.",
    "- The 2025 EST/BLE layer is planning-estimate-only and can never silently replace regulatory evidence.",
    "- The 2009 DFIRM layers are historical-only and cannot drive current parcel classifications.",
    `- Source reconciliation: ${reconciliation.status}.`,
    `- Snapshot policy: ${snapshotPolicy.status}.`,
    "",
    "## Hard blockers",
    "",
    ...reconciliation.blockers.map((item) => `- ${item}`),
    "- Record explicit store, derive, and query rights and two independent approvals.",
    "- Certify the county boundary snapshot used to clip the flood source.",
    "- Capture geometry with exact counts, stable IDs, valid polygons, zone taxonomy, overlap audit, and immutable lineage.",
  ];
  fs.writeFileSync(path.join(directory, "tarrant-flood-readiness.md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ regulatoryFeatureCount: regulatory.featureCount, regulatoryZoneTupleCount: regulatory.zoneTuples.length, estimatedFeatureCount: probes.find((item) => item.role === "planning-estimate-only").featureCount, legacyFeatureCount: probes.filter((item) => item.role === "historical-only").reduce((sum, item) => sum + item.featureCount, 0), reconciliationStatus: reconciliation.status, snapshotPolicyStatus: snapshotPolicy.status }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
