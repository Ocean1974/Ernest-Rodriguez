export const SERVICE_TELEMETRY_EVENT_VERSION = "wr-service-telemetry-event-v1";
export const SERVICE_TELEMETRY_SNAPSHOT_VERSION = "wr-service-telemetry-snapshot-v1";
export const SERVICE_SLO_POLICY_VERSION = "wr-service-slo-policy-v1";
export const SERVICE_SLO_REPORT_VERSION = "wr-service-slo-report-v1";

const STATUSES = new Set(["success", "partial", "error", "timeout", "rejected"]);
const SAFE_ATTRIBUTE_KEYS = new Set(["countyId", "datasetId", "sourceVersion", "requestClass", "cacheStatus", "providerId", "connectorId"]);

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

function number(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

export function createServiceTelemetryEvent(input = {}) {
  const startedAt = iso(input.startedAt, "startedAt");
  const endedAt = iso(input.endedAt, "endedAt");
  if (endedAt < startedAt) throw new TypeError("endedAt cannot precede startedAt");
  const status = STATUSES.has(input.status) ? input.status : "error";
  const attributes = {};
  for (const [key, value] of Object.entries(input.attributes || {})) if (SAFE_ATTRIBUTE_KEYS.has(key) && value !== undefined && value !== null) attributes[key] = String(value);
  return Object.freeze({
    schemaVersion: SERVICE_TELEMETRY_EVENT_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    serviceName: required(input.serviceName, "serviceName"),
    operation: required(input.operation, "operation"),
    traceId: required(input.traceId, "traceId"),
    spanId: required(input.spanId, "spanId"),
    parentSpanId: String(input.parentSpanId || ""),
    startedAt,
    endedAt,
    status,
    errorCode: status === "success" ? "" : String(input.errorCode || ""),
    measurements: {
      durationMs: number(input.measurements?.durationMs, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
      queueMs: number(input.measurements?.queueMs),
      records: number(input.measurements?.records, 0, 0),
      bytes: number(input.measurements?.bytes, 0, 0),
      saturationPct: number(input.measurements?.saturationPct, 0, 0, 100),
      sourceLagMs: input.measurements?.sourceLagMs === null || input.measurements?.sourceLagMs === undefined ? null : number(input.measurements.sourceLagMs),
      cacheHit: input.measurements?.cacheHit === true,
    },
    attributes,
  });
}

export function createTelemetryCollector({ organizationId, maxEvents = 10000 } = {}) {
  const tenant = required(organizationId, "organizationId");
  const capacity = Math.max(1, Math.min(100000, Math.trunc(Number(maxEvents) || 10000)));
  const events = [];
  let droppedEventCount = 0;
  return Object.freeze({
    record(input) {
      const event = createServiceTelemetryEvent(input);
      if (event.organizationId !== tenant) { const error = new Error("Telemetry event organization does not match collector tenant"); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error; }
      events.push(event);
      if (events.length > capacity) { const removed = events.length - capacity; events.splice(0, removed); droppedEventCount += removed; }
      return event;
    },
    snapshot({ capturedAt, serviceName = "", operation = "" } = {}) {
      const selected = events.filter((event) => (!serviceName || event.serviceName === serviceName) && (!operation || event.operation === operation));
      return Object.freeze({ schemaVersion: SERVICE_TELEMETRY_SNAPSHOT_VERSION, organizationId: tenant, capturedAt: iso(capturedAt, "capturedAt"), serviceName: String(serviceName), operation: String(operation), retainedCapacity: capacity, droppedEventCount, events: structuredClone(selected) });
    },
    size() { return events.length; },
  });
}

export function createServiceSloPolicy(input = {}) {
  const availabilityTargetPct = number(input.availabilityTargetPct, 99.9, 0, 100);
  return Object.freeze({
    schemaVersion: SERVICE_SLO_POLICY_VERSION,
    serviceName: required(input.serviceName, "serviceName"),
    operation: String(input.operation || ""),
    windowMinutes: Math.max(1, Math.trunc(number(input.windowMinutes, 30 * 24 * 60, 1))),
    minimumSampleCount: Math.max(1, Math.trunc(number(input.minimumSampleCount, 100, 1))),
    availabilityTargetPct,
    latencyP95Ms: number(input.latencyP95Ms, 1000, 1),
    maxSaturationPct: number(input.maxSaturationPct, 85, 1, 100),
    maxSourceLagMs: input.maxSourceLagMs === null || input.maxSourceLagMs === undefined ? null : number(input.maxSourceLagMs, 0, 0),
    partialCountsAsFailure: input.partialCountsAsFailure !== false,
  });
}

export function evaluateServiceSlo(snapshot, policyInput, options = {}) {
  if (snapshot?.schemaVersion !== SERVICE_TELEMETRY_SNAPSHOT_VERSION) throw new TypeError("A wr-service-telemetry-snapshot-v1 snapshot is required");
  const policy = policyInput?.schemaVersion === SERVICE_SLO_POLICY_VERSION ? policyInput : createServiceSloPolicy(policyInput);
  if (snapshot.serviceName && snapshot.serviceName !== policy.serviceName) throw new TypeError("Telemetry snapshot service does not match SLO policy");
  const evaluatedAt = iso(options.evaluatedAt || snapshot.capturedAt, "evaluatedAt");
  const windowStart = new Date(new Date(evaluatedAt).getTime() - policy.windowMinutes * 60000).toISOString();
  const events = snapshot.events.filter((event) => event.serviceName === policy.serviceName && (!policy.operation || event.operation === policy.operation) && event.endedAt >= windowStart && event.endedAt <= evaluatedAt);
  const failures = events.filter((event) => event.status !== "success" && (policy.partialCountsAsFailure || event.status !== "partial"));
  const availabilityPct = events.length ? Number(((events.length - failures.length) / events.length * 100).toFixed(6)) : null;
  const durations = events.map((event) => event.measurements.durationMs);
  const sourceLags = events.map((event) => event.measurements.sourceLagMs).filter((value) => value !== null);
  const saturation = events.map((event) => event.measurements.saturationPct);
  const errorBudgetPct = 100 - policy.availabilityTargetPct;
  const observedFailurePct = events.length ? failures.length / events.length * 100 : null;
  const checks = [
    { id: "minimum-samples", passed: events.length >= policy.minimumSampleCount, actual: events.length, threshold: policy.minimumSampleCount },
    { id: "availability", passed: availabilityPct !== null && availabilityPct >= policy.availabilityTargetPct, actual: availabilityPct, threshold: policy.availabilityTargetPct },
    { id: "latency-p95", passed: percentile(durations, 0.95) !== null && percentile(durations, 0.95) <= policy.latencyP95Ms, actual: percentile(durations, 0.95), threshold: policy.latencyP95Ms },
    { id: "saturation-max", passed: saturation.length > 0 && Math.max(...saturation) <= policy.maxSaturationPct, actual: saturation.length ? Math.max(...saturation) : null, threshold: policy.maxSaturationPct },
  ];
  if (policy.maxSourceLagMs !== null) checks.push({ id: "source-lag-p95", passed: sourceLags.length > 0 && percentile(sourceLags, 0.95) <= policy.maxSourceLagMs, actual: percentile(sourceLags, 0.95), threshold: policy.maxSourceLagMs });
  const sufficient = events.length >= policy.minimumSampleCount;
  return Object.freeze({
    schemaVersion: SERVICE_SLO_REPORT_VERSION,
    organizationId: snapshot.organizationId,
    serviceName: policy.serviceName,
    operation: policy.operation,
    evaluatedAt,
    windowStart,
    status: !sufficient ? "insufficient-evidence" : checks.every((check) => check.passed) ? "passed" : "failed",
    sampleCount: events.length,
    metrics: {
      availabilityPct,
      failureCount: failures.length,
      latencyP50Ms: percentile(durations, 0.5),
      latencyP95Ms: percentile(durations, 0.95),
      latencyP99Ms: percentile(durations, 0.99),
      maxSaturationPct: saturation.length ? Math.max(...saturation) : null,
      sourceLagP95Ms: percentile(sourceLags, 0.95),
      cacheHitPct: events.length ? Number((events.filter((event) => event.measurements.cacheHit).length / events.length * 100).toFixed(3)) : null,
      errorBudgetConsumedPct: errorBudgetPct > 0 && observedFailurePct !== null ? Number((observedFailurePct / errorBudgetPct * 100).toFixed(3)) : failures.length ? null : 0,
      burnRate: errorBudgetPct > 0 && observedFailurePct !== null ? Number((observedFailurePct / errorBudgetPct).toFixed(4)) : failures.length ? null : 0,
    },
    checks,
    policy,
  });
}
