const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "county-importer-registry.json"), "utf8"));
assert.equal(registry.schemaVersion, "wr-county-importer-registry-v1");
assert.equal(registry.batches["pilot-eight"].length, 8);
assert.equal(new Set(registry.batches["pilot-eight"]).size, 8);
assert(registry.counties.filter((county) => county.pilot).every((county) => county.joinKey !== "source-needed"));

execFileSync("node", ["scripts/run-county-importer-batch.cjs", "--batch", "pilot-eight", "--plan"], { cwd: root, stdio: "pipe" });
const report = JSON.parse(fs.readFileSync(path.join(root, "output", "county-importer-program", "pilot-eight-plan.json"), "utf8"));
assert.equal(report.schemaVersion, "wr-county-importer-program-v1");
assert.equal(report.summary.countyCount, 8);
assert.equal(report.summary.importerReadyCount, 8);
assert.equal(report.summary.parcelCoreCompleteCount, 8);
assert.equal(report.summary.exactParcelCount, 6181529);
assert(report.counties.every((county) => county.exactCountParity));
assert.equal(report.summary.sourceCountExactCount, 3);
assert.equal(report.summary.sourceCountReconciledCount, 2);
assert.equal(report.summary.sourceReconciliationNeededCount, 2);
assert.equal(report.summary.sourceCountUnavailableCount, 1);

execFileSync("node", ["scripts/run-county-importer-batch.cjs", "--batch", "texas-arcgis", "--plan"], { cwd: root, stdio: "pipe" });
const texas = JSON.parse(fs.readFileSync(path.join(root, "output", "county-importer-program", "texas-arcgis-plan.json"), "utf8"));
assert.equal(texas.summary.countyCount, 7);
assert.equal(texas.summary.blockedCount, 0);
assert.equal(texas.summary.importerReadyCount, 7);
assert.equal(texas.summary.parcelCoreCompleteCount, 7);
assert.equal(texas.counties.find((county) => county.countyId === "fort-bend-county-tx")?.manifestMode, "full");
assert.equal(texas.counties.find((county) => county.countyId === "bexar-county-tx")?.manifestMode, "full");
console.log("White Rabbit county importer program tests passed.");
