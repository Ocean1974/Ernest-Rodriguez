const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "output/national-county-intelligence/national-completion-queue.json"), "utf8"));
const coverage = JSON.parse(fs.readFileSync(path.join(root, "output/national-county-intelligence/national-coverage-manifest.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "output/national-county-intelligence/national-completion-queue.md"), "utf8");

assert.equal(report.schemaVersion, "wr-national-county-completion-queue-v1");
assert.equal(report.summary.countyEquivalentCount, 3235);
assert.equal(report.summary.stateAreaCount, 57);
assert.equal(report.summary.completeCountyCount + report.summary.incompleteCountyCount, 3235);
assert.equal(report.summary.incompleteCountyCount, report.workQueue.length);
assert.equal(new Set(report.counties.map((county) => county.fips)).size, 3235);
assert.equal(report.counties.length, coverage.counties.length);
assert(report.counties.every((county) => county.totalGateCount === 12));
assert(report.counties.filter((county) => county.stage !== "live").every((county) => county.gates.activation.status === "blocked"));
assert(report.counties.filter((county) => county.stage === "live").every((county) => county.gates.activation.status === "passed"));
assert.deepEqual(report.workQueue.slice(0, 3).map((county) => county.countyId), ["el-paso-county-tx", "montgomery-county-tx", "williamson-county-tx"]);

const montgomery = report.counties.find((county) => county.countyId === "montgomery-county-tx");
assert.equal(montgomery.gates.schemaMapped.status, "passed");
assert.equal(montgomery.gates.stableIdentity.status, "failed");
assert.equal(montgomery.gates.freshness.status, "failed");
assert.equal(montgomery.gates.activation.status, "blocked");

assert(markdown.includes("First 25 queued counties"));
assert(markdown.includes("Queue placement does not authorize"));

console.log("White Rabbit national county completion queue tests passed.");

