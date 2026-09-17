export const SIGNAL_MODEL_VERSION = "wr-predictive-signal-model-v1";
export const SIGNAL_OBSERVATION_VERSION = "wr-market-signal-observation-v1";
export const POINT_IN_TIME_FEATURE_SET_VERSION = "wr-point-in-time-feature-set-v1";
export const EXPLAINABLE_SIGNAL_SCORE_VERSION = "wr-explainable-signal-score-v1";

const CATEGORIES = Object.freeze(["ownership-transfer", "distress", "entitlement", "infrastructure", "demand"]);

function hash(seed) {
  let value = 2166136261;
  for (const character of String(seed)) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(36);
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name, allowEmpty = false) {
  if (allowEmpty && !value) return "";
  const parsed = new Date(value || Date.now());
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${name} must be a valid date`);
  return parsed.toISOString();
}

function propertyId(value) {
  const id = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return id;
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, minimum = 0, maximum = 1) { return Math.max(minimum, Math.min(maximum, value)); }
function round(value, digits = 3) { return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)); }

function definition(input = {}) {
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) throw new TypeError(`Unsupported signal category: ${input.category}`);
  const metric = required(input.metric, "metric");
  const normalization = input.normalization || {};
  const minimum = numeric(normalization.minimum);
  const maximum = numeric(normalization.maximum);
  const mapping = normalization.mapping && typeof normalization.mapping === "object" ? { ...normalization.mapping } : null;
  if (!mapping && (minimum === null || maximum === null || maximum <= minimum)) throw new TypeError(`${metric} requires a valid normalization range or mapping`);
  return {
    id: String(input.id || `${category}:${metric}`),
    category,
    metric,
    label: String(input.label || metric),
    unit: String(input.unit || ""),
    polarity: input.polarity === "negative" ? "negative" : "positive",
    weight: Math.max(0.01, Math.min(100, Number(input.weight ?? 1))),
    normalization: { method: mapping ? "categorical-map" : "clip-linear", minimum, maximum, invert: Boolean(normalization.invert), mapping },
    expectedSourceTypes: [...new Set((input.expectedSourceTypes || []).map(String).filter(Boolean))],
  };
}

export function createPredictiveSignalModel(input = {}) {
  const definitions = (input.definitions || []).map(definition);
  if (!definitions.length) throw new TypeError("At least one signal definition is required");
  const ids = definitions.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new TypeError("Signal definition IDs must be unique");
  return { schemaVersion: SIGNAL_MODEL_VERSION, id: required(input.id, "id"), version: required(input.version, "version"), definitions, createdAt: iso(input.createdAt, "createdAt"), intendedOutcome: String(input.intendedOutcome || ""), horizonDays: Math.max(1, Math.trunc(Number(input.horizonDays ?? 365))), status: input.status === "validated" ? "validated" : "experimental" };
}

export function createSignalObservation(input = {}) {
  const effectiveAt = iso(input.effectiveAt, "effectiveAt");
  const observedAt = iso(input.observedAt || effectiveAt, "observedAt");
  const availableAt = iso(input.availableAt || observedAt, "availableAt");
  const expiresAt = iso(input.expiresAt, "expiresAt", true);
  if (expiresAt && expiresAt < effectiveAt) throw new TypeError("expiresAt cannot be before effectiveAt");
  if (availableAt < observedAt) throw new TypeError("availableAt cannot be before observedAt");
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) throw new TypeError(`Unsupported signal category: ${input.category}`);
  const metric = required(input.metric, "metric");
  const source = input.source || {};
  return {
    schemaVersion: SIGNAL_OBSERVATION_VERSION,
    id: String(input.id || `signal_${hash(`${input.whiteRabbitPropertyId}|${category}|${metric}|${effectiveAt}|${source.datasetId}|${source.recordId}`)}`),
    whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId),
    category,
    metric,
    value: input.value ?? null,
    normalizedValue: numeric(input.normalizedValue),
    unit: String(input.unit || ""),
    effectiveAt,
    observedAt,
    availableAt,
    expiresAt,
    confidence: clamp(Number(input.confidence ?? 1)),
    source: { sourceType: String(source.sourceType || "unknown"), datasetId: required(source.datasetId, "source.datasetId"), recordId: required(source.recordId, "source.recordId"), lineage: source.lineage || null },
  };
}

function normalizeValue(observation, itemDefinition) {
  if (observation.normalizedValue !== null) return clamp(observation.normalizedValue);
  if (itemDefinition.normalization.method === "categorical-map") {
    const mapped = numeric(itemDefinition.normalization.mapping[String(observation.value)]);
    return mapped === null ? null : clamp(itemDefinition.normalization.invert ? 1 - mapped : mapped);
  }
  const value = numeric(observation.value);
  if (value === null) return null;
  const normalized = clamp((value - itemDefinition.normalization.minimum) / (itemDefinition.normalization.maximum - itemDefinition.normalization.minimum));
  return itemDefinition.normalization.invert ? 1 - normalized : normalized;
}

export function assemblePointInTimeFeatures({ model: modelInput, whiteRabbitPropertyId, asOf, observations = [] } = {}) {
  const model = modelInput?.schemaVersion === SIGNAL_MODEL_VERSION ? modelInput : createPredictiveSignalModel(modelInput);
  const id = propertyId(whiteRabbitPropertyId);
  const pointInTime = iso(asOf, "asOf");
  const definitions = new Map(model.definitions.map((item) => [item.id, item]));
  const normalized = observations.map(createSignalObservation);
  const eligible = [];
  const excluded = [];
  for (const observation of normalized) {
    const key = `${observation.category}:${observation.metric}`;
    const reasons = [];
    if (observation.whiteRabbitPropertyId !== id) reasons.push("different-property");
    if (!definitions.has(key) && !model.definitions.some((item) => item.category === observation.category && item.metric === observation.metric)) reasons.push("undefined-feature");
    if (observation.effectiveAt > pointInTime) reasons.push("future-effective-date");
    if (observation.observedAt > pointInTime) reasons.push("future-observation-date");
    if (observation.availableAt > pointInTime) reasons.push("future-availability-date");
    if (observation.expiresAt && observation.expiresAt < pointInTime) reasons.push("expired-before-as-of");
    if (reasons.length) excluded.push({ observationId: observation.id, reasons }); else eligible.push(observation);
  }
  const features = [];
  for (const itemDefinition of model.definitions) {
    const candidates = eligible.filter((item) => item.category === itemDefinition.category && item.metric === itemDefinition.metric).sort((a, b) => b.availableAt.localeCompare(a.availableAt) || b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));
    const selected = candidates[0] || null;
    const normalizedValue = selected ? normalizeValue(selected, itemDefinition) : null;
    const sourceAllowed = !selected || !itemDefinition.expectedSourceTypes.length || itemDefinition.expectedSourceTypes.includes(selected.source.sourceType);
    features.push({ definition: itemDefinition, status: !selected ? "missing" : !sourceAllowed ? "unexpected-source" : normalizedValue === null ? "unusable" : "available", normalizedValue: sourceAllowed ? round(normalizedValue) : null, observation: selected, supersededObservationIds: candidates.slice(1).map((item) => item.id) });
  }
  const availableCount = features.filter((item) => item.status === "available").length;
  return {
    schemaVersion: POINT_IN_TIME_FEATURE_SET_VERSION,
    modelId: model.id,
    modelVersion: model.version,
    whiteRabbitPropertyId: id,
    asOf: pointInTime,
    status: availableCount === 0 ? "insufficient-evidence" : availableCount === features.length ? "complete" : "partial",
    features,
    missingFeatureIds: features.filter((item) => item.status !== "available").map((item) => item.definition.id),
    leakageAudit: { passed: !excluded.some((item) => item.reasons.some((reason) => reason.startsWith("future-"))), excludedObservationCount: excluded.length, excluded },
    model,
  };
}

function scoreBand(score, confidence) {
  if (score === null) return null;
  const margin = (1 - confidence) * 25;
  return { lower: round(clamp(score - margin, 0, 100), 1), upper: round(clamp(score + margin, 0, 100), 1), method: "heuristic evidence-confidence band; not a statistical confidence interval" };
}

export function composeExplainableSignalScore(featureSet) {
  if (!featureSet || featureSet.schemaVersion !== POINT_IN_TIME_FEATURE_SET_VERSION) throw new TypeError("A wr-point-in-time-feature-set-v1 feature set is required");
  const available = featureSet.features.filter((item) => item.status === "available");
  const totalWeight = featureSet.features.reduce((sum, item) => sum + item.definition.weight, 0);
  const availableWeight = available.reduce((sum, item) => sum + item.definition.weight, 0);
  const byPolarity = (polarity) => available.filter((item) => item.definition.polarity === polarity);
  const calculate = (items) => {
    const weight = items.reduce((sum, item) => sum + item.definition.weight, 0);
    return weight ? items.reduce((sum, item) => sum + item.normalizedValue * item.definition.weight * item.observation.confidence, 0) / weight * 100 : null;
  };
  const opportunityScore = calculate(byPolarity("positive"));
  const riskScore = calculate(byPolarity("negative"));
  const coverage = totalWeight ? availableWeight / totalWeight : 0;
  const evidenceConfidence = availableWeight ? available.reduce((sum, item) => sum + item.definition.weight * item.observation.confidence, 0) / availableWeight : 0;
  const effectiveConfidence = coverage * evidenceConfidence;
  const netScore = opportunityScore !== null && riskScore !== null ? clamp(50 + (opportunityScore - riskScore) / 2, 0, 100) : null;
  const factors = available.map((item) => ({ id: item.definition.id, category: item.definition.category, label: item.definition.label, polarity: item.definition.polarity, normalizedValue: item.normalizedValue, weight: item.definition.weight, confidence: item.observation.confidence, weightedEvidence: round(item.normalizedValue * item.definition.weight * item.observation.confidence), source: item.observation.source, effectiveAt: item.observation.effectiveAt, availableAt: item.observation.availableAt }));
  return {
    schemaVersion: EXPLAINABLE_SIGNAL_SCORE_VERSION,
    modelId: featureSet.modelId,
    modelVersion: featureSet.modelVersion,
    whiteRabbitPropertyId: featureSet.whiteRabbitPropertyId,
    asOf: featureSet.asOf,
    status: !available.length ? "insufficient-evidence" : featureSet.status === "complete" ? "scored" : "scored-with-missing-evidence",
    opportunityScore: round(opportunityScore, 1),
    riskScore: round(riskScore, 1),
    netScore: round(netScore, 1),
    evidenceCoveragePct: round(coverage * 100, 1),
    evidenceConfidence: round(evidenceConfidence, 3),
    effectiveConfidence: round(effectiveConfidence, 3),
    bands: { opportunity: scoreBand(opportunityScore, effectiveConfidence), risk: scoreBand(riskScore, effectiveConfidence), net: scoreBand(netScore, effectiveConfidence) },
    factors,
    missingFeatureIds: featureSet.missingFeatureIds,
    leakageAudit: featureSet.leakageAudit,
    scoringRule: "Polarity-specific weighted mean of normalized evidence multiplied by source confidence; net score requires both positive and negative evidence.",
    validationStatus: featureSet.model.status,
  };
}
