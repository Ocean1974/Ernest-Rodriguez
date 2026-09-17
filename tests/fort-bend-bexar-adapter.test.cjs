const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const registry = readJson("data/county-importer-registry.json");
const packageJson = readJson("package.json");
const builder = fs.readFileSync(path.join(root, "scripts", "build-source-verified-county-parcel-service.cjs"), "utf8");

const cases = [
  {
    countyId: "fort-bend-county-tx",
    sourceFile: "data/county-adapters/fort-bend-county-tx/fort-bend-county-tx-source-manifest.json",
    fieldMapFile: "data/county-adapters/fort-bend-county-tx/fort-bend-county-tx-universal-field-map.json",
    expectedCount: 385212,
    expectedMissingGeometry: 0,
    expectedUniqueField: "GlobalID",
    expectedAccountField: "Property_Number",
    expectedDuplicateExcess: 8,
    sampleScript: "fort-bend:service:sample",
  },
  {
    countyId: "bexar-county-tx",
    sourceFile: "data/county-adapters/bexar-county-tx/bexar-county-tx-source-manifest.json",
    fieldMapFile: "data/county-adapters/bexar-county-tx/bexar-county-tx-universal-field-map.json",
    expectedCount: 710772,
    expectedMissingGeometry: 2,
    expectedUniqueField: "OBJECTID",
    expectedAccountField: "AcctNumb",
    expectedDuplicateExcess: 188,
    sampleScript: "bexar:service:sample",
  },
];

for (const item of cases) {
  const adapter = readJson(`data/county-adapters/${item.countyId}/adapter.json`);
  const source = readJson(item.sourceFile);
  const fieldMap = readJson(item.fieldMapFile);
  const pipeline = readJson(`data/county-adapters/${item.countyId}/pipeline.json`);
  const registryEntry = registry.counties.find((county) => county.countyId === item.countyId);

  assert(adapter.id === item.countyId, `${item.countyId} adapter id must be stable`);
  assert(adapter.status === "pilot", `${item.countyId} must remain a gated pilot`);
  assert(adapter.uniqueGisKey === item.expectedUniqueField, `${item.countyId} must use its verified unique feature key`);
  assert(adapter.accountIdField === item.expectedAccountField, `${item.countyId} must preserve its business parcel identifier`);
  assert(adapter.verifiedCounts.parcelGeometryFeatures === item.expectedCount, `${item.countyId} must lock its exact live feature count`);
  assert(adapter.verifiedCounts.missingGeometry === item.expectedMissingGeometry, `${item.countyId} must lock its missing geometry count`);
  assert(source.verified_counts.parcel_geometry_features === item.expectedCount, `${item.countyId} source count must match adapter`);
  const unusableGeometryCount = source.verified_counts.geometry_unusable_features ?? source.verified_counts.geometry_missing_features;
  assert(unusableGeometryCount === item.expectedMissingGeometry, `${item.countyId} unusable geometry count must match adapter`);
  assert(source.query.geometry_out_sr === 4326, `${item.countyId} importer must normalize geometry to EPSG:4326`);
  assert(source.download_tests.arcgis_rest_query.supported, `${item.countyId} ArcGIS query support must be verified`);
  assert(source.activation === "do-not-activate", `${item.countyId} must not activate before remaining gates pass`);
  assert(fieldMap.identityPolicy.runtimeFeatureId === item.expectedUniqueField, `${item.countyId} field map must use the verified unique key`);
  assert(fieldMap.fields.accountNumber === item.expectedAccountField, `${item.countyId} field map must preserve the account field`);
  assert(pipeline.scaffoldOnly === false, `${item.countyId} pipeline must be executable rather than scaffold-only`);
  assert(registryEntry?.sampleCommand, `${item.countyId} must have an executable sample importer command`);
  assert(registryEntry?.fullCommand, `${item.countyId} must have an executable full importer command`);
  assert(packageJson.scripts[item.sampleScript], `${item.countyId} sample npm script must exist`);
  assert(builder.includes(`"${item.countyId}"`), `${item.countyId} must be supported by the shared county importer`);
  assert(builder.includes(item.expectedAccountField), `${item.countyId} account field must be mapped by the shared importer`);
  const serviceManifest = readJson(`public/data/counties/${item.countyId}/parcels/manifest.json`);
  assert(["sample", "full"].includes(serviceManifest.mode), `${item.countyId} must have a parcel service artifact`);
  const expectedBuiltCount = serviceManifest.mode === "full" ? item.expectedCount - item.expectedMissingGeometry : 25;
  assert(serviceManifest.featureCount === expectedBuiltCount, `${item.countyId} service must reconcile mapped parcels`);
  assert(serviceManifest.searchIndexCount === expectedBuiltCount, `${item.countyId} search count must match its parcel count`);
  assert(["pilot-sample-not-for-production-activation", "full-build-needs-qc-before-app-activation"].includes(serviceManifest.activationStatus), `${item.countyId} service must not bypass activation review`);
}

assert(readJson(cases[0].sourceFile).verified_counts.property_number_duplicate_excess === cases[0].expectedDuplicateExcess, "Fort Bend duplicate business parcel IDs must be documented");
assert(readJson(cases[1].sourceFile).verified_counts.account_number_duplicate_excess === cases[1].expectedDuplicateExcess, "Bexar duplicate business parcel IDs must be documented");
assert(readJson(cases[1].sourceFile).officialSourceStatus === "verified-with-freshness-blocker", "Bexar freshness blocker must remain explicit");
assert(builder.includes("fs.rmSync(tempChunkFile, { force: true })"), "Streaming builds must release temporary chunk storage as outputs are finalized");
assert(builder.includes("fs.rmSync(tempSearchFile, { force: true })"), "Streaming builds must release temporary search storage as outputs are finalized");
assert(builder.includes("ensureFullBuildCapacity"), "Full county imports must run a disk-capacity preflight");
assert(builder.includes("FULL_BUILD_FREE_SPACE_RESERVE_BYTES"), "Full county imports must preserve a free-space reserve");
const qcBuilder = fs.readFileSync(path.join(root, "scripts", "build-county-qc-reports.cjs"), "utf8");
assert(qcBuilder.includes('--county='), "County QC must support bounded single-county execution");
assert(packageJson.scripts["fort-bend:qc"], "Fort Bend targeted QC script must exist");
assert(packageJson.scripts["bexar:qc"], "Bexar targeted QC script must exist");

console.log("Real Estate Savant Fort Bend and Bexar source-verification adapter tests passed.");
