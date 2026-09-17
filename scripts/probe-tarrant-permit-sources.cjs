const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const root = path.join(__dirname, "..");
const COUNTY_ID = "tarrant-county-tad";
const rawSha = (value) => createHash("sha256").update(value).digest("hex");
const semanticSha = (value) => rawSha(JSON.stringify(value, Object.keys(value).sort()));
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const registry = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/tarrant/jurisdiction-source-registry.json"), "utf8"));
const specs = [
  { sourceId: "tarrant-transportation-utility-permits", publisher: "Tarrant County Transportation Department", sourceRole: "county-utility", jurisdictionIds: [], coverageStatement: "Transportation utility permits only; not building permits and not evidence of countywide building-permit coverage.", temporalCoverage: "service history start date unverified", layerUrl: "https://mapit.tarrantcounty.com/arcgis/rest/services/Transportation/Utility_Permit/MapServer/0", identityField: "PERMIT_NO", completenessFields: ["PERMIT_NO", "GlobalID"], addressField: "", sourceParcelKeyField: "", typeFields: [] },
  { sourceId: "fort-worth-accela-permits", publisher: "City of Fort Worth", sourceRole: "municipal-building", jurisdictionIds: ["fort-worth"], coverageStatement: "Fort Worth municipal permits only; jurisdiction boundary and ETJ treatment require separate evidence.", temporalCoverage: "service history start date unverified", layerUrl: "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/FeatureServer/0", identityField: "Unique_ID", completenessFields: ["Unique_ID", "Permit_No", "Address", "Latitude", "Longitude"], addressField: "Address", sourceParcelKeyField: "", typeFields: ["Permit_Type", "Current_Status"] },
  { sourceId: "arlington-issued-permits-three-year", publisher: "City of Arlington", sourceRole: "municipal-building", jurisdictionIds: ["arlington"], coverageStatement: "Arlington municipal issued permits and certificates of occupancy; official description states a rolling three-year view.", temporalCoverage: "rolling three-year view; updated daily Monday-Friday", layerUrl: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1", identityField: "FOLDERSEQUENCE", completenessFields: ["FOLDERSEQUENCE", "FOLDERNAME", "PROPGISID1"], addressField: "FOLDERNAME", sourceParcelKeyField: "PROPGISID1", typeFields: ["FOLDERTYPE", "STATUSDESC"] },
];

async function get(url, expectedHost) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost) throw new Error("Permit probe URL is not allowlisted");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Permit probe failed with HTTP ${response.status}`);
  const value = JSON.parse(text);
  if (value.error) throw new Error(`Permit source error: ${value.error.message || "unknown"}`);
  return { value, sha256: rawSha(text), bytes: Buffer.byteLength(text) };
}

async function probe(spec) {
  const host = new URL(spec.layerUrl).hostname;
  const queryUrl = `${spec.layerUrl}/query`;
  const metadataPromise = get(`${spec.layerUrl}?f=json`, host);
  const countPromise = get(`${queryUrl}?where=1%3D1&returnCountOnly=true&f=json`, host);
  const completenessPromises = spec.completenessFields.map(async (field) => [field, await get(`${queryUrl}?where=${encodeURIComponent(`${field} IS NOT NULL`)}&returnCountOnly=true&f=json`, host)]);
  const taxonomyPromise = spec.typeFields.length
    ? get(`${queryUrl}?where=1%3D1&outFields=${encodeURIComponent(spec.typeFields.join(","))}&returnGeometry=false&returnDistinctValues=true&orderByFields=${encodeURIComponent(spec.typeFields.join(","))}&f=json`, host)
    : metadataPromise;
  const [metadata, count, completenessEntries, taxonomy] = await Promise.all([metadataPromise, countPromise, Promise.all(completenessPromises), taxonomyPromise]);
  const completeness = Object.fromEntries(completenessEntries);
  const nonNullCounts = Object.fromEntries(completenessEntries.map(([field, response]) => [field, response.value.count]));
  const typeValues = spec.typeFields.length ? taxonomy.value.features.map((feature) => spec.typeFields.map((field) => String(feature.attributes[field] || "")).join(" | ")) : ["Utility Permit"];
  const permitTypes = spec.typeFields.length ? [...new Set(taxonomy.value.features.map((feature) => String(feature.attributes[spec.typeFields[0]] || "")).filter(Boolean))] : ["Utility Permit"];
  const sr = metadata.value.extent?.spatialReference || {};
  return {
    input: {
      countyId: COUNTY_ID, sourceId: spec.sourceId, publisher: spec.publisher, sourceRole: spec.sourceRole, jurisdictionIds: spec.jurisdictionIds, coverageStatement: spec.coverageStatement, temporalCoverage: spec.temporalCoverage,
      serviceUrl: spec.layerUrl.replace(/\/\d+$/, ""), layerUrl: spec.layerUrl, layerName: metadata.value.name, geometryType: metadata.value.geometryType, spatialReference: `EPSG:${sr.latestWkid || sr.wkid}`,
      identityField: spec.identityField, identityUniqueness: "unverified", addressField: spec.addressField, sourceParcelKeyField: spec.sourceParcelKeyField, sourceParcelKeyBridgeStatus: "unverified",
      featureCount: count.value.count, nonNullCounts, typeStatusTupleCount: typeValues.length, permitTypes,
      metadataSha256: metadata.sha256, countResponseSha256: count.sha256, completenessResponseSha256: semanticSha(Object.fromEntries(Object.entries(completeness).map(([field, response]) => [field, response.sha256]))), taxonomyResponseSha256: taxonomy.sha256, observedAt: new Date().toISOString(),
    },
    transport: { metadataBytes: metadata.bytes, countResponseBytes: count.bytes, completenessResponseBytes: Object.values(completeness).reduce((sum, response) => sum + response.bytes, 0), taxonomyResponseBytes: taxonomy.bytes },
  };
}

(async () => {
  const permits = await import("../src/operations/countyPermitIntelligence.mjs");
  const raw = await Promise.all(specs.map(probe));
  const probes = raw.map((item) => permits.createCountyPermitSourceProbe(item.input));
  const universe = [...registry.municipalities.map(slug), "unincorporated-tarrant"];
  const reconciliation = permits.reconcileCountyPermitCoverage({ countyId: COUNTY_ID, jurisdictionUniverseIds: universe, probes });
  const normalizationPolicies = probes.map((probe) => permits.createCountyPermitNormalizationPolicy({ countyId: COUNTY_ID, sourceProbeSha256: probe.probeSha256, identityUniqueness: probe.identityUniqueness, sourceParcelKeyBridgeStatus: probe.sourceParcelKeyBridgeStatus, addressField: probe.addressField, sourceParcelKeyField: probe.sourceParcelKeyField, geometryAvailable: probe.nonNullCounts.Latitude > 0 || probe.geometryType !== "", jurisdictionBoundarySnapshotSha256: "", rights: [], rightsEvidenceRef: "", approvalRefs: [] }));
  const artifact = { probes: probes.map((probe, index) => ({ ...probe, transport: raw[index].transport })), reconciliation, normalizationPolicies, recordsCaptured: false, geometryCaptured: false, parcelLinksBuilt: false, activationAuthorized: false };
  const directory = path.join(root, "output/tarrant/permit-readiness");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-permit-readiness.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  const lines = [
    "# Tarrant Permit Federation Readiness", "", `Observed: ${probes[0].observedAt}`, "",
    "This metadata-only probe captured no permit records or geometry and cannot link permits to parcels or authorize UI activation.", "",
    "| Source | Role | Records | Complete IDs | Coverage | Status |", "| --- | --- | ---: | ---: | --- | --- |",
    ...probes.map((probe) => `| ${probe.sourceId} | ${probe.sourceRole} | ${probe.featureCount} | ${probe.nonNullCounts[probe.identityField]} | ${probe.coverageStatement} | ${probe.status} |`),
    "", "## Building-permit jurisdiction coverage", "",
    `- Jurisdiction scopes: ${universe.length}.`,
    `- Municipal building sources discovered: ${reconciliation.discoveredBuildingJurisdictionIds.join(", ") || "none"}.`,
    `- Certified municipal building sources: ${reconciliation.certifiedBuildingJurisdictionIds.length}.`,
    `- Uncovered or uncertified scopes: ${reconciliation.uncoveredBuildingJurisdictionIds.length}.`,
    "- Tarrant utility permits are explicitly excluded from building-permit coverage.",
    "- Arlington is explicitly a rolling three-year view, not complete historical coverage.",
    "", "## Hard blockers", "",
    "- Verify source permit ID uniqueness and preserve immutable raw-source lineage.",
    "- Record source reuse rights and two independent approvals.",
    "- Certify effective-dated jurisdiction boundaries.",
    "- Prove any source property-ID bridge to TAD ACCOUNT; never infer equivalence.",
    "- Normalize and partition every source record into direct-linked, address-linked, spatial-linked, unmatched, ambiguous, conflict, or invalid counts.",
  ];
  fs.writeFileSync(path.join(directory, "tarrant-permit-readiness.md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ sourceCounts: Object.fromEntries(probes.map((probe) => [probe.sourceId, probe.featureCount])), discoveredBuildingJurisdictions: reconciliation.discoveredBuildingJurisdictionIds, certifiedBuildingJurisdictionCount: reconciliation.certifiedBuildingJurisdictionIds.length, uncoveredBuildingJurisdictionCount: reconciliation.uncoveredBuildingJurisdictionIds.length }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
