import { assertOpportunityBriefAccess, prepareOpportunityBriefExport, sealOpportunityBriefExportArtifact } from "./opportunityBriefExport.mjs";

export const OPPORTUNITY_BRIEF_EXPORT_JOB_VERSION = "wr-opportunity-brief-export-job-v1";
export const OPPORTUNITY_BRIEF_EXPORT_WORKER_STATE_VERSION = "wr-opportunity-brief-export-worker-state-v1";
export const OPPORTUNITY_BRIEF_EXPORT_WORKER_CYCLE_VERSION = "wr-opportunity-brief-export-worker-cycle-v1";
export const OPPORTUNITY_BRIEF_EXPORT_DEAD_LETTER_VERSION = "wr-opportunity-brief-export-dead-letter-v1";
export const OPPORTUNITY_BRIEF_EXPORT_RUN_VERSION = "wr-opportunity-brief-export-run-v1";

export const BRIEF_EXPORT_JOB_STATUSES = Object.freeze(["queued", "leased", "retry-scheduled", "artifact-ready", "dead-lettered"]);

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

function stableId(prefix, seed) {
  let hash = 2166136261;
  for (const character of String(seed)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function opaqueRef(value, name, prefix) {
  const ref = required(value, name);
  if (!ref.startsWith(prefix)) throw new TypeError(`${name} must be an opaque ${prefix} reference`);
  return ref;
}

function normalizeLease(value) {
  if (!value) return null;
  return Object.freeze({ token: required(value.token, "lease.token"), workerId: required(value.workerId, "lease.workerId"), leasedAt: iso(value.leasedAt, "lease.leasedAt"), expiresAt: iso(value.expiresAt, "lease.expiresAt") });
}

export function createOpportunityBriefExportJob(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const requestId = required(input.requestId, "requestId");
  const createdAt = iso(input.createdAt, "createdAt");
  return {
    schemaVersion: OPPORTUNITY_BRIEF_EXPORT_JOB_VERSION,
    id: String(input.id || stableId("brief_export_job", `${organizationId}|${requestId}`)),
    organizationId,
    requestId,
    policyRef: opaqueRef(input.policyRef, "policyRef", "policy-ref:"),
    requestRef: opaqueRef(input.requestRef, "requestRef", "request-ref:"),
    accessGrantRef: opaqueRef(input.accessGrantRef, "accessGrantRef", "grant-ref:"),
    briefRef: opaqueRef(input.briefRef, "briefRef", "brief-ref:"),
    status: BRIEF_EXPORT_JOB_STATUSES.includes(input.status) ? input.status : "queued",
    attemptNumber: Math.max(0, Math.trunc(Number(input.attemptNumber) || 0)),
    maxAttempts: Math.max(1, Math.trunc(Number(input.maxAttempts) || 5)),
    nextAttemptAt: iso(input.nextAttemptAt || createdAt, "nextAttemptAt"),
    lease: normalizeLease(input.lease),
    artifact: input.artifact || null,
    lastErrorCode: String(input.lastErrorCode || ""),
    lastErrorMessage: String(input.lastErrorMessage || ""),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt, "updatedAt"),
    completedAt: input.completedAt ? iso(input.completedAt, "completedAt") : "",
  };
}

export function createOpportunityBriefExportWorkerState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const jobs = (input.jobs || []).map((job) => {
    if (job.organizationId !== organizationId) {
      const error = new Error("All brief export jobs must belong to the worker-state organization");
      error.code = "WR_TENANT_ISOLATION_VIOLATION";
      throw error;
    }
    return createOpportunityBriefExportJob(job);
  });
  return {
    schemaVersion: OPPORTUNITY_BRIEF_EXPORT_WORKER_STATE_VERSION,
    organizationId,
    revision: Math.max(1, Math.trunc(Number(input.revision) || 1)),
    jobs,
    deadLetters: (input.deadLetters || []).map((item) => ({ ...item, schemaVersion: OPPORTUNITY_BRIEF_EXPORT_DEAD_LETTER_VERSION })),
    updatedAt: iso(input.updatedAt, "updatedAt"),
  };
}

export function enqueueOpportunityBriefExport(stateInput, jobInput) {
  const state = createOpportunityBriefExportWorkerState(stateInput);
  const job = createOpportunityBriefExportJob({ ...jobInput, organizationId: state.organizationId });
  const existing = state.jobs.find((item) => item.requestId === job.requestId || item.id === job.id);
  if (existing) {
    const same = existing.policyRef === job.policyRef && existing.requestRef === job.requestRef && existing.accessGrantRef === job.accessGrantRef && existing.briefRef === job.briefRef;
    if (!same) {
      const error = new Error("Export request idempotency conflict");
      error.code = "WR_BRIEF_EXPORT_IDEMPOTENCY_CONFLICT";
      throw error;
    }
    return state;
  }
  return { ...state, revision: state.revision + 1, jobs: [...state.jobs, job], updatedAt: job.createdAt };
}

export function leaseOpportunityBriefExportJobs(stateInput, options = {}) {
  const state = createOpportunityBriefExportWorkerState(stateInput);
  const now = iso(options.now, "now");
  const nowMs = new Date(now).getTime();
  const workerId = required(options.workerId, "workerId");
  const leaseSeconds = Math.max(1, Number(options.leaseSeconds) || 60);
  const limit = Math.max(1, Math.trunc(Number(options.limit) || 10));
  const jobs = state.jobs.map((job) => ({ ...job }));
  const candidates = jobs.filter((job) => !["artifact-ready", "dead-lettered"].includes(job.status) && !(job.status === "leased" && new Date(job.lease?.expiresAt || 0).getTime() > nowMs) && new Date(job.nextAttemptAt).getTime() <= nowMs)
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.id.localeCompare(b.id));
  const leasedJobs = [];
  const recoveredLeaseJobIds = [];
  for (const job of candidates.slice(0, limit)) {
    if (job.status === "leased") recoveredLeaseJobIds.push(job.id);
    job.status = "leased";
    job.attemptNumber += 1;
    job.lease = Object.freeze({ token: stableId("brief_export_lease", `${job.id}|${workerId}|${now}|${state.revision}`), workerId, leasedAt: now, expiresAt: new Date(nowMs + leaseSeconds * 1000).toISOString() });
    job.updatedAt = now;
    leasedJobs.push(createOpportunityBriefExportJob(job));
  }
  return Object.freeze({
    schemaVersion: OPPORTUNITY_BRIEF_EXPORT_WORKER_CYCLE_VERSION,
    state: leasedJobs.length ? { ...state, revision: state.revision + 1, jobs, updatedAt: now } : state,
    workerId,
    evaluatedAt: now,
    leasedJobs,
    recoveredLeaseJobIds,
  });
}

function normalizeExecutionError(error) {
  return { success: false, retryable: !["WR_BRIEF_ACCESS_REVOKED", "WR_BRIEF_ACCESS_EXPIRED", "WR_BRIEF_RECIPIENT_DENIED", "WR_TENANT_ISOLATION_VIOLATION", "WR_BRIEF_SOURCE_INTEGRITY_FAILURE", "WR_BRIEF_RENDER_INTEGRITY_FAILURE"].includes(error?.code), errorCode: String(error?.code || "brief-export-exception"), errorMessage: String(error?.message || error) };
}

export async function executeOpportunityBriefExport(jobInput, adapters = {}, options = {}) {
  const job = createOpportunityBriefExportJob(jobInput);
  if (job.status !== "leased" || !job.lease) throw new TypeError("Only a leased brief export job can execute");
  const now = iso(options.now, "now");
  if (!adapters.resolver?.resolve) throw new TypeError("resolver.resolve is required");
  if (!adapters.renderer?.render) throw new TypeError("renderer.render is required");
  if (!adapters.storage?.put) throw new TypeError("storage.put is required");
  try {
    const resolved = await adapters.resolver.resolve(Object.freeze({ organizationId: job.organizationId, policyRef: job.policyRef, requestRef: job.requestRef, accessGrantRef: job.accessGrantRef, briefRef: job.briefRef }));
    if ([resolved?.policy, resolved?.request, resolved?.accessGrant].some((item) => item?.organizationId !== job.organizationId)) {
      const error = new Error("Resolved export evidence crossed tenant boundaries");
      error.code = "WR_TENANT_ISOLATION_VIOLATION";
      throw error;
    }
    const prepared = prepareOpportunityBriefExport({ ...resolved, preparedAt: now });
    const rendered = await adapters.renderer.render(Object.freeze({
      organizationId: job.organizationId,
      requestId: job.requestId,
      format: prepared.request.format,
      redactedPayload: prepared.redactedPayload,
      sourcePayloadSha256: prepared.redactedPayloadSha256,
      watermark: prepared.watermark,
      watermarkSha256: prepared.watermarkSha256,
      lineage: prepared.lineage,
    }));
    const latestGrant = adapters.resolver.resolveAccessGrant ? await adapters.resolver.resolveAccessGrant(job.accessGrantRef, job.organizationId) : resolved.accessGrant;
    assertOpportunityBriefAccess(latestGrant, { organizationId: job.organizationId, requestId: job.requestId, now });
    if (latestGrant.id !== prepared.grant.id || latestGrant.revokedAt !== prepared.grant.revokedAt) {
      const reprepared = prepareOpportunityBriefExport({ ...resolved, accessGrant: latestGrant, preparedAt: now });
      if (reprepared.redactedPayloadSha256 !== prepared.redactedPayloadSha256) throw Object.assign(new Error("Access changed during rendering"), { code: "WR_BRIEF_ACCESS_CHANGED" });
    }
    const storageResult = await adapters.storage.put(Object.freeze({
      organizationId: job.organizationId,
      idempotencyKey: `brief-export:${job.organizationId}:${job.requestId}`,
      content: rendered?.content,
      contentType: String(rendered?.contentType || "application/octet-stream"),
    }));
    const artifactRef = opaqueRef(storageResult?.artifactRef, "storage.artifactRef", "artifact-ref:");
    const artifact = sealOpportunityBriefExportArtifact({ ...resolved, accessGrant: latestGrant, prepared, rendered, artifactRef, createdAt: now });
    return Object.freeze({ success: true, retryable: false, artifact });
  } catch (error) {
    return Object.freeze(normalizeExecutionError(error));
  }
}

export function completeOpportunityBriefExportJob(stateInput, input = {}, options = {}) {
  const state = createOpportunityBriefExportWorkerState(stateInput);
  const completedAt = iso(options.completedAt, "completedAt");
  const index = state.jobs.findIndex((job) => job.id === input.jobId);
  if (index < 0) throw new TypeError(`Unknown brief export job: ${input.jobId}`);
  const current = state.jobs[index];
  if (current.status !== "leased" || !current.lease) throw new TypeError("Brief export job is not leased");
  if (current.lease.workerId !== options.workerId || current.lease.token !== options.leaseToken) throw Object.assign(new Error("Brief export lease ownership conflict"), { code: "WR_BRIEF_EXPORT_LEASE_CONFLICT" });
  if (new Date(current.lease.expiresAt) < new Date(completedAt)) throw Object.assign(new Error("Brief export lease expired before completion"), { code: "WR_BRIEF_EXPORT_LEASE_EXPIRED" });
  const result = input.result || {};
  const jobs = [...state.jobs];
  const deadLetters = [...state.deadLetters];
  let next;
  if (result.success === true) {
    next = { ...current, status: "artifact-ready", lease: null, artifact: result.artifact, lastErrorCode: "", lastErrorMessage: "", completedAt, updatedAt: completedAt };
  } else if (result.retryable !== false && current.attemptNumber < current.maxAttempts) {
    const baseDelaySeconds = Math.max(1, Number(options.baseDelaySeconds) || 30);
    const maxDelaySeconds = Math.max(baseDelaySeconds, Number(options.maxDelaySeconds) || 3600);
    const delaySeconds = Math.min(maxDelaySeconds, baseDelaySeconds * 2 ** Math.max(0, current.attemptNumber - 1));
    next = { ...current, status: "retry-scheduled", lease: null, nextAttemptAt: new Date(new Date(completedAt).getTime() + delaySeconds * 1000).toISOString(), lastErrorCode: String(result.errorCode || "brief-export-failure"), lastErrorMessage: String(result.errorMessage || ""), updatedAt: completedAt };
  } else {
    next = { ...current, status: "dead-lettered", lease: null, lastErrorCode: String(result.errorCode || "brief-export-failure"), lastErrorMessage: String(result.errorMessage || ""), updatedAt: completedAt };
    deadLetters.push(Object.freeze({ schemaVersion: OPPORTUNITY_BRIEF_EXPORT_DEAD_LETTER_VERSION, id: stableId("brief_export_dead_letter", `${current.id}|${current.attemptNumber}|${completedAt}`), organizationId: current.organizationId, jobId: current.id, requestId: current.requestId, attemptNumber: current.attemptNumber, errorCode: next.lastErrorCode, errorMessage: next.lastErrorMessage, deadLetteredAt: completedAt }));
  }
  jobs[index] = next;
  return { ...state, revision: state.revision + 1, jobs, deadLetters, updatedAt: completedAt };
}

function persistState(repository, context, state, options) {
  return repository.commit({ context, namespace: "brief-exports", key: "worker-state", value: state, expectedTenantRevision: options.expectedTenantRevision, expectedRecordRevision: options.expectedRecordRevision, idempotencyKey: options.idempotencyKey, occurredAt: options.occurredAt }, options.validation);
}

export async function runOpportunityBriefExportWorkerCycle(options = {}) {
  const repository = options.repository;
  if (!repository?.readRecord || !repository?.tenantRevision || !repository?.commit) throw new TypeError("A durable repository is required");
  const context = options.context;
  const workerId = required(options.workerId, "workerId");
  const now = iso(options.now, "now");
  const validation = { now };
  const stored = repository.readRecord(context, "brief-exports", "worker-state", validation);
  const initial = stored?.value || createOpportunityBriefExportWorkerState({ organizationId: context.organizationId, updatedAt: now });
  const cycle = leaseOpportunityBriefExportJobs(initial, { now, workerId, leaseSeconds: options.leaseSeconds, limit: options.limit });
  if (!cycle.leasedJobs.length) return Object.freeze({ schemaVersion: OPPORTUNITY_BRIEF_EXPORT_RUN_VERSION, organizationId: context.organizationId, workerId, startedAt: now, completedAt: now, leasedJobIds: [], artifactReadyJobIds: [], retryScheduledJobIds: [], deadLetteredJobIds: [], recoveredLeaseJobIds: cycle.recoveredLeaseJobIds, leaseReceipt: null, completionReceipt: null });
  const tenantRevision = repository.tenantRevision(context, validation);
  const batchId = stableId("batch", cycle.leasedJobs.map((job) => job.id).sort().join("|"));
  const leaseReceipt = persistState(repository, context, cycle.state, { expectedTenantRevision: tenantRevision, expectedRecordRevision: Number(stored?.revision || 0), idempotencyKey: `brief-export-lease:${context.organizationId}:${workerId}:${now}:${batchId}`, occurredAt: now, validation });
  let completedState = cycle.state;
  const artifactReadyJobIds = [], retryScheduledJobIds = [], deadLetteredJobIds = [];
  for (const job of cycle.leasedJobs) {
    const completedAt = iso(options.clock ? options.clock() : now, "completedAt");
    const result = await executeOpportunityBriefExport(job, options.adapters, { now: completedAt });
    completedState = completeOpportunityBriefExportJob(completedState, { jobId: job.id, result }, { workerId, leaseToken: job.lease.token, completedAt, baseDelaySeconds: options.baseDelaySeconds, maxDelaySeconds: options.maxDelaySeconds });
    const status = completedState.jobs.find((item) => item.id === job.id)?.status;
    if (status === "artifact-ready") artifactReadyJobIds.push(job.id);
    if (status === "retry-scheduled") retryScheduledJobIds.push(job.id);
    if (status === "dead-lettered") deadLetteredJobIds.push(job.id);
  }
  const completedAt = iso(options.clock ? options.clock() : now, "completedAt");
  const completionReceipt = persistState(repository, context, completedState, { expectedTenantRevision: leaseReceipt.tenantRevision, expectedRecordRevision: leaseReceipt.recordRevision, idempotencyKey: `brief-export-complete:${context.organizationId}:${workerId}:${now}:${batchId}`, occurredAt: completedAt, validation: { now: completedAt } });
  return Object.freeze({ schemaVersion: OPPORTUNITY_BRIEF_EXPORT_RUN_VERSION, organizationId: context.organizationId, workerId, startedAt: now, completedAt, leasedJobIds: cycle.leasedJobs.map((job) => job.id), artifactReadyJobIds, retryScheduledJobIds, deadLetteredJobIds, recoveredLeaseJobIds: cycle.recoveredLeaseJobIds, leaseReceipt, completionReceipt });
}
