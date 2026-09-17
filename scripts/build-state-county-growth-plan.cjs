const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const inputPath = path.join(root, "data", "state-county-growth-next-wave.json");
const parityPath = path.join(root, "output", "county-dcad-parity-backlog.json");
const outputJson = path.join(root, "output", "state-county-growth-plan.json");
const outputMd = path.join(root, "output", "state-county-growth-plan.md");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const nextWave = readJson(inputPath);
  const parity = fs.existsSync(parityPath) ? readJson(parityPath) : null;
  const existingCountyIds = new Set((parity?.counties || []).map((county) => county.countyId));
  const states = nextWave.waves.map((wave) => ({
    state: wave.state,
    nextCounties: wave.nextCounties.map((county, index) => ({
      ...county,
      sequence: index + 1,
      alreadyTracked: existingCountyIds.has(county.countyId),
      nextMilestone: "verify-official-sources",
      requiredSourceGroups: [
        "parcel-geometry",
        "parcel-ids",
        "owner-appraisal",
        "viewport-search",
        "qa",
        "permits-certificates",
        "zoning",
        "floodplain",
        "development-signals",
        "migration-demand",
      ],
    })),
  }));
  const totalNextCounties = states.reduce((total, state) => total + state.nextCounties.length, 0);
  const report = {
    version: "wr-state-county-growth-plan-v1",
    generatedAt: new Date().toISOString(),
    source: "data/state-county-growth-next-wave.json",
    uiConstraint: nextWave.uiConstraint,
    strategy: nextWave.strategy,
    currentTrackedCountyCount: parity?.summary?.countyCount || 0,
    nextWaveStateCount: states.length,
    totalNextCounties,
    states,
  };

  ensureDir(path.dirname(outputJson));
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

  const lines = [
    "# State County Growth Plan",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Strategy: ${report.strategy}`,
    `- Existing tracked counties: ${report.currentTrackedCountyCount}`,
    `- States in next wave: ${report.nextWaveStateCount}`,
    `- Next counties: ${report.totalNextCounties}`,
    "",
    "## State Waves",
    "",
    ...report.states.flatMap((state) => [
      `### ${state.state}`,
      "",
      ...state.nextCounties.map((county) => `- ${county.sequence}. ${county.countyName} (${county.market}) - ${county.nextMilestone}`),
      "",
    ]),
    "## UI Constraint",
    "",
    report.uiConstraint,
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));

  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify({ states: report.nextWaveStateCount, nextCounties: report.totalNextCounties }, null, 2));
}

main();
