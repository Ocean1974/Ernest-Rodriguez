const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const runner = path.join(root, "scripts", "run-county-ingestion.cjs");
const outputDir = path.join(root, "output", "county-batch-plan");
const defaultCounties = [
  "tarrant",
  "collin-county-tx",
  "denton-county-tx",
  "fort-bend-county-tx",
  "travis-county-tx",
  "bexar-county-tx",
];

function parseArgs(argv) {
  const args = { counties: defaultCounties, mode: "plan", outputName: "county-batch-plan" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--counties") {
      args.counties = String(argv[index + 1] || "")
        .split(",")
        .map((county) => county.trim())
        .filter(Boolean);
    }
    if (argv[index] === "--execute") args.mode = "execute";
    if (argv[index] === "--plan" || argv[index] === "--dry-run") args.mode = "plan";
    if (argv[index] === "--output-name") {
      args.outputName = String(argv[index + 1] || args.outputName)
        .trim()
        .replace(/[^a-z0-9-]+/gi, "-")
        .replace(/^-+|-+$/g, "");
    }
  }
  if (!args.counties.length) throw new Error("At least one county adapter folder is required.");
  if (!args.outputName) throw new Error("Batch output name cannot be empty.");
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function planCounty(county) {
  execFileSync("node", [runner, "--county", county, "--plan"], { cwd: root, stdio: "pipe" });
  const adapter = readJson(path.join(root, "data", "county-adapters", county, "adapter.json"));
  const planPath = path.join(root, "output", `county-ingestion-plan-${adapter.id}.json`);
  const plan = readJson(planPath);
  return {
    countyFolder: county,
    adapterId: plan.adapterId,
    countyName: plan.countyName,
    validationErrorCount: plan.validation.errors.length,
    validationWarningCount: plan.validation.warnings.length,
    sourceAndOutputReady: plan.validation.errors.length === 0 && plan.validation.warnings.length === 0,
    planPath: path.relative(root, planPath).replace(/\\/g, "/"),
    warnings: plan.validation.warnings,
    steps: plan.steps.map((step) => ({
      id: step.id,
      requiresNetwork: step.requiresNetwork,
      requiredOutputs: step.requiredOutputs,
    })),
  };
}

function writeReport(report, outputJson, outputMd) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const lines = [
    "# County Batch Plan",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Mode: ${report.mode}`,
    `- Counties: ${report.summary.countyCount}`,
    `- Ready for execution: ${report.summary.readyCount}`,
    `- Blocked: ${report.summary.blockedCount}`,
    "",
    "| County | Adapter | Errors | Warnings | Execution |",
    "| --- | --- | ---: | ---: | --- |",
    ...report.counties.map(
      (county) =>
        `| ${county.countyName} | \`${county.adapterId}\` | ${county.validationErrorCount} | ${county.validationWarningCount} | ${county.sourceAndOutputReady ? "ready" : "blocked"} |`,
    ),
    "",
    "## Safety rule",
    "",
    report.executionRule,
    "",
    "## Blockers",
    "",
    ...report.counties.flatMap((county) => [
      `### ${county.countyName}`,
      "",
      ...(county.warnings.length ? county.warnings.map((warning) => `- ${warning}`) : ["- None"]),
      "",
    ]),
    "## UI constraint",
    "",
    report.uiConstraint,
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputJson = path.join(outputDir, `${args.outputName}.json`);
  const outputMd = path.join(outputDir, `${args.outputName}.md`);
  const counties = args.counties.map(planCounty);
  const blocked = counties.filter((county) => !county.sourceAndOutputReady);
  const report = {
    version: "wr-county-batch-plan-v1",
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    outputName: args.outputName,
    uiConstraint: "Do not redesign or change visible White Rabbit behavior while batch county pipelines are incomplete.",
    executionRule:
      "Batch execute mode is refused unless every selected county has zero adapter validation errors and zero missing-source/output warnings.",
    summary: {
      countyCount: counties.length,
      readyCount: counties.length - blocked.length,
      blockedCount: blocked.length,
    },
    counties,
  };
  writeReport(report, outputJson, outputMd);

  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));

  if (args.mode === "execute" && blocked.length) {
    throw new Error(`Batch execution blocked for ${blocked.length} county adapter(s) with unresolved validation warnings.`);
  }
  if (args.mode === "execute") {
    for (const county of counties) {
      execFileSync("node", [runner, "--county", county.countyFolder, "--execute"], { cwd: root, stdio: "inherit" });
    }
  }
}

main();
