const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const registryPath = path.join(root, "data", "county-importer-registry.json");
const outputDir = path.join(root, "output", "county-importer-program");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function parseArgs(argv) {
  const args = { batch: "pilot-eight", mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--batch") args.batch = String(argv[index + 1] || args.batch);
    if (argv[index] === "--sample") args.mode = "sample";
    if (argv[index] === "--full") args.mode = "full";
    if (argv[index] === "--plan") args.mode = "plan";
  }
  return args;
}

function inspectCounty(entry) {
  const adapterPath = path.join(root, "data", "county-adapters", entry.adapterFolder, "adapter.json");
  const manifestPath = path.join(root, entry.manifestPath);
  const adapterPresent = fs.existsSync(adapterPath);
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const featureCount = Number(manifest?.featureCount || 0);
  const searchIndexCount = Number(manifest?.searchIndexCount || 0);
  const sourceVerifiedFeatureCount = Number(manifest?.sourceVerifiedFeatureCount || 0);
  const skippedSourceFeatureCount = Number(manifest?.skipped || 0);
  const exactCountParity = featureCount > 0 && searchIndexCount === featureCount;
  const sourceCountStatus = !manifest || sourceVerifiedFeatureCount <= 0
    ? "unavailable"
    : sourceVerifiedFeatureCount === featureCount
      ? "exact"
      : featureCount + skippedSourceFeatureCount === sourceVerifiedFeatureCount
        ? "reconciled-skipped"
        : "reconciliation-needed";
  const joinKeyVerified = Boolean(entry.joinKey && entry.joinKey !== "source-needed");
  const executable = Boolean(entry.sampleCommand && entry.fullCommand);
  const blockers = [];
  if (!adapterPresent) blockers.push("county adapter missing");
  if (!joinKeyVerified) blockers.push("duplicate-safe join key not verified");
  if (!executable) blockers.push("reusable importer command not connected");
  if (!manifest) blockers.push("parcel service manifest missing");
  else if (!exactCountParity) blockers.push(`parcel/search count mismatch (${featureCount} parcels vs ${searchIndexCount} search records)`);
  return {
    ...entry,
    adapterPath: path.relative(root, adapterPath).replace(/\\/g, "/"),
    adapterPresent,
    manifestPresent: Boolean(manifest),
    manifestMode: manifest?.mode || (manifest ? "full-equivalent" : "missing"),
    featureCount,
    sourceVerifiedFeatureCount,
    skippedSourceFeatureCount,
    searchIndexCount,
    exactCountParity,
    sourceCountStatus,
    sourceToOutputDelta: sourceVerifiedFeatureCount > 0 ? featureCount - sourceVerifiedFeatureCount : null,
    importerReady: adapterPresent && joinKeyVerified && executable,
    parcelCoreComplete: adapterPresent && joinKeyVerified && manifest && exactCountParity,
    blockers,
  };
}

function writeReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const stem = `${report.batch}-${report.mode}`;
  const jsonPath = path.join(outputDir, `${stem}.json`);
  const mdPath = path.join(outputDir, `${stem}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const lines = [
    "# County Importer Program",
    "",
    `Generated: ${report.generatedAt}`,
    `Batch: \`${report.batch}\``,
    `Mode: \`${report.mode}\``,
    "",
    `- Counties: ${report.summary.countyCount}`,
    `- Reusable importer ready: ${report.summary.importerReadyCount}`,
    `- Parcel core complete: ${report.summary.parcelCoreCompleteCount}`,
    `- Exact parcel records: ${report.summary.exactParcelCount.toLocaleString()}`,
    `- Exact upstream source parity: ${report.summary.sourceCountExactCount}`,
    `- Reconciled source exclusions: ${report.summary.sourceCountReconciledCount}`,
    `- Source reconciliation needed: ${report.summary.sourceReconciliationNeededCount}`,
    `- Upstream count unavailable: ${report.summary.sourceCountUnavailableCount}`,
    `- Blocked: ${report.summary.blockedCount}`,
    "",
    "| County | State | Importer | Parcel records | Search parity | Source parity | Status |",
    "| --- | --- | --- | ---: | --- | --- | --- |",
    ...report.counties.map((county) => `| ${county.countyId} | ${county.state} | ${county.importerFamily} | ${county.featureCount.toLocaleString()} | ${county.exactCountParity ? "exact" : "blocked"} | ${county.sourceCountStatus}${county.sourceToOutputDelta === null || county.sourceToOutputDelta === 0 ? "" : ` (${county.sourceToOutputDelta > 0 ? "+" : ""}${county.sourceToOutputDelta})`} | ${county.parcelCoreComplete ? "parcel delivery complete" : county.blockers.join("; ")} |`),
    "",
    "## Batch expansion rule",
    "",
    report.executionRule,
    "",
    "Production activation remains controlled by county QC, freshness, lineage, optional intelligence layers, and the application feature gate.",
    "",
  ];
  fs.writeFileSync(mdPath, lines.join("\n"));
  return { jsonPath, mdPath };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = readJson(registryPath);
  const countyIds = registry.batches[args.batch];
  if (!countyIds) throw new Error(`Unknown importer batch: ${args.batch}`);
  const byId = new Map(registry.counties.map((entry) => [entry.countyId, entry]));
  const counties = countyIds.map((countyId) => {
    const entry = byId.get(countyId);
    if (!entry) throw new Error(`Batch ${args.batch} references an unregistered county: ${countyId}`);
    return inspectCounty(entry);
  });
  const blocked = counties.filter((county) => !county.importerReady);
  const report = {
    schemaVersion: "wr-county-importer-program-v1",
    generatedAt: new Date().toISOString(),
    batch: args.batch,
    mode: args.mode,
    executionRule: registry.executionRule,
    importerFamilies: registry.importerFamilies,
    summary: {
      countyCount: counties.length,
      importerReadyCount: counties.filter((county) => county.importerReady).length,
      parcelCoreCompleteCount: counties.filter((county) => county.parcelCoreComplete).length,
      exactParcelCount: counties.reduce((sum, county) => sum + county.featureCount, 0),
      sourceCountExactCount: counties.filter((county) => county.sourceCountStatus === "exact").length,
      sourceCountReconciledCount: counties.filter((county) => county.sourceCountStatus === "reconciled-skipped").length,
      sourceReconciliationNeededCount: counties.filter((county) => county.sourceCountStatus === "reconciliation-needed").length,
      sourceCountUnavailableCount: counties.filter((county) => county.sourceCountStatus === "unavailable").length,
      blockedCount: blocked.length,
    },
    counties,
  };
  const files = writeReport(report);
  console.log(`Wrote ${path.relative(root, files.jsonPath)}`);
  console.log(`Wrote ${path.relative(root, files.mdPath)}`);
  console.log(JSON.stringify(report.summary, null, 2));

  if (args.mode !== "plan") {
    if (blocked.length) throw new Error(`Importer batch execution blocked for: ${blocked.map((county) => county.countyId).join(", ")}`);
    for (const county of counties) {
      const command = args.mode === "full" ? county.fullCommand : county.sampleCommand;
      console.log(`\n[${county.importerFamily}] ${county.countyId}: ${command}`);
      execSync(command, { cwd: root, stdio: "inherit", shell: true });
    }
  }
}

main();
