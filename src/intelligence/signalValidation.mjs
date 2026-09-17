export const SIGNAL_BACKTEST_VERSION = "wr-signal-backtest-v1";
export const SIGNAL_DRIFT_REPORT_VERSION = "wr-signal-drift-report-v1";

function iso(value, name) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${name} must be a valid date`);
  return parsed.toISOString();
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function round(value, digits = 4) { return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)); }

function auc(records) {
  const positives = records.filter((item) => item.outcome === 1);
  const negatives = records.filter((item) => item.outcome === 0);
  if (!positives.length || !negatives.length) return null;
  let credit = 0;
  for (const positive of positives) for (const negative of negatives) credit += positive.score > negative.score ? 1 : positive.score === negative.score ? 0.5 : 0;
  return credit / (positives.length * negatives.length);
}

export function backtestSignalScores({ modelId, modelVersion, predictions = [], horizonDays = 365, generatedAt = new Date().toISOString() } = {}) {
  const valid = [];
  const excluded = [];
  const leakageViolations = [];
  for (const [index, input] of predictions.entries()) {
    const id = String(input.id || `prediction-${index + 1}`);
    const score = numeric(input.score);
    const scoredAt = iso(input.scoredAt, "scoredAt");
    const featureSetAsOf = iso(input.featureSetAsOf || scoredAt, "featureSetAsOf");
    const outcomeObservedAt = iso(input.outcomeObservedAt, "outcomeObservedAt");
    const outcome = input.outcome === true || input.outcome === 1 ? 1 : input.outcome === false || input.outcome === 0 ? 0 : null;
    const reasons = [];
    if (score === null || score < 0 || score > 100) reasons.push("invalid-score");
    if (outcome === null) reasons.push("invalid-outcome");
    if (featureSetAsOf > scoredAt) { reasons.push("feature-set-after-score-time"); leakageViolations.push({ predictionId: id, type: "future-feature-set", featureSetAsOf, scoredAt }); }
    if (outcomeObservedAt <= scoredAt) { reasons.push("outcome-not-after-score-time"); leakageViolations.push({ predictionId: id, type: "non-forward-outcome", outcomeObservedAt, scoredAt }); }
    const horizonEnd = new Date(new Date(scoredAt).getTime() + Math.max(1, Number(horizonDays)) * 86400000).toISOString();
    if (outcomeObservedAt > horizonEnd) reasons.push("outcome-outside-horizon");
    if (reasons.length) excluded.push({ predictionId: id, reasons }); else valid.push({ id, score, probability: score / 100, outcome, scoredAt, featureSetAsOf, outcomeObservedAt });
  }
  const positiveCount = valid.filter((item) => item.outcome === 1).length;
  const negativeCount = valid.length - positiveCount;
  const brierScore = valid.length ? mean(valid.map((item) => (item.probability - item.outcome) ** 2)) : null;
  const ranked = [...valid].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topCount = ranked.length ? Math.max(1, Math.ceil(ranked.length * 0.1)) : 0;
  const top = ranked.slice(0, topCount);
  const calibration = Array.from({ length: 5 }, (_, index) => {
    const lower = index * 20; const upper = (index + 1) * 20;
    const records = valid.filter((item) => item.score >= lower && (index === 4 ? item.score <= upper : item.score < upper));
    return { lowerScoreInclusive: lower, upperScoreExclusive: index === 4 ? 101 : upper, count: records.length, meanPredictedProbability: round(mean(records.map((item) => item.probability))), observedOutcomeRate: round(mean(records.map((item) => item.outcome))) };
  });
  return {
    schemaVersion: SIGNAL_BACKTEST_VERSION,
    modelId: String(modelId || ""),
    modelVersion: String(modelVersion || ""),
    generatedAt: iso(generatedAt, "generatedAt"),
    horizonDays: Math.max(1, Number(horizonDays)),
    status: valid.length >= 2 && positiveCount > 0 && negativeCount > 0 ? "evaluated" : "insufficient-sample",
    sample: { submitted: predictions.length, evaluated: valid.length, excluded: excluded.length, positiveCount, negativeCount },
    metrics: { auc: round(auc(valid)), brierScore: round(brierScore), precisionAtTopDecile: top.length ? round(mean(top.map((item) => item.outcome))) : null, topDecileCount: top.length },
    calibration,
    leakageAudit: { passed: leakageViolations.length === 0, violationCount: leakageViolations.length, violations: leakageViolations },
    excluded,
    caveats: ["Backtest metrics describe the supplied sample only.", "Scores are not validated for production use until sample, time-split, geography, and drift gates pass."],
  };
}

function distribution(values, minimum, maximum, binCount) {
  const counts = Array(binCount).fill(0);
  if (!values.length) return counts;
  if (maximum === minimum) { counts[0] = values.length; return counts; }
  for (const value of values) counts[Math.min(binCount - 1, Math.max(0, Math.floor((value - minimum) / (maximum - minimum) * binCount)))] += 1;
  return counts.map((count) => count / values.length);
}

function standardDeviation(values, average) {
  return values.length ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length) : null;
}

export function buildSignalDriftReport({ modelId, modelVersion, features = [], warningPsi = 0.1, alertPsi = 0.25, generatedAt = new Date().toISOString() } = {}) {
  const reports = features.map((feature) => {
    const baselineRaw = Array.isArray(feature.baselineValues) ? feature.baselineValues : [];
    const currentRaw = Array.isArray(feature.currentValues) ? feature.currentValues : [];
    const baseline = baselineRaw.map(numeric).filter((value) => value !== null);
    const current = currentRaw.map(numeric).filter((value) => value !== null);
    const baselineMissingRate = baselineRaw.length ? 1 - baseline.length / baselineRaw.length : 1;
    const currentMissingRate = currentRaw.length ? 1 - current.length / currentRaw.length : 1;
    const all = [...baseline, ...current];
    const minimum = all.length ? Math.min(...all) : 0;
    const maximum = all.length ? Math.max(...all) : 0;
    const baselineDistribution = distribution(baseline, minimum, maximum, 10);
    const currentDistribution = distribution(current, minimum, maximum, 10);
    const epsilon = 0.0001;
    const psi = baseline.length && current.length ? baselineDistribution.reduce((sum, baselinePct, index) => { const base = Math.max(epsilon, baselinePct); const next = Math.max(epsilon, currentDistribution[index]); return sum + (next - base) * Math.log(next / base); }, 0) : null;
    const baselineMean = mean(baseline); const currentMean = mean(current);
    const baselineStdDev = baselineMean === null ? null : standardDeviation(baseline, baselineMean);
    const standardizedMeanShift = baselineMean !== null && currentMean !== null && baselineStdDev > 0 ? (currentMean - baselineMean) / baselineStdDev : null;
    const missingRateDelta = currentMissingRate - baselineMissingRate;
    const status = psi === null ? "insufficient-evidence" : psi >= alertPsi || Math.abs(missingRateDelta) >= 0.2 ? "alert" : psi >= warningPsi || Math.abs(missingRateDelta) >= 0.1 ? "warning" : "stable";
    return { featureId: String(feature.featureId || ""), status, baselineCount: baselineRaw.length, currentCount: currentRaw.length, baselineMissingRate: round(baselineMissingRate), currentMissingRate: round(currentMissingRate), missingRateDelta: round(missingRateDelta), baselineMean: round(baselineMean), currentMean: round(currentMean), standardizedMeanShift: round(standardizedMeanShift), populationStabilityIndex: round(psi), bins: baselineDistribution.map((baselinePct, index) => ({ index, baselinePct: round(baselinePct), currentPct: round(currentDistribution[index]) })) };
  });
  return { schemaVersion: SIGNAL_DRIFT_REPORT_VERSION, modelId: String(modelId || ""), modelVersion: String(modelVersion || ""), generatedAt: iso(generatedAt, "generatedAt"), status: reports.some((item) => item.status === "alert") ? "alert" : reports.some((item) => item.status === "warning") ? "warning" : reports.every((item) => item.status === "stable") ? "stable" : "insufficient-evidence", thresholds: { warningPsi, alertPsi, warningMissingRateDelta: 0.1, alertMissingRateDelta: 0.2 }, features: reports, action: reports.some((item) => item.status === "alert") ? "Pause automated use and investigate source/model drift." : reports.some((item) => item.status === "warning") ? "Review drift before the next activation decision." : "No drift action required by configured thresholds." };
}
