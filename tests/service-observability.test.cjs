const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const telemetry = await import("../src/operations/serviceObservability.mjs");
  const organizationId = "org-white-rabbit";
  const collector = telemetry.createTelemetryCollector({ organizationId, maxEvents: 3 });
  const event = (index, status = "success") => ({ organizationId, serviceName: "property-intelligence-query", operation: "execute", traceId: `trace-${index}`, spanId: `span-${index}`, startedAt: `2026-08-14T14:0${index}:00.000Z`, endedAt: `2026-08-14T14:0${index}:00.${String(index * 100).padStart(3, "0")}Z`, status, errorCode: status === "success" ? "" : "WR_TEST", measurements: { durationMs: index * 100, saturationPct: index * 10, sourceLagMs: index * 1000, cacheHit: index % 2 === 0 }, attributes: { datasetId: "dcad", token: "must-not-be-recorded" } });
  collector.record(event(1));
  collector.record(event(2));
  collector.record(event(3, "error"));
  collector.record(event(4));
  assert.equal(collector.size(), 3);
  const snapshot = collector.snapshot({ capturedAt: "2026-08-14T14:10:00.000Z", serviceName: "property-intelligence-query", operation: "execute" });
  assert.equal(snapshot.schemaVersion, "wr-service-telemetry-snapshot-v1");
  assert.equal(snapshot.droppedEventCount, 1);
  assert(!Object.prototype.hasOwnProperty.call(snapshot.events[0].attributes, "token"), "arbitrary secret-bearing telemetry attributes must be dropped");
  assert.throws(() => collector.record({ ...event(5), organizationId: "org-other" }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const passingPolicy = telemetry.createServiceSloPolicy({ serviceName: "property-intelligence-query", operation: "execute", windowMinutes: 60, minimumSampleCount: 3, availabilityTargetPct: 60, latencyP95Ms: 500, maxSaturationPct: 80, maxSourceLagMs: 10000 });
  const passing = telemetry.evaluateServiceSlo(snapshot, passingPolicy, { evaluatedAt: "2026-08-14T14:10:00.000Z" });
  assert.equal(passing.schemaVersion, "wr-service-slo-report-v1");
  assert.equal(passing.status, "passed");
  assert.equal(passing.metrics.availabilityPct, 66.666667);
  assert.equal(passing.metrics.latencyP95Ms, 400);
  assert(passing.metrics.errorBudgetConsumedPct > 0);
  const failing = telemetry.evaluateServiceSlo(snapshot, { ...passingPolicy, availabilityTargetPct: 99.9 }, { evaluatedAt: "2026-08-14T14:10:00.000Z" });
  assert.equal(failing.status, "failed");
  assert(failing.checks.some((check) => check.id === "availability" && !check.passed));
  const insufficient = telemetry.evaluateServiceSlo(snapshot, { ...passingPolicy, minimumSampleCount: 4 }, { evaluatedAt: "2026-08-14T14:10:00.000Z" });
  assert.equal(insufficient.status, "insufficient-evidence");

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "service-observability.schema.json"), "utf8"));
  assert.equal(schema.$defs.report.properties.schemaVersion.const, "wr-service-slo-report-v1");
  console.log("White Rabbit safe telemetry, SLO, latency, saturation, lag, and error-budget tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
