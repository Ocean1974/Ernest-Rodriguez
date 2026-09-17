const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { backtestSignalScores, buildSignalDriftReport } = await import("../src/intelligence/signalValidation.mjs");
  const scoredAt = "2025-01-01T00:00:00.000Z";
  const outcomeObservedAt = "2025-06-01T00:00:00.000Z";
  const predictions = [90, 80, 70, 60, 55, 45, 35, 20, 10, 5].map((score, index) => ({ id: `p${index}`, score, scoredAt, featureSetAsOf: scoredAt, outcome: index < 5, outcomeObservedAt }));
  predictions.push({ id: "leak", score: 99, scoredAt, featureSetAsOf: "2025-01-02T00:00:00.000Z", outcome: true, outcomeObservedAt });
  const backtest = backtestSignalScores({ modelId: "acquisition-opportunity", modelVersion: "2026.08", predictions, horizonDays: 365, generatedAt: "2026-08-13" });
  assert.equal(backtest.schemaVersion, "wr-signal-backtest-v1");
  assert.equal(backtest.status, "evaluated");
  assert.equal(backtest.sample.evaluated, 10);
  assert.equal(backtest.sample.excluded, 1);
  assert.equal(backtest.metrics.auc, 1);
  assert.equal(backtest.metrics.precisionAtTopDecile, 1);
  assert(backtest.metrics.brierScore >= 0 && backtest.metrics.brierScore <= 1);
  assert.equal(backtest.calibration.length, 5);
  assert.equal(backtest.leakageAudit.passed, false);
  assert(backtest.leakageAudit.violations.some((item) => item.predictionId === "leak"));
  const insufficient = backtestSignalScores({ predictions: [{ score: 50, scoredAt, outcome: true, outcomeObservedAt }] });
  assert.equal(insufficient.status, "insufficient-sample");

  const stable = buildSignalDriftReport({ modelId: "model", modelVersion: "1", generatedAt: "2026-08-13", features: [{ featureId: "demand", baselineValues: [1, 2, 3, 4, 5], currentValues: [1, 2, 3, 4, 5] }] });
  assert.equal(stable.schemaVersion, "wr-signal-drift-report-v1");
  assert.equal(stable.status, "stable");
  assert.equal(stable.features[0].populationStabilityIndex, 0);
  const alert = buildSignalDriftReport({ modelId: "model", modelVersion: "1", generatedAt: "2026-08-13", features: [{ featureId: "demand", baselineValues: [1, 2, 3, 4, 5], currentValues: [100, 101, 102, 103, 104] }] });
  assert.equal(alert.status, "alert");
  assert(alert.features[0].populationStabilityIndex >= 0.25);
  assert(alert.action.includes("Pause automated use"));
  const missing = buildSignalDriftReport({ features: [{ featureId: "missing", baselineValues: [], currentValues: [] }] });
  assert.equal(missing.status, "insufficient-evidence");

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "signal-validation.schema.json"), "utf8"));
  assert(schema.oneOf.some((item) => item.properties.schemaVersion.const === "wr-signal-backtest-v1"));
  console.log("White Rabbit signal backtest, calibration, leakage-audit, and drift tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
