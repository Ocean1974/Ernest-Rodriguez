const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "county-activation-manifest.json");
const outputMd = path.join(root, "output", "county-activation-manifest.md");
const registrySource = fs.readFileSync(path.join(root, "src", "data", "countyRegistry.ts"), "utf8");
const featureGateSource = fs.readFileSync(path.join(root, "src", "data", "platformFeatureGates.ts"), "utf8");

const targets = [
  "jefferson-ky",
  "harris-county-tx",
  "maricopa-county-az",
  "king-county-wa",
  "tarrant-county-tad",
  "collin-county-tx",
  "denton-county-tx",
  "fort-bend-county-tx",
  "travis-county-tx",
  "bexar-county-tx",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

function indexBy(items, key) {
  return new Map((items || []).map((item) => [item[key], item]));
}

function countyDecision(countyId, promotionById, connectionById, freshnessById) {
  const promotion = promotionById.get(countyId);
  const connection = connectionById.get(countyId);
  const freshness = freshnessById.get(countyId);
  const parcelFreshness = freshness?.services?.find((service) => service.layer === "parcels");
  const service = connection?.parcelService || {};
  const adapter = connection?.adapterPath ? readJson(connection.adapterPath) : {};
  const pipelinePath = connection?.adapterPath ? path.posix.join(path.posix.dirname(connection.adapterPath), "pipeline.json") : "";
  const pipeline = pipelinePath && fs.existsSync(path.join(root, pipelinePath)) ? readJson(pipelinePath) : {};
  const sourceCount = Number(service.sourceVerifiedFeatureCount || promotion?.counts?.parcelGeometryFeatures || 0);
  const emittedCount = Number(service.featureCount || 0);
  const skippedCount = Number(service.skipped || adapter?.verifiedCounts?.missingGeometry || 0);
  const documentedSkippedCount = Number(adapter?.activation?.countReconciliation?.skippedFeatures || 0);
  const exactCountParity = sourceCount > 0 && (
    emittedCount === sourceCount ||
    (emittedCount + skippedCount === sourceCount && skippedCount === documentedSkippedCount)
  );
  const pilotQcClean = promotion?.checks?.qcZeroFailures === true;

  const gates = {
    evidenceReportsPresent: Boolean(promotion && connection && freshness),
    adapterPresent: connection?.adapterPresent === true,
    fullParcelService: service.fullParcelServiceReady === true,
    viewportIndex: service.viewportReady === true && Number(service.chunkCount || 0) > 0,
    searchIndex: service.searchReady === true && Number(service.searchShardCount || 0) > 0,
    exactCountParity,
    pilotQcClean,
    qcClean: promotion?.checks?.qcPass === true && promotion?.checks?.qcZeroFailures === true && promotion?.checks?.qcZeroWarnings === true,
    noSourceOrJoinPlaceholders: promotion?.checks?.sourceAndJoinPlaceholdersCleared === true,
    dcadLikeParity: connection?.dcadLikeWindowReady === true,
    upstreamFreshnessCurrent: parcelFreshness?.freshnessStatus === "current",
  };
  const releaseTier = adapter?.activation?.releaseTier || "full-production";
  const pilotRequested = releaseTier === "map-search-pilot" && adapter?.activation?.authorized === true;
  const requiredGateIds = pilotRequested
    ? ["evidenceReportsPresent", "adapterPresent", "fullParcelService", "viewportIndex", "searchIndex", "exactCountParity", "pilotQcClean", "upstreamFreshnessCurrent"]
    : ["evidenceReportsPresent", "adapterPresent", "fullParcelService", "viewportIndex", "searchIndex", "exactCountParity", "qcClean", "noSourceOrJoinPlaceholders", "dcadLikeParity", "upstreamFreshnessCurrent"];
  const failedGateIds = requiredGateIds.filter((id) => !gates[id]);
  const technicalEligibility = failedGateIds.length === 0;
  const adapterProductionEnabled = pipeline?.enabledForProduction === true;
  const registrySelectable = new RegExp(`id: ["']${countyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][\\s\\S]{0,350}?enabled: true`).test(registrySource);
  const featureGateEnabled = pilotRequested
    ? /houstonMapSearch:\s*true/.test(featureGateSource)
    : /priorityCountyActivation:\s*true/.test(featureGateSource);
  const visibilityAuthorized = technicalEligibility && adapterProductionEnabled && registrySelectable && featureGateEnabled;
  const blockers = [
    ...failedGateIds.map((id) => `activation gate failed: ${id}`),
    ...(pilotRequested ? [] : (promotion?.blockers || [])),
  ];
  if (!adapterProductionEnabled) blockers.push("adapter enabledForProduction is false");
  if (!registrySelectable) blockers.push("county selector entry is default-off");
  if (!featureGateEnabled) blockers.push("priorityCountyActivation feature gate is false");

  return {
    countyId,
    countyName: connection?.countyName || promotion?.countyName || countyId,
    releaseTier,
    activationDecision: visibilityAuthorized ? "activate" : "do-not-activate",
    technicalEligibility,
    visibilityAuthorized,
    gates,
    controls: { adapterProductionEnabled, registrySelectable, featureGateEnabled },
    evidence: {
      promotionGate: "output/priority-county-promotion/priority-county-promotion-gate.json",
      connectionGate: "output/county-connection-gate.json",
      freshnessAudit: "output/source-freshness-audit.json",
      qcStatus: promotion?.qc?.status || "missing",
      qcWarningCount: Number(promotion?.qc?.warningCount || 0),
      qcFailureCount: Number(promotion?.qc?.failureCount || 0),
      sourceVerifiedFeatureCount: sourceCount,
      emittedFeatureCount: emittedCount,
      skippedFeatureCount: skippedCount,
      viewportChunkCount: Number(service.chunkCount || 0),
      searchShardCount: Number(service.searchShardCount || 0),
      placeholderPathCount: Number(promotion?.placeholderPaths?.length || 0),
      parcelFreshnessStatus: parcelFreshness?.freshnessStatus || "unknown",
      missingDcadLikeGroups: connection?.missingDcadLikeGroups || [],
    },
    failedGateIds,
    blockers: [...new Set(blockers)],
  };
}

function main() {
  const promotion = readJson("output/priority-county-promotion/priority-county-promotion-gate.json");
  const connection = readJson("output/county-connection-gate.json");
  const freshness = readJson("output/source-freshness-audit.json");
  const promotionById = indexBy(promotion.counties, "adapterId");
  const connectionById = indexBy(connection.counties, "countyId");
  const freshnessById = indexBy(freshness.adapters, "id");
  const counties = targets.map((countyId) => countyDecision(countyId, promotionById, connectionById, freshnessById));
  const report = {
    schemaVersion: "wr-county-activation-manifest-v1",
    generatedAt: new Date().toISOString(),
    pageDesignChanged: false,
    activationPolicy: "Fail closed by release tier: map/search pilots require a full reconciled parcel service, zero QC failures, current source evidence, and all visibility controls; full production additionally requires zero warnings, cleared placeholders, and DCAD-like intelligence parity.",
    baseline: {
      countyId: "dallas-county-dcad",
      disposition: "retain-production-active-model",
      visibleCountyIds: ["dallas-county-dcad", "harris-county-tx"],
      exactParcelFeatureCount: 696601,
      exactSearchShardCount: 1224,
      dcadLikeWindowReady: connectionById.get("dallas-county-dcad")?.dcadLikeWindowReady === true,
      freshnessDebt: "upstream source freshness is unknown and must be remediated without deactivating the locked Dallas baseline",
    },
    mandatoryTechnicalGates: [
      "evidenceReportsPresent",
      "adapterPresent",
      "fullParcelService",
      "viewportIndex",
      "searchIndex",
      "exactCountParity",
      "pilotQcClean",
      "qcClean",
      "noSourceOrJoinPlaceholders",
      "dcadLikeParity",
      "upstreamFreshnessCurrent",
    ],
    visibilityControls: ["adapterProductionEnabled", "registrySelectable", "featureGateEnabled"],
    summary: {
      candidateCount: counties.length,
      technicalEligibleCount: counties.filter((county) => county.technicalEligibility).length,
      visibleActivationCount: counties.filter((county) => county.visibilityAuthorized).length,
      blockedCount: counties.filter((county) => !county.visibilityAuthorized).length,
      mapSearchCapableButBlockedCount: counties.filter((county) => county.gates.fullParcelService && !county.visibilityAuthorized).length,
      unknownParcelFreshnessCount: counties.filter((county) => county.evidence.parcelFreshnessStatus === "unknown").length,
    },
    counties,
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# County Activation Manifest",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.activationPolicy,
    "",
    `- Priority candidates: ${report.summary.candidateCount}`,
    `- Technically eligible: ${report.summary.technicalEligibleCount}`,
    `- Visibly authorized: ${report.summary.visibleActivationCount}`,
    `- Blocked: ${report.summary.blockedCount}`,
    `- Full parcel services still blocked: ${report.summary.mapSearchCapableButBlockedCount}`,
    `- Unknown parcel freshness: ${report.summary.unknownParcelFreshnessCount}`,
    "",
    "| County | Source / emitted | QC | Freshness | DCAD parity | Decision |",
    "| --- | ---: | --- | --- | --- | --- |",
    ...counties.map((county) => `| ${county.countyName} | ${county.evidence.sourceVerifiedFeatureCount} / ${county.evidence.emittedFeatureCount} | ${county.evidence.qcStatus} (${county.evidence.qcWarningCount} warnings) | ${county.evidence.parcelFreshnessStatus} | ${county.gates.dcadLikeParity ? "yes" : "no"} | ${county.activationDecision} |`),
    "",
    "## Exact blockers",
    "",
    ...counties.flatMap((county) => [`### ${county.countyName}`, "", ...county.blockers.map((blocker) => `- ${blocker}`), ""]),
    "## UI safety",
    "",
    "Dallas remains the production baseline. Houston/Harris County is selectable at the map/search pilot tier. This tranche changed no page layout, styling, imagery, or parcel interaction.",
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));
  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
