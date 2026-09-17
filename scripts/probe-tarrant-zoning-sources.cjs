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
  { sourceId: "fort-worth-current-zoning", publisher: "City of Fort Worth", sourceRole: "current-zoning", jurisdictionIds: ["fort-worth"], coverageStatement: "Fort Worth municipal current zoning only; certified jurisdiction clipping and limited-purpose treatment are required.", temporalCoverage: "current service snapshot; per-feature effective dates incomplete", layerUrl: "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/CIVIC_ZONING/MapServer/0", identityField: "OBJECTID", districtField: "ZONING", baseDistrictField: "BASE_ZONING", effectiveDateField: "ORD_EFF_DATE", completenessFields: ["OBJECTID", "ZONING", "BASE_ZONING", "ORD_EFF_DATE"], taxonomyFields: ["ZONING", "BASE_ZONING"] },
  { sourceId: "fort-worth-zoning-overlays", publisher: "City of Fort Worth", sourceRole: "overlay", jurisdictionIds: ["fort-worth"], coverageStatement: "Fort Worth zoning overlays only; overlays supplement and never replace current zoning.", temporalCoverage: "current service snapshot; effective-date completeness unverified", layerUrl: "https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Zoning_case_service/MapServer/8", identityField: "OBJECTID", districtField: "", baseDistrictField: "", effectiveDateField: "APPROVAL_D", completenessFields: ["OBJECTID", "OVERLAY_ID", "NAME"], taxonomyFields: ["OVERLAY", "NAME"] },
  { sourceId: "fort-worth-zoning-cases", publisher: "City of Fort Worth", sourceRole: "zoning-case", jurisdictionIds: ["fort-worth"], coverageStatement: "Fort Worth zoning cases only; proposed or pending cases never replace effective current zoning.", temporalCoverage: "service window start date unverified", layerUrl: "https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Zoning_case_service/MapServer/12", identityField: "OBJECTID", districtField: "", baseDistrictField: "", effectiveDateField: "DATE_APPRO", completenessFields: ["OBJECTID", "CASE_NMBR", "ACTION_"], taxonomyFields: ["ACTION_", "ZONING_FRO", "ZONING_TO"] },
  { sourceId: "arlington-current-zoning", publisher: "City of Arlington", sourceRole: "current-zoning", jurisdictionIds: ["arlington"], coverageStatement: "Arlington active zoning districts only; certified jurisdiction clipping is required.", temporalCoverage: "current active districts; per-feature effective dates incomplete", layerUrl: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/3", identityField: "OBJECTID", districtField: "ZONINGDETAIL", baseDistrictField: "DISTRICT", effectiveDateField: "EFFECTIVEDATE", completenessFields: ["OBJECTID", "ZONINGDETAIL", "DISTRICT", "EFFECTIVEDATE"], taxonomyFields: ["ZONINGDETAIL", "DISTRICT"] },
  { sourceId: "arlington-planning-overlays", publisher: "City of Arlington", sourceRole: "overlay", jurisdictionIds: ["arlington"], coverageStatement: "Arlington active planning overlays only; overlays supplement and never replace current zoning.", temporalCoverage: "current active overlays; effective dates not exposed", layerUrl: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/8", identityField: "OBJECTID", districtField: "", baseDistrictField: "", effectiveDateField: "", completenessFields: ["OBJECTID", "OverlayName", "Status"], taxonomyFields: ["OverlayName", "Status"] },
  { sourceId: "arlington-zoning-cases-three-year", publisher: "City of Arlington", sourceRole: "zoning-case", jurisdictionIds: ["arlington"], coverageStatement: "Arlington zoning cases only; official description states a rolling three-year view updated monthly.", temporalCoverage: "rolling three-year view; updated monthly", layerUrl: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/0", identityField: "OBJECTID", districtField: "", baseDistrictField: "", effectiveDateField: "ISSUEDATE", completenessFields: ["OBJECTID", "FolderNumber", "FOLDERSEQUENCE", "PROPGISID1"], taxonomyFields: ["FOLDERTYPE", "STATUSDESC"] },
];

async function get(url, host) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== host) throw new Error("Zoning probe URL is not allowlisted");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Zoning probe failed with HTTP ${response.status}`);
  const value = JSON.parse(text);
  if (value.error) throw new Error(`Zoning source error: ${value.error.message || "unknown"}`);
  return { value, sha256: rawSha(text), bytes: Buffer.byteLength(text) };
}

async function probe(spec) {
  const host = new URL(spec.layerUrl).hostname;
  const query = `${spec.layerUrl}/query`;
  const [metadata, count, completenessEntries, taxonomy] = await Promise.all([
    get(`${spec.layerUrl}?f=json`, host),
    get(`${query}?where=1%3D1&returnCountOnly=true&f=json`, host),
    Promise.all(spec.completenessFields.map(async (field) => [field, await get(`${query}?where=${encodeURIComponent(`${field} IS NOT NULL`)}&returnCountOnly=true&f=json`, host)])),
    get(`${query}?where=1%3D1&outFields=${encodeURIComponent(spec.taxonomyFields.join(","))}&returnGeometry=false&returnDistinctValues=true&orderByFields=${encodeURIComponent(spec.taxonomyFields.join(","))}&f=json`, host),
  ]);
  const completeness = Object.fromEntries(completenessEntries);
  const sr = metadata.value.extent?.spatialReference || {};
  return {
    input: { countyId: COUNTY_ID, sourceId: spec.sourceId, publisher: spec.publisher, sourceRole: spec.sourceRole, jurisdictionIds: spec.jurisdictionIds, coverageStatement: spec.coverageStatement, temporalCoverage: spec.temporalCoverage, serviceUrl: spec.layerUrl.replace(/\/\d+$/, ""), layerUrl: spec.layerUrl, layerName: metadata.value.name, geometryType: metadata.value.geometryType, spatialReference: `EPSG:${sr.latestWkid || sr.wkid}`, identityField: spec.identityField, identityUniqueness: "unverified", districtField: spec.districtField, baseDistrictField: spec.baseDistrictField, effectiveDateField: spec.effectiveDateField, featureCount: count.value.count, nonNullCounts: Object.fromEntries(completenessEntries.map(([field, response]) => [field, response.value.count])), taxonomyTupleCount: taxonomy.value.features.length, metadataSha256: metadata.sha256, countResponseSha256: count.sha256, completenessResponseSha256: semanticSha(Object.fromEntries(Object.entries(completeness).map(([field, response]) => [field, response.sha256]))), taxonomyResponseSha256: taxonomy.sha256, observedAt: new Date().toISOString() },
    transport: { metadataBytes: metadata.bytes, countResponseBytes: count.bytes, completenessResponseBytes: Object.values(completeness).reduce((sum, response) => sum + response.bytes, 0), taxonomyResponseBytes: taxonomy.bytes },
  };
}

(async () => {
  const zoning = await import("../src/operations/countyZoningIntelligence.mjs");
  const raw = await Promise.all(specs.map(probe));
  const probes = raw.map((item) => zoning.createCountyZoningSourceProbe(item.input));
  const universe = [...registry.municipalities.map(slug), "unincorporated-tarrant"];
  const reconciliation = zoning.reconcileCountyZoningCoverage({ countyId: COUNTY_ID, jurisdictionUniverseIds: universe, probes });
  const snapshotPolicies = probes.filter((probe) => probe.sourceRole === "current-zoning").map((probe) => zoning.createCountyZoningSnapshotPolicy({ countyId: COUNTY_ID, sourceProbeSha256: probe.probeSha256, identityUniqueness: probe.identityUniqueness, nullDistrictCount: probe.nullDistrictCount, jurisdictionBoundarySnapshotSha256: "", effectiveAt: probe.observedAt, rights: [], rightsEvidenceRef: "", approvalRefs: [] }));
  const artifact = { probes: probes.map((probe, index) => ({ ...probe, transport: raw[index].transport })), reconciliation, snapshotPolicies, geometryCaptured: false, parcelAssignmentsBuilt: false, activationAuthorized: false };
  const directory = path.join(root, "output/tarrant/zoning-readiness");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-zoning-readiness.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  const lines = ["# Tarrant Zoning Federation Readiness", "", `Observed: ${probes[0].observedAt}`, "", "This metadata-only probe captured no zoning geometry and cannot assign current zoning to parcels or authorize UI activation.", "", "| Source | Role | Features | Complete district values | Taxonomy tuples | Status |", "| --- | --- | ---: | ---: | ---: | --- |", ...probes.map((probe) => `| ${probe.sourceId} | ${probe.sourceRole} | ${probe.featureCount} | ${probe.districtField ? probe.nonNullCounts[probe.districtField] : "n/a"} | ${probe.taxonomyTupleCount} | ${probe.status} |`), "", "## Coverage", "", `- Current-zoning jurisdictions discovered: ${reconciliation.discoveredCurrentZoningJurisdictionIds.join(", ") || "none"}.`, `- Certified current-zoning jurisdictions: ${reconciliation.certifiedCurrentZoningJurisdictionIds.length}.`, `- Uncovered or uncertified scopes: ${reconciliation.uncoveredCurrentZoningJurisdictionIds.length}.`, "- Overlays and zoning cases are preserved separately and never replace current zoning.", "- Missing effective dates are preserved as missing and never invented.", "", "## Hard blockers", "", "- Verify source feature identity uniqueness and record reuse rights.", "- Resolve null current-district values under an approved source policy.", "- Certify effective-dated jurisdiction boundaries and geometry clipping.", "- Capture immutable zoning geometry and district definitions with exact lineage.", "- Publish exact assigned, split, ambiguous, unmatched, invalid, and missing-definition counts."];
  fs.writeFileSync(path.join(directory, "tarrant-zoning-readiness.md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ sourceCounts: Object.fromEntries(probes.map((probe) => [probe.sourceId, probe.featureCount])), discoveredCurrentZoningJurisdictions: reconciliation.discoveredCurrentZoningJurisdictionIds, certifiedCurrentZoningJurisdictionCount: reconciliation.certifiedCurrentZoningJurisdictionIds.length, uncoveredCurrentZoningJurisdictionCount: reconciliation.uncoveredCurrentZoningJurisdictionIds.length }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
