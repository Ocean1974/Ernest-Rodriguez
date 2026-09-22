const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serviceRoot = path.join(root, "public/data/counties/collin-county-tx/parcels");
const report = JSON.parse(fs.readFileSync(path.join(root, "output/collin-county-tx/ccad-refresh-parcel-service-report.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(serviceRoot, "manifest.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(report.sourceRecordCount === 441278, "Refresh service must preserve the exact CCAD source count");
assert(report.searchIndexCount === 441278, "Every refresh record must remain searchable");
assert(report.rowOrderGlobalIdMatches === 441278, "Every geometry/appraisal row must reconcile by GlobalID");
assert(report.geometryFeatureCount === 441252, "Valid polygon count must remain exact");
assert(report.missingGeometry === 1 && report.invalidGeometry === 25, "Geometry exclusions must be explicit");
assert(report.activationAuthorized === false, "A successful rebuild must not bypass final county QC");
assert(manifest.schemaVersion === "wr-collin-ccad-refresh-parcel-service-v1", "Live manifest must identify the refresh build");
assert(manifest.featureCount === 441278 && manifest.searchIndexCount === 441278, "Live manifest must expose all refresh records to search");
assert(manifest.appraisalValueRecordCount === 429405, "Live service must expose the exact certified appraisal-value coverage");
assert(manifest.certifiedPriorRollRecordCount === 429405, "Blank in-progress current values must fall back to the certified prior roll");
assert(manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0) === 441252, "Viewport chunks must reconcile to valid polygon count");
assert(Object.keys(manifest.addressSearchIndexShards.files).length > 0, "Live service must publish dedicated address shards");

const planoFiles = [].concat(manifest.addressSearchIndexShards.files.sy || []);
let planoSearchRecord = null;
for (const file of planoFiles) {
  const shard = JSON.parse(fs.readFileSync(path.join(serviceRoot, file), "utf8"));
  const addressIndex = shard.fields.indexOf("address");
  const record = shard.parcels.find((values) => values[addressIndex] === "1608 SYLVAN DR , PLANO, TX 75074");
  if (record) {
    planoSearchRecord = Object.fromEntries(shard.fields.map((field, index) => [field, record[index]]));
    break;
  }
}
assert(planoSearchRecord, "Known Plano refresh address must be present in the live address index");
const planoChunk = JSON.parse(fs.readFileSync(path.join(serviceRoot, `chunks/${planoSearchRecord.chunkId}.json`), "utf8"));
const planoParcel = planoChunk.parcels.find((parcel) => parcel.countyParcelId === planoSearchRecord.countyParcelId);
assert(planoParcel?.realGeometry?.geometry?.type === "Polygon" || planoParcel?.realGeometry?.geometry?.type === "MultiPolygon", "Plano address result must resolve to a live polygon chunk");
assert(Number(planoParcel?.totalValue) > 0 && planoParcel?.valueYear === "2026", "Known Plano parcel must expose its certified 2026 appraisal value");

console.log("Collin current-refresh parcel service tests passed.");
