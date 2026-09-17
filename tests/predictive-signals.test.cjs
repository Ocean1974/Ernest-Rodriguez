const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const signals = await import("../src/intelligence/predictiveSignals.mjs");
  const propertyId = "wrp:v1:dallas-county-dcad:A1";
  const model = signals.createPredictiveSignalModel({
    id: "acquisition-opportunity", version: "2026.08", createdAt: "2026-01-01", intendedOutcome: "Acquisition candidate advances within 365 days", horizonDays: 365,
    definitions: [
      { category: "ownership-transfer", metric: "transfers-365d", label: "Recent ownership transfers", polarity: "positive", weight: 15, normalization: { minimum: 0, maximum: 5 }, expectedSourceTypes: ["recorder"] },
      { category: "distress", metric: "distress-index", label: "Distress evidence", polarity: "negative", weight: 25, normalization: { minimum: 0, maximum: 10 }, expectedSourceTypes: ["official-record"] },
      { category: "entitlement", metric: "entitlement-stage", label: "Entitlement progress", polarity: "positive", weight: 20, normalization: { mapping: { denied: 0, filed: 0.4, approved: 1 } }, expectedSourceTypes: ["permit"] },
      { category: "infrastructure", metric: "access-index", label: "Infrastructure access", polarity: "positive", weight: 15, normalization: { minimum: 0, maximum: 1 }, expectedSourceTypes: ["official-record"] },
      { category: "demand", metric: "rent-growth-pct", label: "Rent growth", polarity: "positive", weight: 25, normalization: { minimum: -5, maximum: 10 }, expectedSourceTypes: ["mls"] },
    ],
  });
  assert.equal(model.schemaVersion, "wr-predictive-signal-model-v1");
  assert.equal(model.status, "experimental");
  const source = (sourceType, datasetId, recordId) => ({ sourceType, datasetId, recordId });
  const observation = (overrides) => signals.createSignalObservation({ whiteRabbitPropertyId: propertyId, effectiveAt: "2026-06-01", observedAt: "2026-06-02", availableAt: "2026-06-03", confidence: 0.9, ...overrides });
  const observations = [
    observation({ id: "transfer-old", category: "ownership-transfer", metric: "transfers-365d", value: 1, source: source("recorder", "county-recorder", "t1") }),
    observation({ id: "transfer-future", category: "ownership-transfer", metric: "transfers-365d", value: 5, effectiveAt: "2026-07-01", observedAt: "2026-07-02", availableAt: "2026-09-01", source: source("recorder", "county-recorder", "t2") }),
    observation({ category: "distress", metric: "distress-index", value: 8, source: source("official-record", "tax-office", "d1") }),
    observation({ category: "entitlement", metric: "entitlement-stage", value: "approved", source: source("permit", "city-planning", "e1") }),
    observation({ category: "infrastructure", metric: "access-index", value: 0.8, source: source("official-record", "regional-mobility", "i1") }),
    observation({ category: "demand", metric: "rent-growth-pct", value: 5, source: source("mls", "market-feed", "m1") }),
  ];
  const features = signals.assemblePointInTimeFeatures({ model, whiteRabbitPropertyId: propertyId, asOf: "2026-08-13", observations });
  assert.equal(features.schemaVersion, "wr-point-in-time-feature-set-v1");
  assert.equal(features.status, "complete");
  assert.equal(features.features.find((item) => item.definition.metric === "transfers-365d").observation.id, "transfer-old", "future-available evidence must not replace point-in-time evidence");
  assert.equal(features.leakageAudit.passed, false);
  assert(features.leakageAudit.excluded.some((item) => item.observationId === "transfer-future" && item.reasons.includes("future-availability-date")));
  const score = signals.composeExplainableSignalScore(features);
  assert.equal(score.schemaVersion, "wr-explainable-signal-score-v1");
  assert.equal(score.status, "scored");
  assert(score.opportunityScore > 0 && score.riskScore > 0 && score.netScore !== null);
  assert.equal(score.evidenceCoveragePct, 100);
  assert.equal(score.factors.length, 5);
  assert(score.factors.every((factor) => factor.source.datasetId));
  assert(score.bands.net.method.includes("not a statistical confidence interval"));

  const wrongSource = observations.map((item) => item.metric === "distress-index" ? { ...item, source: { ...item.source, sourceType: "broker" } } : item);
  const partial = signals.assemblePointInTimeFeatures({ model, whiteRabbitPropertyId: propertyId, asOf: "2026-08-13", observations: wrongSource });
  assert.equal(partial.status, "partial");
  assert.equal(partial.features.find((item) => item.definition.metric === "distress-index").status, "unexpected-source");
  assert(partial.missingFeatureIds.includes("distress:distress-index"));

  const positiveOnlyModel = signals.createPredictiveSignalModel({ id: "positive-only", version: "1", createdAt: "2026-01-01", definitions: [{ category: "demand", metric: "growth", polarity: "positive", normalization: { minimum: 0, maximum: 10 } }] });
  const positiveFeatures = signals.assemblePointInTimeFeatures({ model: positiveOnlyModel, whiteRabbitPropertyId: propertyId, asOf: "2026-08-13", observations: [observation({ category: "demand", metric: "growth", value: 8, source: source("mls", "feed", "g1") })] });
  assert.equal(signals.composeExplainableSignalScore(positiveFeatures).netScore, null, "net score requires both opportunity and risk evidence");
  const emptyFeatures = signals.assemblePointInTimeFeatures({ model, whiteRabbitPropertyId: propertyId, asOf: "2026-08-13", observations: [] });
  assert.equal(signals.composeExplainableSignalScore(emptyFeatures).status, "insufficient-evidence");
  assert.throws(() => observation({ category: "demand", metric: "growth", value: 1, observedAt: "2026-06-03", availableAt: "2026-06-02", source: source("mls", "feed", "bad") }), /availableAt/);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "predictive-signal.schema.json"), "utf8"));
  assert(schema.oneOf.some((item) => item.properties.schemaVersion.const === "wr-point-in-time-feature-set-v1"));
  console.log("White Rabbit leakage-controlled predictive signal tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
