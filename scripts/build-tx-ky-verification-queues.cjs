const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const completionScript = path.join(root, "scripts", "build-tx-ky-completion-gate.cjs");
const completionPath = path.join(root, "output", "tx-ky-completion-gate", "tx-ky-completion-gate.json");
const outputDir = path.join(root, "output", "tx-ky-verification-queues");
const outputJson = path.join(outputDir, "tx-ky-verification-queues.json");
const outputMd = path.join(outputDir, "tx-ky-verification-queues.md");
const batchSize = 25;

const priorityByState = {
  TX: [
    "harris-county-tx",
    "tarrant-county-tad",
    "collin-county-tx",
    "denton-county-tx",
    "travis-county-tx",
    "bexar-county-tx",
    "fort-bend-county-tx",
  ],
  KY: [
    "jefferson-ky",
    "fayette-county-ky",
    "boone-county-ky",
    "kenton-county-ky",
    "campbell-county-ky",
    "oldham-county-ky",
    "bullitt-county-ky",
  ],
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function orderCounties(counties, priorities) {
  const priorityIndex = new Map(priorities.map((adapterId, index) => [adapterId, index]));
  return [...counties].sort((a, b) => {
    const aIndex = priorityIndex.has(a.adapterId) ? priorityIndex.get(a.adapterId) : Number.MAX_SAFE_INTEGER;
    const bIndex = priorityIndex.has(b.adapterId) ? priorityIndex.get(b.adapterId) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.countyName.localeCompare(b.countyName);
  });
}

function requiredEvidence(county) {
  return [
    "official parcel geometry source provenance",
    "official appraisal/owner source provenance",
    "exact parcel geometry feature count",
    "exact appraisal/property row count",
    "exact geometry-to-appraisal join key",
    "universal parcel schema report",
    "viewport parcel chunks",
    "parcel search shards",
    "owner/appraisal join",
    "county QC with zero failures and documented warnings",
  ];
}

function stateQueue(completion, state) {
  const incomplete = orderCounties(
    completion.counties.filter((county) => county.state === state && county.status !== "core-complete"),
    priorityByState[state],
  ).map((county, index) => ({
    sequence: index + 1,
    countyId: county.censusCountyId,
    adapterId: county.adapterId,
    countyName: county.countyName,
    state,
    status: county.status,
    mapSearchReady: county.mapSearchReady,
    canActivate: false,
    activationStatus: "do-not-activate-until-county-gate-passes",
    adapterPath: county.adapterPath,
    missing: county.missing,
    requiredEvidence: requiredEvidence(county),
  }));
  const batches = chunk(incomplete, batchSize).map((counties, index) => ({
    batch: index + 1,
    countyCount: counties.length,
    startSequence: counties[0]?.sequence || 0,
    endSequence: counties[counties.length - 1]?.sequence || 0,
    counties,
  }));
  return {
    state,
    active: true,
    total: completion.summary[state].total,
    coreComplete: completion.summary[state].coreComplete,
    remaining: incomplete.length,
    batchCount: batches.length,
    activeBatch: batches[0] || { batch: 0, countyCount: 0, counties: [] },
    batches,
  };
}

function main() {
  execFileSync("node", [completionScript], { cwd: root, stdio: "pipe" });
  const completion = readJson(completionPath);
  const states = ["TX", "KY"].map((state) => stateQueue(completion, state));
  const report = {
    version: "wr-tx-ky-verification-queues-v1",
    generatedAt: new Date().toISOString(),
    source: "output/tx-ky-completion-gate/tx-ky-completion-gate.json",
    strategy:
      "Advance Texas and Kentucky concurrently in independent 25-county batches. County activation remains individual and requires official sources, exact joins/counts, viewport/search outputs, owner/appraisal readiness, and QC.",
    uiConstraint: "Do not redesign, restyle, or change visible White Rabbit behavior while Texas and Kentucky county data pipelines advance.",
    activeStates: ["TX", "KY"],
    batchSize,
    summary: {
      stateCount: states.length,
      totalCounties: states.reduce((total, state) => total + state.total, 0),
      coreComplete: states.reduce((total, state) => total + state.coreComplete, 0),
      remaining: states.reduce((total, state) => total + state.remaining, 0),
      activeBatchCountyCount: states.reduce((total, state) => total + state.activeBatch.countyCount, 0),
    },
    states,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const lines = [
    "# Texas and Kentucky Verification Queues",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.strategy,
    "",
    `- Active states: ${report.activeStates.join(", ")}`,
    `- Total counties: ${report.summary.totalCounties}`,
    `- Core-complete: ${report.summary.coreComplete}`,
    `- Remaining: ${report.summary.remaining}`,
    `- Active batch counties: ${report.summary.activeBatchCountyCount}`,
    "",
    ...states.flatMap((state) => [
      `## ${state.state} Active Batch`,
      "",
      `- Core-complete: ${state.coreComplete}/${state.total}`,
      `- Remaining: ${state.remaining}`,
      `- Batches: ${state.batchCount}`,
      "",
      "| Seq | County | Status | Missing |",
      "| ---: | --- | --- | --- |",
      ...state.activeBatch.counties.map(
        (county) => `| ${county.sequence} | ${county.countyName} | ${county.status} | ${county.missing.join(", ")} |`,
      ),
      "",
    ]),
    "## Activation rule",
    "",
    "Every queued county remains do-not-activate until its own county gate passes. Progress in one state never bypasses QC in the other.",
    "",
    "## UI constraint",
    "",
    report.uiConstraint,
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));
  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
