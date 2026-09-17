const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "output", "priority-county-promotion");
const outputJson = path.join(outputDir, "priority-county-promotion-gate.json");
const outputMd = path.join(outputDir, "priority-county-promotion-gate.md");

const targets = [
  { group: "map-search-pilot", adapterId: "jefferson-ky", adapterPath: "data/county-adapters/louisville/adapter.json" },
  { group: "map-search-pilot", adapterId: "harris-county-tx", adapterPath: "data/county-adapters/harris-county-tx/adapter.json" },
  { group: "map-search-pilot", adapterId: "maricopa-county-az", adapterPath: "data/county-adapters/maricopa-county-az/adapter.json" },
  { group: "map-search-pilot", adapterId: "king-county-wa", adapterPath: "data/county-adapters/king-county-wa/adapter.json" },
  { group: "texas-priority-build", adapterId: "tarrant-county-tad", adapterPath: "data/county-adapters/tarrant/adapter.json", planId: "tarrant-county-tad" },
  { group: "texas-priority-build", adapterId: "collin-county-tx", adapterPath: "data/county-adapters/collin-county-tx/adapter.json" },
  { group: "texas-priority-build", adapterId: "denton-county-tx", adapterPath: "data/county-adapters/denton-county-tx/adapter.json" },
  { group: "texas-priority-build", adapterId: "fort-bend-county-tx", adapterPath: "data/county-adapters/fort-bend-county-tx/adapter.json" },
  { group: "texas-priority-build", adapterId: "travis-county-tx", adapterPath: "data/county-adapters/travis-county-tx/adapter.json" },
  { group: "texas-priority-build", adapterId: "bexar-county-tx", adapterPath: "data/county-adapters/bexar-county-tx/adapter.json" },
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function placeholderPaths(value, prefix = "") {
  if (typeof value === "string") {
    return value.includes("source-needed") || value.includes("placeholder") ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => placeholderPaths(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => placeholderPaths(item, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

function auditByCounty() {
  const audit = readJson("output/texas-source-audit/texas-source-audit.json");
  return new Map((audit.counties || []).map((item) => [item.countyId, item]));
}

function censusCountyId(adapterId) {
  if (adapterId === "tarrant-county-tad") return "tarrant-county-tx";
  return adapterId;
}

function gateRecord(target, audits, parityById) {
  const adapter = readJson(target.adapterPath);
  const qcPath = `output/county-qc/${target.adapterId}.json`;
  const qc = exists(qcPath) ? readJson(qcPath) : null;
  const verified = qc?.verifiedCounts || adapter.verifiedCounts || {};
  const warnings = (qc?.checks || []).filter((check) => check.status === "warning");
  const failures = (qc?.checks || []).filter((check) => check.status === "fail");
  const placeholders = placeholderPaths({
    sourceFiles: adapter.sourceFiles || {},
    joinKeys: adapter.joinKeys || {},
    ownerEnrichment: adapter.ownerEnrichment || {},
  });
  const counts = {
    parcelGeometryFeatures: Number(verified.parcelGeometryFeatures || 0),
    appParcelChunks: Number(verified.appParcelChunks || 0),
    parcelSearchShards: Number(verified.parcelSearchShards || 0),
  };
  const checks = {
    qcPresent: Boolean(qc),
    qcPass: qc?.status === "pass",
    qcZeroFailures: failures.length === 0,
    qcZeroWarnings: warnings.length === 0,
    exactParcelCountVerified: counts.parcelGeometryFeatures > 0,
    viewportChunksBuilt: counts.appParcelChunks > 0,
    searchShardsBuilt: counts.parcelSearchShards > 0,
    sourceAndJoinPlaceholdersCleared: placeholders.length === 0,
  };
  const promotionReady = Object.values(checks).every(Boolean);
  const blockers = [];
  if (!checks.qcPresent) blockers.push("county QC report is missing");
  if (!checks.qcPass) blockers.push(`county QC status is ${qc?.status || "missing"}`);
  if (!checks.qcZeroFailures) blockers.push(`${failures.length} QC failure(s) remain`);
  if (!checks.qcZeroWarnings) blockers.push(`${warnings.length} QC warning(s) remain`);
  if (!checks.exactParcelCountVerified) blockers.push("exact parcel geometry count is not verified");
  if (!checks.viewportChunksBuilt) blockers.push("viewport parcel chunks are not built");
  if (!checks.searchShardsBuilt) blockers.push("parcel search shards are not built");
  if (!checks.sourceAndJoinPlaceholdersCleared) blockers.push(`${placeholders.length} source/join placeholder path(s) remain`);

  const audit = audits.get(censusCountyId(target.adapterId));
  const parity = parityById.get(target.adapterId);
  const planId = target.planId || target.adapterId;
  const planPath = `output/county-ingestion-plan-${planId}.json`;
  const plan = exists(planPath) ? readJson(planPath) : null;

  return {
    group: target.group,
    adapterId: target.adapterId,
    countyName: adapter.countyName,
    state: adapter.state,
    adapterStatus: adapter.status,
    enabledForProduction: adapter.enabledForProduction === true,
    promotionReady,
    safeVisibleActivation: promotionReady ? "eligible-after-explicit-product-activation" : "do-not-activate",
    checks,
    counts,
    qc: {
      status: qc?.status || "missing",
      warningCount: warnings.length,
      failureCount: failures.length,
      warningLabels: warnings.map((warning) => warning.label),
      failureLabels: failures.map((failure) => failure.label),
    },
    placeholderPaths: placeholders,
    blockers,
    parity: parity
      ? {
          parityPercent: parity.parityPercent,
          nextMilestone: parity.nextMilestone,
          missingGroups: parity.missingGroups,
        }
      : null,
    sourceAudit: audit
      ? {
          completionImpact: audit.completionImpact,
          officialPortalCount: audit.officialPortals?.length || 0,
          verifiedOfficialPortalCount: (audit.officialPortals || []).filter((portal) =>
            ["official-site-verified", "linked-from-official-site"].includes(portal.verificationStatus),
          ).length,
          remainingBlockers: audit.remainingBlockers || [],
        }
      : null,
    ingestionPlan: plan
      ? {
          path: planPath,
          validationErrorCount: plan.validation?.errors?.length || 0,
          validationWarningCount: plan.validation?.warnings?.length || 0,
        }
      : null,
  };
}

function main() {
  const audits = auditByCounty();
  const parity = readJson("output/county-dcad-parity-backlog.json");
  const parityById = new Map((parity.counties || []).map((item) => [item.countyId, item]));
  const counties = targets.map((target) => gateRecord(target, audits, parityById));
  const report = {
    version: "wr-priority-county-promotion-gate-v1",
    generatedAt: new Date().toISOString(),
    uiConstraint: "Do not redesign or change visible White Rabbit behavior while county production gates are incomplete.",
    promotionRule:
      "Promotion requires passing QC with zero warnings/failures, exact parcel counts, viewport chunks, search shards, and no source-needed or placeholder source/join fields.",
    summary: {
      targetCount: counties.length,
      mapSearchPilotCount: counties.filter((county) => county.group === "map-search-pilot").length,
      texasPriorityBuildCount: counties.filter((county) => county.group === "texas-priority-build").length,
      promotionReadyCount: counties.filter((county) => county.promotionReady).length,
      blockedCount: counties.filter((county) => !county.promotionReady).length,
    },
    counties,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const lines = [
    "# Priority County Promotion Gate",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.promotionRule,
    "",
    `- Targets: ${report.summary.targetCount}`,
    `- Promotion ready: ${report.summary.promotionReadyCount}`,
    `- Blocked: ${report.summary.blockedCount}`,
    "",
    "| County | Group | QC | Parcels | Chunks | Search shards | Promotion |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...counties.map(
      (county) =>
        `| ${county.countyName} | ${county.group} | ${county.qc.status} (${county.qc.warningCount} warnings) | ${county.counts.parcelGeometryFeatures} | ${county.counts.appParcelChunks} | ${county.counts.parcelSearchShards} | ${county.promotionReady ? "ready" : "blocked"} |`,
    ),
    "",
    "## Exact blockers",
    "",
    ...counties.flatMap((county) => [
      `### ${county.countyName}`,
      "",
      ...county.blockers.map((blocker) => `- ${blocker}`),
      ...county.qc.warningLabels.map((warning) => `- QC: ${warning}`),
      "",
    ]),
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
