import { completeDeliveryJob, createAlertWorkerState, executeProviderDelivery, leaseDeliveryJobs } from "./alertDeliveryWorker.mjs";
import { persistAlertWorkerState } from "../persistence/platformPersistenceService.mjs";

export const ALERT_SCHEDULER_RUN_VERSION = "wr-alert-scheduler-run-v1";

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

function providerFrom(registry, providerId) {
  return registry instanceof Map ? registry.get(providerId) : registry?.[providerId];
}

function cycleKey(jobs) {
  let hash = 2166136261;
  for (const character of jobs.map((job) => job.id).sort().join("|")) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

export async function runAlertWorkerCycle(options = {}) {
  const repository = options.repository;
  if (!repository?.readRecord || !repository?.tenantRevision) throw new TypeError("A durable repository is required");
  const context = options.context;
  const workerId = required(options.workerId, "workerId");
  const now = iso(options.now, "now");
  const validation = { now };
  const leaseSeconds = Math.max(1, Number(options.leaseSeconds) || 60);
  if (options.providerTimeoutMs && Number(options.providerTimeoutMs) >= leaseSeconds * 1000) throw new TypeError("providerTimeoutMs must be shorter than the worker lease");
  const stored = repository.readRecord(context, "alert-worker", "state", validation);
  const state = stored?.value || createAlertWorkerState({ organizationId: context.organizationId, updatedAt: now });
  const tenantRevision = repository.tenantRevision(context, validation);
  const cycle = leaseDeliveryJobs(state, { now, workerId, leaseSeconds, limit: options.limit, rateLimits: options.rateLimits });
  if (!cycle.leasedJobs.length) {
    return { schemaVersion: ALERT_SCHEDULER_RUN_VERSION, organizationId: context.organizationId, workerId, startedAt: now, completedAt: now, leasedJobIds: [], deliveredJobIds: [], retryScheduledJobIds: [], deadLetteredJobIds: [], rateLimitedJobIds: cycle.rateLimitedJobIds, recoveredLeaseJobIds: cycle.recoveredLeaseJobIds, leaseReceipt: null, completionReceipt: null };
  }
  const leasedSetKey = cycleKey(cycle.leasedJobs);
  const leaseReceipt = persistAlertWorkerState(repository, context, cycle.state, {
    expectedTenantRevision: tenantRevision,
    expectedRecordRevision: Number(stored?.revision || 0),
    idempotencyKey: `alert-worker-lease:${context.organizationId}:${workerId}:${now}:${leasedSetKey}`,
    occurredAt: now,
    validation,
  });
  let completedState = cycle.state;
  const deliveredJobIds = [];
  const retryScheduledJobIds = [];
  const deadLetteredJobIds = [];
  for (const job of cycle.leasedJobs) {
    const provider = providerFrom(options.providerRegistry, job.providerId);
    const result = provider
      ? await executeProviderDelivery(job, provider)
      : { success: false, retryable: true, errorCode: "provider-not-configured", errorMessage: `Provider is not configured: ${job.providerId}` };
    const completedAt = iso(options.clock ? options.clock() : now, "completedAt");
    completedState = completeDeliveryJob(completedState, { jobId: job.id, result }, { workerId, leaseToken: job.lease.token, completedAt, baseDelaySeconds: options.baseDelaySeconds, maxDelaySeconds: options.maxDelaySeconds, jitterRatio: options.jitterRatio });
    const status = completedState.jobs.find((item) => item.id === job.id)?.status;
    if (status === "delivered") deliveredJobIds.push(job.id);
    if (status === "retry-scheduled") retryScheduledJobIds.push(job.id);
    if (status === "dead-lettered") deadLetteredJobIds.push(job.id);
  }
  const completedAt = iso(options.clock ? options.clock() : now, "completedAt");
  const completionReceipt = persistAlertWorkerState(repository, context, completedState, {
    expectedTenantRevision: leaseReceipt.tenantRevision,
    expectedRecordRevision: leaseReceipt.recordRevision,
    idempotencyKey: `alert-worker-complete:${context.organizationId}:${workerId}:${now}:${leasedSetKey}`,
    occurredAt: completedAt,
    validation: { now: completedAt },
  });
  return { schemaVersion: ALERT_SCHEDULER_RUN_VERSION, organizationId: context.organizationId, workerId, startedAt: now, completedAt, leasedJobIds: cycle.leasedJobs.map((job) => job.id), deliveredJobIds, retryScheduledJobIds, deadLetteredJobIds, rateLimitedJobIds: cycle.rateLimitedJobIds, recoveredLeaseJobIds: cycle.recoveredLeaseJobIds, leaseReceipt, completionReceipt };
}
