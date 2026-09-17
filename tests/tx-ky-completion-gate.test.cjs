const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const packageJson = readJson("package.json");

assert(packageJson.scripts["county:tx-ky-completion-gate"] === "node scripts/build-tx-ky-completion-gate.cjs", "Package scripts must expose TX/KY completion gate");

execFileSync("node", ["scripts/build-tx-ky-completion-gate.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/tx-ky-completion-gate/tx-ky-completion-gate.json");
const reportMd = fs.readFileSync(path.join(root, "output", "tx-ky-completion-gate", "tx-ky-completion-gate.md"), "utf8");

assert(report.version === "wr-tx-ky-completion-gate-v1", "Completion gate must use a stable version");
assert(report.uiConstraint.includes("Do not redesign"), "Completion gate must preserve the UI constraint");
assert(report.summary.TX.total === 254, "Completion gate must cover 254 Texas counties");
assert(report.summary.KY.total === 120, "Completion gate must cover 120 Kentucky counties");
assert(report.stateGate.activeStates.join(",") === "TX,KY", "Texas and Kentucky must both remain active state pipelines");
assert(report.stateGate.executionMode === "concurrent-state-pipelines", "Texas and Kentucky must be able to progress concurrently");
assert(report.stateGate.texasCanAdvance === true, "Texas pipeline must be able to advance");
assert(report.stateGate.kentuckyCanAdvance === true, "Kentucky pipeline must be able to advance");
assert(report.counties.some((county) => county.censusCountyId === "dallas-county-tx" && county.adapterId === "dallas-county-dcad"), "Dallas must map to the canonical DCAD adapter");
assert(report.counties.some((county) => county.censusCountyId === "tarrant-county-tx" && county.adapterId === "tarrant-county-tad"), "Tarrant must map to the canonical TAD adapter");
assert(report.counties.some((county) => county.censusCountyId === "jefferson-county-ky" && county.adapterId === "jefferson-ky"), "Jefferson KY must map to the canonical Louisville adapter");
assert(report.counties.every((county) => county.status !== "core-complete" || county.canActivate === true), "Only core-complete counties can activate");
assert(report.nextTexasCounties.length > 0, "Completion gate must produce the next Texas work queue");
assert(report.nextTexasCounties.every((county) => county.state === "TX"), "Next queue must stay in Texas");
assert(reportMd.includes("TX/KY Completion Gate"), "Completion gate markdown must exist");

console.log("White Rabbit TX/KY completion gate tests passed.");
