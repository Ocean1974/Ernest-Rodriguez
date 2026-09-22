const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8"));
const manifest = read("public", "data", "national", "migration-demand", "manifest.json");
const coverage = read("public", "data", "national", "migration-demand", "coverage-index.json");
const texasCounties = read("public", "data", "national", "migration-demand", "counties", "48.json");
const texasPlaces = read("public", "data", "national", "migration-demand", "places", "48.json");

assert.equal(manifest.schemaVersion, "wr-national-migration-demand-manifest-v1");
assert.equal(manifest.countyRecordCount, 3222);
assert.equal(manifest.matchedCensusUniverseCountyCount, 3209);
assert.equal(manifest.placeRecordCount, 32330);
assert.equal(Object.keys(coverage.counties).length, 3248, "coverage index must include ACS counties plus explicit project-universe source gaps");
assert.equal(Object.values(coverage.counties).filter((record) => /^ready/.test(record.status)).length, 3222);
assert.equal(Object.values(coverage.counties).filter((record) => /^source-gap/.test(record.status)).length, 26);
assert(manifest.semantics.includes("No parcel attribution"));
assert.match(manifest.scoring.disclaimer, /not a forecast/i);
assert(manifest.sources.every((source) => source.bytes > 0 && /^[a-f0-9]{64}$/.test(source.sha256)));

const byCounty = new Map(texasCounties.records.map((record) => [record.geographyId, record]));
const bexar = byCounty.get("48029");
assert(bexar, "Bexar County demand context must exist");
assert.equal(bexar.name, "Bexar County, TX");
assert.equal(bexar.metrics.population, 2067341);
assert.equal(bexar.metrics.irsNetReturns, 2764);
assert.equal(bexar.migrationSignal, "net-inflow");
assert(Number.isInteger(bexar.marketDemandIndex) && bexar.marketDemandIndex >= 0 && bexar.marketDemandIndex <= 100);
assert.match(bexar.sourceScope, /never.*parcel fact/i);

const byPlace = new Map(texasPlaces.records.map((record) => [record.geographyId, record]));
for (const [fips, name] of [["4805000", "Austin city"], ["4819000", "Dallas city"], ["4835000", "Houston city"], ["4865000", "San Antonio city"]]) {
  const place = byPlace.get(fips);
  assert(place, `${name} demand context must exist`);
  assert.equal(place.name, name);
  assert.equal(place.geographyLevel, "place");
  assert.equal(place.metrics.irsNetReturns, null, "IRS county migration must not be copied onto a city");
  assert.match(place.indexSemantics, /not a forecast/i);
}

const bexarManifest = read("public", "data", "counties", "bexar-county-tx", "demand", "manifest.json");
assert.equal(bexarManifest.status, "ready-aggregate-geography-context");
assert.equal(bexarManifest.countyFips, "48029");
assert.equal(bexarManifest.parcelAttribution, false);
assert.equal(bexarManifest.parcelJoinCount, 0);

console.log("National county and Census-place migration/demand context tests passed.");
