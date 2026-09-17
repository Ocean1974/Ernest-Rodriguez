const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
execFileSync("node", ["scripts/build-kentucky-ingestion-waves.cjs"], { cwd: root, stdio: "pipe" });
const report = JSON.parse(fs.readFileSync(path.join(root, "output", "kentucky-source-audit", "kentucky-ingestion-waves.json"), "utf8"));
const ids = report.waves.flatMap((wave) => wave.countyIds);

assert.equal(report.schemaVersion, "wr-kentucky-ingestion-waves-v1");
assert.deepEqual(report.waves.map((wave) => wave.targetCountyCount), [7, 14, 28, 56, 15]);
assert.equal(ids.length, 120);
assert.equal(new Set(ids).size, 120, "Every Kentucky county must appear exactly once");
assert.equal(report.maxNetworkConcurrency, 4);
assert.equal(report.productionActivationAuthorized, false);
assert.equal(report.uiChanged, false);
assert(report.stages.includes("resumable-content-addressed-capture"));
assert(report.stages.includes("county-specific-activation-review"));

console.log("White Rabbit Kentucky exponential-scope, bounded-concurrency ingestion wave tests passed.");
