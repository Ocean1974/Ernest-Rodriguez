import { performance } from "node:perf_hooks";

export const LOAD_SCENARIO_VERSION = "wr-load-scenario-v1";
export const LOAD_RESILIENCE_REPORT_VERSION = "wr-load-resilience-report-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

export function createLoadScenario(input = {}) {
  const seen = new Set();
  const requests = (input.requests || []).map((request, index) => {
    const id = required(request.id || `request-${index + 1}`, `requests[${index}].id`);
    if (seen.has(id)) throw new TypeError(`Duplicate load request ID: ${id}`);
    seen.add(id);
    return { id, payload: structuredClone(request.payload ?? {}), recoveryProbe: request.recoveryProbe === true };
  });
  if (!requests.length) throw new TypeError("requests must contain at least one request");
  const faultSchedule = {};
  for (const [requestId, fault] of Object.entries(input.faultSchedule || {})) {
    if (!seen.has(requestId)) throw new TypeError(`Fault target is not in the scenario: ${requestId}`);
    faultSchedule[requestId] = { type: ["reject", "timeout", "delay"].includes(fault.type) ? fault.type : "reject", code: String(fault.code || "WR_INJECTED_FAULT"), delayMs: integer(fault.delayMs, 0, 0, 2000) };
  }
  return Object.freeze({
    schemaVersion: LOAD_SCENARIO_VERSION,
    id: required(input.id, "id"),
    serviceName: required(input.serviceName, "serviceName"),
    requests,
    concurrency: integer(input.concurrency, 4, 1, 64),
    timeoutMs: integer(input.timeoutMs, 5000, 10, 60000),
    faultSchedule,
    thresholds: {
      minimumRequests: integer(input.thresholds?.minimumRequests, requests.length, 1, 100000),
      minimumSuccessPct: Math.max(0, Math.min(100, Number(input.thresholds?.minimumSuccessPct ?? 99))),
      maximumP95Ms: Math.max(1, Number(input.thresholds?.maximumP95Ms ?? 1000)),
      maximumTimeoutPct: Math.max(0, Math.min(100, Number(input.thresholds?.maximumTimeoutPct ?? 1))),
      requireRecoveryProbe: input.thresholds?.requireRecoveryProbe === true,
    },
  });
}

function delay(ms) { return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }

async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(`Load request timed out after ${timeoutMs}ms`); error.code = "WR_LOAD_TIMEOUT"; reject(error); }, timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runLoadResilienceScenario({ scenario: scenarioInput, execute, clock = () => performance.now(), generatedAt = new Date().toISOString() } = {}) {
  const scenario = scenarioInput?.schemaVersion === LOAD_SCENARIO_VERSION ? scenarioInput : createLoadScenario(scenarioInput);
  if (typeof execute !== "function") throw new TypeError("execute is required");
  const started = clock();
  const results = new Array(scenario.requests.length);
  let next = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  async function worker() {
    while (next < scenario.requests.length) {
      const index = next++;
      const request = scenario.requests[index];
      const fault = scenario.faultSchedule[request.id];
      const requestStarted = clock();
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (fault?.delayMs) await delay(fault.delayMs);
        if (fault?.type === "reject") { const error = new Error("Deterministic injected rejection"); error.code = fault.code; throw error; }
        const timeoutMs = fault?.type === "timeout" ? Math.min(10, scenario.timeoutMs) : scenario.timeoutMs;
        const operation = fault?.type === "timeout"
          ? delay(timeoutMs + 5).then(() => execute(request.payload, { requestId: request.id, recoveryProbe: request.recoveryProbe, injectedFault: fault }))
          : Promise.resolve(execute(request.payload, { requestId: request.id, recoveryProbe: request.recoveryProbe, injectedFault: fault || null }));
        const output = await withTimeout(operation, timeoutMs);
        const outputStatus = String(output?.status || "success");
        results[index] = { requestId: request.id, recoveryProbe: request.recoveryProbe, status: outputStatus === "complete" || outputStatus === "success" ? "success" : outputStatus === "partial" ? "partial" : "error", code: String(output?.code || ""), durationMs: Math.max(0, clock() - requestStarted) };
      } catch (error) {
        results[index] = { requestId: request.id, recoveryProbe: request.recoveryProbe, status: error.code === "WR_LOAD_TIMEOUT" ? "timeout" : "error", code: String(error.code || "WR_LOAD_EXECUTION_ERROR"), durationMs: Math.max(0, clock() - requestStarted) };
      } finally { inFlight -= 1; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(scenario.concurrency, scenario.requests.length) }, worker));
  const elapsedMs = Math.max(1, clock() - started);
  const success = results.filter((result) => result.status === "success");
  const timeouts = results.filter((result) => result.status === "timeout");
  const recoveryProbes = results.filter((result) => result.recoveryProbe);
  const metrics = {
    requestCount: results.length,
    successCount: success.length,
    partialCount: results.filter((result) => result.status === "partial").length,
    errorCount: results.filter((result) => result.status === "error").length,
    timeoutCount: timeouts.length,
    successPct: Number((success.length / results.length * 100).toFixed(3)),
    timeoutPct: Number((timeouts.length / results.length * 100).toFixed(3)),
    latencyP50Ms: percentile(results.map((result) => result.durationMs), 0.5),
    latencyP95Ms: percentile(results.map((result) => result.durationMs), 0.95),
    latencyP99Ms: percentile(results.map((result) => result.durationMs), 0.99),
    throughputPerSecond: Number((results.length / elapsedMs * 1000).toFixed(3)),
    elapsedMs,
    configuredConcurrency: scenario.concurrency,
    maxInFlight,
    injectedFaultCount: Object.keys(scenario.faultSchedule).length,
    recoveryProbeCount: recoveryProbes.length,
    recoveryProbeSuccessCount: recoveryProbes.filter((result) => result.status === "success").length,
  };
  const checks = [
    { id: "minimum-requests", passed: metrics.requestCount >= scenario.thresholds.minimumRequests, actual: metrics.requestCount, threshold: scenario.thresholds.minimumRequests },
    { id: "success-rate", passed: metrics.successPct >= scenario.thresholds.minimumSuccessPct, actual: metrics.successPct, threshold: scenario.thresholds.minimumSuccessPct },
    { id: "latency-p95", passed: metrics.latencyP95Ms <= scenario.thresholds.maximumP95Ms, actual: metrics.latencyP95Ms, threshold: scenario.thresholds.maximumP95Ms },
    { id: "timeout-rate", passed: metrics.timeoutPct <= scenario.thresholds.maximumTimeoutPct, actual: metrics.timeoutPct, threshold: scenario.thresholds.maximumTimeoutPct },
  ];
  if (scenario.thresholds.requireRecoveryProbe) checks.push({ id: "recovery-probe", passed: recoveryProbes.length > 0 && recoveryProbes.every((result) => result.status === "success"), actual: `${metrics.recoveryProbeSuccessCount}/${metrics.recoveryProbeCount}`, threshold: "all" });
  const sufficient = metrics.requestCount >= scenario.thresholds.minimumRequests;
  return Object.freeze({ schemaVersion: LOAD_RESILIENCE_REPORT_VERSION, scenarioId: scenario.id, serviceName: scenario.serviceName, generatedAt: new Date(generatedAt).toISOString(), status: !sufficient ? "insufficient-evidence" : checks.every((check) => check.passed) ? "passed" : "failed", metrics, checks, results, scenario });
}
