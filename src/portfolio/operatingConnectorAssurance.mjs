import { createHash } from "node:crypto";
import { createOperatingConnector, createOperatingMappingProfile, createOperatingConnectorWorkerState } from "./operatingConnectorRuntime.mjs";

export const CONNECTOR_SCHEMA_BASELINE_VERSION = "wr-connector-schema-baseline-v1";
export const CONNECTOR_SCHEMA_ASSESSMENT_VERSION = "wr-connector-schema-assessment-v1";
export const CONNECTOR_CREDENTIAL_BINDING_VERSION = "wr-connector-credential-binding-v1";
export const CONNECTOR_CREDENTIAL_ROTATION_VERSION = "wr-connector-credential-rotation-v1";
export const CONNECTOR_DRILL_PLAN_VERSION = "wr-connector-drill-plan-v1";
export const CONNECTOR_DRILL_RESULT_VERSION = "wr-connector-drill-result-v1";
export const OPERATING_ADAPTER_CERTIFICATION_VERSION = "wr-operating-adapter-certification-v1";
export const CONNECTOR_HEALTH_REPORT_VERSION = "wr-connector-health-report-v1";
export const CONNECTOR_ASSURANCE_STATE_VERSION = "wr-connector-assurance-state-v1";

const REQUIRED_DRILLS = Object.freeze(["provider-outage", "cursor-stall", "credential-expiry", "schema-drift", "lease-recovery"]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function connectorAssuranceSha256(value) { return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex"); }
function error(code, message) { const value = new Error(message); value.code = code; return value; }
function seal(input, body, field, code) { const digest = connectorAssuranceSha256(body); if (input?.[field] && input[field] !== digest) throw error(code, `${field} verification failed`); return Object.freeze({ ...body, [field]: digest }); }
function secretRef(value, name = "secretRef") { const normalized = required(value, name); if (!normalized.startsWith("secret-ref:")) throw new TypeError(`${name} must be an opaque secret-ref`); return normalized; }
function evidenceRefs(values, name) { const refs = [...new Set((values || []).map(String).filter(Boolean))].sort(); if (!refs.length || refs.some((item) => !item.startsWith("evidence-ref:"))) throw new TypeError(`${name} requires opaque evidence-ref values`); return refs; }
function safePath(value, name) { const parts = required(value, name).split("."); if (parts.some((part) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(part) || UNSAFE_KEYS.has(part))) throw new TypeError(`${name} is unsafe`); return parts.join("."); }
function safeSchemaPath(value, name) { const parts = required(value, name).split("."); if (parts.some((part) => !/^[A-Za-z][A-Za-z0-9_-]*(?:\[\])?$/.test(part) || UNSAFE_KEYS.has(part.replace(/\[\]$/, "")))) throw new TypeError(`${name} is unsafe`); return parts.join("."); }

function valueType(value) { if (value === null) return "null"; if (Array.isArray(value)) return "array"; if (Number.isInteger(value)) return "integer"; return typeof value; }
function collectDescriptor(value, prefix, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value).sort()) {
    if (UNSAFE_KEYS.has(key)) throw new TypeError(`Schema sample contains unsafe key: ${key}`);
    const path = prefix ? `${prefix}.${key}` : key, current = value[key], type = valueType(current);
    const item = output.get(path) || { path, types: new Set(), presentCount: 0 };
    item.types.add(type); item.presentCount += 1; output.set(path, item);
    if (type === "object") collectDescriptor(current, path, output);
    if (type === "array") for (const child of current) if (child && typeof child === "object" && !Array.isArray(child)) collectDescriptor(child, `${path}[]`, output);
  }
}
function schemaDescriptor(records) {
  const samples = (records || []).map((record) => record?.fields ?? record);
  if (!samples.length) throw new TypeError("Schema evidence requires at least one sample record");
  const collected = new Map();
  for (const sample of samples) collectDescriptor(sample, "", collected);
  return [...collected.values()].map((item) => ({ path: item.path, types: [...item.types].sort(), presencePct: Number((item.presentCount / samples.length * 100).toFixed(6)) })).sort((a, b) => a.path.localeCompare(b.path));
}

export function createConnectorSchemaBaseline(input = {}) {
  const sampleRecords = input.sampleRecords || [], descriptor = (input.descriptor || schemaDescriptor(sampleRecords)).map((item, index) => ({ path: safeSchemaPath(item.path, `descriptor[${index}].path`), types: [...new Set((item.types || []).map((type) => required(type, `descriptor[${index}].type`)))].sort(), presencePct: Math.max(0, Math.min(100, Number(item.presencePct) || 0)) })), requiredPaths = [...new Set((input.requiredPaths || []).map((item, index) => safeSchemaPath(item, `requiredPaths[${index}]`)))].sort();
  for (const path of requiredPaths) if (!descriptor.some((item) => item.path === path && item.presencePct === 100)) throw new TypeError(`Required schema path is not present in every sample: ${path}`);
  const body = { schemaVersion: CONNECTOR_SCHEMA_BASELINE_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), version: Math.max(1, Math.trunc(Number(input.version) || 1)), descriptor: structuredClone(descriptor), requiredPaths, sampleCount: Math.max(1, Number(input.sampleCount) || sampleRecords.length), createdByUserId: required(input.createdByUserId, "createdByUserId"), createdAt: iso(input.createdAt, "createdAt"), approvedByUserId: required(input.approvedByUserId, "approvedByUserId"), approvedAt: iso(input.approvedAt, "approvedAt") };
  if (body.createdByUserId === body.approvedByUserId) throw error("WR_SCHEMA_BASELINE_APPROVAL_SEPARATION_REQUIRED", "Schema baselines require an independent approver");
  return seal(input, body, "baselineSha256", "WR_CONNECTOR_SCHEMA_BASELINE_INTEGRITY_FAILURE");
}

export function assessConnectorSchemaPage(baselineInput, page, options = {}) {
  const baseline = createConnectorSchemaBaseline(baselineInput), descriptor = schemaDescriptor(page?.records || []), expected = new Map(baseline.descriptor.map((item) => [item.path, item])), actual = new Map(descriptor.map((item) => [item.path, item]));
  const missingRequiredPaths = baseline.requiredPaths.filter((path) => !actual.has(path) || actual.get(path).presencePct < 100);
  const typeChanges = [];
  for (const [path, expectedItem] of expected) if (actual.has(path) && canonicalJson(actual.get(path).types) !== canonicalJson(expectedItem.types)) typeChanges.push({ path, expectedTypes: expectedItem.types, actualTypes: actual.get(path).types });
  const addedPaths = descriptor.filter((item) => !expected.has(item.path)).map((item) => item.path), removedOptionalPaths = baseline.descriptor.filter((item) => !actual.has(item.path) && !baseline.requiredPaths.includes(item.path)).map((item) => item.path);
  const body = { schemaVersion: CONNECTOR_SCHEMA_ASSESSMENT_VERSION, organizationId: baseline.organizationId, connectorId: baseline.connectorId, baselineId: baseline.id, baselineVersion: baseline.version, baselineSha256: baseline.baselineSha256, pageSha256: required(page?.pageSha256, "page.pageSha256"), assessedAt: iso(options.assessedAt || page.fetchedAt, "assessedAt"), status: missingRequiredPaths.length || typeChanges.length ? "incompatible" : addedPaths.length || removedOptionalPaths.length ? "compatible-with-drift" : "compatible", missingRequiredPaths, typeChanges, addedPaths, removedOptionalPaths, observedDescriptor: descriptor };
  return seal({}, body, "assessmentSha256", "WR_CONNECTOR_SCHEMA_ASSESSMENT_INTEGRITY_FAILURE");
}

function createSchemaAssessment(input = {}) { const body = { schemaVersion: CONNECTOR_SCHEMA_ASSESSMENT_VERSION, organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), baselineId: required(input.baselineId, "baselineId"), baselineVersion: Math.max(1, Math.trunc(Number(input.baselineVersion) || 1)), baselineSha256: required(input.baselineSha256, "baselineSha256"), pageSha256: required(input.pageSha256, "pageSha256"), assessedAt: iso(input.assessedAt, "assessedAt"), status: ["compatible", "compatible-with-drift", "incompatible"].includes(input.status) ? input.status : "incompatible", missingRequiredPaths: structuredClone(input.missingRequiredPaths || []), typeChanges: structuredClone(input.typeChanges || []), addedPaths: structuredClone(input.addedPaths || []), removedOptionalPaths: structuredClone(input.removedOptionalPaths || []), observedDescriptor: structuredClone(input.observedDescriptor || []) }; return seal(input, body, "assessmentSha256", "WR_CONNECTOR_SCHEMA_ASSESSMENT_INTEGRITY_FAILURE"); }

export function createConnectorSchemaGuard(assuranceStateInput, connectorId, options = {}) {
  const state = createConnectorAssuranceState(assuranceStateInput), connector = required(connectorId, "connectorId"), baseline = [...state.schemaBaselines].filter((item) => item.connectorId === connector).sort((a, b) => b.version - a.version)[0];
  if (!baseline) throw error("WR_CONNECTOR_SCHEMA_BASELINE_MISSING", `No approved schema baseline exists for ${connector}`);
  return (connectorInput, page) => {
    const runtimeConnector = createOperatingConnector(connectorInput);
    if (runtimeConnector.organizationId !== state.organizationId || runtimeConnector.connectorId !== connector) throw error("WR_TENANT_ISOLATION_VIOLATION", "Schema guard connector scope mismatch");
    const assessment = assessConnectorSchemaPage(baseline, page, { assessedAt: options.clock ? options.clock() : page.fetchedAt });
    options.onAssessment?.(assessment);
    if (assessment.status === "incompatible") { const failure = error("WR_CONNECTOR_SCHEMA_DRIFT", "Connector page is incompatible with the approved schema baseline"); failure.assessment = assessment; throw failure; }
    return assessment;
  };
}

export function createConnectorCredentialBinding(input = {}) {
  const validFrom = iso(input.validFrom, "validFrom"), expiresAt = iso(input.expiresAt, "expiresAt");
  if (expiresAt <= validFrom) throw new TypeError("Credential binding expiry must follow activation");
  const body = { schemaVersion: CONNECTOR_CREDENTIAL_BINDING_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), version: Math.max(1, Math.trunc(Number(input.version) || 1)), secretRef: secretRef(input.secretRef), validFrom, expiresAt, status: ["staged", "active", "retired"].includes(input.status) ? input.status : "staged", createdByUserId: required(input.createdByUserId, "createdByUserId"), createdAt: iso(input.createdAt, "createdAt"), evidenceRefs: evidenceRefs(input.evidenceRefs, "credential binding") };
  return seal(input, body, "bindingSha256", "WR_CONNECTOR_CREDENTIAL_BINDING_INTEGRITY_FAILURE");
}

export function createConnectorCredentialRotation(input = {}) {
  const body = { schemaVersion: CONNECTOR_CREDENTIAL_ROTATION_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), fromBindingId: required(input.fromBindingId, "fromBindingId"), fromBindingSha256: required(input.fromBindingSha256, "fromBindingSha256"), toBindingId: required(input.toBindingId, "toBindingId"), toBindingSha256: required(input.toBindingSha256, "toBindingSha256"), requestedByUserId: required(input.requestedByUserId, "requestedByUserId"), requestedAt: iso(input.requestedAt, "requestedAt"), approvedByUserId: required(input.approvedByUserId, "approvedByUserId"), approvedAt: iso(input.approvedAt, "approvedAt"), status: ["approved", "applied", "cancelled"].includes(input.status) ? input.status : "approved", evidenceRefs: evidenceRefs(input.evidenceRefs, "credential rotation"), appliedAt: input.appliedAt ? iso(input.appliedAt, "appliedAt") : "" };
  if (body.requestedByUserId === body.approvedByUserId) throw error("WR_CREDENTIAL_ROTATION_APPROVAL_SEPARATION_REQUIRED", "Credential rotation requires an independent approver");
  return seal(input, body, "rotationSha256", "WR_CONNECTOR_CREDENTIAL_ROTATION_INTEGRITY_FAILURE");
}

export function createConnectorDrillPlan(input = {}) {
  const scenarios = [...new Set((input.scenarios || REQUIRED_DRILLS).map(String))].sort();
  for (const requiredDrill of REQUIRED_DRILLS) if (!scenarios.includes(requiredDrill)) throw new TypeError(`Drill plan is missing required scenario: ${requiredDrill}`);
  const body = { schemaVersion: CONNECTOR_DRILL_PLAN_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), connectorSha256: required(input.connectorSha256, "connectorSha256"), scenarios, createdByUserId: required(input.createdByUserId, "createdByUserId"), createdAt: iso(input.createdAt, "createdAt"), approvedByUserId: required(input.approvedByUserId, "approvedByUserId"), approvedAt: iso(input.approvedAt, "approvedAt") };
  if (body.createdByUserId === body.approvedByUserId) throw error("WR_CONNECTOR_DRILL_APPROVAL_SEPARATION_REQUIRED", "Connector drill plans require an independent approver");
  return seal(input, body, "planSha256", "WR_CONNECTOR_DRILL_PLAN_INTEGRITY_FAILURE");
}

export async function runConnectorDrillSuite(planInput, executeScenario, options = {}) {
  const plan = createConnectorDrillPlan(planInput), startedAt = iso(options.startedAt, "startedAt");
  if (typeof executeScenario !== "function") throw new TypeError("executeScenario is required");
  const scenarioResults = [];
  for (const scenario of plan.scenarios) {
    const result = await executeScenario(Object.freeze({ organizationId: plan.organizationId, connectorId: plan.connectorId, scenario, drillPlanId: plan.id, idempotencyKey: `connector-drill:${plan.id}:${scenario}` }));
    scenarioResults.push(Object.freeze({ scenario, passed: result?.passed === true, assertionCount: Math.max(0, Math.trunc(Number(result?.assertionCount) || 0)), durationMs: Math.max(0, Number(result?.durationMs) || 0), errorCode: result?.passed === true ? "" : String(result?.errorCode || "drill-failed"), evidenceRefs: evidenceRefs(result?.evidenceRefs, `drill ${scenario}`) }));
  }
  const completedAt = iso(options.completedAt, "completedAt"), body = { schemaVersion: CONNECTOR_DRILL_RESULT_VERSION, id: String(options.id || `drill_result_${connectorAssuranceSha256(`${plan.id}|${startedAt}`).slice(0, 24)}`), organizationId: plan.organizationId, connectorId: plan.connectorId, planId: plan.id, planSha256: plan.planSha256, startedAt, completedAt, status: scenarioResults.every((item) => item.passed && item.assertionCount > 0) ? "passed" : "failed", scenarioResults };
  if (completedAt < startedAt) throw new TypeError("Drill completion cannot precede start");
  return seal({}, body, "resultSha256", "WR_CONNECTOR_DRILL_RESULT_INTEGRITY_FAILURE");
}

function createConnectorDrillResult(input = {}) { const scenarioResults = (input.scenarioResults || []).map((item, index) => ({ scenario: required(item.scenario, `scenarioResults[${index}].scenario`), passed: item.passed === true, assertionCount: Math.max(0, Math.trunc(Number(item.assertionCount) || 0)), durationMs: Math.max(0, Number(item.durationMs) || 0), errorCode: item.passed === true ? "" : String(item.errorCode || "drill-failed"), evidenceRefs: evidenceRefs(item.evidenceRefs, `scenarioResults[${index}]`) })); if (new Set(scenarioResults.map((item) => item.scenario)).size !== scenarioResults.length || REQUIRED_DRILLS.some((scenario) => !scenarioResults.some((item) => item.scenario === scenario))) throw new TypeError("Drill result must contain each required scenario exactly once"); const computedStatus = scenarioResults.every((item) => item.passed && item.assertionCount > 0) ? "passed" : "failed"; if (input.status && input.status !== computedStatus) throw new TypeError("Drill result status does not match scenario evidence"); const body = { schemaVersion: CONNECTOR_DRILL_RESULT_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), planId: required(input.planId, "planId"), planSha256: required(input.planSha256, "planSha256"), startedAt: iso(input.startedAt, "startedAt"), completedAt: iso(input.completedAt, "completedAt"), status: computedStatus, scenarioResults }; if (body.completedAt < body.startedAt) throw new TypeError("Drill completion cannot precede start"); return seal(input, body, "resultSha256", "WR_CONNECTOR_DRILL_RESULT_INTEGRITY_FAILURE"); }

export function certifyOperatingAdapter(input = {}) {
  const connector = createOperatingConnector(input.connector), profile = createOperatingMappingProfile(input.mappingProfile), baseline = createConnectorSchemaBaseline(input.schemaBaseline), credential = createConnectorCredentialBinding(input.credentialBinding), drill = createConnectorDrillResult(input.drillResult), slo = input.sloReport || {}, certifiedAt = iso(input.certifiedAt, "certifiedAt"), maxDrillAgeDays = Math.max(1, Math.min(90, Number(input.maximumDrillAgeDays) || 30));
  const drillAgeDays = (new Date(certifiedAt) - new Date(drill.completedAt)) / 86400000;
  const checks = [
    { id: "mapping", passed: profile.organizationId === connector.organizationId && profile.connectorId === connector.connectorId && profile.id === connector.mappingProfileId && profile.version === connector.mappingProfileVersion },
    { id: "schema-baseline", passed: baseline.organizationId === connector.organizationId && baseline.connectorId === connector.connectorId },
    { id: "credential", passed: credential.organizationId === connector.organizationId && credential.connectorId === connector.connectorId && credential.status === "active" && credential.secretRef === connector.credentialRef && credential.validFrom <= certifiedAt && credential.expiresAt > certifiedAt },
    { id: "drills", passed: drill.organizationId === connector.organizationId && drill.connectorId === connector.connectorId && drill.status === "passed" && drillAgeDays >= 0 && drillAgeDays <= maxDrillAgeDays && REQUIRED_DRILLS.every((scenario) => drill.scenarioResults.some((item) => item.scenario === scenario && item.passed && item.assertionCount > 0 && item.evidenceRefs.length > 0)) },
    { id: "slo", passed: slo.schemaVersion === "wr-service-slo-report-v1" && slo.organizationId === connector.organizationId && slo.serviceName === "operating-connector" && slo.status === "passed" },
  ];
  const blockers = checks.filter((item) => !item.passed).map((item) => item.id), status = blockers.length ? "rejected" : "certified";
  const body = { schemaVersion: OPERATING_ADAPTER_CERTIFICATION_VERSION, id: String(input.id || `adapter_cert_${connectorAssuranceSha256(`${connector.connectorSha256}|${certifiedAt}`).slice(0, 24)}`), organizationId: connector.organizationId, connectorId: connector.connectorId, connectorSha256: connector.connectorSha256, mappingSha256: profile.mappingSha256, baselineSha256: baseline.baselineSha256, credentialBindingSha256: credential.bindingSha256, drillResultSha256: drill.resultSha256, sloEvaluatedAt: String(slo.evaluatedAt || certifiedAt), reviewerUserId: required(input.reviewerUserId, "reviewerUserId"), certifiedAt, status, activationAuthorized: status === "certified", checks, blockers };
  if ([profile.createdByUserId, profile.approvedByUserId].includes(body.reviewerUserId)) throw error("WR_ADAPTER_CERTIFICATION_REVIEW_SEPARATION_REQUIRED", "Adapter certification requires a reviewer independent of mapping authors and approvers");
  return seal({}, body, "certificationSha256", "WR_OPERATING_ADAPTER_CERTIFICATION_INTEGRITY_FAILURE");
}

function createAdapterCertification(input = {}) { const body = { schemaVersion: OPERATING_ADAPTER_CERTIFICATION_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), connectorSha256: required(input.connectorSha256, "connectorSha256"), mappingSha256: required(input.mappingSha256, "mappingSha256"), baselineSha256: required(input.baselineSha256, "baselineSha256"), credentialBindingSha256: required(input.credentialBindingSha256, "credentialBindingSha256"), drillResultSha256: required(input.drillResultSha256, "drillResultSha256"), sloEvaluatedAt: iso(input.sloEvaluatedAt, "sloEvaluatedAt"), reviewerUserId: required(input.reviewerUserId, "reviewerUserId"), certifiedAt: iso(input.certifiedAt, "certifiedAt"), status: input.status === "certified" ? "certified" : "rejected", activationAuthorized: input.activationAuthorized === true, checks: structuredClone(input.checks || []), blockers: structuredClone(input.blockers || []) }; if (body.activationAuthorized !== (body.status === "certified" && !body.blockers.length)) throw new TypeError("Adapter activation authorization does not match certification status"); return seal(input, body, "certificationSha256", "WR_OPERATING_ADAPTER_CERTIFICATION_INTEGRITY_FAILURE"); }

export function createConnectorHealthReport(input = {}) {
  const connector = createOperatingConnector(input.connector), slo = input.sloReport || {}, worker = createOperatingConnectorWorkerState(input.workerState), assessments = (input.schemaAssessments || []).filter((item) => item.connectorId === connector.connectorId), now = iso(input.evaluatedAt, "evaluatedAt"), nowMs = new Date(now).getTime();
  if (worker.organizationId !== connector.organizationId || slo.organizationId !== connector.organizationId) throw error("WR_TENANT_ISOLATION_VIOLATION", "Connector health inputs must share one tenant");
  const jobs = worker.jobs.filter((item) => item.connectorId === connector.connectorId), metrics = { dueBacklog: jobs.filter((item) => ["queued", "retry-scheduled", "continuation"].includes(item.status) && new Date(item.nextAttemptAt).getTime() <= nowMs).length, expiredLeases: jobs.filter((item) => item.status === "leased" && new Date(item.lease?.expiresAt || 0).getTime() <= nowMs).length, deadLetters: jobs.filter((item) => item.status === "dead-lettered").length, incompatibleSchemaAssessments: assessments.filter((item) => item.status === "incompatible").length, additiveSchemaAssessments: assessments.filter((item) => item.status === "compatible-with-drift").length, sloStatus: String(slo.status || "missing") };
  const findings = []; if (metrics.incompatibleSchemaAssessments) findings.push("schema-incompatible"); if (metrics.deadLetters) findings.push("dead-letters"); if (metrics.expiredLeases) findings.push("expired-leases"); if (metrics.sloStatus !== "passed") findings.push("slo-not-passed"); if (metrics.dueBacklog > Math.max(0, Number(input.maximumDueBacklog) || 10)) findings.push("backlog-exceeded");
  const body = { schemaVersion: CONNECTOR_HEALTH_REPORT_VERSION, organizationId: connector.organizationId, connectorId: connector.connectorId, connectorSha256: connector.connectorSha256, evaluatedAt: now, status: findings.includes("schema-incompatible") || findings.includes("slo-not-passed") ? "blocked" : findings.length ? "degraded" : "healthy", metrics, findings };
  return seal({}, body, "healthSha256", "WR_CONNECTOR_HEALTH_INTEGRITY_FAILURE");
}

function createHealthReport(input = {}) { const body = { schemaVersion: CONNECTOR_HEALTH_REPORT_VERSION, organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), connectorSha256: required(input.connectorSha256, "connectorSha256"), evaluatedAt: iso(input.evaluatedAt, "evaluatedAt"), status: ["healthy", "degraded", "blocked"].includes(input.status) ? input.status : "blocked", metrics: structuredClone(input.metrics || {}), findings: structuredClone(input.findings || []) }; return seal(input, body, "healthSha256", "WR_CONNECTOR_HEALTH_INTEGRITY_FAILURE"); }

export function createConnectorAssuranceState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId"), schemaBaselines = (input.schemaBaselines || []).map(createConnectorSchemaBaseline), credentialBindings = (input.credentialBindings || []).map(createConnectorCredentialBinding), credentialRotations = (input.credentialRotations || []).map(createConnectorCredentialRotation), drillPlans = (input.drillPlans || []).map(createConnectorDrillPlan), drillResults = (input.drillResults || []).map(createConnectorDrillResult), adapterCertifications = (input.adapterCertifications || []).map(createAdapterCertification), healthReports = (input.healthReports || []).map(createHealthReport), schemaAssessments = (input.schemaAssessments || []).map(createSchemaAssessment);
  for (const item of [...schemaBaselines, ...credentialBindings, ...credentialRotations, ...drillPlans, ...drillResults, ...adapterCertifications, ...healthReports, ...schemaAssessments]) if (item.organizationId !== organizationId) throw error("WR_TENANT_ISOLATION_VIOLATION", "Connector assurance records must share one tenant");
  for (const collection of [schemaBaselines, credentialBindings, credentialRotations, drillPlans, drillResults, adapterCertifications]) if (new Set(collection.map((item) => item.id)).size !== collection.length) throw new TypeError("Connector assurance IDs must be unique within each collection");
  for (const result of drillResults) { const plan = drillPlans.find((item) => item.id === result.planId); if (!plan || plan.planSha256 !== result.planSha256 || plan.connectorId !== result.connectorId) throw new TypeError(`Drill result references an unknown or changed plan: ${result.planId}`); }
  const active = credentialBindings.filter((item) => item.status === "active"); for (const binding of active) if (active.some((other) => other.connectorId === binding.connectorId && other.id !== binding.id)) throw error("WR_CONNECTOR_MULTIPLE_ACTIVE_CREDENTIALS", `Connector has multiple active credential bindings: ${binding.connectorId}`);
  const body = { schemaVersion: CONNECTOR_ASSURANCE_STATE_VERSION, organizationId, revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), schemaBaselines, credentialBindings, credentialRotations, drillPlans, drillResults, adapterCertifications, healthReports, schemaAssessments, updatedAt: iso(input.updatedAt, "updatedAt") };
  return seal(input, body, "stateSha256", "WR_CONNECTOR_ASSURANCE_STATE_INTEGRITY_FAILURE");
}

export function applyApprovedCredentialRotation(workerStateInput, assuranceStateInput, rotationId, context = {}) {
  const worker = createOperatingConnectorWorkerState(workerStateInput), assurance = createConnectorAssuranceState(assuranceStateInput), occurredAt = iso(context.occurredAt, "occurredAt");
  if (worker.organizationId !== assurance.organizationId || context.organizationId !== assurance.organizationId) throw error("WR_TENANT_ISOLATION_VIOLATION", "Credential rotation tenant mismatch");
  if (!(context.grants || []).includes("connector:credential-rotate")) throw error("WR_CONNECTOR_PERMISSION_DENIED", "connector:credential-rotate grant is required");
  if (Number(context.expectedWorkerRevision) !== worker.revision || Number(context.expectedAssuranceRevision) !== assurance.revision) throw error("WR_REVISION_CONFLICT", "Credential rotation state revision conflict");
  const rotation = assurance.credentialRotations.find((item) => item.id === rotationId), from = rotation && assurance.credentialBindings.find((item) => item.id === rotation.fromBindingId), to = rotation && assurance.credentialBindings.find((item) => item.id === rotation.toBindingId), connector = rotation && worker.connectors.find((item) => item.connectorId === rotation.connectorId);
  if (!rotation || rotation.status !== "approved" || !from || !to || !connector) throw new TypeError(`Unknown approved credential rotation: ${rotationId}`);
  if (from.connectorId !== rotation.connectorId || to.connectorId !== rotation.connectorId || from.bindingSha256 !== rotation.fromBindingSha256 || to.bindingSha256 !== rotation.toBindingSha256 || from.status !== "active" || to.status !== "staged" || connector.credentialRef !== from.secretRef) throw error("WR_CREDENTIAL_ROTATION_PRECONDITION_FAILED", "Credential rotation bindings or connector state changed");
  if (to.validFrom > occurredAt || to.expiresAt <= occurredAt) throw error("WR_CREDENTIAL_ROTATION_WINDOW_INVALID", "Replacement credential is not active at rotation time");
  const nextConnector = createOperatingConnector({ ...connector, connectorSha256: undefined, credentialRef: to.secretRef });
  const nextWorker = createOperatingConnectorWorkerState({ ...worker, stateSha256: undefined, revision: worker.revision + 1, connectors: worker.connectors.map((item) => item.connectorId === connector.connectorId ? nextConnector : item), updatedAt: occurredAt });
  const nextBindings = assurance.credentialBindings.map((item) => item.id === from.id ? createConnectorCredentialBinding({ ...item, bindingSha256: undefined, status: "retired" }) : item.id === to.id ? createConnectorCredentialBinding({ ...item, bindingSha256: undefined, status: "active" }) : item);
  const nextRotation = createConnectorCredentialRotation({ ...rotation, rotationSha256: undefined, status: "applied", appliedAt: occurredAt });
  const nextAssurance = createConnectorAssuranceState({ ...assurance, stateSha256: undefined, revision: assurance.revision + 1, credentialBindings: nextBindings, credentialRotations: assurance.credentialRotations.map((item) => item.id === rotation.id ? nextRotation : item), updatedAt: occurredAt });
  return Object.freeze({ workerState: nextWorker, assuranceState: nextAssurance, connectorSha256: nextConnector.connectorSha256, rotationSha256: nextRotation.rotationSha256 });
}

export function persistAppliedCredentialRotation(repository, context, result, options = {}) {
  if (!repository?.commitMany) throw new TypeError("repository.commitMany is required");
  const workerState = createOperatingConnectorWorkerState(result?.workerState), assuranceState = createConnectorAssuranceState(result?.assuranceState);
  if (workerState.organizationId !== context.organizationId || assuranceState.organizationId !== context.organizationId || workerState.organizationId !== assuranceState.organizationId) throw error("WR_TENANT_ISOLATION_VIOLATION", "Credential rotation persistence tenant mismatch");
  const rotation = assuranceState.credentialRotations.find((item) => item.rotationSha256 === result.rotationSha256 && item.status === "applied"), connector = rotation && workerState.connectors.find((item) => item.connectorId === rotation.connectorId);
  if (!rotation || !connector || connector.connectorSha256 !== result.connectorSha256) throw error("WR_CREDENTIAL_ROTATION_APPLICATION_INTEGRITY_FAILURE", "Credential rotation result does not match its worker and assurance states");
  return repository.commitMany({ context, mutations: [{ namespace: "operating-feed", key: "connector-worker-state", value: workerState, expectedRecordRevision: options.expectedWorkerRecordRevision }, { namespace: "operating-feed", key: "connector-assurance-state", value: assuranceState, expectedRecordRevision: options.expectedAssuranceRecordRevision }], expectedTenantRevision: options.expectedTenantRevision, idempotencyKey: required(options.idempotencyKey, "idempotencyKey"), occurredAt: iso(options.occurredAt, "occurredAt") }, options.validation || {});
}
