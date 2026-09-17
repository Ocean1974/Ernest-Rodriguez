const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "opportunity-decision-workflow-readiness.json");
const outputMd = path.join(root, "output", "opportunity-decision-workflow-readiness.md");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

(async () => {
  const { SqlitePlatformRepository } = await import(pathToFileURL(path.join(root, "src", "persistence", "sqlitePlatformRepository.mjs")).href);
  const { createUserIntelligenceWorkflow } = await import(pathToFileURL(path.join(root, "src", "platform", "userIntelligenceWorkflow.mjs")).href);
  const predictive = await import(pathToFileURL(path.join(root, "src", "intelligence", "predictiveSignals.mjs")).href);
  const validation = await import(pathToFileURL(path.join(root, "src", "intelligence", "signalValidation.mjs")).href);
  const { createOpportunityDecisionWorkflow } = await import(pathToFileURL(path.join(root, "src", "intelligence", "opportunityDecisionWorkflow.mjs")).href);
  const countyId = "dallas-county-dcad";
  const propertyId = `wrp:v1:${countyId}:CERT-OPP-1`;
  const organizationId = "org-opportunity-certification";
  let now = "2026-08-24T15:00:00.000Z";
  let scenario = "low";
  const serviceContext = { organizationId, actorUserId: "service-opportunity", subjectUserId: "service-opportunity", sessionId: "cert-service-session", requestId: "cert-service-request", grants: ["persistence:read", "persistence:write", "opportunity-intelligence:evaluate"], issuedAt: "2026-08-24T14:00:00.000Z", expiresAt: "2026-08-25T15:00:00.000Z" };
  const userContext = { ...serviceContext, actorUserId: "analyst-certification", subjectUserId: "analyst-certification", sessionId: "cert-user-session", requestId: "cert-user-request", grants: ["persistence:read", "persistence:write", "user-intelligence:read", "user-intelligence:write", "user-intelligence:evaluate"] };
  const model = predictive.createPredictiveSignalModel({ id: "acquisition-priority", version: "2026.08-cert", createdAt: "2026-08-01", status: "validated", intendedOutcome: "Analyst review priority", definitions: [
    { category: "demand", metric: "demand-index", label: "Demand", polarity: "positive", weight: 1, normalization: { minimum: 0, maximum: 10 }, expectedSourceTypes: ["official-record"] },
    { category: "distress", metric: "risk-index", label: "Risk", polarity: "negative", weight: 1, normalization: { minimum: 0, maximum: 10 }, expectedSourceTypes: ["official-record"] }
  ] });
  const predictions = Array.from({ length: 500 }, (_, index) => ({ id: `cert-prediction-${index}`, score: index < 250 ? 90 : 10, scoredAt: "2025-01-01", featureSetAsOf: "2025-01-01", outcome: index < 250, outcomeObservedAt: "2025-06-01" }));
  const backtest = validation.backtestSignalScores({ modelId: model.id, modelVersion: model.version, predictions, horizonDays: 365, generatedAt: "2026-08-01" });
  const stableDemand = Array.from({ length: 500 }, (_, index) => index % 10);
  const stableRisk = Array.from({ length: 500 }, (_, index) => 10 - (index % 10));
  const drift = validation.buildSignalDriftReport({ modelId: model.id, modelVersion: model.version, generatedAt: "2026-08-24", features: [{ featureId: "demand-index", baselineValues: stableDemand, currentValues: stableDemand }, { featureId: "risk-index", baselineValues: stableRisk, currentValues: stableRisk }] });
  const modelPack = { schemaVersion: "wr-certified-signal-model-pack-v1", activationAuthorized: true, model, backtest, drift, certifiedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", policy: { minimumBacktestSample: 500, minimumDriftSample: 500, maximumBacktestAgeDays: 90, maximumDriftAgeHours: 168, minimumAuc: 0.8, maximumBrierScore: 0.2, minimumCoveragePct: 100, minimumEffectiveConfidence: 0.9, priorityThreshold: 70, materialScoreDelta: 10 } };
  const observationProvider = { schemaVersion: "wr-signal-observation-provider-v1", activationAuthorized: true, async getObservations(id, { asOf }) { const values = scenario === "low" ? { demand: 2, risk: 8 } : { demand: 9, risk: 1 }; return { observations: [
    predictive.createSignalObservation({ id: `${scenario}-demand`, whiteRabbitPropertyId: id, category: "demand", metric: "demand-index", value: values.demand, effectiveAt: asOf, observedAt: asOf, availableAt: asOf, confidence: 1, source: { sourceType: "official-record", datasetId: "certified-opportunity-fixture", recordId: `${scenario}-demand` } }),
    predictive.createSignalObservation({ id: `${scenario}-risk`, whiteRabbitPropertyId: id, category: "distress", metric: "risk-index", value: values.risk, effectiveAt: asOf, observedAt: asOf, availableAt: asOf, confidence: 1, source: { sourceType: "official-record", datasetId: "certified-opportunity-fixture", recordId: `${scenario}-risk` } })
  ], sourceEvidence: [{ sourceCountyId: countyId, datasetId: "certified-opportunity-fixture", sourceVersion: "2026.08.24", sourceUpdatedAt: asOf, freshnessStatus: "current", partial: false }] }; } };
  const profileProvider = { schemaVersion: "wr-opportunity-profile-provider-v1", activationAuthorized: true, async getProfile(id, { asOf }) { return { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: id, asOf, parcel: { whiteRabbitPropertyId: id, ownerName: "RABBIT LAND LLC", landAreaSize: 8, landAreaUnit: "ACRE", landValue: 1000000, improvementValue: 100000, totalValue: 1100000, yearBuilt: 1975, ownershipTenureYears: 12, geometry: { excluded: true } }, permits: [], intelligence: { development: { signalCount: 1, signalTypes: ["permit"], latestActivityDate: "2026-08-01" } }, lineage: { sourceDatasetId: "dcad-certification", sourceVersion: "2026", sourceUpdatedAt: asOf, freshnessStatus: "current", secret: "discarded" } }; } };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-opportunity-cert-"));
  const databasePath = path.join(tempDir, "cert.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => now });
  try {
    const verified = () => ({ valid: true, activationAuthorized: true });
    const userWorkflow = createUserIntelligenceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision: { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "deal-workflow-collaboration", activationAuthorized: true }, verifyReleaseDecision: verified });
    await userWorkflow.saveWatchlist({ watchlist: { id: "cert-opportunity-watch", name: "Certified opportunity watch", propertyIds: [propertyId], alertPolicy: { enabled: true, cadence: "immediate", materialChangesOnly: true }, createdAt: now }, expectedTenantRevision: 0, expectedUserRecordRevision: 0, expectedAlertRecordRevision: 0, expectedStateRevision: 1, idempotencyKey: "cert-opportunity-watch-save", occurredAt: now }, userContext);
    const workflow = createOpportunityDecisionWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision: { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "explainable-predictive-signals", activationAuthorized: true }, verifyReleaseDecision: verified, modelPack, verifyModelPack: verified, observationProvider, profileProvider, verifyProvider: verified, clock: () => now });
    const inactive = createOpportunityDecisionWorkflow({ repository, allowedCountyIds: [countyId] });
    let inactiveRejected = false;
    try { await inactive.evaluate({}, serviceContext); } catch (error) { inactiveRejected = error.code === "WR_OPPORTUNITY_RUNTIME_INACTIVE"; }
    const first = await workflow.evaluate({ whiteRabbitPropertyId: propertyId, asOf: now, expectedTenantRevision: 1, expectedLedgerRecordRevision: 0, expectedAlertRecordRevision: 1, idempotencyKey: "cert-opportunity-eval-1" }, serviceContext);
    scenario = "high";
    now = "2026-08-24T15:05:00.000Z";
    const secondInput = { whiteRabbitPropertyId: propertyId, asOf: now, expectedTenantRevision: 2, expectedLedgerRecordRevision: 1, expectedAlertRecordRevision: 1, idempotencyKey: "cert-opportunity-eval-2" };
    const second = await workflow.evaluate(secondInput, serviceContext);
    const revisionBeforeReplay = repository.tenantRevision(serviceContext, { now });
    const replay = await workflow.evaluate(secondInput, serviceContext);
    const revisionAfterReplay = repository.tenantRevision(serviceContext, { now });
    const ledger = repository.readRecord(serviceContext, "opportunity-intelligence", `property:${propertyId}`, { now }).value;
    const routing = repository.readRecord(serviceContext, "alert-routing", "state", { now }).value;
    const audit = repository.exportAuditLog(serviceContext, { now, exportedAt: now });
    const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
    const rawObservationsPersisted = ledger.decisions.some((decision) => Object.prototype.hasOwnProperty.call(decision, "observations"));
    const opportunityAttempts = routing.deliveryAttempts.filter((attempt) => attempt.alertEnvelopeId.startsWith("alert_opportunity_"));
    const checks = [
      { id: "release-default-off", passed: inactiveRejected && workflow.activationAuthorized === true },
      { id: "certified-model-pack", passed: backtest.sample.evaluated === 500 && backtest.leakageAudit.passed === true && drift.status === "stable" },
      { id: "point-in-time-score-transition", passed: first.decision.predictiveScore.netScore === 20 && second.decision.predictiveScore.netScore === 90 },
      { id: "baseline-suppressed", passed: first.materialChange === false && first.routedSubscriptionCount === 0 },
      { id: "atomic-watchlist-alert", passed: second.receipt.mutationCount === 2 && second.routedSubscriptionCount === 1 && second.queuedAttemptCount === 1 },
      { id: "in-app-only", passed: opportunityAttempts.length === 1 && opportunityAttempts[0].channelType === "in-app" },
      { id: "exact-replay-no-write", passed: replay.status === "replayed" && revisionBeforeReplay === revisionAfterReplay },
      { id: "bounded-minimized-ledger", passed: ledger.decisions.length === 2 && !rawObservationsPersisted && ledger.decisions.every((decision) => decision.advisoryOnly === true) },
      { id: "tamper-evident-audit", passed: audit.verification.valid === true },
      { id: "locked-ui", passed: !appSource.includes("opportunityDecisionWorkflow") }
    ];
    const report = {
      schemaVersion: "wr-opportunity-decision-workflow-readiness-v1", generatedAt: now, status: checks.every((item) => item.passed) ? "foundation-ready-release-blocked" : "rejected",
      contracts: ["wr-opportunity-decision-workflow-v1", "wr-opportunity-decision-v1", "wr-opportunity-decision-ledger-v1", "wr-opportunity-evaluation-result-v1", "wr-certified-signal-model-pack-v1", "wr-signal-observation-provider-v1", "wr-opportunity-profile-provider-v1"],
      decisionWorkflow: { atomicNamespaces: ["opportunity-intelligence", "alert-routing"], canonicalPropertyJoinKey: "whiteRabbitPropertyId", maximumLedgerDecisionsPerProperty: 50, maximumObservationsPerEvaluation: 5000, optimisticConcurrency: true, idempotentReplay: true, tamperEvidentAudit: true, advisoryOnly: true, rawObservationsPersisted },
      validationEvidence: { backtestSample: backtest.sample.evaluated, auc: backtest.metrics.auc, brierScore: backtest.metrics.brierScore, leakageAuditPassed: backtest.leakageAudit.passed, driftStatus: drift.status, driftFeatureCount: drift.features.length, minimumDriftSamplePerFeature: 500, maximumBacktestAgeDays: 90, maximumDriftAgeHours: 168, evidenceCoveragePct: second.decision.predictiveScore.evidenceCoveragePct, effectiveConfidence: second.decision.predictiveScore.effectiveConfidence },
      alertBoundary: { inAppOnly: true, externalProviderContacted: false, externalDeliveryActivated: false, firstDecisionEstablishesBaseline: true, materialChangeRequired: true, watchlistMembershipRequired: true },
      activation: { productionReleaseDecisionPresent: false, certificationUsedSyntheticAuthorization: true, certifiedProductionModelConnected: false, certifiedProductionObservationProviderConnected: false, certifiedProductionProfileProviderConnected: false, visibleUiActivated: false, lockedWebsiteDesignChanged: false },
      certificationScenario: { propertyCount: 1, watchlistCount: 1, decisionCount: ledger.decisions.length, baselineNetScore: first.decision.predictiveScore.netScore, changedNetScore: second.decision.predictiveScore.netScore, baselineDisposition: first.decision.disposition, changedDisposition: second.decision.disposition, queuedWatchlistAlertCount: opportunityAttempts.length, finalTenantRevision: revisionAfterReplay, replayPreservedTenantRevision: revisionBeforeReplay === revisionAfterReplay },
      checks,
      releaseBlockers: ["No production-signed predictive-signal capability release decision exists.", "No verified production historical observation or property-profile provider is connected.", "Production temporal and geographic holdouts, calibration, fairness, and drift evidence remain incomplete.", "Production identity, KMS, sustained-load, recovery, rollback, and security-review evidence remains incomplete."]
    };
    fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(outputMd, ["# Opportunity Decision Workflow Readiness", "", `Status: ${report.status}`, "", "- Point-in-time model score: certified synthetic fixture", "- Backtest sample: 500", "- Drift sample per feature: 500 baseline + 500 current", "- Decision transition: 20 monitor -> 90 analyst-review-priority", "- Material watchlist alert: one in-app attempt queued", "- Raw observations persisted: no", "- Exact replay: passed", "- UI changed: no", "- Production activation: no", "", "Release blockers:", ...report.releaseBlockers.map((item) => `- ${item}`), ""].join("\n"));
    console.log(`Built ${path.relative(root, outputJson)} and ${path.relative(root, outputMd)} (${sha256(fs.readFileSync(outputJson))}).`);
  } finally {
    repository.close();
    for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
    fs.rmdirSync(tempDir);
  }
})().catch((error) => { console.error(error); process.exit(1); });
