import { createHash } from "node:crypto";
import { calculateUnderwriting, normalizeUnderwritingAssumptions } from "./underwritingEngine.mjs";

export const UNDERWRITING_SCENARIO_VERSION = "wr-underwriting-scenario-v1";
export const UNDERWRITING_REVIEW_VERSION = "wr-underwriting-review-v1";
export const UNDERWRITING_APPROVAL_VERSION = "wr-underwriting-approval-v1";
export const UNDERWRITING_GOVERNANCE_STATE_VERSION = "wr-underwriting-governance-state-v1";
export const UNDERWRITING_GOVERNANCE_ACTIVITY_VERSION = "wr-underwriting-governance-activity-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stableId(prefix, seed) {
  return `${prefix}_${digest(seed).slice(0, 20)}`;
}

function propertyId(value) {
  const normalized = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(normalized)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return normalized;
}

function actorContext(input = {}, permission) {
  const context = { organizationId: required(input.organizationId, "context.organizationId"), actorUserId: required(input.actorUserId, "context.actorUserId"), permissions: [...new Set((input.permissions || []).map(String))] };
  if (permission && !context.permissions.includes(permission)) {
    const error = new Error(`User ${context.actorUserId} lacks ${permission}`);
    error.code = "WR_PERMISSION_DENIED";
    throw error;
  }
  return context;
}

function revision(value) {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

export class UnderwritingRevisionConflictError extends Error {
  constructor(entityType, entityId, expectedRevision, actualRevision) {
    super(`${entityType} ${entityId} revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = "UnderwritingRevisionConflictError";
    this.code = "WR_REVISION_CONFLICT";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function evidenceDigest(model, result, comparableAnalyses) {
  return digest({ model, result, comparableAnalyses });
}

export function createUnderwritingScenario(input = {}) {
  const createdAt = iso(input.createdAt, "createdAt");
  const generatedAt = iso(input.generatedAt || input.result?.generatedAt || createdAt, "generatedAt");
  const assumptionInput = structuredClone(input.assumptionInput || {});
  const model = normalizeUnderwritingAssumptions(assumptionInput);
  const result = calculateUnderwriting(model, { generatedAt });
  const comparableAnalyses = (input.comparableAnalyses || []).map((analysis) => {
    if (analysis?.schemaVersion !== "wr-comparable-analysis-v1") throw new TypeError("Comparable analyses must use wr-comparable-analysis-v1");
    return structuredClone(analysis);
  });
  const organizationId = required(input.organizationId, "organizationId");
  const whiteRabbitPropertyId = propertyId(input.whiteRabbitPropertyId);
  const createdBy = required(input.createdBy, "createdBy");
  const status = ["draft", "in-review", "changes-requested", "approved", "rejected", "superseded"].includes(input.status) ? input.status : "draft";
  return {
    schemaVersion: UNDERWRITING_SCENARIO_VERSION,
    id: String(input.id || stableId("uw_scenario", `${organizationId}|${whiteRabbitPropertyId}|${createdAt}|${input.name || "Scenario"}`)),
    organizationId,
    whiteRabbitPropertyId,
    name: required(input.name || "Underwriting scenario", "name"),
    status,
    assumptionInput,
    model,
    result,
    comparableAnalyses,
    requiredComparableTypes: [...new Set((input.requiredComparableTypes || []).filter((type) => ["sale", "rent"].includes(type)))],
    evidenceDigest: evidenceDigest(model, result, comparableAnalyses),
    generatedAt,
    revision: revision(input.revision),
    createdBy,
    updatedBy: String(input.updatedBy || createdBy),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt, "updatedAt"),
  };
}

export function createUnderwritingGovernanceState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const scenarios = (input.scenarios || []).map(createUnderwritingScenario);
  if (scenarios.some((scenario) => scenario.organizationId !== organizationId)) {
    const error = new Error("Every underwriting scenario must match the governance-state organization");
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  const reviews = (input.reviews || []).map((review) => ({ ...review, schemaVersion: UNDERWRITING_REVIEW_VERSION }));
  const approvals = (input.approvals || []).map((approval) => ({ ...approval, schemaVersion: UNDERWRITING_APPROVAL_VERSION }));
  const activity = (input.activity || []).map((event) => Object.freeze({ ...event, schemaVersion: UNDERWRITING_GOVERNANCE_ACTIVITY_VERSION }));
  if ([...reviews, ...approvals, ...activity].some((item) => item.organizationId !== organizationId)) {
    const error = new Error("Every underwriting governance record must match the state organization");
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  return {
    schemaVersion: UNDERWRITING_GOVERNANCE_STATE_VERSION,
    organizationId,
    revision: revision(input.revision),
    scenarios,
    reviews,
    approvals,
    activity,
    updatedAt: iso(input.updatedAt, "updatedAt"),
  };
}

function assertStateRevision(state, expected) {
  if (expected !== undefined && Number(expected) !== state.revision) throw new UnderwritingRevisionConflictError("underwriting-governance-state", "root", Number(expected), state.revision);
}

function assertScenarioRevision(scenario, expected) {
  if (expected !== undefined && Number(expected) !== scenario.revision) throw new UnderwritingRevisionConflictError("underwriting-scenario", scenario.id, Number(expected), scenario.revision);
}

function appendActivity(state, context, action, scenario, occurredAt, metadata = {}) {
  const event = Object.freeze({ schemaVersion: UNDERWRITING_GOVERNANCE_ACTIVITY_VERSION, id: stableId("uw_activity", `${scenario.id}|${action}|${context.actorUserId}|${occurredAt}|${state.revision}`), organizationId: state.organizationId, scenarioId: scenario.id, whiteRabbitPropertyId: scenario.whiteRabbitPropertyId, actorUserId: context.actorUserId, action, occurredAt, metadata: { ...metadata } });
  return { ...state, revision: state.revision + 1, activity: [...state.activity, event], updatedAt: occurredAt };
}

export function addUnderwritingScenario(stateInput, scenarioInput, contextInput = {}, options = {}) {
  let state = createUnderwritingGovernanceState(stateInput);
  const context = actorContext(contextInput, "underwriting:write");
  if (context.organizationId !== state.organizationId) throw Object.assign(new Error("Actor organization does not match governance state"), { code: "WR_TENANT_ISOLATION_VIOLATION" });
  assertStateRevision(state, options.expectedStateRevision);
  const scenario = createUnderwritingScenario({ ...scenarioInput, organizationId: state.organizationId, createdBy: context.actorUserId, updatedBy: context.actorUserId });
  if (state.scenarios.some((item) => item.id === scenario.id)) throw new TypeError(`Underwriting scenario already exists: ${scenario.id}`);
  state.scenarios = [...state.scenarios, scenario];
  return appendActivity(state, context, "underwriting.scenario-created", scenario, scenario.createdAt);
}

export function reviseUnderwritingScenario(stateInput, scenarioId, changes = {}, contextInput = {}, options = {}) {
  let state = createUnderwritingGovernanceState(stateInput);
  const context = actorContext(contextInput, "underwriting:write");
  if (context.organizationId !== state.organizationId) throw Object.assign(new Error("Actor organization does not match governance state"), { code: "WR_TENANT_ISOLATION_VIOLATION" });
  assertStateRevision(state, options.expectedStateRevision);
  const existing = state.scenarios.find((scenario) => scenario.id === scenarioId);
  if (!existing) throw new TypeError(`Unknown underwriting scenario: ${scenarioId}`);
  assertScenarioRevision(existing, options.expectedScenarioRevision);
  if (["approved", "superseded"].includes(existing.status)) throw new TypeError("Approved or superseded underwriting scenarios are immutable");
  if (!context.permissions.includes("underwriting:admin") && existing.createdBy !== context.actorUserId) throw Object.assign(new Error("Only the scenario author or an underwriting admin can revise it"), { code: "WR_PERMISSION_DENIED" });
  const updatedAt = iso(options.occurredAt, "occurredAt");
  const next = createUnderwritingScenario({ ...existing, ...changes, id: existing.id, organizationId: existing.organizationId, whiteRabbitPropertyId: existing.whiteRabbitPropertyId, createdBy: existing.createdBy, createdAt: existing.createdAt, status: "draft", revision: existing.revision + 1, updatedBy: context.actorUserId, updatedAt, generatedAt: updatedAt });
  state.scenarios = state.scenarios.map((scenario) => scenario.id === scenarioId ? next : scenario);
  return appendActivity(state, context, "underwriting.scenario-revised", next, updatedAt, { previousRevision: existing.revision });
}

export function submitUnderwritingScenario(stateInput, scenarioId, contextInput = {}, options = {}) {
  let state = createUnderwritingGovernanceState(stateInput);
  const context = actorContext(contextInput, "underwriting:write");
  if (context.organizationId !== state.organizationId) throw Object.assign(new Error("Actor organization does not match governance state"), { code: "WR_TENANT_ISOLATION_VIOLATION" });
  assertStateRevision(state, options.expectedStateRevision);
  const existing = state.scenarios.find((scenario) => scenario.id === scenarioId);
  if (!existing) throw new TypeError(`Unknown underwriting scenario: ${scenarioId}`);
  assertScenarioRevision(existing, options.expectedScenarioRevision);
  if (!context.permissions.includes("underwriting:admin") && existing.createdBy !== context.actorUserId) throw Object.assign(new Error("Only the scenario author or an underwriting admin can submit it"), { code: "WR_PERMISSION_DENIED" });
  if (!["draft", "changes-requested"].includes(existing.status)) throw new TypeError(`Scenario cannot be submitted from status ${existing.status}`);
  if (existing.result.status === "insufficient-evidence") throw new TypeError("Scenario cannot enter review with insufficient underwriting evidence");
  for (const type of existing.requiredComparableTypes) {
    const analysis = existing.comparableAnalyses.find((item) => item.analysisType === type && item.status === "adjusted-estimate");
    if (!analysis) throw new TypeError(`Scenario requires an adjusted ${type} comparable analysis`);
    if (analysis.subject?.whiteRabbitPropertyId !== existing.whiteRabbitPropertyId || !analysis.estimate || analysis.missingAdjustmentEvidence?.length || !analysis.selected?.length) throw new TypeError(`Scenario ${type} comparable analysis lacks complete subject-matched evidence`);
    const analysisAsOf = new Date(analysis.analysisAsOf).getTime();
    if (!Number.isFinite(analysisAsOf) || analysisAsOf > new Date(existing.generatedAt).getTime()) throw new TypeError(`Scenario ${type} comparable analysis is not point-in-time safe`);
    if (analysis.selected.some((item) => item.comparable?.source?.licenseStatus !== "authorized" || new Date(item.comparable?.source?.availableAt).getTime() > analysisAsOf)) throw new TypeError(`Scenario ${type} comparable analysis contains unauthorized or future evidence`);
  }
  const occurredAt = iso(options.occurredAt, "occurredAt");
  const next = { ...existing, status: "in-review", revision: existing.revision + 1, updatedBy: context.actorUserId, updatedAt: occurredAt };
  state.scenarios = state.scenarios.map((scenario) => scenario.id === scenarioId ? next : scenario);
  return appendActivity(state, context, "underwriting.scenario-submitted", next, occurredAt, { evidenceDigest: next.evidenceDigest });
}

export function recordUnderwritingReview(stateInput, scenarioId, reviewInput = {}, contextInput = {}, options = {}) {
  let state = createUnderwritingGovernanceState(stateInput);
  const context = actorContext(contextInput, "underwriting:review");
  if (context.organizationId !== state.organizationId) throw Object.assign(new Error("Actor organization does not match governance state"), { code: "WR_TENANT_ISOLATION_VIOLATION" });
  assertStateRevision(state, options.expectedStateRevision);
  const scenario = state.scenarios.find((item) => item.id === scenarioId);
  if (!scenario || scenario.status !== "in-review") throw new TypeError("Scenario must be in review");
  assertScenarioRevision(scenario, options.expectedScenarioRevision);
  if (scenario.createdBy === context.actorUserId) throw Object.assign(new Error("Scenario authors cannot review their own underwriting"), { code: "WR_SEPARATION_OF_DUTIES" });
  const decision = reviewInput.decision === "changes-requested" ? "changes-requested" : "recommended";
  const occurredAt = iso(options.occurredAt, "occurredAt");
  const review = Object.freeze({ schemaVersion: UNDERWRITING_REVIEW_VERSION, id: stableId("uw_review", `${scenario.id}|${scenario.revision}|${context.actorUserId}|${occurredAt}`), organizationId: state.organizationId, scenarioId: scenario.id, scenarioRevision: scenario.revision, evidenceDigest: scenario.evidenceDigest, reviewerUserId: context.actorUserId, decision, comment: required(reviewInput.comment, "review.comment"), createdAt: occurredAt });
  state.reviews = [...state.reviews, review];
  let nextScenario = scenario;
  if (decision === "changes-requested") {
    nextScenario = { ...scenario, status: "changes-requested", revision: scenario.revision + 1, updatedBy: context.actorUserId, updatedAt: occurredAt };
    state.scenarios = state.scenarios.map((item) => item.id === scenario.id ? nextScenario : item);
  }
  return appendActivity(state, context, decision === "recommended" ? "underwriting.review-recommended" : "underwriting.changes-requested", nextScenario, occurredAt, { reviewId: review.id, reviewedScenarioRevision: review.scenarioRevision, evidenceDigest: review.evidenceDigest });
}

export function decideUnderwritingScenario(stateInput, scenarioId, decisionInput = {}, contextInput = {}, options = {}) {
  let state = createUnderwritingGovernanceState(stateInput);
  const context = actorContext(contextInput, "underwriting:approve");
  if (context.organizationId !== state.organizationId) throw Object.assign(new Error("Actor organization does not match governance state"), { code: "WR_TENANT_ISOLATION_VIOLATION" });
  assertStateRevision(state, options.expectedStateRevision);
  const scenario = state.scenarios.find((item) => item.id === scenarioId);
  if (!scenario || scenario.status !== "in-review") throw new TypeError("Scenario must be in review");
  assertScenarioRevision(scenario, options.expectedScenarioRevision);
  if (scenario.createdBy === context.actorUserId) throw Object.assign(new Error("Scenario authors cannot approve their own underwriting"), { code: "WR_SEPARATION_OF_DUTIES" });
  const recommended = [...state.reviews].reverse().find((review) => review.scenarioId === scenario.id && review.decision === "recommended" && review.scenarioRevision === scenario.revision && review.evidenceDigest === scenario.evidenceDigest);
  if (!recommended) throw new TypeError("A current independent recommended review is required before approval");
  const decision = decisionInput.decision === "rejected" ? "rejected" : "approved";
  const occurredAt = iso(options.occurredAt, "occurredAt");
  const next = { ...scenario, status: decision, revision: scenario.revision + 1, updatedBy: context.actorUserId, updatedAt: occurredAt };
  const approval = Object.freeze({ schemaVersion: UNDERWRITING_APPROVAL_VERSION, id: stableId("uw_approval", `${scenario.id}|${scenario.revision}|${decision}|${context.actorUserId}|${occurredAt}`), organizationId: state.organizationId, scenarioId: scenario.id, reviewedScenarioRevision: scenario.revision, approvedScenarioRevision: next.revision, evidenceDigest: scenario.evidenceDigest, reviewId: recommended.id, approverUserId: context.actorUserId, decision, comment: required(decisionInput.comment, "decision.comment"), decidedAt: occurredAt });
  state.scenarios = state.scenarios.map((item) => item.id === scenario.id ? next : item);
  state.approvals = [...state.approvals, approval];
  return appendActivity(state, context, decision === "approved" ? "underwriting.scenario-approved" : "underwriting.scenario-rejected", next, occurredAt, { approvalId: approval.id, reviewId: recommended.id, evidenceDigest: approval.evidenceDigest });
}
