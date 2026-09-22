const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const countyAdaptersDir = path.join(root, "data", "county-adapters");

function usage() {
  return [
    "Usage:",
    "  node scripts/run-county-ingestion.cjs --county dallas --plan",
    "  node scripts/run-county-ingestion.cjs --county dallas --execute",
    "",
    "Default mode is --plan. Execute mode runs the adapter pipeline commands in order.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { county: "dallas", mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--county") args.county = argv[index + 1] || args.county;
    if (arg === "--execute") args.mode = "execute";
    if (arg === "--plan" || arg === "--dry-run") args.mode = "plan";
    if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function readJson(relativePath) {
  return readJsonFile(path.join(root, relativePath));
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function relativeExists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function adapterPaths(county) {
  const folder = path.join(countyAdaptersDir, county);
  return {
    folder,
    adapterFile: path.join(folder, "adapter.json"),
    pipelineFile: path.join(folder, "pipeline.json"),
  };
}

function commandList(step) {
  if (Array.isArray(step.commands)) return step.commands;
  return step.command ? [step.command] : [];
}

function validateAdapter(county, adapter, pipeline, universalSchema) {
  const errors = [];
  const warnings = [];

  if (!adapter.id) errors.push("adapter.id is required");
  if (!adapter.countyName) errors.push("adapter.countyName is required");
  if (!adapter.universalParcelSchema?.version) errors.push("adapter.universalParcelSchema.version is required");
  if (adapter.universalParcelSchema?.version !== universalSchema.properties?.schemaVersion?.const) {
    errors.push("adapter universal schema version does not match data/schemas/universal-parcel.schema.json");
  }
  if (!pipeline.steps?.length) errors.push("pipeline.steps must include at least one step");
  if (!String(pipeline.uiConstraint || "").includes("Do not redesign")) errors.push("pipeline must preserve the no-redesign UI constraint");

  for (const [key, value] of Object.entries(adapter.sourceFiles || {})) {
    const sources = Array.isArray(value) ? value : [value];
    for (const source of sources) {
      if (source === "optional") continue;
      if (!relativeExists(source)) warnings.push(`sourceFiles.${key} is not present yet: ${source}`);
    }
  }

  for (const step of pipeline.steps || []) {
    if (!step.id) errors.push("pipeline step is missing id");
    if (!step.label) errors.push(`pipeline step ${step.id || "(unknown)"} is missing label`);
    if (!commandList(step).length) errors.push(`pipeline step ${step.id || "(unknown)"} is missing command(s)`);
    for (const output of step.requiredOutputs || []) {
      if (!relativeExists(output)) warnings.push(`step ${step.id} output is not present yet: ${output}`);
    }
  }

  return { county, errors, warnings };
}

function buildPlan(county, adapter, pipeline, validation) {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    mode: "plan",
    county,
    adapterId: adapter.id,
    countyName: adapter.countyName,
    appraisalDistrictName: adapter.appraisalDistrictName,
    universalParcelSchema: adapter.universalParcelSchema,
    uiConstraint: pipeline.uiConstraint,
    validation,
    steps: pipeline.steps.map((step, index) => ({
      order: index + 1,
      id: step.id,
      label: step.label,
      commands: commandList(step),
      requiresNetwork: Boolean(step.requiresNetwork),
      requiredOutputs: step.requiredOutputs || [],
    })),
    productionTileStep: pipeline.productionTileStep,
  };
}

function writePlan(plan) {
  const outputDir = path.join(root, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonFile = path.join(outputDir, `county-ingestion-plan-${plan.adapterId}.json`);
  const mdFile = path.join(outputDir, `county-ingestion-plan-${plan.adapterId}.md`);
  fs.writeFileSync(jsonFile, JSON.stringify(plan, null, 2));
  const productionTileLines = plan.productionTileStep
    ? [
        plan.productionTileStep.handoff ? `- Handoff: \`${plan.productionTileStep.handoff}\`` : "",
        plan.productionTileStep.script ? `- Script: \`${plan.productionTileStep.script}\`` : "",
        plan.productionTileStep.expectedOutput ? `- Expected output: \`${plan.productionTileStep.expectedOutput}\`` : "",
      ].filter(Boolean)
    : ["- Not configured. County execution and activation remain blocked until a production tile handoff is documented."];
  const lines = [
    `# County Ingestion Plan: ${plan.countyName}`,
    "",
    `Generated: ${plan.generatedAt}`,
    "",
    `Adapter: \`${plan.adapterId}\``,
    `Universal parcel schema: \`${plan.universalParcelSchema.version}\``,
    "",
    "## UI Constraint",
    "",
    plan.uiConstraint,
    "",
    "## Validation",
    "",
    `- Errors: ${plan.validation.errors.length}`,
    `- Warnings: ${plan.validation.warnings.length}`,
    "",
    ...plan.validation.warnings.map((warning) => `- Warning: ${warning}`),
    "",
    "## Steps",
    "",
    ...plan.steps.flatMap((step) => [
      `### ${step.order}. ${step.label}`,
      "",
      `- Step id: \`${step.id}\``,
      `- Requires network: ${step.requiresNetwork ? "yes" : "no"}`,
      `- Commands: ${step.commands.map((command) => `\`${command}\``).join(", ")}`,
      `- Required outputs: ${step.requiredOutputs.map((output) => `\`${output}\``).join(", ") || "none"}`,
      "",
    ]),
    "## Production Tile Step",
    "",
    ...productionTileLines,
    "",
  ];
  fs.writeFileSync(mdFile, lines.join("\n"));
  return { jsonFile, mdFile };
}

function runCommands(plan) {
  if (plan.validation.errors.length) {
    throw new Error(`Cannot execute ingestion with validation errors: ${plan.validation.errors.join("; ")}`);
  }
  for (const step of plan.steps) {
    for (const command of step.commands) {
      console.log(`\n[${step.id}] ${command}`);
      execSync(command, { cwd: root, stdio: "inherit", shell: true });
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const paths = adapterPaths(args.county);
  if (!fs.existsSync(paths.adapterFile)) throw new Error(`Missing county adapter: ${path.relative(root, paths.adapterFile)}`);
  if (!fs.existsSync(paths.pipelineFile)) throw new Error(`Missing county pipeline: ${path.relative(root, paths.pipelineFile)}`);

  const adapter = readJsonFile(paths.adapterFile);
  const pipeline = readJsonFile(paths.pipelineFile);
  const universalSchema = readJson(adapter.universalParcelSchema.schemaPath);
  const validation = validateAdapter(args.county, adapter, pipeline, universalSchema);
  const plan = buildPlan(args.county, adapter, pipeline, validation);
  const files = writePlan(plan);

  if (validation.errors.length) {
    console.error(`County ingestion plan has ${validation.errors.length} error(s).`);
    validation.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log(`Wrote ${path.relative(root, files.jsonFile)}`);
  console.log(`Wrote ${path.relative(root, files.mdFile)}`);
  if (validation.warnings.length) {
    console.log(`Warnings: ${validation.warnings.length}`);
    validation.warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (args.mode === "execute") runCommands(plan);
  else console.log("Plan mode only. Re-run with --execute to run the county ingestion commands.");
}

main();
