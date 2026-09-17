import { createHash } from "node:crypto";
import { assertPersistenceGrant } from "../persistence/persistenceContracts.mjs";
import { createUserIntelligenceState } from "../platform/userIntelligenceStore.mjs";
import { buildOpportunitySignals } from "./opportunitySignals.mjs";
import { assemblePointInTimeFeatures, composeExplainableSignalScore } from "./predictiveSignals.mjs";
import { createAlertEnvelope } from "./changeEvents.mjs";
import { createAlertRoutingState, planAlertRouting, recordDeliveryAttempts } from "../alerts/alertRoutingStore.mjs";

export const OPPORTUNITY_DECISION_WORKFLOW_VERSION = "wr-opportunity-decision-workflow-v1";
export const OPPORTUNITY_DECISION_VERSION = "wr-opportunity-decision-v1";
export const OPPORTUNITY_DECISION_LEDGER_VERSION = "wr-opportunity-decision-ledger-v1";
export const OPPORTUNITY_EVALUATION_RESULT_VERSION = "wr-opportunity-evaluation-result-v1";
export const CERTIFIED_SIGNAL_MODEL_PACK_VERSION = "wr-certified-signal-model-pack-v1";
export const SIGNAL_OBSERVATION_PROVIDER_VERSION = "wr-signal-observation-provider-v1";
export const OPPORTUNITY_PROFILE_PROVIDER_VERSION = "wr-opportunity-profile-provider-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function fail(code, message) { const error = new Error(message); error.code = code; return error; }
function propertyId(value) { const id = required(value, "whiteRabbitPropertyId"); if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity"); return id; }
function countyIdFromProperty(id) { return propertyId(id).split(":").slice(2, -1).join(":"); }
function round(value, digits = 1) { return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null; }

function authorizedRelease(decision, verifier) {
  if (!decision || typeof verifier !== "function") return false;
  let verification;
  try { verification = verifier(decision); } catch { return false; }
  return decision.schemaVersion === "wr-capability-release-decision-v1" && decision.capabilityId === "explainable-predictive-signals" && decision.activationAuthorized === true && verification?.valid === true && verification?.activationAuthorized === true;
}

function validateModelPack(pack, asOf, verifier) {
  if (pack?.schemaVersion !== CERTIFIED_SIGNAL_MODEL_PACK_VERSION || pack?.activationAuthorized !== true) throw fail("WR_SIGNAL_MODEL_NOT_CERTIFIED", "An activation-authorized certified signal model pack is required");
  let verification;
  try { verification = typeof verifier === "function" ? verifier(pack) : null; } catch { verification = null; }
  if (verification?.valid !== true || verification?.activationAuthorized !== true) throw fail("WR_SIGNAL_MODEL_SIGNATURE_REJECTED", "Signal model pack failed current trust verification");
  const model = pack.model;
  if (model?.schemaVersion !== "wr-predictive-signal-model-v1" || model.status !== "validated") throw fail("WR_SIGNAL_MODEL_NOT_VALIDATED", "Predictive signal model must be validated");
  const backtest = pack.backtest;
  if (backtest?.schemaVersion !== "wr-signal-backtest-v1" || backtest.status !== "evaluated" || backtest.modelId !== model.id || backtest.modelVersion !== model.version || backtest.leakageAudit?.passed !== true || Number(backtest.sample?.evaluated || 0) < Number(pack.policy?.minimumBacktestSample || 500)) throw fail("WR_SIGNAL_BACKTEST_REJECTED", "Model backtest evidence is missing, mismatched, too small, or leakage-contaminated");
  if (Number(backtest.metrics?.auc || 0) < Number(pack.policy?.minimumAuc || 0.65) || Number(backtest.metrics?.brierScore ?? 1) > Number(pack.policy?.maximumBrierScore || 0.25)) throw fail("WR_SIGNAL_PERFORMANCE_REJECTED", "Model performance does not satisfy its certification policy");
  const drift = pack.drift;
  if (drift?.schemaVersion !== "wr-signal-drift-report-v1" || drift.modelId !== model.id || drift.modelVersion !== model.version || drift.status !== "stable") throw fail("WR_SIGNAL_DRIFT_REJECTED", "Current signal drift evidence is not stable");
  const minimumDriftSample = Math.max(100, Number(pack.policy?.minimumDriftSample || 500));
  if (!Array.isArray(drift.features) || drift.features.length !== model.definitions.length || drift.features.some((item) => Number(item.baselineCount || 0) < minimumDriftSample || Number(item.currentCount || 0) < minimumDriftSample)) throw fail("WR_SIGNAL_DRIFT_SAMPLE_REJECTED", "Drift evidence is missing a representative baseline or current sample");
  const certifiedAt = iso(pack.certifiedAt, "modelPack.certifiedAt");
  const expiresAt = iso(pack.expiresAt, "modelPack.expiresAt");
  if (certifiedAt > asOf || expiresAt < asOf || expiresAt <= certifiedAt) throw fail("WR_SIGNAL_CERTIFICATION_WINDOW", "Signal model certification is not current");
  const backtestGeneratedAt = iso(backtest.generatedAt, "backtest.generatedAt");
  const driftGeneratedAt = iso(drift.generatedAt, "drift.generatedAt");
  const backtestAgeDays = (new Date(asOf).getTime() - new Date(backtestGeneratedAt).getTime()) / 86400000;
  const driftAgeHours = (new Date(asOf).getTime() - new Date(driftGeneratedAt).getTime()) / 3600000;
  if (backtestAgeDays < 0 || backtestAgeDays > Number(pack.policy?.maximumBacktestAgeDays || 90) || driftAgeHours < 0 || driftAgeHours > Number(pack.policy?.maximumDriftAgeHours || 168)) throw fail("WR_SIGNAL_VALIDATION_STALE", "Backtest or drift evidence is future-dated or stale");
  return {
    model,
    policy: {
      minimumCoveragePct: Math.max(1, Math.min(100, Number(pack.policy?.minimumCoveragePct || 80))),
      minimumEffectiveConfidence: Math.max(0, Math.min(1, Number(pack.policy?.minimumEffectiveConfidence || 0.65))),
      priorityThreshold: Math.max(0, Math.min(100, Number(pack.policy?.priorityThreshold || 70))),
      materialScoreDelta: Math.max(1, Math.min(100, Number(pack.policy?.materialScoreDelta || 10))),
    },
    certification: { certifiedAt, expiresAt, backtestGeneratedAt, driftGeneratedAt, backtestAgeDays: round(backtestAgeDays, 3), driftAgeHours: round(driftAgeHours, 3), minimumDriftSample, backtestSha256: digest(backtest), driftSha256: digest(drift), modelSha256: digest(model), backtestSample: backtest.sample.evaluated, auc: backtest.metrics.auc, brierScore: backtest.metrics.brierScore, driftStatus: drift.status },
  };
}

function normalizeEvidence(input, asOf) {
  const sourceCountyId = required(input?.sourceCountyId, "sourceEvidence.sourceCountyId");
  const datasetId = required(input?.datasetId, "sourceEvidence.datasetId");
  const sourceVersion = required(input?.sourceVersion, "sourceEvidence.sourceVersion");
  const sourceUpdatedAt = iso(input?.sourceUpdatedAt, "sourceEvidence.sourceUpdatedAt");
  if (sourceUpdatedAt > asOf) throw fail("WR_POINT_IN_TIME_LEAKAGE", `Source ${datasetId} is dated after the evaluation point`);
  if (input?.freshnessStatus !== "current" || input?.partial === true) throw fail("WR_SIGNAL_SOURCE_NOT_CURRENT", `Source ${datasetId} is stale, unknown, or partial`);
  return { sourceCountyId, datasetId, sourceVersion, sourceUpdatedAt, freshnessStatus: "current", partial: false };
}

function normalizeProfile(input, id, asOf) {
  const profileId = propertyId(input?.whiteRabbitPropertyId || input?.parcel?.whiteRabbitPropertyId);
  if (profileId !== id || input?.schemaVersion !== "wr-property-profile-v1" || !input.lineage) throw fail("WR_OPPORTUNITY_PROFILE_INVALID", `Property profile is invalid for ${id}`);
  const evidenceAt = iso(input.asOf || input.generatedAt || input.lineage.sourceUpdatedAt, "profile evidence timestamp");
  if (evidenceAt > asOf) throw fail("WR_POINT_IN_TIME_LEAKAGE", `Property profile contains future evidence for ${id}`);
  if (input.lineage.freshnessStatus !== "current") throw fail("WR_OPPORTUNITY_PROFILE_NOT_CURRENT", `Property profile freshness is not current for ${id}`);
  const parcel = Object.fromEntries(["whiteRabbitPropertyId", "countyParcelId", "accountNum", "accountNumber", "gisParcelId", "ownerName", "ownerName2", "businessName", "propertyName", "landAreaSize", "landAreaUnit", "landAreaSqFt", "landValue", "improvementValue", "totalValue", "yearBuilt", "ownershipTenureYears"].filter((key) => input.parcel?.[key] !== undefined).map((key) => [key, input.parcel[key]]));
  parcel.whiteRabbitPropertyId = id;
  parcel.dataLineage = { sourceDatasetId: String(input.lineage.sourceDatasetId || ""), sourceVersion: String(input.lineage.sourceVersion || ""), sourceUpdatedAt: String(input.lineage.sourceUpdatedAt || evidenceAt), freshnessStatus: "current" };
  const permits = Array.isArray(input.permits) ? input.permits.slice(0, 1000).map((item) => ({ permitRecordId: String(item.permitRecordId || ""), permitNumber: String(item.permitNumber || "") })) : null;
  const development = input.intelligence?.development ? { signalCount: Math.max(0, Number(input.intelligence.development.signalCount || 0)), signalTypes: (input.intelligence.development.signalTypes || []).slice(0, 50).map(String), latestActivityDate: String(input.intelligence.development.latestActivityDate || "") } : null;
  return { parcel, permits, development, evidenceAt };
}

function createLedger(input = {}) {
  return { schemaVersion: OPPORTUNITY_DECISION_LEDGER_VERSION, organizationId: String(input.organizationId || ""), whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId), revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), decisions: (input.decisions || []).slice(-50), updatedAt: iso(input.updatedAt, "ledger.updatedAt") };
}

function sourceContainsProperty(userState, subscription, id) {
  if (subscription.sourceType === "watchlist") return userState.watchlists.find((item) => item.id === subscription.sourceId)?.propertyIds?.includes(id) === true;
  if (subscription.sourceType === "saved-search") return userState.savedSearches.find((item) => item.id === subscription.sourceId)?.lastEvaluation?.propertyIds?.includes(id) === true;
  return false;
}

function eligibleSubscriptions(repository, context, routingState, id, asOf) {
  const userStates = new Map(repository.listRecords(context, "user-intelligence", { now: asOf }).map((record) => [record.key, createUserIntelligenceState(record.value)]));
  return routingState.subscriptions.filter((subscription) => {
    if (subscription.organizationId !== context.organizationId || !subscription.enabled || !subscription.channels.some((channel) => channel.type === "in-app" && channel.enabled)) return false;
    const state = userStates.get(subscription.ownerUserId);
    return state ? sourceContainsProperty(state, subscription, id) : false;
  });
}

function decisionEvent(previous, decision, policy) {
  if (!previous) return null;
  const scoreDelta = round(Number(decision.predictiveScore.netScore) - Number(previous.predictiveScore.netScore), 1);
  const priorityChanged = previous.disposition !== decision.disposition;
  const tierChanged = previous.heuristicSignal.tier !== decision.heuristicSignal.tier;
  if (!priorityChanged && !tierChanged && Math.abs(scoreDelta) < policy.materialScoreDelta) return null;
  const severity = priorityChanged || Math.abs(scoreDelta) >= policy.materialScoreDelta * 2 ? "high" : "medium";
  return { schemaVersion: "wr-property-change-event-v1", id: `event_${digest(`${decision.id}|${previous.id}`).slice(0, 24)}`, eventType: "opportunity-decision-changed", category: "opportunity", severity, whiteRabbitPropertyId: decision.whiteRabbitPropertyId, field: "opportunityDecision", before: { decisionId: previous.id, netScore: previous.predictiveScore.netScore, disposition: previous.disposition, heuristicTier: previous.heuristicSignal.tier }, after: { decisionId: decision.id, netScore: decision.predictiveScore.netScore, disposition: decision.disposition, heuristicTier: decision.heuristicSignal.tier }, observedAt: decision.asOf, evidence: { modelId: decision.model.id, modelVersion: decision.model.version, scoreDelta, factorCount: decision.predictiveScore.factors.length } };
}

function fingerprint(context, input) { return digest({ organizationId: context.organizationId, actorUserId: context.actorUserId, propertyId: input.whiteRabbitPropertyId, asOf: input.asOf, expectedTenantRevision: input.expectedTenantRevision, expectedLedgerRecordRevision: input.expectedLedgerRecordRevision, expectedAlertRecordRevision: input.expectedAlertRecordRevision }); }

export function createOpportunityDecisionWorkflow({ repository, allowedCountyIds = [], releaseDecision = null, verifyReleaseDecision = null, modelPack = null, verifyModelPack = null, observationProvider = null, profileProvider = null, verifyProvider = null, clock = () => new Date().toISOString() } = {}) {
  if (!repository?.readRecord || !repository?.commitMany || !repository?.readIdempotencyReceipt || !repository?.listRecords) throw new TypeError("A durable transactional repository is required");
  const counties = new Set(allowedCountyIds.map(String).filter(Boolean));
  if (!counties.size) throw new TypeError("allowedCountyIds must contain at least one county");
  const activationAuthorized = authorizedRelease(releaseDecision, verifyReleaseDecision);
  const providerVerified = (provider, type) => { try { const result = typeof verifyProvider === "function" ? verifyProvider(provider, type) : null; return result?.valid === true && result?.activationAuthorized === true; } catch { return false; } };
  const observationsAuthorized = observationProvider?.schemaVersion === SIGNAL_OBSERVATION_PROVIDER_VERSION && observationProvider?.activationAuthorized === true && typeof observationProvider.getObservations === "function" && providerVerified(observationProvider, "signal-observations");
  const profileAuthorized = profileProvider?.schemaVersion === OPPORTUNITY_PROFILE_PROVIDER_VERSION && profileProvider?.activationAuthorized === true && typeof profileProvider.getProfile === "function" && providerVerified(profileProvider, "property-profile");
  return Object.freeze({
    schemaVersion: OPPORTUNITY_DECISION_WORKFLOW_VERSION,
    activationAuthorized,
    async evaluate(input = {}, context = {}) {
      if (!activationAuthorized) throw fail("WR_OPPORTUNITY_RUNTIME_INACTIVE", "Opportunity decision workflow is not release-authorized");
      assertPersistenceGrant(context, "persistence:read"); assertPersistenceGrant(context, "persistence:write");
      if (!context.grants?.includes("opportunity-intelligence:evaluate")) throw fail("WR_OPPORTUNITY_PERMISSION_DENIED", "opportunity-intelligence:evaluate grant is required");
      if (!observationsAuthorized) throw fail("WR_SIGNAL_PROVIDER_NOT_AUTHORIZED", "An activation-authorized signal observation provider is required");
      if (!profileAuthorized) throw fail("WR_OPPORTUNITY_PROFILE_PROVIDER_NOT_AUTHORIZED", "An activation-authorized opportunity profile provider is required");
      const id = propertyId(input.whiteRabbitPropertyId);
      if (!counties.has(countyIdFromProperty(id))) throw fail("WR_OPPORTUNITY_COUNTY_SCOPE", `Property is outside the opportunity county allowlist: ${id}`);
      const asOf = iso(input.asOf || clock(), "asOf");
      const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
      const requestFingerprint = fingerprint(context, { ...input, whiteRabbitPropertyId: id, asOf });
      const priorReceipt = repository.readIdempotencyReceipt(context, idempotencyKey, { now: asOf });
      if (priorReceipt) {
        if (priorReceipt.requestFingerprint !== requestFingerprint) throw fail("WR_IDEMPOTENCY_CONFLICT", `Idempotency key ${idempotencyKey} was used for another opportunity evaluation`);
        const ledgerRecord = repository.readRecord(context, "opportunity-intelligence", `property:${id}`, { now: asOf });
        const decisionId = String(priorReceipt.responseMetadata?.decisionId || "");
        const decision = ledgerRecord?.value?.decisions?.find((item) => item.id === decisionId) || null;
        if (!decision) throw fail("WR_IDEMPOTENCY_RESULT_MISSING", "The replay receipt references a decision that is no longer available in the bounded ledger");
        return { schemaVersion: OPPORTUNITY_EVALUATION_RESULT_VERSION, status: "replayed", receipt: { ...priorReceipt, replayed: true }, decision, routedSubscriptionCount: 0, queuedAttemptCount: 0, replayed: true };
      }
      const tenantRevision = repository.tenantRevision(context, { now: asOf });
      if (Number(input.expectedTenantRevision) !== tenantRevision) throw fail("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${input.expectedTenantRevision}, found ${tenantRevision}`);
      const ledgerKey = `property:${id}`;
      const ledgerRecord = repository.readRecord(context, "opportunity-intelligence", ledgerKey, { now: asOf });
      const alertRecord = repository.readRecord(context, "alert-routing", "state", { now: asOf });
      if (Number(input.expectedLedgerRecordRevision || 0) !== Number(ledgerRecord?.revision || 0)) throw fail("WR_PERSISTENCE_CONFLICT", "Opportunity ledger record revision conflict");
      if (Number(input.expectedAlertRecordRevision || 0) !== Number(alertRecord?.revision || 0)) throw fail("WR_PERSISTENCE_CONFLICT", "Alert-routing record revision conflict");
      const validatedPack = validateModelPack(modelPack, asOf, verifyModelPack);
      const observationResult = await observationProvider.getObservations(id, { asOf, context, signal: input.signal || null });
      const observations = Array.isArray(observationResult?.observations) ? observationResult.observations : [];
      if (observations.length > 5000) throw fail("WR_SIGNAL_OBSERVATION_LIMIT", "Opportunity evaluation exceeds 5,000 observations");
      const sourceEvidence = (observationResult?.sourceEvidence || []).map((item) => normalizeEvidence(item, asOf));
      if (!sourceEvidence.length) throw fail("WR_SIGNAL_SOURCE_EVIDENCE_MISSING", "Signal observation source evidence is required");
      if (sourceEvidence.some((item) => item.sourceCountyId !== countyIdFromProperty(id))) throw fail("WR_SIGNAL_SOURCE_SCOPE", "Signal source evidence is outside the property county");
      const evidenceByDataset = new Map();
      for (const source of sourceEvidence) { const previous = evidenceByDataset.get(source.datasetId); if (previous && canonicalJson(previous) !== canonicalJson(source)) throw fail("WR_SIGNAL_SOURCE_CHANGED", `Signal source changed within the evaluation: ${source.datasetId}`); evidenceByDataset.set(source.datasetId, source); }
      const evidenceDatasets = new Set(sourceEvidence.map((item) => item.datasetId));
      if (observations.some((item) => !evidenceDatasets.has(String(item?.source?.datasetId || "")))) throw fail("WR_SIGNAL_SOURCE_EVIDENCE_MISSING", "Every signal observation dataset must have current source evidence");
      if (observations.some((item) => String(item?.whiteRabbitPropertyId || "") !== id)) throw fail("WR_SIGNAL_PROPERTY_SCOPE", "Every signal observation must belong to the evaluated property");
      const features = assemblePointInTimeFeatures({ model: validatedPack.model, whiteRabbitPropertyId: id, asOf, observations });
      if (features.leakageAudit.passed !== true) throw fail("WR_POINT_IN_TIME_LEAKAGE", "Future-dated signal observations were supplied to the evaluation");
      const predictiveScore = composeExplainableSignalScore(features);
      if (predictiveScore.status !== "scored" || predictiveScore.validationStatus !== "validated" || predictiveScore.netScore === null || predictiveScore.evidenceCoveragePct < validatedPack.policy.minimumCoveragePct || predictiveScore.effectiveConfidence < validatedPack.policy.minimumEffectiveConfidence) throw fail("WR_SIGNAL_EVIDENCE_INSUFFICIENT", "Predictive score lacks validated coverage or confidence for governed use");
      const rawProfile = await profileProvider.getProfile(id, { asOf, context, signal: input.signal || null });
      const profile = normalizeProfile(rawProfile, id, asOf);
      const heuristicSignal = buildOpportunitySignals({ parcel: profile.parcel, permits: profile.permits, development: profile.development, observedAt: asOf });
      const disposition = predictiveScore.netScore >= validatedPack.policy.priorityThreshold ? "analyst-review-priority" : "monitor";
      const previousLedger = ledgerRecord ? createLedger(ledgerRecord.value) : createLedger({ organizationId: context.organizationId, whiteRabbitPropertyId: id, updatedAt: asOf });
      if (previousLedger.organizationId !== context.organizationId) throw fail("WR_TENANT_ISOLATION_VIOLATION", "Opportunity ledger belongs to another tenant");
      const previous = previousLedger.decisions.at(-1) || null;
      const decisionCore = { whiteRabbitPropertyId: id, asOf, disposition, model: { id: validatedPack.model.id, version: validatedPack.model.version, validationStatus: validatedPack.model.status }, predictiveScore, heuristicSignal, sourceEvidence, certification: validatedPack.certification, policy: validatedPack.policy, profileEvidenceAt: profile.evidenceAt, advisoryOnly: true };
      const decision = { schemaVersion: OPPORTUNITY_DECISION_VERSION, id: `decision_${digest(decisionCore).slice(0, 24)}`, organizationId: context.organizationId, ...decisionCore };
      if (previous?.id === decision.id) throw fail("WR_DUPLICATE_OPPORTUNITY_DECISION", "This exact opportunity decision is already the current ledger entry");
      const ledger = { ...previousLedger, revision: previousLedger.revision + 1, decisions: [...previousLedger.decisions, decision].slice(-50), updatedAt: asOf };
      let routingState = alertRecord ? createAlertRoutingState(alertRecord.value) : createAlertRoutingState({ updatedAt: asOf });
      const event = decisionEvent(previous, decision, validatedPack.policy);
      const subscriptions = event ? eligibleSubscriptions(repository, context, routingState, id, asOf) : [];
      const routingDecisions = [];
      for (const subscription of subscriptions) {
        const inAppSubscription = { ...subscription, channels: subscription.channels.filter((channel) => channel.type === "in-app") };
        const envelope = { ...createAlertEnvelope({ subscriptionId: subscription.id, subscriptionType: subscription.sourceType, events: [event], createdAt: asOf }), id: `alert_opportunity_${digest(`${decision.id}|${subscription.id}`).slice(0, 24)}` };
        const routingDecision = planAlertRouting({ subscription: inAppSubscription, envelope, routingState, now: asOf });
        routingState = recordDeliveryAttempts(routingState, routingDecision.attempts, { expectedRevision: routingState.revision, updatedAt: asOf });
        routingDecisions.push({ ownerUserId: subscription.ownerUserId, subscriptionId: subscription.id, envelopeId: envelope.id, status: routingDecision.status, attemptCount: routingDecision.attempts.length });
      }
      const mutations = [{ namespace: "opportunity-intelligence", key: ledgerKey, operation: "put", value: ledger, expectedRecordRevision: Number(ledgerRecord?.revision || 0) }];
      if (routingDecisions.length) mutations.push({ namespace: "alert-routing", key: "state", operation: "put", value: routingState, expectedRecordRevision: Number(alertRecord?.revision || 0) });
      const receipt = repository.commitMany({ context, mutations, expectedTenantRevision: tenantRevision, idempotencyKey, requestFingerprint, responseMetadata: { decisionId: decision.id, whiteRabbitPropertyId: id }, occurredAt: asOf }, { now: asOf });
      return { schemaVersion: OPPORTUNITY_EVALUATION_RESULT_VERSION, status: "evaluated", receipt, decision, previousDecisionId: previous?.id || "", materialChange: Boolean(event), routedSubscriptionCount: routingDecisions.length, queuedAttemptCount: routingDecisions.filter((item) => item.status === "queued").reduce((sum, item) => sum + item.attemptCount, 0), routingDecisions, replayed: false };
    },
  });
}
