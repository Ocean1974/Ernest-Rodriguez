const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const gateJson = path.join(root, "output", "county-connection-gate.json");
const texasQueueJson = path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.json");
const outputJson = path.join(root, "output", "county-dcad-parity-backlog.json");
const outputMd = path.join(root, "output", "county-dcad-parity-backlog.md");

const DCAD_GROUPS = [
  "identity",
  "address",
  "owner-contact",
  "appraisal-values",
  "land-building",
  "geometry",
  "parcel-dimensions",
  "block-grid",
  "zoning",
  "floodplain",
  "permits-certificates",
  "development-signals",
  "migration-demand",
  "source-lineage",
];

const REQUIRED_FOR_MAP_SEARCH = ["identity", "geometry", "source-lineage"];
const REQUIRED_FOR_DCAD_WINDOW = DCAD_GROUPS.filter((group) => group !== "migration-demand");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function tryReadJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function compactNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function nextMilestone(county) {
  if (county.activationStage === "production-active") return "hold-dcad-model";
  if (!county.parcelService?.fullParcelServiceReady) return "build-full-parcel-service";
  if (!county.layerReadiness || county.layerReadiness.qa !== "ready") return "finish-source-lineage-qc";
  if (county.missingDcadLikeGroups?.some((group) => ["owner-contact", "appraisal-values", "land-building", "address"].includes(group))) {
    return "join-owner-appraisal-window";
  }
  if (county.missingDcadLikeGroups?.some((group) => ["permits-certificates", "zoning", "floodplain"].includes(group))) {
    return "close-intelligence-layers";
  }
  if (county.missingDcadLikeGroups?.includes("development-signals")) return "build-development-signals";
  if (county.missingDcadLikeGroups?.includes("migration-demand")) return "add-migration-demand";
  return "activation-review";
}

function actionForMilestone(milestone, county) {
  if (milestone === "hold-dcad-model") return "Keep Dallas locked as the active production county and use its counts and join keys as the model.";
  if (milestone === "build-full-parcel-service") return "Verify official parcel geometry and owner/appraisal sources, then build viewport chunks and search shards.";
  if (milestone === "finish-source-lineage-qc") return "Generate schema, join-key, full-access, and county QA reports with exact counts.";
  if (milestone === "join-owner-appraisal-window") return "Join official owner, mailing, situs, land, building, value, legal, and land-use fields to the parcel service.";
  if (milestone === "close-intelligence-layers") {
    const missing = county.missingDcadLikeGroups || county.missingGroups || [];
    return missing.length
      ? `Close the remaining intelligence gaps: ${missing.join(", ")}. Preserve exact parcel keys, unmatched records, and source coverage.`
      : "Run final intelligence-layer certification and activation review.";
  }
  if (milestone === "build-development-signals") return "Build parcel-indexed development, permit, ownership, and market activity signals.";
  if (milestone === "add-migration-demand") return "Join aggregate demand geography to parcels without using individual-person data.";
  return `Run activation review for ${county.countyName} after all DCAD-like groups are ready.`;
}

function buildRecord(county) {
  const missing = county.missingDcadLikeGroups || [];
  const readyGroups = DCAD_GROUPS.filter((group) => !missing.includes(group));
  const milestone = nextMilestone(county);
  const parcelFeatureCount = compactNumber(county.parcelService?.featureCount);
  const sourceVerifiedFeatureCount = compactNumber(county.parcelService?.sourceVerifiedFeatureCount || county.sourceCounts?.verifiedParcelCount);

  return {
    countyId: county.countyId,
    countyName: county.countyName,
    state: county.state,
    market: county.market,
    activationStage: county.activationStage,
    safeVisibleActivation: county.safeVisibleActivation,
    mapSearchReady: Boolean(county.mapSearchReady),
    dcadLikeWindowReady: Boolean(county.dcadLikeWindowReady),
    parityScore: {
      readyGroups: readyGroups.length,
      totalGroups: DCAD_GROUPS.length,
      percent: Number(((readyGroups.length / DCAD_GROUPS.length) * 100).toFixed(1)),
    },
    parcelService: {
      featureCount: parcelFeatureCount,
      sourceVerifiedFeatureCount,
      chunkCount: compactNumber(county.parcelService?.chunkCount),
      searchShardCount: compactNumber(county.parcelService?.searchShardCount),
      fullParcelServiceReady: Boolean(county.parcelService?.fullParcelServiceReady),
    },
    readyGroups,
    missingGroups: missing,
    missingMapSearchGroups: REQUIRED_FOR_MAP_SEARCH.filter((group) => missing.includes(group)),
    missingDcadWindowGroups: REQUIRED_FOR_DCAD_WINDOW.filter((group) => missing.includes(group)),
    nextMilestone: milestone,
    nextAction: actionForMilestone(milestone, county),
    uiConstraint: "Do not redesign White Rabbit pages while closing county parity gaps.",
  };
}

function texasQueueEntries() {
  const queue = tryReadJson(texasQueueJson);
  if (!queue) return [];
  const records = [];
  const seen = new Set();
  for (const batch of [queue.activeBatch, ...(queue.batches || [])].filter(Boolean)) {
    if (!Array.isArray(batch.counties)) continue;
    for (const county of batch.counties) {
      const countyId = county.countyId || county.adapterId;
      if (!countyId || seen.has(countyId)) continue;
      seen.add(countyId);
      records.push(county);
    }
  }
  return records.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

function queueEntryToGateCounty(entry) {
  const countyId = entry.countyId || entry.adapterId;
  const adapterPath = entry.adapterPath || `data/county-adapters/${countyId}/adapter.json`;
  const adapter = tryReadJson(path.join(root, adapterPath));
  const verifiedParcelCount = compactNumber(adapter?.verifiedCounts?.parcelGeometryFeatures);
  const qaReady = fs.existsSync(path.join(root, `output/${countyId}/schema-report.json`)) ||
    fs.existsSync(path.join(root, `output/${countyId}/schema-report.md`));
  const missingDcadLikeGroups = qaReady
    ? DCAD_GROUPS.filter((group) => group !== "source-lineage")
    : [...DCAD_GROUPS];

  return {
    countyId,
    countyName: adapter?.countyName || entry.countyName,
    state: adapter?.state || entry.state || "TX",
    market: adapter?.marketName || entry.countyName,
    activationStage: verifiedParcelCount > 0 ? "source-verified-build-needed" : "source-needed",
    safeVisibleActivation: "do-not-activate",
    mapSearchReady: false,
    dcadLikeWindowReady: false,
    missingDcadLikeGroups,
    parcelService: {
      featureCount: 0,
      sourceVerifiedFeatureCount: verifiedParcelCount,
      chunkCount: 0,
      searchShardCount: 0,
      fullParcelServiceReady: false,
    },
    layerReadiness: {
      ownerAppraisal: "source-needed-or-build-needed",
      zoning: "source-needed-or-build-needed",
      floodplain: "source-needed-or-build-needed",
      permitsCo: "source-needed-or-join-needed",
      parcelDimensions: "source-needed-or-build-needed",
      blockGrid: "source-needed-or-build-needed",
      developmentSignals: "source-needed-or-build-needed",
      migrationDemand: "source-needed-or-build-needed",
      qa: qaReady ? "ready" : "missing",
    },
  };
}

function mergeTexasQueueIntoGate(gateCounties) {
  const records = [...gateCounties];
  const byId = new Map(records.map((county) => [county.countyId, county]));
  for (const entry of texasQueueEntries()) {
    const countyId = entry.countyId || entry.adapterId;
    if (!countyId || byId.has(countyId) || countyId.includes("dallas")) continue;
    const record = queueEntryToGateCounty(entry);
    records.push(record);
    byId.set(countyId, record);
  }
  return records;
}

function main() {
  if (!fs.existsSync(gateJson)) {
    throw new Error("Run npm run county:connection-gate before building the DCAD parity backlog.");
  }

  const gate = readJson(gateJson);
  const records = mergeTexasQueueIntoGate(gate.counties).map(buildRecord);
  const incomplete = records.filter((record) => record.countyId !== "dallas-county-dcad" && !record.dcadLikeWindowReady);
  const byMilestone = records.reduce((acc, record) => {
    acc[record.nextMilestone] = (acc[record.nextMilestone] || 0) + 1;
    return acc;
  }, {});

  const report = {
    version: "wr-county-dcad-parity-backlog-v1",
    generatedAt: new Date().toISOString(),
    sourceGateReport: "output/county-connection-gate.json",
    dcadModelCountyId: "dallas-county-dcad",
    uiConstraint: "Do not redesign White Rabbit pages while expanding county parcel intelligence plumbing.",
    texasRolloutRule: "Every non-Dallas Texas county remains do-not-activate until official sources, exact counts, join keys, viewport chunks, search shards, owner/appraisal joins, DCAD-like parcel-window groups, and QA are complete.",
    parityGroups: DCAD_GROUPS,
    summary: {
      countyCount: records.length,
      productionActiveCount: records.filter((record) => record.activationStage === "production-active").length,
      mapSearchReadyCount: records.filter((record) => record.mapSearchReady).length,
      dcadLikeWindowReadyCount: records.filter((record) => record.dcadLikeWindowReady).length,
      incompleteCountyCount: incomplete.length,
      nextMilestones: byMilestone,
    },
    counties: records,
  };

  ensureDir(path.dirname(outputJson));
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

  const lines = [
    "# County DCAD Parity Backlog",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Source gate report: ${report.sourceGateReport}`,
    `- Counties tracked: ${report.summary.countyCount}`,
    `- Map/search ready: ${report.summary.mapSearchReadyCount}`,
    `- DCAD-like window ready: ${report.summary.dcadLikeWindowReadyCount}`,
    `- Incomplete non-DCAD counties: ${report.summary.incompleteCountyCount}`,
    `- Texas rollout rule: ${report.texasRolloutRule}`,
    "",
    "## Next Milestones",
    "",
    ...Object.entries(report.summary.nextMilestones).map(([milestone, count]) => `- ${milestone}: ${count}`),
    "",
    "## County Backlog",
    "",
    ...records.map((record) => [
      `### ${record.countyName}`,
      "",
      `- County ID: \`${record.countyId}\``,
      `- Stage: ${record.activationStage}`,
      `- Safe visible activation: ${record.safeVisibleActivation || "none"}`,
      `- Parity: ${record.parityScore.readyGroups}/${record.parityScore.totalGroups} groups (${record.parityScore.percent}%)`,
      `- Parcel service: ${record.parcelService.featureCount}/${record.parcelService.sourceVerifiedFeatureCount || record.parcelService.featureCount} features, ${record.parcelService.chunkCount} chunks, ${record.parcelService.searchShardCount} search shards`,
      `- Next milestone: ${record.nextMilestone}`,
      `- Next action: ${record.nextAction}`,
      `- Missing groups: ${record.missingGroups.length ? record.missingGroups.join(", ") : "none"}`,
      "",
    ].join("\n")),
    "## UI Constraint",
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
