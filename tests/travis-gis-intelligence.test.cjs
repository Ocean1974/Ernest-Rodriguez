const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8"));
const report = read("output", "travis-county-tx", "austin-gis-intelligence-report.json");
const zoning = read("public", "data", "counties", "travis-county-tx", "zoning", "manifest.json");
const flood = read("public", "data", "counties", "travis-county-tx", "floodplain", "manifest.json");
const parcels = read("public", "data", "counties", "travis-county-tx", "parcels", "manifest.json");

assert.strictEqual(report.parcelCount, 386682);
assert.strictEqual(report.zoning.sourceFeatureCount, 22504);
assert(report.zoning.joinedParcelCount > 0);
assert.strictEqual(report.floodplain.fullyDevelopedSourceFeatureCount, 11436);
assert.strictEqual(report.floodplain.femaSourceFeatureCount, 9315);
assert(report.floodplain.joinedParcelCount > 0);
assert.strictEqual(zoning.parcelIndexCount, report.zoning.joinedParcelCount);
assert.strictEqual(flood.parcelIndexCount, report.floodplain.joinedParcelCount);
assert.strictEqual(parcels.joinedParcelDimensionCount, parcels.featureCount);
assert.strictEqual(parcels.joinedBlockGridCount, parcels.featureCount);
for (const manifest of [zoning, flood]) {
  assert.strictEqual(manifest.defaultVisible, false);
  assert.strictEqual(manifest.renderDirectlyInBrowser, false);
  assert(Object.keys(manifest.parcelIndexShards.files).length > 0);
}

console.log("Austin parcel dimensions, block context, zoning, and floodplain intelligence tests passed.");
