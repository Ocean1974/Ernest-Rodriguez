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
const nextWave = readJson("data/state-county-growth-next-wave.json");

assert(packageJson.scripts["county:state-growth"] === "node scripts/build-state-county-growth-plan.cjs", "Package scripts must expose the state county growth plan builder");
assert(nextWave.strategy.includes("states already present"), "Next wave must stay inside states already present in the project queue");
assert(nextWave.uiConstraint.includes("Do not redesign"), "Next wave must preserve the locked UI constraint");

execFileSync("node", ["scripts/build-state-county-growth-plan.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/state-county-growth-plan.json");
const reportMd = fs.readFileSync(path.join(root, "output", "state-county-growth-plan.md"), "utf8");
const stateCodes = report.states.map((state) => state.state);

["TX", "CA", "FL", "AZ", "WA", "KY", "IL", "NY", "NV", "MI", "PA"].forEach((state) => {
  assert(stateCodes.includes(state), `Growth plan must include existing project state ${state}`);
});

assert(report.totalNextCounties === 23, "Growth plan should queue 23 next-wave counties");
assert(report.states.every((state) => state.nextCounties.every((county) => county.nextMilestone === "verify-official-sources")), "Every next county must start with official source verification");
assert(report.states.every((state) => state.nextCounties.every((county) => county.requiredSourceGroups.includes("owner-appraisal"))), "Every next county must require owner/appraisal source discovery");
assert(reportMd.includes("State County Growth Plan"), "Growth plan markdown must be generated");
assert(reportMd.includes("Do not redesign"), "Growth plan markdown must preserve the UI constraint");

console.log("White Rabbit state county growth plan tests passed.");
