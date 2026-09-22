const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

const report = read("output/bexar-county-tx/bexar-intelligence-pilot-report.json");
const adapter = read("data/county-adapters/bexar-county-tx/adapter.json");
const parcels = read("public/data/counties/bexar-county-tx/parcels/manifest.json");
const zoning = read("public/data/counties/bexar-county-tx/zoning/manifest.json");
const floodplain = read("public/data/counties/bexar-county-tx/floodplain/manifest.json");
const permits = read("public/data/counties/bexar-county-tx/permits/manifest.json");
const developments = read("public/data/counties/bexar-county-tx/developments/manifest.json");
const sources = read("data/raw/bexar-county-tx/intelligence/source-manifest.json");

assert.equal(report.sourceCountyId, "bexar-county-tx");
assert.equal(report.status, "14-of-14-pilot-groups-built-production-disabled");
assert.deepEqual(report.parityTarget, { readyGroups: 14, totalGroups: 14, percent: 100, remainingGroup: null });
assert.equal(report.counts.parcels, 710770);
assert.equal(report.counts.zoningSourceFeatures, 767728);
assert.equal(report.counts.floodSourceFeatures, 13765);
assert.equal(report.counts.preliminaryPlats, 1215);
assert.equal(report.counts.recordedPlats, 6790);
assert.equal(report.counts.permitRecords, report.counts.joinedPermits + report.counts.unmatchedPermits);
assert(report.counts.zoningParcels > 0);
assert(report.counts.floodplainParcels > 0);
assert(report.counts.joinedPermits > 0);
assert(report.counts.developmentParcels > 0);

assert.equal(parcels.featureCount, report.counts.parcels);
assert.equal(parcels.joinedParcelDimensionCount, report.counts.parcels);
assert.equal(parcels.joinedBlockGridCount, report.counts.parcels);
assert.deepEqual(parcels.missingLayers, []);
assert.equal(zoning.parcelIndexCount, report.counts.zoningParcels);
assert.equal(floodplain.parcelIndexCount, report.counts.floodplainParcels);
assert.equal(permits.permitCount, report.counts.permitRecords);
assert.equal(permits.joinedPermitCount, report.counts.joinedPermits);
assert.equal(permits.unmatchedPermitCount, report.counts.unmatchedPermits);
assert.equal(developments.parcelCount, report.counts.developmentParcels);

const expectedStatuses = {
  "parcel-dimensions": "ready-verified-generated-and-direct-parcel-dimensions",
  "block-grid": "ready-verified-parcel-grid-neighborhood-legal-context",
  permits: "parcel-index-ready-partial-municipal-coverage",
  "zoning-intelligence": "parcel-index-ready-partial-municipal-coverage",
  "development-signals": "parcel-index-ready-partial-municipal-coverage",
  "floodplain-intelligence": "parcel-index-ready-official-fema-coverage",
  "migration-demand": "ready-aggregate-geography-context",
};
for (const [id, status] of Object.entries(expectedStatuses)) {
  assert.equal(adapter.optionalLayers.find((layer) => layer.id === id)?.status, status, `${id} status`);
}

const sourceIds = new Set(sources.sources.map((source) => source.sourceId));
for (const id of [
  "san-antonio-cosa-zoning",
  "fema-nfhl-bexar-flood-hazard-zones",
  "san-antonio-preliminary-plat",
  "san-antonio-recorded-plat",
  "san-antonio-issued-building-permits",
]) assert(sourceIds.has(id), `missing official source ${id}`);

assert.match(adapter.productionGap, /all 14/i);
assert.match(adapter.productionGap, /production activation remain gated/i);

console.log("Bexar / San Antonio intelligence pilot tests passed.");
