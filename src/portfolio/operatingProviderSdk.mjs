import { createHash } from "node:crypto";
import { createOperatingConnector } from "./operatingConnectorRuntime.mjs";
import { connectorAssuranceSha256 } from "./operatingConnectorAssurance.mjs";

export const OPERATING_VENDOR_PROFILE_VERSION = "wr-operating-vendor-profile-v1";
export const MANAGED_SECRET_RESOLUTION_VERSION = "wr-managed-secret-resolution-v1";
export const PROVIDER_EXECUTION_POLICY_VERSION = "wr-provider-execution-policy-v1";
export const PROVIDER_EXECUTION_STATE_VERSION = "wr-provider-execution-state-v1";
export const PROVIDER_EXECUTION_PERMIT_VERSION = "wr-provider-execution-permit-v1";
export const VENDOR_SANDBOX_CERTIFICATION_PACK_VERSION = "wr-vendor-sandbox-certification-pack-v1";

const VENDOR_PROFILE_INPUTS = Object.freeze([
  {
    id: "yardi-voyager-interface",
    providerId: "yardi",
    productName: "Yardi Voyager",
    enrollmentModel: "interface-partner",
    sandboxAvailability: "partner-program",
    activationPrerequisites: ["interface-program-approval", "data-exchange-agreement", "development-sandbox", "pilot-client-beta"],
    supportedDomainKinds: ["lease", "lease-amendment", "operating-statement", "asset-budget"],
    officialEvidenceUrls: ["https://www.yardi.com/company/become-an-interface-partner/", "https://www.yardi.com/me/company/find-an-interface-partner/"],
  },
  {
    id: "mri-property-management-x-partner",
    providerId: "mri",
    productName: "MRI Property Management X",
    enrollmentModel: "solution-partner",
    sandboxAvailability: "provider-confirmation-required",
    activationPrerequisites: ["partner-approval", "data-exchange-agreement", "sandbox-or-pilot-environment"],
    supportedDomainKinds: ["lease", "lease-amendment", "operating-statement", "asset-budget"],
    officialEvidenceUrls: ["https://www.mrisoftware.com/ca/partners/"],
  },
  {
    id: "appfolio-stack-integration",
    providerId: "appfolio",
    productName: "AppFolio Property Manager",
    enrollmentModel: "stack-marketplace-partner",
    sandboxAvailability: "provider-confirmation-required",
    activationPrerequisites: ["marketplace-enrollment", "provider-certification", "tenant-authorization", "sandbox-or-pilot-environment"],
    supportedDomainKinds: ["lease", "operating-statement", "asset-budget"],
    officialEvidenceUrls: ["https://www.appfolio.com/services/stack"],
  },
]);

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function operatingProviderSha256(value) { return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex"); }
function error(code, message) { const value = new Error(message); value.code = code; return value; }
function seal(input, body, field, code) { const digest = operatingProviderSha256(body); if (input?.[field] && input[field] !== digest) throw error(code, `${field} verification failed`); return Object.freeze({ ...body, [field]: digest }); }
function secretRef(value, name = "secretRef") { const normalized = required(value, name); if (!normalized.startsWith("secret-ref:")) throw new TypeError(`${name} must be an opaque secret-ref`); return normalized; }
function evidenceRefs(values, name, allowEmpty = false) { const refs = [...new Set((values || []).map(String).filter(Boolean))].sort(); if ((!allowEmpty && !refs.length) || refs.some((item) => !item.startsWith("evidence-ref:"))) throw new TypeError(`${name} requires opaque evidence-ref values`); return refs; }

export function createOperatingVendorProfile(input = {}) {
  const prerequisites = [...new Set((input.activationPrerequisites || []).map((item) => required(item, "activationPrerequisite")))].sort(), supportedDomainKinds = [...new Set((input.supportedDomainKinds || []).map(String).filter(Boolean))].sort(), officialEvidenceUrls = [...new Set((input.officialEvidenceUrls || []).map((item) => { const url = new URL(item); if (url.protocol !== "https:") throw new TypeError("Official vendor evidence URLs must use HTTPS"); return url.toString(); }))].sort();
  if (!prerequisites.length || !supportedDomainKinds.length || !officialEvidenceUrls.length) throw new TypeError("Vendor profiles require prerequisites, supported domain kinds, and official evidence");
  const body = { schemaVersion: OPERATING_VENDOR_PROFILE_VERSION, id: required(input.id, "id"), providerId: required(input.providerId, "providerId"), productName: required(input.productName, "productName"), enrollmentModel: required(input.enrollmentModel, "enrollmentModel"), sandboxAvailability: ["partner-program", "provider-confirmation-required"].includes(input.sandboxAvailability) ? input.sandboxAvailability : "provider-confirmation-required", endpointProvisioning: "tenant-specific-provider-assigned", activationPrerequisites: prerequisites, supportedDomainKinds, officialEvidenceUrls };
  return seal(input, body, "profileSha256", "WR_OPERATING_VENDOR_PROFILE_INTEGRITY_FAILURE");
}

export const OPERATING_VENDOR_SANDBOX_PROFILES = Object.freeze(VENDOR_PROFILE_INPUTS.map(createOperatingVendorProfile));

export function createManagedSecretResolver({ backend, auditSink, clock = () => new Date().toISOString() } = {}) {
  if (!backend?.resolve || typeof auditSink?.record !== "function") throw new TypeError("Managed secret backend.resolve and auditSink.record are required");
  return Object.freeze({
    schemaVersion: MANAGED_SECRET_RESOLUTION_VERSION,
    async resolve(reference, context = {}) {
      const ref = secretRef(reference), organizationId = required(context.organizationId, "context.organizationId"), connectorId = required(context.connectorId, "context.connectorId"), purpose = required(context.purpose, "context.purpose"), resolvedAt = iso(clock(), "clock");
      if (purpose !== "operating-connector-fetch") throw error("WR_SECRET_PURPOSE_DENIED", "Managed credential may only be resolved for operating connector fetches");
      const record = await backend.resolve(ref, Object.freeze({ organizationId, connectorId, purpose }));
      if (!record || record.organizationId !== organizationId || record.connectorId !== connectorId || secretRef(record.reference) !== ref) throw error("WR_SECRET_SCOPE_DENIED", "Managed credential scope does not match the connector tenant");
      const validFrom = iso(record.validFrom, "secret.validFrom"), expiresAt = iso(record.expiresAt, "secret.expiresAt");
      if (validFrom > resolvedAt || expiresAt <= resolvedAt || record.revoked === true) throw error("WR_SECRET_NOT_ACTIVE", "Managed credential is not active");
      const credential = record.value;
      if (!credential || typeof credential !== "object") throw new TypeError("Managed credential backend returned no credential value");
      const receiptBody = { schemaVersion: MANAGED_SECRET_RESOLUTION_VERSION, organizationId, connectorId, purpose, secretRef: ref, secretVersion: required(record.version, "secret.version"), resolvedAt, expiresAt };
      const receipt = seal({}, receiptBody, "resolutionSha256", "WR_MANAGED_SECRET_RESOLUTION_INTEGRITY_FAILURE");
      auditSink.record(receipt);
      return Object.freeze({ credential: structuredClone(credential), receipt });
    },
  });
}

function normalizeProviderResponse(response, request) {
  const status = Number(response?.status || 200);
  if (status < 200 || status >= 300) { const failure = error(status === 401 || status === 403 ? "WR_PROVIDER_AUTHENTICATION_FAILED" : status === 429 ? "WR_PROVIDER_RATE_LIMITED" : status >= 500 ? "WR_PROVIDER_UNAVAILABLE" : "WR_PROVIDER_REQUEST_REJECTED", `Operating provider returned HTTP ${status || "unknown"}`); failure.retryable = status === 408 || status === 425 || status === 429 || status >= 500 || status === 0; failure.retryAfterSeconds = Math.max(0, Number(response?.retryAfterSeconds) || 0); throw failure; }
  const body = response?.body || response;
  return { responseId: required(body.responseId, "provider responseId"), fetchedAt: iso(body.fetchedAt, "provider fetchedAt"), nextCursor: String(body.nextCursor || ""), hasMore: body.hasMore === true, records: structuredClone(body.records || []), providerRequestId: String(response?.requestId || body.providerRequestId || ""), requestLimit: request.limit };
}

export function createOperatingProviderAdapter({ profile: profileInput, secretResolver, transport, recordNormalizer, allowedHosts = [], clock = () => new Date().toISOString() } = {}) {
  const profile = createOperatingVendorProfile(profileInput);
  if (!secretResolver?.resolve || !transport?.fetchPage) throw new TypeError("secretResolver.resolve and transport.fetchPage are required");
  const hostAllowlist = [...new Set(allowedHosts.map((item) => required(item, "allowedHost").toLowerCase()))].sort();
  if (!hostAllowlist.length) throw new TypeError("Operating provider adapters require an explicit host allowlist");
  return Object.freeze({
    profile,
    async fetchPage(request) {
      if (request.providerId !== profile.providerId) throw error("WR_PROVIDER_PROFILE_MISMATCH", "Connector provider does not match adapter profile");
      const endpoint = new URL(required(request.baseUrl, "request.baseUrl"));
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || !hostAllowlist.includes(endpoint.hostname.toLowerCase()) || endpoint.hostname.includes(":")) throw error("WR_PROVIDER_ENDPOINT_REJECTED", "Provider endpoint must be HTTPS and match the adapter host allowlist");
      const resolved = await secretResolver.resolve(secretRef(request.credentialRef), { organizationId: required(request.organizationId, "request.organizationId"), connectorId: required(request.connectorId, "request.connectorId"), purpose: "operating-connector-fetch" });
      const response = await transport.fetchPage({ baseUrl: endpoint.origin + endpoint.pathname.replace(/\/$/, ""), credential: resolved.credential, cursor: String(request.cursor || ""), limit: Math.max(1, Math.trunc(Number(request.limit) || 1)), mode: request.mode === "backfill" ? "backfill" : "incremental", windowStart: String(request.windowStart || ""), windowEnd: String(request.windowEnd || ""), idempotencyKey: required(request.idempotencyKey, "request.idempotencyKey"), requestedAt: iso(clock(), "clock") });
      const normalized = normalizeProviderResponse(response, request), records = recordNormalizer?.normalize ? normalized.records.map((record) => ({ ...record, fields: recordNormalizer.normalize(record.fields || {}, { asOf: String(record.effectiveAt || normalized.fetchedAt).slice(0, 10) }) })) : normalized.records;
      return Object.freeze({ ...normalized, records, secretResolutionSha256: resolved.receipt.resolutionSha256 });
    },
  });
}

export function createProviderExecutionPolicy(input = {}) {
  const body = { schemaVersion: PROVIDER_EXECUTION_POLICY_VERSION, connectorId: required(input.connectorId, "connectorId"), capacity: Math.max(1, Math.min(10000, Math.trunc(Number(input.capacity) || 60))), refillTokensPerSecond: Math.max(0.001, Math.min(10000, Number(input.refillTokensPerSecond) || 1)), maximumConcurrency: Math.max(1, Math.min(100, Math.trunc(Number(input.maximumConcurrency) || 4))), failureThreshold: Math.max(1, Math.min(100, Math.trunc(Number(input.failureThreshold) || 5))), resetAfterSeconds: Math.max(1, Math.min(86400, Math.trunc(Number(input.resetAfterSeconds) || 60))), permitSeconds: Math.max(1, Math.min(3600, Math.trunc(Number(input.permitSeconds) || 60))) };
  return Object.freeze(body);
}

function createPermit(input = {}) { const body = { schemaVersion: PROVIDER_EXECUTION_PERMIT_VERSION, id: required(input.id, "id"), connectorId: required(input.connectorId, "connectorId"), jobId: required(input.jobId, "jobId"), workerId: required(input.workerId, "workerId"), cursor: String(input.cursor || ""), issuedAt: iso(input.issuedAt, "issuedAt"), expiresAt: iso(input.expiresAt, "expiresAt"), probe: input.probe === true }; return seal(input, body, "permitSha256", "WR_PROVIDER_EXECUTION_PERMIT_INTEGRITY_FAILURE"); }

export function createProviderExecutionState(input = {}) {
  const policy = createProviderExecutionPolicy(input.policy || input), updatedAt = iso(input.updatedAt, "updatedAt"), permits = (input.activePermits || []).map(createPermit), body = { schemaVersion: PROVIDER_EXECUTION_STATE_VERSION, organizationId: required(input.organizationId, "organizationId"), connectorId: policy.connectorId, revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), policy, tokens: Math.max(0, Math.min(policy.capacity, Number(input.tokens ?? policy.capacity))), lastRefillAt: iso(input.lastRefillAt || updatedAt, "lastRefillAt"), circuitStatus: ["closed", "open", "half-open"].includes(input.circuitStatus) ? input.circuitStatus : "closed", consecutiveFailures: Math.max(0, Math.trunc(Number(input.consecutiveFailures) || 0)), openedAt: input.openedAt ? iso(input.openedAt, "openedAt") : "", retryAfterUntil: input.retryAfterUntil ? iso(input.retryAfterUntil, "retryAfterUntil") : "", activePermits: permits, updatedAt };
  if (body.circuitStatus === "open" && !body.openedAt) throw new TypeError("Open provider circuits require openedAt");
  if (new Set(permits.map((item) => item.id)).size !== permits.length) throw new TypeError("Provider permit IDs must be unique");
  return seal(input, body, "stateSha256", "WR_PROVIDER_EXECUTION_STATE_INTEGRITY_FAILURE");
}

function refill(state, now) { const seconds = Math.max(0, (new Date(now) - new Date(state.lastRefillAt)) / 1000); return Math.min(state.policy.capacity, state.tokens + seconds * state.policy.refillTokensPerSecond); }
export function beginProviderExecution(stateInput, input = {}) {
  const state = createProviderExecutionState(stateInput), now = iso(input.now, "now"), nowMs = new Date(now).getTime(), policy = state.policy, activePermits = state.activePermits.filter((item) => new Date(item.expiresAt).getTime() > nowMs), recoveredPermitIds = state.activePermits.filter((item) => new Date(item.expiresAt).getTime() <= nowMs).map((item) => item.id), tokens = refill(state, now), resetAt = state.retryAfterUntil || (state.openedAt ? new Date(new Date(state.openedAt).getTime() + policy.resetAfterSeconds * 1000).toISOString() : ""), canProbe = state.circuitStatus === "open" && resetAt && resetAt <= now, circuitStatus = canProbe ? "half-open" : state.circuitStatus;
  let denialCode = ""; if (circuitStatus === "open") denialCode = "WR_PROVIDER_CIRCUIT_OPEN"; else if (circuitStatus === "half-open" && activePermits.some((item) => item.probe)) denialCode = "WR_PROVIDER_CIRCUIT_PROBE_BUSY"; else if (activePermits.length >= policy.maximumConcurrency) denialCode = "WR_PROVIDER_CONCURRENCY_LIMITED"; else if (tokens < 1) denialCode = "WR_PROVIDER_RATE_LIMITED";
  if (denialCode) { const permitRetryAt = activePermits.map((item) => item.expiresAt).sort()[0], retryAt = circuitStatus === "open" ? resetAt : denialCode === "WR_PROVIDER_CONCURRENCY_LIMITED" || denialCode === "WR_PROVIDER_CIRCUIT_PROBE_BUSY" ? permitRetryAt : new Date(nowMs + Math.ceil((1 - tokens) / policy.refillTokensPerSecond * 1000)).toISOString(); return { allowed: false, code: denialCode, retryAt, state, recoveredPermitIds }; }
  const probe = circuitStatus === "half-open", permit = createPermit({ id: `provider_permit_${operatingProviderSha256(`${state.connectorId}|${input.jobId}|${input.workerId}|${input.cursor || ""}|${now}|${state.revision}`).slice(0, 24)}`, connectorId: state.connectorId, jobId: required(input.jobId, "jobId"), workerId: required(input.workerId, "workerId"), cursor: input.cursor, issuedAt: now, expiresAt: new Date(nowMs + policy.permitSeconds * 1000).toISOString(), probe });
  const nextState = createProviderExecutionState({ ...state, stateSha256: undefined, revision: state.revision + 1, tokens: tokens - 1, lastRefillAt: now, circuitStatus, activePermits: [...activePermits, permit], updatedAt: now });
  return { allowed: true, permit, state: nextState, recoveredPermitIds };
}

export function completeProviderExecution(stateInput, permitInput, outcome = {}, options = {}) {
  const state = createProviderExecutionState(stateInput), permit = createPermit(permitInput), completedAt = iso(options.completedAt, "completedAt"), active = state.activePermits.find((item) => item.id === permit.id);
  if (!active || active.permitSha256 !== permit.permitSha256) throw error("WR_PROVIDER_EXECUTION_PERMIT_CONFLICT", "Provider execution permit is missing or changed");
  const success = outcome.success === true, failures = success ? 0 : state.consecutiveFailures + 1, forcedOpen = outcome.errorCode === "WR_PROVIDER_RATE_LIMITED" && Number(outcome.retryAfterSeconds) > 0, open = !success && (forcedOpen || failures >= state.policy.failureThreshold), retryAfterUntil = forcedOpen ? new Date(new Date(completedAt).getTime() + Number(outcome.retryAfterSeconds) * 1000).toISOString() : open ? new Date(new Date(completedAt).getTime() + state.policy.resetAfterSeconds * 1000).toISOString() : "";
  return createProviderExecutionState({ ...state, stateSha256: undefined, revision: state.revision + 1, circuitStatus: success ? "closed" : open ? "open" : "closed", consecutiveFailures: failures, openedAt: open ? completedAt : "", retryAfterUntil, activePermits: state.activePermits.filter((item) => item.id !== permit.id), updatedAt: completedAt });
}

export function createDurableProviderExecutionController({ repository, context, policyByConnector, clock = () => new Date().toISOString() } = {}) {
  if (!repository?.readRecord || !repository?.commit) throw new TypeError("A durable repository is required");
  const policyFor = (connectorId) => createProviderExecutionPolicy(policyByConnector instanceof Map ? policyByConnector.get(connectorId) : policyByConnector?.[connectorId] || { connectorId });
  return Object.freeze({
    beforeCall(input = {}) {
      const connectorId = required(input.connector?.connectorId, "connector.connectorId"), now = iso(input.occurredAt || clock(), "occurredAt"), key = `provider-execution:${encodeURIComponent(connectorId)}`, stored = repository.readRecord(context, "operating-feed", key, { now }), state = stored?.value ? createProviderExecutionState(stored.value) : createProviderExecutionState({ organizationId: context.organizationId, policy: policyFor(connectorId), updatedAt: now }), begun = beginProviderExecution(state, { now, jobId: input.job.id, workerId: input.workerId, cursor: input.request.cursor });
      if (!begun.allowed) return begun;
      const receipt = repository.commit({ context, namespace: "operating-feed", key, value: begun.state, expectedTenantRevision: input.expectedTenantRevision, expectedRecordRevision: Number(stored?.revision || 0), idempotencyKey: `provider-execution-begin:${begun.permit.id}`, occurredAt: now }, { now });
      return { ...begun, receipt };
    },
    afterCall(input = {}) {
      const connectorId = required(input.connector?.connectorId, "connector.connectorId"), completedAt = iso(input.completedAt || clock(), "completedAt"), key = `provider-execution:${encodeURIComponent(connectorId)}`, stored = repository.readRecord(context, "operating-feed", key, { now: completedAt });
      if (!stored?.value) throw error("WR_PROVIDER_EXECUTION_STATE_MISSING", "Provider execution state is missing at completion");
      const state = completeProviderExecution(stored.value, input.permit, input.outcome, { completedAt });
      const receipt = repository.commit({ context, namespace: "operating-feed", key, value: state, expectedTenantRevision: input.expectedTenantRevision, expectedRecordRevision: stored.revision, idempotencyKey: `provider-execution-complete:${input.permit.id}:${state.revision}`, occurredAt: completedAt }, { now: completedAt });
      return { state, receipt };
    },
  });
}

export function persistConnectorSchemaAssessment(repository, context, assessment, options = {}) {
  if (!repository?.commit) throw new TypeError("repository.commit is required");
  if (assessment?.schemaVersion !== "wr-connector-schema-assessment-v1" || assessment.organizationId !== context.organizationId) throw error("WR_TENANT_ISOLATION_VIOLATION", "Schema assessment does not match the authenticated tenant");
  const { assessmentSha256, ...body } = assessment; if (connectorAssuranceSha256(body) !== assessmentSha256) throw error("WR_CONNECTOR_SCHEMA_ASSESSMENT_INTEGRITY_FAILURE", "Schema assessment digest verification failed");
  const key = `schema-assessment:${encodeURIComponent(assessment.connectorId)}:${assessment.assessedAt}:${assessment.assessmentSha256}`;
  return repository.commit({ context, namespace: "operating-feed", key, value: assessment, expectedTenantRevision: options.expectedTenantRevision, expectedRecordRevision: 0, idempotencyKey: options.idempotencyKey || `schema-assessment:${assessment.assessmentSha256}`, occurredAt: options.occurredAt || assessment.assessedAt }, options.validation || {});
}

export function createDurableSchemaAssessmentJournal({ repository, context } = {}) {
  if (!repository?.commit) throw new TypeError("repository.commit is required");
  return Object.freeze({ record(assessment, options = {}) { return persistConnectorSchemaAssessment(repository, context, assessment, { ...options, validation: { now: options.occurredAt || assessment.assessedAt } }); } });
}

function assertAdapterCertification(input) { if (input?.schemaVersion !== "wr-operating-adapter-certification-v1") throw new TypeError("A wr-operating-adapter-certification-v1 decision is required"); const { certificationSha256, ...body } = input; if (connectorAssuranceSha256(body) !== certificationSha256) throw error("WR_OPERATING_ADAPTER_CERTIFICATION_INTEGRITY_FAILURE", "Adapter certification digest verification failed"); return input; }
export function buildVendorSandboxCertificationPack(input = {}) {
  const profile = createOperatingVendorProfile(input.profile), connector = createOperatingConnector(input.connector), adapterCertification = assertAdapterCertification(input.adapterCertification), evaluatedAt = iso(input.evaluatedAt, "evaluatedAt"), evidence = input.sandboxEvidence || {};
  const checks = [
    { id: "provider-profile", passed: connector.providerId === profile.providerId },
    { id: "adapter-certification", passed: adapterCertification.status === "certified" && adapterCertification.activationAuthorized === true && adapterCertification.connectorSha256 === connector.connectorSha256 },
    { id: "program-enrollment", passed: evidence.programEnrollmentApproved === true },
    { id: "data-exchange-agreement", passed: evidence.dataExchangeAgreementExecuted === true },
    { id: "sandbox-access", passed: evidence.sandboxAccessConfirmed === true },
    { id: "tenant-authorization", passed: evidence.tenantAuthorizationConfirmed === true },
    { id: "cursor-semantics", passed: evidence.cursorSemanticsVerified === true },
    { id: "rate-limit-semantics", passed: evidence.rateLimitSemanticsVerified === true },
    { id: "correction-and-deletion-semantics", passed: evidence.correctionAndDeletionSemanticsVerified === true },
    { id: "sandbox-fixtures", passed: Number(evidence.fixtureCount) >= 20 && Number(evidence.failedFixtureCount) === 0 },
  ];
  const evidenceReferences = evidenceRefs(evidence.evidenceRefs, "vendor sandbox certification", true), blockers = checks.filter((item) => !item.passed).map((item) => item.id); if (!evidenceReferences.length) blockers.push("evidence-references");
  const status = blockers.length ? "blocked" : "certified", body = { schemaVersion: VENDOR_SANDBOX_CERTIFICATION_PACK_VERSION, id: String(input.id || `vendor_pack_${operatingProviderSha256(`${profile.profileSha256}|${connector.connectorSha256}|${evaluatedAt}`).slice(0, 24)}`), organizationId: connector.organizationId, connectorId: connector.connectorId, providerId: connector.providerId, vendorProfileId: profile.id, vendorProfileSha256: profile.profileSha256, connectorSha256: connector.connectorSha256, adapterCertificationSha256: adapterCertification.certificationSha256, evaluatedAt, status, activationAuthorized: status === "certified", checks, blockers, evidenceRefs: evidenceReferences, officialEvidenceUrls: profile.officialEvidenceUrls };
  return seal({}, body, "packSha256", "WR_VENDOR_SANDBOX_CERTIFICATION_PACK_INTEGRITY_FAILURE");
}

export function validateVendorSandboxCertificationPack(input = {}) {
  if (input.schemaVersion !== VENDOR_SANDBOX_CERTIFICATION_PACK_VERSION) throw new TypeError("A wr-vendor-sandbox-certification-pack-v1 pack is required");
  const body = { schemaVersion: VENDOR_SANDBOX_CERTIFICATION_PACK_VERSION, id: required(input.id, "id"), organizationId: required(input.organizationId, "organizationId"), connectorId: required(input.connectorId, "connectorId"), providerId: required(input.providerId, "providerId"), vendorProfileId: required(input.vendorProfileId, "vendorProfileId"), vendorProfileSha256: required(input.vendorProfileSha256, "vendorProfileSha256"), connectorSha256: required(input.connectorSha256, "connectorSha256"), adapterCertificationSha256: required(input.adapterCertificationSha256, "adapterCertificationSha256"), evaluatedAt: iso(input.evaluatedAt, "evaluatedAt"), status: input.status === "certified" ? "certified" : "blocked", activationAuthorized: input.activationAuthorized === true, checks: structuredClone(input.checks || []), blockers: structuredClone(input.blockers || []), evidenceRefs: evidenceRefs(input.evidenceRefs, "vendor sandbox certification", input.status !== "certified"), officialEvidenceUrls: (input.officialEvidenceUrls || []).map((item) => { const url = new URL(item); if (url.protocol !== "https:") throw new TypeError("Official vendor evidence URLs must use HTTPS"); return url.toString(); }).sort() };
  const sealed = seal(input, body, "packSha256", "WR_VENDOR_SANDBOX_CERTIFICATION_PACK_INTEGRITY_FAILURE");
  if (sealed.activationAuthorized !== (sealed.status === "certified" && !sealed.blockers.length)) throw new TypeError("Vendor sandbox activation authorization does not match pack status");
  return sealed;
}
