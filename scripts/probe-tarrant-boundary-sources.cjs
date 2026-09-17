const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/tarrant/jurisdiction-source-registry.json"), "utf8"));
const CITY_SERVICE = "https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/CityBoundariesWUnincorp/MapServer";
const ETJ_SERVICE = "https://mapit.tarrantcounty.com/arcgis/rest/services/Transportation/ETJ/MapServer";
const GUIDANCE_URL = "https://www.tarrantcountytx.gov/en/engineering-services/development/extra-territorial-jurisdictions.html";
const GUIDANCE_ETJS = ["Azle ETJ", "Crowley ETJ", "Fort Worth ETJ", "Haslet ETJ", "Kennedale ETJ", "Mansfield ETJ"];
const rawSha = (value) => createHash("sha256").update(value).digest("hex");

async function fetchRaw(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "mapit.tarrantcounty.com") throw new Error("Boundary probe URL is not allowlisted");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Boundary probe failed with HTTP ${response.status}`);
  const value = JSON.parse(text);
  if (value.error) throw new Error(`Boundary source error: ${value.error.message || "unknown"}`);
  return { value, sha256: rawSha(text), bytes: Buffer.byteLength(text) };
}

async function inspectSource({ sourceId, serviceUrl, nameField, expectedUniverseNames }) {
  const layerUrl = `${serviceUrl}/0`;
  const [metadata, count, distinct] = await Promise.all([
    fetchRaw(`${layerUrl}?f=json`),
    fetchRaw(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`),
    fetchRaw(`${layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(nameField)}&returnGeometry=false&returnDistinctValues=true&orderByFields=${encodeURIComponent(nameField)}&f=json`),
  ]);
  const oid = metadata.value.objectIdField || metadata.value.fields?.find((field) => field.type === "esriFieldTypeOID")?.name;
  return {
    input: {
      countyId: registry.countyId,
      sourceId,
      publisher: sourceId === "tarrant-city-boundaries" ? "Tarrant County / NCTCOG" : "Tarrant County Transportation",
      serviceUrl,
      layerUrl,
      layerName: metadata.value.name,
      geometryType: metadata.value.geometryType,
      spatialReference: `EPSG:${metadata.value.extent?.spatialReference?.latestWkid || metadata.value.extent?.spatialReference?.wkid}`,
      objectIdField: oid,
      jurisdictionNameField: nameField,
      maxRecordCount: metadata.value.maxRecordCount,
      featureCount: count.value.count,
      distinctNames: distinct.value.features.map((feature) => feature.attributes[nameField]),
      expectedUniverseNames,
      metadataSha256: metadata.sha256,
      countResponseSha256: count.sha256,
      distinctResponseSha256: distinct.sha256,
      observedAt: new Date().toISOString(),
    },
    transport: { metadataBytes: metadata.bytes, countResponseBytes: count.bytes, distinctResponseBytes: distinct.bytes },
  };
}

(async () => {
  const boundary = await import("../src/operations/countyJurisdictionBoundary.mjs");
  const [cityRaw, etjRaw] = await Promise.all([
    inspectSource({ sourceId: "tarrant-city-boundaries", serviceUrl: CITY_SERVICE, nameField: "CITYNAME", expectedUniverseNames: registry.municipalities }),
    inspectSource({ sourceId: "tarrant-city-etj", serviceUrl: ETJ_SERVICE, nameField: "NAME", expectedUniverseNames: GUIDANCE_ETJS }),
  ]);
  const cityProbe = boundary.createCountyBoundarySourceProbe(cityRaw.input);
  const etjProbe = boundary.createCountyBoundarySourceProbe(etjRaw.input);
  const reconciliation = boundary.createCountyEtjReconciliation({ countyId: registry.countyId, guidanceUrl: GUIDANCE_URL, guidanceObservedAt: "2026-08-23T00:00:00.000Z", guidanceNames: GUIDANCE_ETJS, serviceNames: etjProbe.distinctNames, serviceProbeSha256: etjProbe.probeSha256 });
  const snapshotPolicy = boundary.createCountyBoundarySnapshotPolicy({ countyId: registry.countyId, sourceProbeSha256: cityProbe.probeSha256, reconciliationSha256: reconciliation.reconciliationSha256, reconciliationStatus: reconciliation.status, effectiveAt: new Date().toISOString(), observedAt: new Date().toISOString(), rights: [], rightsEvidenceRef: "", approvalRefs: [] });
  const artifact = { cityProbe, cityTransport: cityRaw.transport, etjProbe, etjTransport: etjRaw.transport, reconciliation, snapshotPolicy, activationAuthorized: false };
  const directory = path.join(root, "output/tarrant/boundary-readiness");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-boundary-readiness.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  const lines = [
    "# Tarrant Boundary and ETJ Readiness",
    "",
    `Observed: ${cityProbe.observedAt}`,
    "",
    "This metadata-only probe captured no geometry and does not authorize a boundary snapshot, parcel assignment, zoning assignment, or UI activation.",
    "",
    "| Source | Features | Distinct labels | Missing expected | Additional observed | Status |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    `| City boundaries with unincorporated areas | ${cityProbe.featureCount} | ${cityProbe.distinctNameCount} | ${cityProbe.missingExpectedNames.length} | ${cityProbe.additionalObservedNames.length} | ${cityProbe.status} |`,
    `| City ETJs | ${etjProbe.featureCount} | ${etjProbe.distinctNameCount} | ${etjProbe.missingExpectedNames.length} | ${etjProbe.additionalObservedNames.length} | ${etjProbe.status} |`,
    "",
    "## ETJ discrepancy",
    "",
    `- Matching guidance/service labels: ${reconciliation.matchingNames.join(", ") || "none"}`,
    `- Named by current guidance but missing from service: ${reconciliation.missingFromService.join(", ") || "none"}`,
    `- Present in service but not current guidance: ${reconciliation.serviceOnly.join(", ") || "none"}`,
    `- Reconciliation status: ${reconciliation.status}`,
    "",
    "## Hard blockers",
    "",
    "- Resolve the ETJ temporal/definition discrepancy with dated authoritative evidence.",
    "- Record explicit store, derive, and query rights.",
    "- Obtain two independent approvals for the effective-dated snapshot policy.",
    "- Capture and validate geometry with exact source counts, stable identities, county clipping, validity checks, and reviewed overlaps.",
  ];
  fs.writeFileSync(path.join(directory, "tarrant-boundary-readiness.md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ cityFeatureCount: cityProbe.featureCount, cityDistinctNameCount: cityProbe.distinctNameCount, etjFeatureCount: etjProbe.featureCount, etjDistinctNameCount: etjProbe.distinctNameCount, etjStatus: reconciliation.status, snapshotPolicyStatus: snapshotPolicy.status }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
