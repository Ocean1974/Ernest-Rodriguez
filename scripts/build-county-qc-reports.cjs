const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adaptersDir = path.join(root, "data", "county-adapters");
const outputDir = path.join(root, "output", "county-qc");

function writeFileWithRetry(file, contents, attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.writeFileSync(file, contents);
      return;
    } catch (error) {
      const retryable = error?.code === "EBUSY" || error?.code === "EPERM";
      if (!retryable || attempt === attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 50);
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function isRemoteSource(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function statInfo(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return null;
  const stats = fs.statSync(absolute);
  return {
    exists: true,
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function discoverCountyAdapters() {
  if (!fs.existsSync(adaptersDir)) return [];
  return fs
    .readdirSync(adaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folder = path.join(adaptersDir, entry.name);
      const adapterFile = path.join(folder, "adapter.json");
      const pipelineFile = path.join(folder, "pipeline.json");
      return {
        countySlug: entry.name,
        folder,
        adapterFile,
        pipelineFile,
      };
    })
    .filter((candidate) => fs.existsSync(candidate.adapterFile));
}

function check(condition, label, details = "") {
  return {
    label,
    status: condition ? "pass" : "fail",
    details,
  };
}

function warn(condition, label, details = "") {
  return {
    label,
    status: condition ? "pass" : "warning",
    details,
  };
}

function countStatus(checks, status) {
  return checks.filter((item) => item.status === status).length;
}

function validateCounty(candidate) {
  const adapter = readJson(candidate.adapterFile);
  const isPilot = adapter.status === "pilot" || adapter.status === "template";
  const pipeline = fs.existsSync(candidate.pipelineFile) ? readJson(candidate.pipelineFile) : null;
  const schemaPath = adapter.universalParcelSchema?.schemaPath || "";
  const schema = schemaPath && exists(schemaPath) ? readJson(path.join(root, schemaPath)) : null;
  const parcelManifest = exists("public/data/parcels/manifest.json") ? readJson(path.join(root, "public/data/parcels/manifest.json")) : null;
  const permitManifest = exists("public/data/permits/manifest.json") ? readJson(path.join(root, "public/data/permits/manifest.json")) : null;
  const developmentIndex = exists("public/data/developments/parcel-development-index.json") ? readJson(path.join(root, "public/data/developments/parcel-development-index.json")) : null;

  const checks = [];
  checks.push(check(Boolean(adapter.id), "Adapter id is present"));
  checks.push(check(Boolean(adapter.countyName), "County name is present"));
  checks.push(check(Boolean(adapter.appraisalDistrictName), "Appraisal district name is present"));
  checks.push(check(Boolean(adapter.map?.geoBounds), "County map bounds are configured"));
  checks.push(check(Boolean(adapter.map?.camera), "County map camera is configured"));
  checks.push(check(Boolean(adapter.universalParcelSchema?.version), "Universal parcel schema version is configured"));
  checks.push(check(Boolean(schema), "Universal parcel schema file exists", schemaPath));
  checks.push(check(!schema || adapter.universalParcelSchema.version === schema.properties?.schemaVersion?.const, "Adapter schema version matches universal schema"));
  checks.push(check(Boolean(adapter.joinKeys?.primaryParcelAccount), "Primary parcel/account join key is documented"));
  checks.push(warn(Boolean(adapter.joinKeys?.blockLabels), "Block label join behavior is documented"));
  checks.push(warn(Boolean(adapter.joinKeys?.dimensions), "Dimension join behavior is documented"));
  checks.push(check(Boolean(adapter.ownerEnrichment?.officialJoinKey), "Owner enrichment join key is configured"));
  checks.push(check(Boolean(adapter.ownerEnrichment?.fields?.ownerName), "Owner name source field mapping is configured"));
  checks.push(warn(Boolean(adapter.ownerEnrichment?.fields?.ownerPhone), "Owner phone source field mapping is configured"));
  checks.push(warn(Boolean(adapter.ownerEnrichment?.fields?.ownerEmail), "Owner email source field mapping is documented"));
  checks.push(warn(Array.isArray(adapter.optionalLayers), "Optional county layers are declared"));
  for (const layer of adapter.optionalLayers || []) {
    checks.push(warn(Boolean(layer.id && layer.label && layer.joinBehavior), `Optional layer is documented: ${layer.id || "(missing id)"}`));
    if (layer.publicDataRoot) {
      checks.push(check(String(layer.publicDataRoot).startsWith("/data/"), `Optional layer public data root is app-safe: ${layer.id}`, layer.publicDataRoot));
    }
    if (layer.schemaPath) {
      checks.push((isPilot ? warn : check)(exists(layer.schemaPath), `Optional layer schema exists: ${layer.id}`, layer.schemaPath));
    }
    if (layer.parcelIndexSchemaPath) {
      checks.push((isPilot ? warn : check)(exists(layer.parcelIndexSchemaPath), `Optional layer parcel index schema exists: ${layer.id}`, layer.parcelIndexSchemaPath));
    }
    if (layer.manifestPath) {
      checks.push((isPilot ? warn : check)(exists(layer.manifestPath), `Optional layer manifest exists: ${layer.id}`, layer.manifestPath));
    }
    if (layer.parcelIndexPath) {
      checks.push((isPilot ? warn : check)(exists(layer.parcelIndexPath), `Optional layer parcel index exists: ${layer.id}`, layer.parcelIndexPath));
    }
    if (layer.reportPath) {
      checks.push((isPilot ? warn : check)(exists(layer.reportPath), `Optional layer source report exists: ${layer.id}`, layer.reportPath));
    }
    if (layer.status === "metadata-ready" || String(layer.id || "").includes("zoning")) {
      checks.push(check(layer.defaultVisible === false, `Optional layer stays default-off: ${layer.id}`));
    }
    if (layer.renderStrategy) {
      const strategy = String(layer.renderStrategy).toLowerCase();
      checks.push(check(strategy.includes("viewport") && (strategy.includes("build-time") || strategy.includes("offline")), `Optional layer has safe render strategy: ${layer.id}`, layer.renderStrategy));
    }
    if (layer.maxFeaturesPerViewport) {
      checks.push(check(Number(layer.maxFeaturesPerViewport) <= 750, `Optional layer viewport cap is bounded: ${layer.id}`, layer.maxFeaturesPerViewport));
    }
  }
  checks.push(check(Boolean(pipeline), "County ingestion pipeline is present"));
  checks.push(check(Boolean(pipeline?.uiConstraint?.includes("Do not redesign")), "Pipeline protects no-redesign UI constraint"));
  checks.push(check(Boolean(pipeline?.steps?.some((step) => step.id === "build-parcel-service")), "Pipeline builds parcel chunks/search"));
  checks.push(check(Boolean(pipeline?.steps?.some((step) => step.id === "build-owner-matches")), "Pipeline builds owner matches"));
  checks.push(check(Boolean(pipeline?.steps?.some((step) => step.id === "validate")), "Pipeline includes validation step"));

  for (const [key, value] of Object.entries(adapter.sourceFiles || {})) {
    if (value === "optional") {
      checks.push(warn(true, `Optional source is declared: ${key}`, value));
    } else if (isRemoteSource(value)) {
      checks.push(warn(true, `Remote source is configured: ${key}`, value));
    } else {
      checks.push((isPilot ? warn : check)(exists(value), `Source file exists: ${key}`, value));
    }
  }

  for (const requiredOutput of adapter.requiredOutputs || []) {
    if (requiredOutput.includes(" or ")) {
      const choices = requiredOutput.split(/\s+or\s+/);
      checks.push(warn(choices.some(exists), `One production output option exists: ${requiredOutput}`));
    } else {
      checks.push((isPilot ? warn : check)(exists(requiredOutput), `Required output exists: ${requiredOutput}`));
    }
  }

  if (adapter.status === "active") {
    checks.push(check(Boolean(parcelManifest), "Active county parcel manifest exists"));
    checks.push(check(!parcelManifest || parcelManifest.featureCount === adapter.verifiedCounts?.parcelGeometryFeatures, "Parcel manifest count matches verified county count"));
    checks.push(check(!parcelManifest || parcelManifest.chunkCount === adapter.verifiedCounts?.appParcelChunks, "Parcel chunk count matches verified county count"));
    checks.push(check(!parcelManifest?.searchIndexShards || Object.keys(parcelManifest.searchIndexShards.files || {}).length === adapter.verifiedCounts?.parcelSearchShards, "Parcel search shard count matches verified county count"));
    checks.push(check(Boolean(permitManifest), "Active county permit manifest exists"));
    checks.push(check(!permitManifest || permitManifest.joinedPermitCount === adapter.verifiedCounts?.permitRowsJoined, "Permit joined count matches verified county count"));
    checks.push(check(!permitManifest || permitManifest.unmatchedPermitCount === adapter.verifiedCounts?.permitRowsUnmatched, "Permit unmatched count matches verified county count"));
    checks.push(check(Boolean(developmentIndex), "Active county development index exists"));
    checks.push(check(!developmentIndex || developmentIndex.parcelCount === adapter.verifiedCounts?.parcelsWithDevelopmentSignals, "Development parcel count matches verified county count"));
  }

  const artifacts = {};
  for (const output of adapter.requiredOutputs || []) {
    if (output.includes(" or ")) continue;
    artifacts[output] = statInfo(output);
  }

  const status = countStatus(checks, "fail") > 0 ? "fail" : countStatus(checks, "warning") > 0 ? "warning" : "pass";
  return {
    generatedAt: new Date().toISOString(),
    countySlug: candidate.countySlug,
    adapterPath: path.relative(root, candidate.adapterFile),
    pipelinePath: fs.existsSync(candidate.pipelineFile) ? path.relative(root, candidate.pipelineFile) : "",
    adapterId: adapter.id,
    countyName: adapter.countyName,
    appraisalDistrictName: adapter.appraisalDistrictName,
    adapterStatus: adapter.status || "",
    status,
    passCount: countStatus(checks, "pass"),
    warningCount: countStatus(checks, "warning"),
    failCount: countStatus(checks, "fail"),
    checks,
    verifiedCounts: adapter.verifiedCounts || {},
    productionGap: adapter.productionGap || "",
    artifacts,
  };
}

function writeCountyReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const base = report.adapterId || report.countySlug;
  const jsonPath = path.join(outputDir, `${base}.json`);
  const mdPath = path.join(outputDir, `${base}.md`);
  writeFileWithRetry(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    `# County QC Report: ${report.countyName}`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Adapter: \`${report.adapterId}\``,
    `- Appraisal district: ${report.appraisalDistrictName}`,
    `- Status: ${report.status}`,
    `- Passed: ${report.passCount}`,
    `- Warnings: ${report.warningCount}`,
    `- Failures: ${report.failCount}`,
    "",
    "## Checks",
    "",
    "| Status | Check | Details |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.status} | ${item.label} | ${String(item.details || "").replace(/\|/g, "\\|")} |`),
    "",
    "## Verified Counts",
    "",
    ...Object.entries(report.verifiedCounts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Production Gap",
    "",
    report.productionGap || "No production gap documented.",
    "",
    "## UI Constraint",
    "",
    "This QC report is data plumbing only. It does not redesign or restyle any White Rabbit pages.",
    "",
  ];
  writeFileWithRetry(mdPath, lines.join("\n"));
  return { jsonPath, mdPath };
}

function writeIndex(reports) {
  const generatedAt = new Date().toISOString();
  const index = {
    generatedAt,
    countyCount: reports.length,
    passCount: reports.filter((report) => report.status === "pass").length,
    warningCount: reports.filter((report) => report.status === "warning").length,
    failCount: reports.filter((report) => report.status === "fail").length,
    counties: reports.map((report) => ({
      adapterId: report.adapterId,
      countyName: report.countyName,
      status: report.status,
      passCount: report.passCount,
      warningCount: report.warningCount,
      failCount: report.failCount,
      reportJson: `output/county-qc/${report.adapterId}.json`,
      reportMd: `output/county-qc/${report.adapterId}.md`,
    })),
  };
  writeFileWithRetry(path.join(outputDir, "index.json"), JSON.stringify(index, null, 2));
  const lines = [
    "# County QC Report Index",
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Counties checked: ${index.countyCount}`,
    `- Pass: ${index.passCount}`,
    `- Warning: ${index.warningCount}`,
    `- Fail: ${index.failCount}`,
    "",
    "| Status | County | Adapter | Report |",
    "| --- | --- | --- | --- |",
    ...index.counties.map((county) => `| ${county.status} | ${county.countyName} | \`${county.adapterId}\` | \`${county.reportMd}\` |`),
    "",
    "No page files are changed by this QC reporting step.",
    "",
  ];
  writeFileWithRetry(path.join(outputDir, "index.md"), lines.join("\n"));
  return index;
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const countyArg = process.argv.find((arg) => arg.startsWith("--county="));
  const requestedCounty = countyArg ? countyArg.slice("--county=".length).trim() : "";
  const candidates = discoverCountyAdapters().filter((candidate) => !requestedCounty || candidate.countySlug === requestedCounty);
  if (!candidates.length) throw new Error("No folder-style county adapters found.");
  const reports = candidates.map(validateCounty);
  for (const report of reports) {
    const files = writeCountyReport(report);
    console.log(`Wrote ${path.relative(root, files.jsonPath)}`);
    console.log(`Wrote ${path.relative(root, files.mdPath)}`);
  }
  if (requestedCounty) {
    console.log(JSON.stringify({ countyCount: reports.length, countyId: reports[0].adapterId, status: reports[0].status, passCount: reports[0].passCount, warningCount: reports[0].warningCount, failCount: reports[0].failCount }, null, 2));
    return;
  }
  const index = writeIndex(reports);
  console.log(`Wrote output/county-qc/index.json`);
  console.log(`Wrote output/county-qc/index.md`);
  console.log(JSON.stringify({ countyCount: index.countyCount, passCount: index.passCount, warningCount: index.warningCount, failCount: index.failCount }, null, 2));
}

main();
