const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

execFileSync("node", ["scripts/build-priority-county-promotion-gate.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/priority-county-promotion/priority-county-promotion-gate.json");
const markdown = fs.readFileSync(
  path.join(root, "output", "priority-county-promotion", "priority-county-promotion-gate.md"),
  "utf8",
);
const expectedIds = [
  "jefferson-ky",
  "harris-county-tx",
  "maricopa-county-az",
  "king-county-wa",
  "tarrant-county-tad",
  "collin-county-tx",
  "denton-county-tx",
  "fort-bend-county-tx",
  "travis-county-tx",
  "bexar-county-tx",
];

assert(report.version === "wr-priority-county-promotion-gate-v1", "Priority gate must have a stable version");
assert(report.uiConstraint.includes("Do not redesign"), "Priority gate must preserve the UI constraint");
assert(report.summary.targetCount === 10, "Priority gate must cover ten requested counties");
assert(report.summary.mapSearchPilotCount === 4, "Priority gate must cover four map/search pilots");
assert(report.summary.texasPriorityBuildCount === 6, "Priority gate must cover six Texas build priorities");
assert(expectedIds.every((id) => report.counties.some((county) => county.adapterId === id)), "Priority gate is missing a target county");
assert(
  report.counties.every((county) => county.promotionReady || county.safeVisibleActivation === "do-not-activate"),
  "Blocked counties must remain do-not-activate",
);
assert(
  report.counties.every((county) => !county.promotionReady || Object.values(county.checks).every(Boolean)),
  "Promotion-ready counties must pass every production check",
);
assert(
  report.counties
    .filter((county) => county.group === "texas-priority-build")
    .every((county) => county.ingestionPlan && county.ingestionPlan.validationErrorCount === 0),
  "Every Texas priority must have a valid ingestion plan",
);
assert(markdown.includes("Exact blockers"), "Priority gate markdown must document exact blockers");

console.log("White Rabbit priority county promotion gate tests passed.");
