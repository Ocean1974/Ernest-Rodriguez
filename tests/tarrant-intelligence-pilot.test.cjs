const assert = require("assert");
const fs = require("fs");
const path = require("path");
const utils = require("../scripts/tarrant-intelligence-utils.cjs");

const root = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

assert.strictEqual(utils.normalizeAddress("123 Main Street, Apt 4"), "123 MAIN ST");
assert.strictEqual(utils.normalizeId("TAD: 00-123"), "tad00123");
assert(utils.pointInPolygon([1, 1], [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]));
assert(!utils.pointInPolygon([3, 1], [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]));
const grid = utils.makeGrid({ minLng: 0, minLat: 0, maxLng: 10, maxLat: 10 }, 10, 10);
grid.add({ id: "a" }, { minLng: 1, minLat: 1, maxLng: 2, maxLat: 2 });
assert.strictEqual(grid.at([1.5, 1.5])[0].id, "a");
assert.strictEqual(utils.developmentCategory({ permitType: "New Construction" }), "new-construction");
assert.strictEqual(utils.developmentCategory({ description: "Interior remodel" }), "alteration");

const report = readJson("output/tarrant/intelligence-pilot/tarrant-intelligence-pilot-report.json");
const zoning = readJson("public/data/counties/tarrant/zoning/manifest.json");
const floodplain = readJson("public/data/counties/tarrant/floodplain/manifest.json");
const permits = readJson("public/data/counties/tarrant/permits/manifest.json");
const developments = readJson("public/data/counties/tarrant/developments/manifest.json");
const adapter = readJson("data/county-adapters/tarrant/adapter.json");

assert.strictEqual(report.status, "13-of-14-pilot-groups-built-production-disabled");
assert.deepStrictEqual(report.parityTarget, { readyGroups: 13, totalGroups: 14, percent: 92.9, remainingGroup: "migration-demand" });
assert.strictEqual(report.counts.parcels, 758633);
assert.strictEqual(zoning.parcelIndexCount, report.counts.zoningParcels);
assert.strictEqual(floodplain.parcelIndexCount, report.counts.floodplainParcels);
assert.strictEqual(permits.permitCount, report.counts.permits);
assert.strictEqual(permits.joinedPermitCount, report.counts.joinedPermits);
assert.strictEqual(developments.parcelCount, report.counts.developmentParcels);
assert.strictEqual(permits.joinMethodCounts.sourceParcelKey + permits.joinMethodCounts.addressMatch + permits.joinMethodCounts.spatialNearestCentroid, permits.joinedPermitCount);
assert.strictEqual(permits.joinMethodCounts.unmatched + permits.joinMethodCounts.ambiguous, permits.unmatchedPermitCount);
assert.strictEqual(permits.joinedPermitCount + permits.unmatchedPermitCount, permits.permitCount);
assert(report.coverage.coveredJurisdictions.includes("fort-worth") && report.coverage.coveredJurisdictions.includes("arlington"));
assert.strictEqual(report.coverage.uncoveredJurisdictionCount, 40);
assert.strictEqual(zoning.defaultVisible, false);
assert.strictEqual(floodplain.defaultVisible, false);
assert.strictEqual(adapter.status, "pilot");
assert(adapter.productionGap.includes("13/14"));
assert(fs.statSync(path.join(root, "public/data/counties/tarrant/developments/parcel-development-index.json")).size > 0);

console.log("Tarrant intelligence pilot utilities and generated-artifact invariants passed.");
