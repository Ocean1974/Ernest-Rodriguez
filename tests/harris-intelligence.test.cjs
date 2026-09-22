const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const countyRoot = path.join(root, "public", "data", "counties", "harris-county-tx");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(countyRoot, ...parts), "utf8"));

const zoning = read("zoning", "manifest.json");
assert.strictEqual(zoning.sourceCountyId, "harris-county-tx");
assert.strictEqual(zoning.defaultVisible, false);
assert.strictEqual(zoning.renderDirectlyInBrowser, false);
assert(zoning.parcelIndexCount > 0, "Houston development controls must join to parcels");
assert(/no conventional citywide zoning/i.test(zoning.parcelZoningJoin.noZoningDisclosure));
assert.strictEqual(zoning.sourceLayers[0].sourceFeatureCount, 751);

const flood = read("floodplain", "manifest.json");
assert.strictEqual(flood.sourceCountyId, "harris-county-tx");
assert.strictEqual(flood.sourceService.sourceFeatureCount, 17968);
assert(flood.parcelIndexCount > 0, "Houston floodplain must join to parcels");
assert.strictEqual(flood.defaultVisible, false);

const developments = read("developments", "manifest.json");
assert.strictEqual(developments.schemaVersion, "wr-development-parcel-service-v1");
assert.strictEqual(developments.sourceCountyId, "harris-county-tx");
assert(developments.sourceRecordCount > 0, "Current plat activity must contain Harris rows");
assert(developments.parcelCount > 0, "Current plat activity must directly join at least one HCAD account");
assert.strictEqual(developments.sourceRecordCount, developments.parcelCount + developments.unmatchedRecordCount);
assert(developments.searchShards.br?.files?.length > 0, "Breen Warehouse must be discoverable through a text search shard");
const breenSearch = read("developments", developments.searchShards.br.files[0]);
assert(breenSearch.records.some((record) => record.subdivisionName === "Breen Warehouse" && record.parcelId === "0642470060006"), "Breen Warehouse must retain its exact HCAD join in runtime search");

const report = JSON.parse(fs.readFileSync(path.join(root, "output", "harris-county-tx", "houston-intelligence-report.json"), "utf8"));
assert.strictEqual(report.developmentSignals.directAccountJoinKey, "Appraisal District No (County Tax ID) -> HCAD_NUM/acct_num");
assert.strictEqual(report.developmentControls.sourceFeatureCount, 751);
assert.strictEqual(report.floodplain.sourceFeatureCount, 17968);

console.log("Harris/Houston zoning-controls, floodplain, and development-signal outputs passed.");
