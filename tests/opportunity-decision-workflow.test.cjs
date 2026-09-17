const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const { createUserIntelligenceWorkflow } = await import("../src/platform/userIntelligenceWorkflow.mjs");
  const predictive = await import("../src/intelligence/predictiveSignals.mjs");
  const validation = await import("../src/intelligence/signalValidation.mjs");
  const { createOpportunityDecisionWorkflow } = await import("../src/intelligence/opportunityDecisionWorkflow.mjs");
  const countyId = "dallas-county-dcad";
  const propertyId = `wrp:v1:${countyId}:OPP-1`;
  const organizationId = "org-opportunity";
  const fixed = "2026-08-24T15:00:00.000Z";
  let now = fixed;
  let scenario = "low";
  let freshness = "current";
  let futureObservation = false;
  const context = { organizationId, actorUserId: "service-opportunity", subjectUserId: "service-opportunity", sessionId: "session-opportunity", requestId: "request-opportunity", grants: ["persistence:read", "persistence:write", "opportunity-intelligence:evaluate"], issuedAt: "2026-08-24T14:00:00.000Z", expiresAt: "2026-08-25T15:00:00.000Z" };
  const userContext = { ...context, actorUserId: "analyst-1", subjectUserId: "analyst-1", sessionId: "session-analyst", requestId: "request-analyst", grants: ["persistence:read", "persistence:write", "user-intelligence:read", "user-intelligence:write", "user-intelligence:evaluate"] };
  const model = predictive.createPredictiveSignalModel({ id: "acquisition-priority", version: "2026.08", createdAt: "2026-08-01", status: "validated", intendedOutcome: "Analyst review priority", definitions: [
    { category: "demand", metric: "demand-index", label: "Demand", polarity: "positive", weight: 1, normalization: { minimum: 0, maximum: 10 }, expectedSourceTypes: ["official-record"] },
    { category: "distress", metric: "risk-index", label: "Risk", polarity: "negative", weight: 1, normalization: { minimum: 0, maximum: 10 }, expectedSourceTypes: ["official-record"] },
  ] });
  const predictions = Array.from({ length: 500 }, (_, index) => ({ id: `prediction-${index}`, score: index < 250 ? 90 : 10, scoredAt: "2025-01-01", featureSetAsOf: "2025-01-01", outcome: index < 250, outcomeObservedAt: "2025-06-01" }));
  const backtest = validation.backtestSignalScores({ modelId: model.id, modelVersion: model.version, predictions, horizonDays: 365, generatedAt: "2026-08-01" });
  const stableDemand = Array.from({ length: 500 }, (_, index) => index % 10);
  const stableRisk = Array.from({ length: 500 }, (_, index) => 10 - (index % 10));
  const drift = validation.buildSignalDriftReport({ modelId: model.id, modelVersion: model.version, generatedAt: "2026-08-24", features: [{ featureId: "demand-index", baselineValues: stableDemand, currentValues: stableDemand }, { featureId: "risk-index", baselineValues: stableRisk, currentValues: stableRisk }] });
  assert.equal(backtest.sample.evaluated, 500);
  assert.equal(backtest.leakageAudit.passed, true);
  assert.equal(drift.status, "stable");
  const modelPack = { schemaVersion: "wr-certified-signal-model-pack-v1", activationAuthorized: true, model, backtest, drift, certifiedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", policy: { minimumBacktestSample: 500, minimumDriftSample: 500, maximumBacktestAgeDays: 90, maximumDriftAgeHours: 168, minimumAuc: 0.8, maximumBrierScore: 0.2, minimumCoveragePct: 100, minimumEffectiveConfidence: 0.9, priorityThreshold: 70, materialScoreDelta: 10 } };
  const observationProvider = { schemaVersion: "wr-signal-observation-provider-v1", activationAuthorized: true, async getObservations(id, { asOf }) {
    const values = scenario === "low" ? { demand: 2, risk: 8 } : { demand: 9, risk: 1 };
    const availableAt = futureObservation ? "2026-08-25T00:00:00.000Z" : asOf;
    return { observations: [
      predictive.createSignalObservation({ id: `${scenario}-demand`, whiteRabbitPropertyId: id, category: "demand", metric: "demand-index", value: values.demand, effectiveAt: asOf, observedAt: asOf, availableAt, confidence: 1, source: { sourceType: "official-record", datasetId: "opportunity-fixture", recordId: `${scenario}-demand` } }),
      predictive.createSignalObservation({ id: `${scenario}-risk`, whiteRabbitPropertyId: id, category: "distress", metric: "risk-index", value: values.risk, effectiveAt: asOf, observedAt: asOf, availableAt, confidence: 1, source: { sourceType: "official-record", datasetId: "opportunity-fixture", recordId: `${scenario}-risk` } }),
    ], sourceEvidence: [{ sourceCountyId: countyId, datasetId: "opportunity-fixture", sourceVersion: "2026.08.24", sourceUpdatedAt: asOf, freshnessStatus: freshness, partial: false }] };
  } };
  const profileProvider = { schemaVersion: "wr-opportunity-profile-provider-v1", activationAuthorized: true, async getProfile(id, { asOf }) { return { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: id, asOf, parcel: { whiteRabbitPropertyId: id, ownerName: "RABBIT LAND LLC", landAreaSize: 8, landAreaUnit: "ACRE", landValue: 1000000, improvementValue: 100000, totalValue: 1100000, yearBuilt: 1975, ownershipTenureYears: 12, geometry: { excluded: true } }, permits: [], intelligence: { development: { signalCount: 1, signalTypes: ["permit"], latestActivityDate: "2026-08-01" } }, lineage: { sourceDatasetId: "dcad", sourceVersion: "2026", sourceUpdatedAt: asOf, freshnessStatus: "current", secret: "discarded" } }; } };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-opportunity-workflow-"));
  const databasePath = path.join(tempDir, "platform.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => now });
  const collaborationRelease = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "deal-workflow-collaboration", activationAuthorized: true };
  const userWorkflow = createUserIntelligenceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision: collaborationRelease, verifyReleaseDecision: () => ({ valid: true, activationAuthorized: true }) });
  await userWorkflow.saveWatchlist({ watchlist: { id: "opportunity-watch", name: "Opportunity watch", propertyIds: [propertyId], alertPolicy: { enabled: true, cadence: "immediate", materialChangesOnly: true }, createdAt: now }, expectedTenantRevision: 0, expectedUserRecordRevision: 0, expectedAlertRecordRevision: 0, expectedStateRevision: 1, idempotencyKey: "opportunity-watch-save", occurredAt: now }, userContext);
  const releaseDecision = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "explainable-predictive-signals", activationAuthorized: true };
  const verified = () => ({ valid: true, activationAuthorized: true });
  const workflow = createOpportunityDecisionWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision: verified, modelPack, verifyModelPack: verified, observationProvider, profileProvider, verifyProvider: verified, clock: () => now });
  assert.equal(workflow.activationAuthorized, true);
  const inactive = createOpportunityDecisionWorkflow({ repository, allowedCountyIds: [countyId] });
  await assert.rejects(() => inactive.evaluate({}, context), (error) => error.code === "WR_OPPORTUNITY_RUNTIME_INACTIVE");
  const firstInput = { whiteRabbitPropertyId: propertyId, asOf: now, expectedTenantRevision: 1, expectedLedgerRecordRevision: 0, expectedAlertRecordRevision: 1, idempotencyKey: "opportunity-eval-1" };
  const first = await workflow.evaluate(firstInput, context);
  assert.equal(first.status, "evaluated");
  assert.equal(first.decision.disposition, "monitor");
  assert.equal(first.decision.predictiveScore.netScore, 20);
  assert.equal(first.materialChange, false);
  assert.equal(first.routedSubscriptionCount, 0, "first decision establishes a baseline without alerting");
  assert.equal(first.receipt.mutationCount, 1);
  scenario = "high";
  now = "2026-08-24T15:05:00.000Z";
  const secondInput = { whiteRabbitPropertyId: propertyId, asOf: now, expectedTenantRevision: 2, expectedLedgerRecordRevision: 1, expectedAlertRecordRevision: 1, idempotencyKey: "opportunity-eval-2" };
  const second = await workflow.evaluate(secondInput, context);
  assert.equal(second.decision.disposition, "analyst-review-priority");
  assert.equal(second.decision.predictiveScore.netScore, 90);
  assert.equal(second.materialChange, true);
  assert.equal(second.routedSubscriptionCount, 1);
  assert.equal(second.queuedAttemptCount, 1);
  assert.equal(second.receipt.mutationCount, 2);
  assert.equal(second.routingDecisions[0].ownerUserId, "analyst-1");
  const replayRevision = repository.tenantRevision(context, { now });
  const replay = await workflow.evaluate(secondInput, context);
  assert.equal(replay.status, "replayed");
  assert.equal(replay.receipt.replayed, true);
  assert.equal(repository.tenantRevision(context, { now }), replayRevision);
  await assert.rejects(() => workflow.evaluate({ ...secondInput, asOf: "2026-08-24T15:06:00.000Z" }, context), (error) => error.code === "WR_IDEMPOTENCY_CONFLICT");
  const ledgerRecord = repository.readRecord(context, "opportunity-intelligence", `property:${propertyId}`, { now });
  assert.equal(ledgerRecord.value.decisions.length, 2);
  assert.equal(ledgerRecord.value.decisions[1].advisoryOnly, true);
  assert.equal("observations" in ledgerRecord.value.decisions[1], false, "raw observations must not be persisted in the decision ledger");
  assert.equal("geometry" in ledgerRecord.value.decisions[1].heuristicSignal, false);
  const routing = repository.readRecord(context, "alert-routing", "state", { now }).value;
  const opportunityAttempt = routing.deliveryAttempts.find((item) => item.alertEnvelopeId.startsWith("alert_opportunity_"));
  assert.equal(opportunityAttempt.channelType, "in-app");
  assert.equal(opportunityAttempt.status, "queued");

  freshness = "unknown";
  const tenantBeforeFreshness = repository.tenantRevision(context, { now });
  await assert.rejects(() => workflow.evaluate({ whiteRabbitPropertyId: propertyId, asOf: "2026-08-24T15:10:00.000Z", expectedTenantRevision: tenantBeforeFreshness, expectedLedgerRecordRevision: 2, expectedAlertRecordRevision: 2, idempotencyKey: "opportunity-unknown" }, context), (error) => error.code === "WR_SIGNAL_SOURCE_NOT_CURRENT");
  assert.equal(repository.tenantRevision(context, { now }), tenantBeforeFreshness);
  freshness = "current";
  futureObservation = true;
  await assert.rejects(() => workflow.evaluate({ whiteRabbitPropertyId: propertyId, asOf: "2026-08-24T15:11:00.000Z", expectedTenantRevision: tenantBeforeFreshness, expectedLedgerRecordRevision: 2, expectedAlertRecordRevision: 2, idempotencyKey: "opportunity-future" }, context), (error) => error.code === "WR_POINT_IN_TIME_LEAKAGE");
  assert.equal(repository.tenantRevision(context, { now }), tenantBeforeFreshness);
  futureObservation = false;
  const unverifiedPack = createOpportunityDecisionWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision: verified, modelPack, observationProvider, profileProvider, verifyProvider: verified });
  await assert.rejects(() => unverifiedPack.evaluate({ whiteRabbitPropertyId: propertyId, asOf: now, expectedTenantRevision: tenantBeforeFreshness, expectedLedgerRecordRevision: 2, expectedAlertRecordRevision: 2, idempotencyKey: "opportunity-unverified-pack" }, context), (error) => error.code === "WR_SIGNAL_MODEL_SIGNATURE_REJECTED");
  const audit = repository.exportAuditLog(context, { now, exportedAt: now });
  assert.equal(audit.verification.valid, true);
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "build-opportunity-decision-workflow-readiness.cjs")], { stdio: "inherit" });
  require("./opportunity-decision-workflow-readiness.test.cjs");
  console.log("White Rabbit certified opportunity decision ledger, point-in-time scoring, watchlist routing, replay, and fail-closed evidence tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
