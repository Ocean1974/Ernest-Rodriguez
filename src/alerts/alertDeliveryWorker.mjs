export const ALERT_DELIVERY_JOB_VERSION = "wr-alert-delivery-job-v1";
export const ALERT_WORKER_STATE_VERSION = "wr-alert-worker-state-v1";
export const ALERT_WORKER_CYCLE_VERSION = "wr-alert-worker-cycle-v1";
export const ALERT_PROVIDER_REQUEST_VERSION = "wr-alert-provider-request-v1";
export const ALERT_PROVIDER_RESULT_VERSION = "wr-alert-provider-result-v1";
export const ALERT_DEAD_LETTER_VERSION = "wr-alert-dead-letter-v1";

export const DELIVERY_JOB_STATUSES = Object.freeze(["queued", "leased", "retry-scheduled", "delivered", "dead-lettered"]);
export const DELIVERY_CHANNELS = Object.freeze(["in-app", "email", "webhook"]);

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
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function revision(value) {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

function normalizeLease(value) {
  if (!value) return null;
  return Object.freeze({
    token: required(value.token, "lease.token"),
    workerId: required(value.workerId, "lease.workerId"),
    leasedAt: iso(value.leasedAt, "lease.leasedAt"),
    expiresAt: iso(value.expiresAt, "lease.expiresAt"),
  });
}

function validateReferences(channelType, endpointRef, payloadRef) {
  if (!String(payloadRef).startsWith("payload-ref:")) throw new TypeError("payloadRef must be an opaque payload-ref, not inline alert content");
  if (["email", "webhook"].includes(channelType) && !String(endpointRef).startsWith("secret-ref:")) {
    throw new TypeError(`${channelType} endpointRef must be an opaque secret-ref`);
  }
}

export function createAlertDeliveryJob(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const deliveryAttemptId = required(input.deliveryAttemptId || input.id, "deliveryAttemptId");
  const channelType = DELIVERY_CHANNELS.includes(input.channelType) ? input.channelType : "in-app";
  const endpointRef = String(input.endpointRef || "");
  const payloadRef = required(input.payloadRef, "payloadRef");
  validateReferences(channelType, endpointRef, payloadRef);
  const createdAt = iso(input.createdAt, "createdAt");
  const status = DELIVERY_JOB_STATUSES.includes(input.status) ? input.status : "queued";
  return {
    schemaVersion: ALERT_DELIVERY_JOB_VERSION,
    id: String(input.jobId || input.id || stableId("delivery_job", `${organizationId}|${deliveryAttemptId}`)),
    organizationId,
    deliveryAttemptId,
    alertEnvelopeId: required(input.alertEnvelopeId, "alertEnvelopeId"),
    subscriptionId: required(input.subscriptionId, "subscriptionId"),
    channelType,
    providerId: String(input.providerId || channelType),
    endpointRef,
    payloadRef,
    providerIdempotencyKey: String(input.providerIdempotencyKey || `wr-delivery:${organizationId}:${deliveryAttemptId}`),
    status,
    attemptNumber: Math.max(0, Math.trunc(Number(input.attemptNumber) || 0)),
    maxAttempts: Math.max(1, Math.trunc(Number(input.maxAttempts) || 5)),
    nextAttemptAt: iso(input.nextAttemptAt || input.scheduledFor || createdAt, "nextAttemptAt"),
    lease: normalizeLease(input.lease),
    lastErrorCode: String(input.lastErrorCode || ""),
    lastErrorMessage: String(input.lastErrorMessage || ""),
    providerMessageId: String(input.providerMessageId || ""),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt, "updatedAt"),
    deliveredAt: input.deliveredAt ? iso(input.deliveredAt, "deliveredAt") : "",
  };
}

export function createAlertWorkerState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const jobs = (input.jobs || []).map((job) => {
    if (String(job.organizationId || "") !== organizationId) throw new TypeError("All jobs must belong to the worker-state organization");
    return createAlertDeliveryJob(job);
  });
  return {
    schemaVersion: ALERT_WORKER_STATE_VERSION,
    organizationId,
    revision: revision(input.revision),
    jobs,
    dispatches: (input.dispatches || []).map((item) => ({ jobId: required(item.jobId, "dispatch.jobId"), channelType: DELIVERY_CHANNELS.includes(item.channelType) ? item.channelType : "in-app", dispatchedAt: iso(item.dispatchedAt, "dispatch.dispatchedAt") })),
    deadLetters: (input.deadLetters || []).map((item) => ({ ...item, schemaVersion: ALERT_DEAD_LETTER_VERSION })),
    updatedAt: iso(input.updatedAt, "updatedAt"),
  };
}

export function enqueueDeliveryAttempts(stateInput, attempts = [], options = {}) {
  const state = createAlertWorkerState(stateInput);
  const createdAt = iso(options.createdAt, "createdAt");
  const additions = [];
  for (const attempt of attempts) {
    if (attempt.status !== "queued") continue;
    if (state.jobs.some((job) => job.deliveryAttemptId === attempt.id) || additions.some((job) => job.deliveryAttemptId === attempt.id)) continue;
    additions.push(createAlertDeliveryJob({
      ...attempt,
      organizationId: state.organizationId,
      deliveryAttemptId: attempt.id,
      payloadRef: typeof options.payloadRefForAttempt === "function" ? options.payloadRefForAttempt(attempt) : options.payloadRef,
      providerId: typeof options.providerIdForChannel === "function" ? options.providerIdForChannel(attempt.channelType) : attempt.channelType,
      maxAttempts: options.maxAttempts,
      createdAt: attempt.createdAt || createdAt,
      updatedAt: createdAt,
    }));
  }
  if (!additions.length) return state;
  return { ...state, revision: state.revision + 1, jobs: [...state.jobs, ...additions], updatedAt: createdAt };
}

function rateLimitFor(channelType, policies = {}) {
  const policy = policies[channelType];
  if (!policy) return { maxDispatches: Number.POSITIVE_INFINITY, windowSeconds: 60 };
  return { maxDispatches: Math.max(0, Math.trunc(Number(policy.maxDispatches) || 0)), windowSeconds: Math.max(1, Number(policy.windowSeconds) || 60) };
}

export function leaseDeliveryJobs(stateInput, options = {}) {
  const state = createAlertWorkerState(stateInput);
  const now = iso(options.now, "now");
  const nowMs = new Date(now).getTime();
  const workerId = required(options.workerId, "workerId");
  const leaseSeconds = Math.max(1, Number(options.leaseSeconds) || 60);
  const limit = Math.max(1, Math.trunc(Number(options.limit) || 25));
  const jobs = state.jobs.map((job) => ({ ...job }));
  const candidates = jobs.filter((job) => {
    if (["delivered", "dead-lettered"].includes(job.status)) return false;
    if (job.status === "leased" && new Date(job.lease?.expiresAt || 0).getTime() > nowMs) return false;
    return new Date(job.nextAttemptAt).getTime() <= nowMs;
  }).sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.id.localeCompare(b.id));
  const leasedJobs = [];
  const rateLimitedJobIds = [];
  const recoveredLeaseJobIds = [];
  const dispatches = [...state.dispatches];
  for (const job of candidates) {
    if (leasedJobs.length >= limit) break;
    const rate = rateLimitFor(job.channelType, options.rateLimits);
    const windowStart = nowMs - rate.windowSeconds * 1000;
    const recentCount = dispatches.filter((dispatch) => dispatch.channelType === job.channelType && new Date(dispatch.dispatchedAt).getTime() > windowStart).length;
    if (recentCount >= rate.maxDispatches) {
      rateLimitedJobIds.push(job.id);
      continue;
    }
    if (job.status === "leased") recoveredLeaseJobIds.push(job.id);
    const lease = Object.freeze({
      token: stableId("lease", `${job.id}|${workerId}|${now}|${state.revision}`),
      workerId,
      leasedAt: now,
      expiresAt: new Date(nowMs + leaseSeconds * 1000).toISOString(),
    });
    Object.assign(job, { status: "leased", attemptNumber: job.attemptNumber + 1, lease, updatedAt: now });
    dispatches.push({ jobId: job.id, channelType: job.channelType, dispatchedAt: now });
    leasedJobs.push(job);
  }
  const changed = leasedJobs.length > 0;
  const nextState = changed ? { ...state, revision: state.revision + 1, jobs, dispatches, updatedAt: now } : state;
  return {
    schemaVersion: ALERT_WORKER_CYCLE_VERSION,
    state: nextState,
    workerId,
    evaluatedAt: now,
    leasedJobs: leasedJobs.map((job) => createAlertDeliveryJob(job)),
    rateLimitedJobIds,
    recoveredLeaseJobIds,
  };
}

export function createProviderRequest(jobInput) {
  const job = createAlertDeliveryJob(jobInput);
  if (job.status !== "leased" || !job.lease) throw new TypeError("Only a leased delivery job can create a provider request");
  validateReferences(job.channelType, job.endpointRef, job.payloadRef);
  return Object.freeze({
    schemaVersion: ALERT_PROVIDER_REQUEST_VERSION,
    jobId: job.id,
    organizationId: job.organizationId,
    providerId: job.providerId,
    channelType: job.channelType,
    endpointRef: job.endpointRef,
    payloadRef: job.payloadRef,
    idempotencyKey: job.providerIdempotencyKey,
    alertEnvelopeId: job.alertEnvelopeId,
    subscriptionId: job.subscriptionId,
    attemptNumber: job.attemptNumber,
  });
}

export async function executeProviderDelivery(jobInput, provider) {
  const request = createProviderRequest(jobInput);
  if (!provider || typeof provider.send !== "function") throw new TypeError("provider.send is required");
  try {
    const result = await provider.send(request);
    return Object.freeze({
      schemaVersion: ALERT_PROVIDER_RESULT_VERSION,
      jobId: request.jobId,
      success: result?.success === true,
      retryable: result?.success === true ? false : result?.retryable !== false,
      providerMessageId: String(result?.providerMessageId || ""),
      errorCode: String(result?.errorCode || ""),
      errorMessage: String(result?.errorMessage || ""),
      providerIdempotentReplay: result?.providerIdempotentReplay === true,
    });
  } catch (error) {
    return Object.freeze({ schemaVersion: ALERT_PROVIDER_RESULT_VERSION, jobId: request.jobId, success: false, retryable: true, providerMessageId: "", errorCode: String(error?.code || "provider-exception"), errorMessage: String(error?.message || error), providerIdempotentReplay: false });
  }
}

function jitterFraction(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 0xffffffff;
}

export function completeDeliveryJob(stateInput, input = {}, options = {}) {
  const state = createAlertWorkerState(stateInput);
  const completedAt = iso(options.completedAt, "completedAt");
  const jobIndex = state.jobs.findIndex((job) => job.id === input.jobId);
  if (jobIndex < 0) throw new TypeError(`Unknown delivery job: ${input.jobId}`);
  const current = state.jobs[jobIndex];
  if (current.status !== "leased" || !current.lease) throw new TypeError("Delivery job is not leased");
  if (current.lease.workerId !== options.workerId || current.lease.token !== options.leaseToken) {
    const error = new Error("Delivery lease ownership conflict");
    error.code = "WR_ALERT_LEASE_CONFLICT";
    throw error;
  }
  if (new Date(current.lease.expiresAt) < new Date(completedAt)) {
    const error = new Error("Delivery lease expired before completion");
    error.code = "WR_ALERT_LEASE_EXPIRED";
    throw error;
  }
  const result = input.result || {};
  const jobs = [...state.jobs];
  const deadLetters = [...state.deadLetters];
  let next;
  if (result.success === true) {
    next = { ...current, status: "delivered", lease: null, providerMessageId: String(result.providerMessageId || ""), lastErrorCode: "", lastErrorMessage: "", deliveredAt: completedAt, updatedAt: completedAt };
  } else {
    const canRetry = result.retryable !== false && current.attemptNumber < current.maxAttempts;
    if (canRetry) {
      const baseSeconds = Math.max(1, Number(options.baseDelaySeconds) || 30);
      const maxSeconds = Math.max(baseSeconds, Number(options.maxDelaySeconds) || 3600);
      const jitterRatio = Math.max(0, Math.min(1, Number(options.jitterRatio) || 0));
      const rawSeconds = Math.min(maxSeconds, baseSeconds * 2 ** Math.max(0, current.attemptNumber - 1));
      const jitter = rawSeconds * jitterRatio * (jitterFraction(`${current.id}|${current.attemptNumber}`) * 2 - 1);
      const delaySeconds = Math.max(1, Math.round(rawSeconds + jitter));
      next = { ...current, status: "retry-scheduled", lease: null, nextAttemptAt: new Date(new Date(completedAt).getTime() + delaySeconds * 1000).toISOString(), lastErrorCode: String(result.errorCode || "provider-failure"), lastErrorMessage: String(result.errorMessage || ""), updatedAt: completedAt };
    } else {
      next = { ...current, status: "dead-lettered", lease: null, lastErrorCode: String(result.errorCode || "provider-failure"), lastErrorMessage: String(result.errorMessage || ""), updatedAt: completedAt };
      deadLetters.push(Object.freeze({ schemaVersion: ALERT_DEAD_LETTER_VERSION, id: stableId("dead_letter", `${current.id}|${current.attemptNumber}|${completedAt}`), organizationId: current.organizationId, jobId: current.id, deliveryAttemptId: current.deliveryAttemptId, channelType: current.channelType, attemptNumber: current.attemptNumber, errorCode: next.lastErrorCode, errorMessage: next.lastErrorMessage, deadLetteredAt: completedAt }));
    }
  }
  jobs[jobIndex] = next;
  return { ...state, revision: state.revision + 1, jobs, deadLetters, updatedAt: completedAt };
}
