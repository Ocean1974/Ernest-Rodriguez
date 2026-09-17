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

assert(packageJson.scripts["county:continue-started-states"] === "node scripts/build-started-state-county-continuation.cjs", "Package scripts must expose the started-state continuation builder");

execFileSync("node", ["scripts/build-started-state-county-continuation.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/started-state-county-continuation.json");
const reportMd = fs.readFileSync(path.join(root, "output", "started-state-county-continuation.md"), "utf8");
const nextWaveStates = nextWave.waves.map((wave) => wave.state);

assert(report.version === "wr-started-state-county-continuation-v1", "Continuation report must use a stable version");
assert(report.uiConstraint.includes("Do not redesign"), "Continuation report must preserve the locked UI constraint");
assert(report.noNewStateMigration === true, "Continuation report must block migration into states not already represented by adapter shells");
assert(report.blockedNewStates.length === 0, "No next-wave state should be outside the already-started adapter states");
assert(report.startedStates.length >= nextWaveStates.length, "Started states must cover every next-wave state before continuation");
assert(nextWaveStates.every((state) => report.startedStates.includes(state)), "Every next-wave state must already be represented in adapter shells");
assert(report.totalContinuationCounties === 23, "Continuation should keep the 23 next-wave counties queued");
assert(report.stateOrder.join(">") === nextWaveStates.join(">"), "Continuation state order must follow the approved next-wave order");
assert(report.currentState === "TX", "Continuation must finish Texas before moving to another state");
assert(report.activeStateCount === 1, "Exactly one state can be active at a time");
assert(report.sequentialStateGate.rule === "finish-current-state-before-next-state", "Continuation must enforce state-by-state sequencing");
assert(report.sequentialStateGate.nextState === "CA", "California should be next only after Texas is complete");
const texas = report.states.find((state) => state.state === "TX");
const california = report.states.find((state) => state.state === "CA");
assert(texas && texas.status === "active-state-finish-before-next-state", "Texas must be the active continuation state");
assert(california && california.status === "blocked-until-prior-state-complete", "California must be blocked until Texas is complete");
assert(texas.nextCounties.every((county) => county.canStartNow === true && county.workOrder.startsWith("1.")), "Every Texas county should be startable now in order");
assert(report.states.filter((state) => state.state !== "TX").every((state) => state.nextCounties.every((county) => county.canStartNow === false && county.blockedByState)), "Non-Texas counties must be blocked by the prior state");
assert(report.states.every((state) => state.nextCounties.every((county) => county.activationStatus === "do-not-activate-until-source-and-qa-verified")), "Continuation counties must stay inactive until source and QA verification");
assert(report.activationRules.some((rule) => rule.includes("Do not activate")), "Continuation report must document the activation gate");
assert(report.activationRules.some((rule) => rule.includes("Finish every queued county")), "Continuation report must document state-by-state completion");
assert(reportMd.includes("Started-State County Continuation"), "Continuation markdown report must exist");
assert(reportMd.includes("Current state: TX"), "Continuation markdown must identify the current state");
assert(reportMd.includes("State gate: finish-current-state-before-next-state"), "Continuation markdown must show the state gate");
assert(reportMd.includes("New-state migration blocked: yes"), "Continuation markdown must make the no-new-state rule visible");

console.log("White Rabbit started-state county continuation tests passed.");
