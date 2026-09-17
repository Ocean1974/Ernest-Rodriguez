const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const adapter = readJson("data/county-adapters/travis-county-tx/adapter.json");
const source = readJson("data/county-adapters/travis-county-tx/travis-county-tx-source-manifest.json");
const fieldMap = readJson("data/county-adapters/travis-county-tx/travis-county-tx-universal-field-map.json");
const service = readJson("public/data/counties/travis-county-tx/parcels/manifest.json");
const certifiedAudit = readJson("output/travis-county-tx/tcad-certified-intelligence-audit.json");
const certifiedManifest = readJson("public/data/counties/travis-county-tx/parcels/intelligence/tcad-2026-supp-333/manifest.json");
const registry = fs.readFileSync(path.join(root, "src/data/countyRegistry.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const loader = fs.readFileSync(path.join(root, "src/map/loadParcels.ts"), "utf8");

assert.strictEqual(adapter.id, "travis-county-tx");
assert.strictEqual(adapter.status, "pilot");
assert.strictEqual(adapter.parcelIdField, "OBJECTID");
assert.strictEqual(adapter.accountIdField, "PROP_ID");
assert.strictEqual(source.verified_counts.parcel_geometry_features, 386682);
assert.strictEqual(source.verified_counts.geometry_missing_features, 0);
assert.strictEqual(source.verified_counts.object_id_distinct_values, 386682);
assert.strictEqual(source.verified_counts.prop_id_missing_features, 13130);
assert.strictEqual(source.verified_counts.prop_id_duplicate_excess, 28);
assert.strictEqual(source.verified_counts.geo_id_duplicate_excess, 88);
assert.strictEqual(fieldMap.identityPolicy.sourceFeatureKey, "OBJECTID");
assert.strictEqual(fieldMap.identityPolicy.businessKeyStatus, "snapshot-unique-refresh-stability-unverified");

assert.strictEqual(service.sourceCountyId, "travis-county-tx");
assert.strictEqual(service.mode, "full");
assert.strictEqual(service.sourceVerifiedFeatureCount, 386682);
assert.strictEqual(service.featureCount, 386682);
assert.strictEqual(service.skipped, 0);
assert.strictEqual(service.searchIndexCount, 386682);
assert.strictEqual(service.joinedAppraisalCount, 373552);
assert.strictEqual(service.joinedParcelDimensionCount, 386682);
assert(service.chunkCount > 0, "Travis service must contain viewport chunks");
assert(Object.keys(service.searchIndexShards.files).length > 0, "Travis service must contain search shards");
assert.strictEqual(certifiedAudit.keyAudit.propertyRows, 493300);
assert.strictEqual(certifiedAudit.keyAudit.distinctSourcePropIds, 493222);
assert.strictEqual(certifiedAudit.keyAudit.serviceMissingPropId, 13130);
assert.strictEqual(certifiedAudit.improvementAudit.improvementDetailRows, 3310123);
assert.strictEqual(certifiedAudit.distribution.enrichedParcels, 373538);
assert.strictEqual(certifiedAudit.distribution.unmatchedServiceParcels, 13144);
assert.strictEqual(certifiedAudit.distribution.sidecarChunkCount, 1180);
assert.strictEqual(certifiedManifest.featureCount, 373538);
assert.strictEqual(service.intelligenceSidecars.featureCount, 373538);

for (const output of [
  "output/travis-county-tx/schema-report.json",
  "output/travis-county-tx/schema-report.md",
  "output/travis-county-tx/join-key-report.md",
  "output/travis-county-tx/full-parcel-access-report.md",
  "output/travis-county-tx/parcel-service-report.json",
  "output/travis-county-tx/parcel-service-report.md",
  "public/data/counties/travis-county-tx/parcels/search-index.json",
  "output/travis-county-tx/tcad-certified-intelligence-audit.json",
  "output/travis-county-tx/tcad-certified-intelligence-audit.md",
]) assert(exists(output), `Missing required Travis output: ${output}`);

assert(registry.includes('id: "travis-county-tx"'), "County registry must include Travis County");
assert(registry.includes('enabled: false'), "Travis must remain behind a pilot activation gate");
assert(app.includes('id: "travis-county-tx"'), "Austin must be reachable through place search");
assert(loader.includes('"travis-county-tx": ["Travis County", "Austin"'), "Parcel search must include Travis/Austin labels");
assert(loader.includes('tcadCertified ? "tcadCertified"'), "Parcel loader must attach TCAD certified sidecars without using the HCAD join flag");

console.log("Travis County TCAD adapter, exact source audit, full service, and pilot routing checks passed.");
