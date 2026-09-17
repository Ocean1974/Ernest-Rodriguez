const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const completionScript = path.join(root, "scripts", "build-tx-ky-completion-gate.cjs");
const completionPath = path.join(root, "output", "tx-ky-completion-gate", "tx-ky-completion-gate.json");
const outputDir = path.join(root, "output", "texas-county-verification-queue");
const outputJson = path.join(outputDir, "texas-county-verification-queue.json");
const outputMd = path.join(outputDir, "texas-county-verification-queue.md");
const batchSize = 25;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readAdapter(county) {
  if (!county.adapterPath || !exists(county.adapterPath)) return null;
  return readJson(path.join(root, county.adapterPath));
}

function requiredEvidenceFor(county) {
  const evidence = [
    "official parcel geometry source URL or local file provenance",
    "official appraisal/owner source URL or local file provenance",
    "exact parcel geometry feature count",
    "exact appraisal/property row count",
    "exact join key from geometry to appraisal/account records",
    "schema report JSON and markdown",
    "join-key report markdown",
    "viewport-safe parcel manifest/chunks",
    "parcel search shards",
    "QC report with pass or documented warning",
  ];

  if (county.missing.includes("owner-appraisal-ready")) {
    evidence.push("owner/appraisal field map with owner name and mailing fields from official source");
  }
  if (county.missing.includes("source-needed-fields-or-join-keys")) {
    evidence.push("all source-needed placeholders replaced or documented as unavailable");
  }
  return evidence;
}

function nextPhase(county) {
  if (county.status === "partial-map-search-ready") {
    return "complete-owner-appraisal-join-and-qc";
  }
  return "official-source-discovery-and-ingest";
}

function sourceQueries(adapter, county) {
  const adapterQueries = adapter?.publicSourceDiscovery?.sourceSearchQueries || [];
  if (adapterQueries.length) return adapterQueries;
  return [
    `${county.countyName} Texas official parcel GIS data`,
    `${county.countyName} Texas appraisal district bulk data`,
    `${county.countyName} Texas official property search parcel account`,
  ];
}

function queueItem(county, sequence) {
  const adapter = readAdapter(county);
  return {
    sequence,
    countyId: county.censusCountyId,
    adapterId: county.adapterId,
    countyName: county.countyName,
    state: county.state,
    fips: county.fips,
    status: county.status,
    nextPhase: nextPhase(county),
    adapterPath: county.adapterPath,
    missing: county.missing,
    requiredEvidence: requiredEvidenceFor(county),
    sourceSearchQueries: sourceQueries(adapter, county),
    sourceRules: adapter?.publicSourceDiscovery?.sourceRules || [
      "Use official county, assessor/appraiser, GIS, municipal, state, or federal sources first.",
      "Do not activate this county until exact parcel counts and join keys are verified.",
      "Do not infer owner phone/email from permits, contractors, applicants, or scraped pages.",
    ],
    requiredOutputs: adapter?.requiredOutputs || [],
  };
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function main() {
  execFileSync("node", [completionScript], { cwd: root, stdio: "pipe" });
  const completion = readJson(completionPath);
  const texasIncomplete = completion.counties
    .filter((county) => county.state === "TX" && county.status !== "core-complete")
    .map((county, index) => queueItem(county, index + 1));
  const batches = chunk(texasIncomplete, batchSize).map((items, index) => ({
    batch: index + 1,
    startSequence: items[0]?.sequence || 0,
    endSequence: items[items.length - 1]?.sequence || 0,
    countyCount: items.length,
    counties: items,
  }));
  const activeBatch = batches[0] || { batch: 0, countyCount: 0, counties: [] };
  const report = {
    version: "wr-texas-county-verification-queue-v1",
    generatedAt: new Date().toISOString(),
    source: "output/tx-ky-completion-gate/tx-ky-completion-gate.json",
    method: "Texas state queue. Finish the active Texas batch in sequence while Kentucky advances through its own independently QC-gated queue.",
    completionRule: completion.completionRule,
    stateGate: completion.stateGate,
    summary: {
      texasTotal: completion.summary.TX.total,
      texasCoreComplete: completion.summary.TX.coreComplete,
      texasRemaining: texasIncomplete.length,
      batchSize,
      batchCount: batches.length,
      activeBatch: activeBatch.batch,
      kentuckyConcurrent: completion.stateGate.kentuckyCanAdvance === true,
    },
    activeBatch,
    batches,
  };

  ensureDir(outputDir);
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const lines = [
    "# Texas County Verification Queue",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.method,
    "",
    "## Summary",
    "",
    `- Texas core-complete: ${report.summary.texasCoreComplete}/${report.summary.texasTotal}`,
    `- Texas remaining: ${report.summary.texasRemaining}`,
    `- Batch size: ${report.summary.batchSize}`,
    `- Batch count: ${report.summary.batchCount}`,
    `- Active batch: ${report.summary.activeBatch}`,
    `- Kentucky concurrent: ${report.summary.kentuckyConcurrent}`,
    "",
    "## Active Batch",
    "",
    "| Seq | County | Status | Next phase | Missing |",
    "| --- | --- | --- | --- | --- |",
    ...activeBatch.counties.map((county) => `| ${county.sequence} | ${county.countyName} | ${county.status} | ${county.nextPhase} | ${county.missing.join(", ")} |`),
    "",
    "## Required Evidence",
    "",
    "Every county must have official source provenance, exact counts, exact join keys, viewport/search outputs, and QC before it can move to core-complete.",
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));
  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
