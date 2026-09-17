const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adaptersDir = path.join(root, "data", "county-adapters");
const nextWavePath = path.join(root, "data", "state-county-growth-next-wave.json");
const outputJson = path.join(root, "output", "started-state-county-continuation.json");
const outputMd = path.join(root, "output", "started-state-county-continuation.md");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stateFromAdapter(adapter, folderName) {
  const explicitState = String(adapter.state || "").trim().toUpperCase();
  if (explicitState) return explicitState;
  const id = String(adapter.countyId || adapter.id || folderName || "").trim().toLowerCase();
  const stateMatch = id.match(/-([a-z]{2})$/);
  return stateMatch ? stateMatch[1].toUpperCase() : "";
}

function discoverStartedStates() {
  const states = new Set();
  const adapters = [];
  for (const entry of fs.readdirSync(adaptersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const adapterPath = path.join(adaptersDir, entry.name, "adapter.json");
    if (!fs.existsSync(adapterPath)) continue;
    const adapter = readJson(adapterPath);
    const state = stateFromAdapter(adapter, entry.name);
    if (!state) continue;
    states.add(state);
    adapters.push({
      adapterId: adapter.id || entry.name,
      countyName: adapter.countyName || entry.name,
      state,
      status: adapter.status || "unknown",
      adapterPath: path.relative(root, adapterPath).replace(/\\/g, "/"),
    });
  }
  return { states: [...states].sort(), adapters: adapters.sort((a, b) => a.adapterId.localeCompare(b.adapterId)) };
}

function main() {
  const nextWave = readJson(nextWavePath);
  const started = discoverStartedStates();
  const blockedWaves = [];
  const stateOrder = nextWave.waves.map((wave) => String(wave.state || "").trim().toUpperCase()).filter(Boolean);
  const currentState = stateOrder[0] || "";
  const continuationStates = nextWave.waves
    .map((wave, stateIndex) => {
      const state = String(wave.state || "").trim().toUpperCase();
      const inStartedState = started.states.includes(state);
      if (!inStartedState) blockedWaves.push(state);
      const stateCompleteGate = `complete-${state.toLowerCase()}-official-source-and-qa-verification`;
      return {
        state,
        stateSequence: stateIndex + 1,
        activeNow: inStartedState && state === currentState,
        previousStateMustBeComplete: stateIndex === 0 ? null : stateOrder[stateIndex - 1],
        stateCompletionGate: stateCompleteGate,
        status: inStartedState
          ? state === currentState
            ? "active-state-finish-before-next-state"
            : "blocked-until-prior-state-complete"
          : "blocked-new-state",
        nextCounties: inStartedState
          ? wave.nextCounties.map((county, index) => ({
              ...county,
              sequence: index + 1,
              stateSequence: stateIndex + 1,
              workOrder: `${stateIndex + 1}.${index + 1}`,
              continuationMilestone: "verify-official-sources",
              activationStatus: "do-not-activate-until-source-and-qa-verified",
              stateGate: stateCompleteGate,
              canStartNow: state === currentState,
              blockedByState: state === currentState ? null : stateOrder[stateIndex - 1],
            }))
          : [],
      };
    })
    .filter((wave) => wave.status !== "blocked-new-state");

  const totalContinuationCounties = continuationStates.reduce((total, state) => total + state.nextCounties.length, 0);
  const report = {
    version: "wr-started-state-county-continuation-v1",
    generatedAt: new Date().toISOString(),
    source: "data/state-county-growth-next-wave.json",
    uiConstraint: nextWave.uiConstraint,
    strategy: "Finish one started state at a time before moving to another state; continue only inside states already represented by White Rabbit adapter shells before migrating into additional states.",
    startedStates: started.states,
    startedAdapterCount: started.adapters.length,
    startedAdapters: started.adapters,
    stateOrder,
    currentState,
    activeStateCount: continuationStates.filter((state) => state.activeNow).length,
    continuationStateCount: continuationStates.length,
    totalContinuationCounties,
    blockedNewStates: blockedWaves,
    sequentialStateGate: {
      rule: "finish-current-state-before-next-state",
      currentState,
      nextState: stateOrder[1] || null,
      currentStateCompletionRequiredBeforeNext: currentState ? `complete-${currentState.toLowerCase()}-official-source-and-qa-verification` : null,
    },
    noNewStateMigration: blockedWaves.length === 0,
    activationRules: [
      "Do not redesign or restyle White Rabbit pages while continuing county plumbing.",
      "Finish every queued county in the active state before starting any county in the next state.",
      "Do not activate a continuation county in the visible app until official sources, viewport chunks, search shards, and QC reports are verified.",
      "Keep owner/appraisal, permits/CO, zoning, floodplain, development, and migration demand source-needed until join keys and counts are documented.",
      "Use Dallas/DCAD as the model county and keep pilot counties disabled unless their connection gate is ready.",
    ],
    states: continuationStates,
  };

  ensureDir(path.dirname(outputJson));
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

  const lines = [
    "# Started-State County Continuation",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Strategy: ${report.strategy}`,
    `- Started states: ${report.startedStates.join(", ")}`,
    `- State order: ${report.stateOrder.join(" -> ")}`,
    `- Current state: ${report.currentState}`,
    `- State gate: ${report.sequentialStateGate.rule}`,
    `- Started adapter shells: ${report.startedAdapterCount}`,
    `- Continuation states: ${report.continuationStateCount}`,
    `- Continuation counties: ${report.totalContinuationCounties}`,
    `- New-state migration blocked: ${report.noNewStateMigration ? "yes" : "no"}`,
    "",
    "## Continuation Waves",
    "",
    ...report.states.flatMap((state) => [
      `### ${state.state} - ${state.status}`,
      "",
      ...state.nextCounties.map((county) => `- ${county.workOrder}. ${county.countyName} (${county.market}) - ${county.continuationMilestone}${county.canStartNow ? "" : `; blocked by ${county.blockedByState}`}`),
      "",
    ]),
    "## Activation Rules",
    "",
    ...report.activationRules.map((rule) => `- ${rule}`),
    "",
    "## UI Constraint",
    "",
    report.uiConstraint,
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));

  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify({ states: report.continuationStateCount, counties: report.totalContinuationCounties }, null, 2));
}

main();
