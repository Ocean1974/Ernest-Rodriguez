const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const inputDir = path.join(root, "data", "county-source-audits");
const texasQueueJson = path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.json");
const outputDir = path.join(root, "output", "texas-source-audit");
const aggregateOutputJson = path.join(outputDir, "texas-source-audit.json");
const aggregateOutputMd = path.join(outputDir, "texas-source-audit.md");

const DCAD_PARITY_BLOCKERS = [
  "official parcel geometry bulk source not verified",
  "bulk appraisal/owner source not verified",
  "exact parcel count not verified",
  "exact geometry-to-appraisal join key not verified",
  "owner/appraisal parcel window join not built",
  "ParcelDimension-equivalent source not verified",
  "BLKID/block-grid equivalent source not verified",
  "viewport chunks not built",
  "search shards not built",
  "county QA reports not generated",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function withDcadParityBlockers(county) {
  return {
    ...county,
    dcadParityStatus: "source-discovery-started-not-dcad-parity",
    dcadParityBlockers: Array.from(new Set([...(county.remainingBlockers || []), ...DCAD_PARITY_BLOCKERS])),
    safeVisibleActivation: "do-not-activate",
  };
}

function inputFiles() {
  return fs.readdirSync(inputDir)
    .filter((file) => /^tx-batch-\d+-official-portals\.json$/.test(file))
    .sort()
    .map((file) => path.join(inputDir, file));
}

function batchSlug(audit) {
  const match = audit.version.match(/wr-(tx-batch-\d+)-official-portals-v1/);
  if (!match) throw new Error(`Cannot derive batch slug from ${audit.version}`);
  return match[1];
}

function buildReport(audit) {
  const counties = audit.counties.map(withDcadParityBlockers);
  return {
    ...audit,
    counties,
    generatedAt: new Date().toISOString(),
    completionRule: audit.rule,
    dcadParityRule: "Official portal discovery does not make a Texas county DCAD-like. Each county remains do-not-activate until the DCAD parcel-window fields, counts, join keys, viewport chunks, search shards, and QA reports are complete.",
    summary: {
      countyCount: counties.length,
      officialSiteVerified: counties.filter((county) => county.officialPortals.some((portal) => portal.verificationStatus === "official-site-verified")).length,
      portalReachableTextLimited: counties.filter((county) => county.officialPortals.some((portal) => portal.verificationStatus === "portal-reachable-text-limited")).length,
      privateNotOfficial: counties.filter((county) => county.officialPortals.some((portal) => portal.verificationStatus === "private-not-official")).length,
      promotedToCoreComplete: 0,
      dcadParityReady: 0,
    },
  };
}

function texasQueueEntries() {
  if (!fs.existsSync(texasQueueJson)) return [];
  const queue = readJson(texasQueueJson);
  const records = [];
  const seen = new Set();
  for (const batch of [queue.activeBatch, ...(queue.batches || [])].filter(Boolean)) {
    if (!Array.isArray(batch.counties)) continue;
    for (const county of batch.counties) {
      if (!county.countyId || seen.has(county.countyId)) continue;
      seen.add(county.countyId);
      records.push({
        ...county,
        queueBatch: batch.batch,
      });
    }
  }
  return records.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

function unauditedQueueCounty(entry) {
  return withDcadParityBlockers({
    countyId: entry.countyId,
    countyName: entry.countyName,
    state: entry.state || "TX",
    officialPortals: [],
    completionImpact: "source-queue-not-yet-audited",
    remainingBlockers: [
      "official source audit not started",
      "official appraisal district site not verified",
      "property search not inspected",
      "parcel ID field names not verified",
      "exact parcel count not verified",
      "exact geometry-to-appraisal join key not verified",
      "viewport/search outputs not built",
    ],
    auditVersion: "texas-verification-queue",
    auditScope: `Texas verification queue batch ${entry.queueBatch}`,
  });
}

function writeBatchReport(report) {
  const slug = batchSlug(report);
  const displayBatch = slug.replace("tx-batch-", "Batch ");
  const outputJson = path.join(outputDir, `${slug}-source-audit.json`);
  const outputMd = path.join(outputDir, `${slug}-source-audit.md`);
  ensureDir(outputDir);
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const lines = [
    `# Texas ${displayBatch} Source Audit`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.completionRule,
    "",
    report.dcadParityRule,
    "",
    "## Summary",
    "",
    `- Counties audited: ${report.summary.countyCount}`,
    `- Official sites verified: ${report.summary.officialSiteVerified}`,
    `- Reachable but text-limited portals: ${report.summary.portalReachableTextLimited}`,
    `- Private/non-official candidates: ${report.summary.privateNotOfficial}`,
    `- Promoted to core-complete: ${report.summary.promotedToCoreComplete}`,
    `- DCAD parity ready: ${report.summary.dcadParityReady}`,
    "",
    "## Counties",
    "",
    "| County | Completion impact | Safe activation | Official portals | Remaining blockers | DCAD parity blockers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.counties.map((county) => {
      const portals = county.officialPortals.map((portal) => `${portal.label} (${portal.verificationStatus})`).join("; ");
      return `| ${county.countyName} | ${county.completionImpact} | ${county.safeVisibleActivation} | ${portals} | ${county.remainingBlockers.join(", ")} | ${county.dcadParityBlockers.join(", ")} |`;
    }),
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));
  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
}

function writeAggregateReport(reports) {
  const auditedCounties = reports.flatMap((report) => report.counties.map((county) => ({
    ...county,
    auditVersion: report.version,
    auditScope: report.scope,
  })));
  const auditedIds = new Set(auditedCounties.map((county) => county.countyId));
  const queuedNotYetAudited = texasQueueEntries()
    .filter((entry) => !auditedIds.has(entry.countyId))
    .map(unauditedQueueCounty);
  const counties = [...auditedCounties, ...queuedNotYetAudited];
  const report = {
    version: "wr-texas-source-audit-v1",
    generatedAt: new Date().toISOString(),
    sourceBatches: reports.map((item) => item.version),
    completionRule: "Official portals are evidence for source discovery only. They do not make a county core-complete until exact counts, join keys, bulk/source provenance, viewport chunks, search shards, and QC are verified.",
    dcadParityRule: "Official portal discovery does not make a Texas county DCAD-like. Each county remains do-not-activate until the DCAD parcel-window fields, counts, join keys, viewport chunks, search shards, and QA reports are complete.",
    summary: {
      batchCount: reports.length,
      countyCount: counties.length,
      officialSiteVerified: reports.reduce((total, item) => total + compactNumber(item.summary.officialSiteVerified), 0),
      portalDiscoveredSourceFilesNeeded: reports.reduce((total, item) => total + compactNumber(item.summary.portalDiscoveredSourceFilesNeeded), 0),
      officialSiteCandidateNeedsVerification: reports.reduce((total, item) => total + compactNumber(item.summary.officialSiteCandidateNeedsVerification), 0),
      privateNotOfficial: reports.reduce((total, item) => total + compactNumber(item.summary.privateNotOfficial), 0),
      sourceQueueNotYetAudited: queuedNotYetAudited.length,
      promotedToCoreComplete: 0,
      dcadParityReady: 0,
    },
    counties,
  };

  fs.writeFileSync(aggregateOutputJson, JSON.stringify(report, null, 2));
  const lines = [
    "# Texas Source Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.completionRule,
    "",
    report.dcadParityRule,
    "",
    "## Summary",
    "",
    `- Batches audited: ${report.summary.batchCount}`,
    `- Counties audited: ${report.summary.countyCount}`,
    `- Official sites verified: ${report.summary.officialSiteVerified}`,
    `- Portal discovered, source files needed: ${report.summary.portalDiscoveredSourceFilesNeeded}`,
    `- Official-site candidates needing verification: ${report.summary.officialSiteCandidateNeedsVerification}`,
    `- Private/non-official candidates: ${report.summary.privateNotOfficial}`,
    `- Source queue not yet audited: ${report.summary.sourceQueueNotYetAudited}`,
    `- Promoted to core-complete: ${report.summary.promotedToCoreComplete}`,
    `- DCAD parity ready: ${report.summary.dcadParityReady}`,
    "",
    "## Counties",
    "",
    "| County | Batch | Completion impact | Safe activation | Remaining blockers |",
    "| --- | --- | --- | --- | --- |",
    ...report.counties.map((county) => `| ${county.countyName} | ${county.auditVersion} | ${county.completionImpact} | ${county.safeVisibleActivation} | ${county.dcadParityBlockers.join(", ")} |`),
    "",
  ];
  fs.writeFileSync(aggregateOutputMd, lines.join("\n"));
  console.log(`Wrote ${path.relative(root, aggregateOutputJson)}`);
  console.log(`Wrote ${path.relative(root, aggregateOutputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

function compactNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function main() {
  const reports = inputFiles().map((file) => buildReport(readJson(file)));
  for (const report of reports) writeBatchReport(report);
  writeAggregateReport(reports);
}

main();
