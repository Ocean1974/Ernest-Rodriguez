import { createHash } from "node:crypto";
import { assertPersistenceGrant } from "../persistence/persistenceContracts.mjs";
import { buildOpportunityBrief } from "../briefs/opportunityBrief.mjs";
import { createUnderwritingGovernanceState, addUnderwritingScenario } from "../underwriting/underwritingGovernance.mjs";

export const ACQUISITION_HANDOFF_WORKFLOW_VERSION = "wr-acquisition-handoff-workflow-v1";
export const ACQUISITION_HANDOFF_VERSION = "wr-acquisition-handoff-v1";
export const ACQUISITION_HANDOFF_LEDGER_VERSION = "wr-acquisition-handoff-ledger-v1";
export const ACQUISITION_HANDOFF_RESULT_VERSION = "wr-acquisition-handoff-result-v1";
export const HANDOFF_PROFILE_PROVIDER_VERSION = "wr-acquisition-handoff-profile-provider-v1";
export const UNDERWRITING_EVIDENCE_PROVIDER_VERSION = "wr-underwriting-evidence-provider-v1";
export const UNDERWRITING_EVIDENCE_PACK_VERSION = "wr-underwriting-evidence-pack-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function fail(code, message) { const error = new Error(message); error.code = code; return error; }
function propertyId(value) { const id = required(value, "whiteRabbitPropertyId"); if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity"); return id; }
function countyIdFromProperty(id) { return propertyId(id).split(":").slice(2, -1).join(":"); }

function authorizedRelease(decisions, verifier) {
  const requiredCapabilities = new Set(["opportunity-briefs", "scenario-underwriting"]);
  for (const decision of decisions || []) {
    let verification;
    try { verification = typeof verifier === "function" ? verifier(decision) : null; } catch { verification = null; }
    if (decision?.schemaVersion === "wr-capability-release-decision-v1" && decision.activationAuthorized === true && verification?.valid === true && verification?.activationAuthorized === true) requiredCapabilities.delete(decision.capabilityId);
  }
  return requiredCapabilities.size === 0;
}

function providerAuthorized(provider, schemaVersion, type, verifier) {
  let verification;
  try { verification = typeof verifier === "function" ? verifier(provider, type) : null; } catch { verification = null; }
  return provider?.schemaVersion === schemaVersion && provider.activationAuthorized === true && verification?.valid === true && verification?.activationAuthorized === true;
}

function currentDecision(record, id, organizationId, asOf, maximumAgeHours) {
  const decision = record?.value?.decisions?.at(-1);
  if (record?.value?.schemaVersion !== "wr-opportunity-decision-ledger-v1" || !decision) throw fail("WR_OPPORTUNITY_DECISION_MISSING", `No governed opportunity decision exists for ${id}`);
  if (record.value.organizationId !== organizationId || decision.organizationId !== organizationId) throw fail("WR_TENANT_ISOLATION_VIOLATION", "Opportunity decision belongs to another tenant");
  if (decision.schemaVersion !== "wr-opportunity-decision-v1" || decision.whiteRabbitPropertyId !== id || decision.advisoryOnly !== true) throw fail("WR_OPPORTUNITY_DECISION_INVALID", "Opportunity decision contract is invalid");
  if (decision.disposition !== "analyst-review-priority" || decision.predictiveScore?.validationStatus !== "validated" || !Number.isFinite(Number(decision.predictiveScore?.netScore))) throw fail("WR_OPPORTUNITY_NOT_PRIORITY", "Only a validated analyst-review-priority decision can enter the acquisition handoff");
  const decisionAt = iso(decision.asOf, "decision.asOf");
  const ageHours = (new Date(asOf).getTime() - new Date(decisionAt).getTime()) / 3600000;
  if (ageHours < 0 || ageHours > maximumAgeHours) throw fail("WR_OPPORTUNITY_DECISION_STALE", "Opportunity decision is future-dated or outside the handoff freshness window");
  if (iso(decision.certification?.expiresAt, "decision.certification.expiresAt") < asOf || !decision.certification?.modelSha256 || !decision.certification?.backtestSha256 || !decision.certification?.driftSha256) throw fail("WR_OPPORTUNITY_CERTIFICATION_INVALID", "Opportunity model certification is expired or incomplete");
  if (!Array.isArray(decision.sourceEvidence) || !decision.sourceEvidence.length || decision.sourceEvidence.some((item) => item.freshnessStatus !== "current" || item.partial === true || item.sourceCountyId !== countyIdFromProperty(id) || iso(item.sourceUpdatedAt, "decision.sourceUpdatedAt") > asOf)) throw fail("WR_OPPORTUNITY_SOURCE_INVALID", "Opportunity decision source evidence is stale, partial, future-dated, or outside county scope");
  return decision;
}

function normalizeProfile(profile, id, asOf) {
  if (profile?.schemaVersion !== "wr-property-profile-v1" || propertyId(profile.whiteRabbitPropertyId || profile.parcel?.whiteRabbitPropertyId) !== id || !profile.parcel || !profile.lineage) throw fail("WR_HANDOFF_PROFILE_INVALID", "A canonical property profile with lineage is required");
  const profileAsOf = iso(profile.asOf || profile.generatedAt || profile.lineage.sourceUpdatedAt || profile.lineage.sourceAsOf, "profile.asOf");
  if (profileAsOf > asOf || profile.lineage.freshnessStatus !== "current") throw fail("WR_HANDOFF_PROFILE_NOT_CURRENT", "Property profile is future-dated or not current");
  const parcelFields = ["whiteRabbitPropertyId", "accountNum", "accountNumber", "siteAddress", "address", "propertyAddress", "ownerName", "ownerName1", "ownershipTenureYears", "landAreaSize", "landAreaSqFt", "landAreaUnit", "totalValue", "yearBuilt"];
  const parcel = Object.fromEntries(parcelFields.filter((key) => profile.parcel[key] !== undefined).map((key) => [key, structuredClone(profile.parcel[key])]));
  parcel.whiteRabbitPropertyId = id;
  const zoning = profile.intelligence?.zoning ? Object.fromEntries(["code", "sourceDatasetId", "sourceAsOf"].filter((key) => profile.intelligence.zoning[key] !== undefined).map((key) => [key, profile.intelligence.zoning[key]])) : undefined;
  const floodplain = profile.intelligence?.floodplain ? Object.fromEntries(["designation", "sourceDatasetId", "sourceAsOf"].filter((key) => profile.intelligence.floodplain[key] !== undefined).map((key) => [key, profile.intelligence.floodplain[key]])) : undefined;
  const development = profile.intelligence?.development ? Object.fromEntries(["signalCount", "sourceDatasetId", "latestActivityDate"].filter((key) => profile.intelligence.development[key] !== undefined).map((key) => [key, profile.intelligence.development[key]])) : undefined;
  const sanitized = { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: id, sourceCountyId: countyIdFromProperty(id), accountNum: String(profile.accountNum || parcel.accountNum || parcel.accountNumber || ""), asOf: profileAsOf, parcel, intelligence: { ...(zoning ? { zoning } : {}), ...(floodplain ? { floodplain } : {}), ...(development ? { development } : {}) }, evidence: { layerStatus: { permits: String(profile.evidence?.layerStatus?.permits || "unknown") }, permitCount: Number.isFinite(Number(profile.evidence?.permitCount)) ? Number(profile.evidence.permitCount) : null, errors: (profile.evidence?.errors || []).slice(0, 50).map(String) }, lineage: { sourceDatasetId: required(profile.lineage.sourceDatasetId, "profile.lineage.sourceDatasetId"), sourceVersion: String(profile.lineage.sourceVersion || ""), sourceUpdatedAt: iso(profile.lineage.sourceUpdatedAt || profileAsOf, "profile.lineage.sourceUpdatedAt"), sourceAsOf: iso(profile.lineage.sourceAsOf || profileAsOf, "profile.lineage.sourceAsOf"), freshnessStatus: "current" } };
  if (JSON.stringify(sanitized).length > 262144) throw fail("WR_HANDOFF_PROFILE_TOO_LARGE", "Sanitized property profile exceeds 256 KiB");
  return { profile: sanitized, profileAsOf };
}

function normalizeUnderwritingEvidence(input, id, asOf, verifier) {
  if (input?.schemaVersion !== UNDERWRITING_EVIDENCE_PACK_VERSION || input?.activationAuthorized !== true) throw fail("WR_UNDERWRITING_EVIDENCE_NOT_CERTIFIED", "An activation-authorized underwriting evidence pack is required");
  let verification;
  try { verification = typeof verifier === "function" ? verifier(input) : null; } catch { verification = null; }
  if (verification?.valid !== true || verification?.activationAuthorized !== true) throw fail("WR_UNDERWRITING_EVIDENCE_SIGNATURE_REJECTED", "Underwriting evidence pack failed current trust verification");
  const evidenceAsOf = iso(input?.evidenceAsOf, "underwritingEvidence.evidenceAsOf");
  if (evidenceAsOf > asOf) throw fail("WR_UNDERWRITING_POINT_IN_TIME_LEAKAGE", "Underwriting evidence is dated after the handoff");
  const analyses = (input?.comparableAnalyses || []).map((item) => structuredClone(item));
  if (analyses.length > 4 || JSON.stringify(analyses).length > 2097152 || JSON.stringify(input?.assumptionInput || {}).length > 65536) throw fail("WR_UNDERWRITING_EVIDENCE_LIMIT", "Underwriting evidence exceeds bounded handoff limits");
  const requiredTypes = [...new Set((input?.requiredComparableTypes || []).map(String))];
  if (!requiredTypes.length || requiredTypes.some((type) => !["rent", "sale"].includes(type))) throw fail("WR_UNDERWRITING_COMPARABLES_REQUIRED", "At least one required comparable type must be declared");
  for (const type of requiredTypes) {
    const analysis = analyses.find((item) => item.analysisType === type);
    if (analysis?.schemaVersion !== "wr-comparable-analysis-v1" || analysis.status !== "adjusted-estimate" || analysis.subject?.whiteRabbitPropertyId !== id || !analysis.selected?.length || analysis.selected.length > 8 || analysis.missingAdjustmentEvidence?.length || iso(analysis.analysisAsOf, "comparable.analysisAsOf") > asOf) throw fail("WR_UNDERWRITING_EVIDENCE_INSUFFICIENT", `A complete point-in-time ${type} comparable analysis is required`);
    if (analysis.selected.some((item) => item.comparable?.source?.licenseStatus !== "authorized" || iso(item.comparable?.source?.availableAt, "comparable.source.availableAt") > analysis.analysisAsOf)) throw fail("WR_UNDERWRITING_SOURCE_NOT_AUTHORIZED", `${type} comparables contain unauthorized or future evidence`);
  }
  return { assumptionInput: structuredClone(input?.assumptionInput || {}), comparableAnalyses: analyses, requiredComparableTypes: requiredTypes, evidenceAsOf };
}

function createLedger(input) {
  return { schemaVersion: ACQUISITION_HANDOFF_LEDGER_VERSION, organizationId: required(input.organizationId, "ledger.organizationId"), whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId), revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), handoffs: (input.handoffs || []).slice(-25), updatedAt: iso(input.updatedAt, "ledger.updatedAt") };
}

function fingerprint(context, input) { return digest({ organizationId: context.organizationId, actorUserId: context.actorUserId, whiteRabbitPropertyId: input.whiteRabbitPropertyId, asOf: input.asOf, expectedTenantRevision: input.expectedTenantRevision, expectedHandoffRecordRevision: input.expectedHandoffRecordRevision, expectedUnderwritingRecordRevision: input.expectedUnderwritingRecordRevision }); }

export function createAcquisitionHandoffWorkflow({ repository, allowedCountyIds = [], releaseDecisions = [], verifyReleaseDecision = null, profileProvider = null, underwritingEvidenceProvider = null, verifyProvider = null, verifyUnderwritingEvidence = null, maximumDecisionAgeHours = 24, minimumBriefCompletenessPct = 40, clock = () => new Date().toISOString() } = {}) {
  if (!repository?.readRecord || !repository?.readIdempotencyReceipt || !repository?.commitMany) throw new TypeError("A durable transactional repository is required");
  const counties = new Set(allowedCountyIds.map(String).filter(Boolean));
  if (!counties.size) throw new TypeError("allowedCountyIds must contain at least one county");
  const activationAuthorized = authorizedRelease(releaseDecisions, verifyReleaseDecision);
  const profileAuthorized = providerAuthorized(profileProvider, HANDOFF_PROFILE_PROVIDER_VERSION, "property-profile", verifyProvider) && typeof profileProvider.getProfile === "function";
  const underwritingAuthorized = providerAuthorized(underwritingEvidenceProvider, UNDERWRITING_EVIDENCE_PROVIDER_VERSION, "underwriting-evidence", verifyProvider) && typeof underwritingEvidenceProvider.getEvidence === "function";
  return Object.freeze({
    schemaVersion: ACQUISITION_HANDOFF_WORKFLOW_VERSION,
    activationAuthorized,
    async create(input = {}, context = {}) {
      if (!activationAuthorized) throw fail("WR_ACQUISITION_HANDOFF_INACTIVE", "Acquisition handoff is not release-authorized");
      assertPersistenceGrant(context, "persistence:read"); assertPersistenceGrant(context, "persistence:write");
      if (!context.grants?.includes("acquisition-handoff:create")) throw fail("WR_ACQUISITION_HANDOFF_PERMISSION_DENIED", "acquisition-handoff:create grant is required");
      if (!profileAuthorized || !underwritingAuthorized) throw fail("WR_ACQUISITION_HANDOFF_PROVIDER_INACTIVE", "Verified profile and underwriting evidence providers are required");
      const id = propertyId(input.whiteRabbitPropertyId);
      if (!counties.has(countyIdFromProperty(id))) throw fail("WR_ACQUISITION_HANDOFF_COUNTY_SCOPE", "Property is outside the acquisition-handoff county allowlist");
      const asOf = iso(input.asOf || clock(), "asOf");
      const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
      const requestFingerprint = fingerprint(context, { ...input, whiteRabbitPropertyId: id, asOf });
      const priorReceipt = repository.readIdempotencyReceipt(context, idempotencyKey, { now: asOf });
      if (priorReceipt) {
        if (priorReceipt.requestFingerprint !== requestFingerprint) throw fail("WR_IDEMPOTENCY_CONFLICT", "Idempotency key was used for another acquisition handoff");
        const record = repository.readRecord(context, "acquisition-handoff", `property:${id}`, { now: asOf });
        const handoff = record?.value?.handoffs?.find((item) => item.id === priorReceipt.responseMetadata?.handoffId);
        if (!handoff) throw fail("WR_IDEMPOTENCY_RESULT_MISSING", "Replay receipt references a handoff outside the bounded ledger");
        return { schemaVersion: ACQUISITION_HANDOFF_RESULT_VERSION, status: "replayed", receipt: { ...priorReceipt, replayed: true }, handoff, replayed: true };
      }
      const tenantRevision = repository.tenantRevision(context, { now: asOf });
      if (Number(input.expectedTenantRevision) !== tenantRevision) throw fail("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${input.expectedTenantRevision}, found ${tenantRevision}`);
      const opportunityRecord = repository.readRecord(context, "opportunity-intelligence", `property:${id}`, { now: asOf });
      const decision = currentDecision(opportunityRecord, id, context.organizationId, asOf, Math.max(1, Number(maximumDecisionAgeHours) || 24));
      const handoffKey = `property:${id}`;
      const handoffRecord = repository.readRecord(context, "acquisition-handoff", handoffKey, { now: asOf });
      const underwritingRecord = repository.readRecord(context, "underwriting", "governance-state", { now: asOf });
      if (Number(input.expectedHandoffRecordRevision || 0) !== Number(handoffRecord?.revision || 0) || Number(input.expectedUnderwritingRecordRevision || 0) !== Number(underwritingRecord?.revision || 0)) throw fail("WR_PERSISTENCE_CONFLICT", "Acquisition handoff or underwriting record revision conflict");
      const ledger = handoffRecord ? createLedger(handoffRecord.value) : createLedger({ organizationId: context.organizationId, whiteRabbitPropertyId: id, updatedAt: asOf });
      if (ledger.organizationId !== context.organizationId) throw fail("WR_TENANT_ISOLATION_VIOLATION", "Acquisition handoff ledger belongs to another tenant");
      if (ledger.handoffs.some((item) => item.sourceDecisionId === decision.id)) throw fail("WR_ACQUISITION_HANDOFF_DUPLICATE", "This opportunity decision already has an acquisition handoff");
      const rawProfile = await profileProvider.getProfile(id, { asOf, context, signal: input.signal || null });
      const { profile, profileAsOf } = normalizeProfile(rawProfile, id, asOf);
      const rawEvidence = await underwritingEvidenceProvider.getEvidence(id, { asOf, context, profile, opportunityDecision: decision, signal: input.signal || null });
      const evidence = normalizeUnderwritingEvidence(rawEvidence, id, asOf, verifyUnderwritingEvidence);
      let governance = underwritingRecord ? createUnderwritingGovernanceState(underwritingRecord.value) : createUnderwritingGovernanceState({ organizationId: context.organizationId, updatedAt: asOf });
      if (governance.organizationId !== context.organizationId || governance.scenarios.length >= 5000) throw fail("WR_UNDERWRITING_CAPACITY_OR_TENANT", "Underwriting governance is outside tenant scope or at capacity");
      const scenarioId = `uw_handoff_${digest(`${context.organizationId}|${decision.id}`).slice(0, 20)}`;
      governance = addUnderwritingScenario(governance, { id: scenarioId, whiteRabbitPropertyId: id, name: `Opportunity handoff ${decision.id}`, assumptionInput: evidence.assumptionInput, comparableAnalyses: evidence.comparableAnalyses, requiredComparableTypes: evidence.requiredComparableTypes, createdAt: asOf, generatedAt: asOf }, { organizationId: context.organizationId, actorUserId: context.actorUserId, permissions: ["underwriting:write"] }, { expectedStateRevision: governance.revision });
      const scenario = governance.scenarios.find((item) => item.id === scenarioId);
      const opportunitySignals = { schemaVersion: "wr-handoff-opportunity-evidence-v1", decisionId: decision.id, disposition: decision.disposition, predictiveScore: decision.predictiveScore, heuristicSignal: decision.heuristicSignal, model: decision.model, sourceEvidence: decision.sourceEvidence, missingEvidence: decision.heuristicSignal?.missingEvidence || [] };
      const brief = buildOpportunityBrief({ profile, opportunitySignals, underwriting: scenario.result, generatedAt: asOf });
      if (brief.whiteRabbitPropertyId !== id || brief.status === "insufficient-evidence" || Number(brief.evidenceSummary?.completenessPct || 0) < Math.max(1, Number(minimumBriefCompletenessPct) || 40)) throw fail("WR_OPPORTUNITY_BRIEF_INSUFFICIENT", "Opportunity brief does not meet the evidence-completeness threshold");
      const handoffCore = { whiteRabbitPropertyId: id, sourceDecisionId: decision.id, sourceDecisionSha256: digest(decision), scenarioId, scenarioEvidenceDigest: scenario.evidenceDigest, briefSha256: digest(brief), brief, createdAt: asOf, createdBy: context.actorUserId, profileAsOf, underwritingEvidenceAsOf: evidence.evidenceAsOf, status: "draft-pending-independent-review", advisoryOnly: true, exportAuthorized: false, approvalAuthorized: false };
      const handoff = { schemaVersion: ACQUISITION_HANDOFF_VERSION, id: `handoff_${digest(handoffCore).slice(0, 24)}`, organizationId: context.organizationId, ...handoffCore };
      const nextLedger = { ...ledger, revision: ledger.revision + 1, handoffs: [...ledger.handoffs, handoff].slice(-25), updatedAt: asOf };
      const receipt = repository.commitMany({ context, mutations: [
        { namespace: "acquisition-handoff", key: handoffKey, operation: "put", value: nextLedger, expectedRecordRevision: Number(handoffRecord?.revision || 0) },
        { namespace: "underwriting", key: "governance-state", operation: "put", value: governance, expectedRecordRevision: Number(underwritingRecord?.revision || 0) }
      ], expectedTenantRevision: tenantRevision, idempotencyKey, requestFingerprint, responseMetadata: { handoffId: handoff.id, scenarioId, sourceDecisionId: decision.id, whiteRabbitPropertyId: id }, occurredAt: asOf }, { now: asOf });
      return { schemaVersion: ACQUISITION_HANDOFF_RESULT_VERSION, status: "created", receipt, handoff, scenario, replayed: false };
    }
  });
}
