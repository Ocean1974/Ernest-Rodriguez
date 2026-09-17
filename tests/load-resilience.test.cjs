const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const load = await import("../src/operations/loadResilience.mjs");
  const requests = Array.from({ length: 10 }, (_, index) => ({ id: `request-${index + 1}`, payload: { index }, recoveryProbe: index === 9 }));
  const scenario = load.createLoadScenario({ id: "query-resilience", serviceName: "property-intelligence-query", requests, concurrency: 4, timeoutMs: 100, faultSchedule: { "request-3": { type: "reject", code: "WR_INJECTED_SHARD_FAILURE" }, "request-6": { type: "timeout" } }, thresholds: { minimumRequests: 10, minimumSuccessPct: 80, maximumP95Ms: 1000, maximumTimeoutPct: 10, requireRecoveryProbe: true } });
  const report = await load.runLoadResilienceScenario({ scenario, execute: async () => ({ status: "complete" }), generatedAt: "2026-08-14T14:00:00.000Z" });
  assert.equal(report.schemaVersion, "wr-load-resilience-report-v1");
  assert.equal(report.status, "passed");
  assert.equal(report.metrics.requestCount, 10);
  assert.equal(report.metrics.successCount, 8);
  assert.equal(report.metrics.errorCount, 1);
  assert.equal(report.metrics.timeoutCount, 1);
  assert.equal(report.metrics.injectedFaultCount, 2);
  assert.equal(report.metrics.recoveryProbeSuccessCount, 1);
  assert(report.metrics.maxInFlight <= 4);
  const failed = await load.runLoadResilienceScenario({ scenario: { ...scenario, thresholds: { ...scenario.thresholds, minimumSuccessPct: 99 } }, execute: async () => ({ status: "complete" }), generatedAt: "2026-08-14T14:00:00.000Z" });
  assert.equal(failed.status, "failed");
  const insufficient = await load.runLoadResilienceScenario({ scenario: { ...scenario, thresholds: { ...scenario.thresholds, minimumRequests: 20 } }, execute: async () => ({ status: "complete" }), generatedAt: "2026-08-14T14:00:00.000Z" });
  assert.equal(insufficient.status, "insufficient-evidence");
  assert.throws(() => load.createLoadScenario({ id: "bad", serviceName: "service", requests: [{ id: "same" }, { id: "same" }] }), /Duplicate load request ID/);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "load-resilience.schema.json"), "utf8"));
  assert.equal(schema.oneOf[1].properties.schemaVersion.const, "wr-load-resilience-report-v1");
  console.log("White Rabbit deterministic concurrency, fault, timeout, recovery, and load-gate tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
