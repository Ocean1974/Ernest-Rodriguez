const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
execFileSync("node", ["scripts/build-national-coverage-manifest.cjs"], { cwd: root, stdio: "pipe" });

const manifest = JSON.parse(fs.readFileSync(path.join(root, "output", "national-county-intelligence", "national-coverage-manifest.json"), "utf8"));
const universe = JSON.parse(fs.readFileSync(path.join(root, "data", "national-county-intelligence", "us-county-universe.json"), "utf8"));
const continuation = JSON.parse(fs.readFileSync(path.join(root, "output", "started-state-county-continuation.json"), "utf8"));

assert.equal(manifest.schemaVersion, "wr-national-coverage-manifest-v1");
assert.equal(manifest.summary.countyEquivalentCount, universe.countyEquivalentCount);
assert.equal(manifest.summary.uniqueFipsCount, universe.countyEquivalentCount);
assert.equal(manifest.summary.stateAreaCount, 57);
assert.equal(manifest.summary.priorityCountyCount, 23);
assert.equal(manifest.counties.length, universe.countyEquivalentCount);
assert.equal(manifest.states.reduce((total, state) => total + state.countyEquivalentCount, 0), universe.countyEquivalentCount);
assert.equal(Object.values(manifest.summary.stageCounts).reduce((total, count) => total + count, 0), universe.countyEquivalentCount);
assert(manifest.counties.every((county) => county.fips && county.adapterPath && county.stage));
assert.equal(new Set(manifest.counties.map((county) => county.fips)).size, universe.countyEquivalentCount);

const dallas = manifest.counties.find((county) => county.fips === "48113");
assert(dallas, "Dallas County must be represented by Census FIPS 48113");
assert.equal(dallas.state, "TX");
assert.equal(dallas.adapterFolder, "dallas");
assert.equal(dallas.stage, "live");
assert.equal(dallas.verifiedParcelCount, 696601);

assert.equal(continuation.startedAdapterCount, universe.countyEquivalentCount, "Started adapter count must match the Census universe after state metadata reconciliation");
assert.equal(continuation.startedStates.length, 57);
assert(manifest.counties.filter((county) => county.scaffoldOnly).every((county) => county.stage !== "live"));

console.log("White Rabbit national coverage manifest tests passed.");
