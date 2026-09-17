const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

execFileSync("node", ["scripts/run-county-batch.cjs", "--plan"], { cwd: root, stdio: "pipe" });
const report = readJson("output/county-batch-plan/county-batch-plan.json");
const markdown = fs.readFileSync(path.join(root, "output", "county-batch-plan", "county-batch-plan.md"), "utf8");

assert(report.version === "wr-county-batch-plan-v1", "County batch plan must have a stable version");
assert(report.outputName === "county-batch-plan", "Default county batch plan must preserve its output name");
assert(report.summary.countyCount === 6, "Default priority batch must contain six counties");
assert(report.counties.every((county) => county.validationErrorCount === 0), "Priority batch plans must have no adapter errors");
assert(report.summary.blockedCount > 0, "Source-incomplete priority batch must remain execution-blocked");
assert(report.uiConstraint.includes("Do not redesign"), "Batch plan must preserve the UI constraint");
assert(markdown.includes("Safety rule"), "Batch plan markdown must document its safety rule");

const executeAttempt = spawnSync("node", ["scripts/run-county-batch.cjs", "--execute"], {
  cwd: root,
  encoding: "utf8",
});
assert(executeAttempt.status !== 0, "Batch execution must fail closed while warnings remain");
assert(
  `${executeAttempt.stdout}\n${executeAttempt.stderr}`.includes("Batch execution blocked"),
  "Blocked batch execution must explain the gate",
);

execFileSync(
  "node",
  ["scripts/run-county-batch.cjs", "--counties", "harris-county-tx,louisville", "--output-name", "tx-ky-test-plan", "--plan"],
  { cwd: root, stdio: "pipe" },
);
const txKyPlan = readJson("output/county-batch-plan/tx-ky-test-plan.json");
assert(txKyPlan.outputName === "tx-ky-test-plan", "County batch runner must support named concurrent-state plans");
assert(txKyPlan.counties.some((county) => county.adapterId === "harris-county-tx"), "Named plan must include Harris County");
assert(txKyPlan.counties.some((county) => county.adapterId === "jefferson-ky"), "Named plan must include Jefferson County");

console.log("White Rabbit county batch plan tests passed.");
