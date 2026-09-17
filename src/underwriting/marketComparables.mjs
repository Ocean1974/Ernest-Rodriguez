export const MARKET_COMPARABLE_VERSION = "wr-market-comparable-v1";
export const COMPARABLE_ANALYSIS_VERSION = "wr-comparable-analysis-v1";
export const COMPARABLE_ADJUSTMENT_VERSION = "wr-comparable-adjustment-v1";
export const COMPARABLE_DERIVED_ASSUMPTION_VERSION = "wr-comparable-derived-assumption-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function number(value, name, { minimum = -Infinity, allowNull = false } = {}) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new TypeError(`${name} must be a number${Number.isFinite(minimum) ? ` >= ${minimum}` : ""}`);
  return parsed;
}

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function canonicalPropertyId(value, requiredField = false) {
  const normalized = String(value || "");
  if (!normalized && !requiredField) return "";
  if (!/^wrp:v1:[^:]+:.+$/.test(normalized)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return normalized;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

export function createMarketComparable(input = {}) {
  const comparableType = input.comparableType === "rent" ? "rent" : "sale";
  const location = { latitude: number(input.location?.latitude, "location.latitude"), longitude: number(input.location?.longitude, "location.longitude") };
  if (Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) throw new TypeError("Comparable coordinates are outside valid bounds");
  const economics = {
    salePrice: comparableType === "sale" ? number(input.economics?.salePrice, "economics.salePrice", { minimum: 0.01 }) : null,
    annualRent: comparableType === "rent" ? number(input.economics?.annualRent, "economics.annualRent", { minimum: 0.01 }) : null,
    buildingSqFt: number(input.economics?.buildingSqFt, "economics.buildingSqFt", { minimum: 0.01 }),
  };
  const source = {
    datasetId: required(input.source?.datasetId, "source.datasetId"),
    recordId: required(input.source?.recordId, "source.recordId"),
    sourceUrl: String(input.source?.sourceUrl || ""),
    licenseId: required(input.source?.licenseId, "source.licenseId"),
    licenseStatus: ["authorized", "restricted", "expired", "unknown"].includes(input.source?.licenseStatus) ? input.source.licenseStatus : "unknown",
    observedAt: iso(input.source?.observedAt, "source.observedAt"),
    availableAt: iso(input.source?.availableAt, "source.availableAt"),
    expiresAt: input.source?.expiresAt ? iso(input.source.expiresAt, "source.expiresAt") : "",
    sourceFields: { ...(input.source?.sourceFields || {}) },
  };
  if (new Date(source.availableAt) < new Date(source.observedAt)) throw new TypeError("source.availableAt cannot precede source.observedAt");
  return Object.freeze({
    schemaVersion: MARKET_COMPARABLE_VERSION,
    id: required(input.id, "id"),
    comparableType,
    whiteRabbitPropertyId: canonicalPropertyId(input.whiteRabbitPropertyId),
    propertyType: required(input.propertyType, "propertyType").toLowerCase(),
    transactionDate: iso(input.transactionDate, "transactionDate"),
    location,
    economics,
    yearBuilt: number(input.yearBuilt, "yearBuilt", { minimum: 1700, allowNull: true }),
    unitCount: number(input.unitCount, "unitCount", { minimum: 0, allowNull: true }),
    source,
  });
}

function distanceMiles(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function adjustmentEnvelope(input, name) {
  const value = Number(input?.value);
  if (!Number.isFinite(value) || !String(input?.source || "") || !input?.asOf || !Number.isFinite(new Date(input.asOf).getTime())) return null;
  return { value, source: String(input.source), sourceField: String(input.sourceField || name), asOf: iso(input.asOf, `${name}.asOf`) };
}

function selectionScore({ distance, ageDays, sizeRatio, yearDifference, maxDistanceMiles, maxAgeDays }) {
  const factors = {
    distance: Math.max(0, 1 - distance / maxDistanceMiles),
    recency: Math.max(0, 1 - ageDays / maxAgeDays),
    sizeSimilarity: Math.max(0, 1 - Math.min(1, Math.abs(Math.log(sizeRatio)))),
    ageSimilarity: yearDifference === null ? 0.5 : Math.max(0, 1 - Math.min(1, yearDifference / 50)),
    propertyType: 1,
  };
  const weights = { distance: 0.3, recency: 0.25, sizeSimilarity: 0.25, ageSimilarity: 0.1, propertyType: 0.1 };
  return { factors, weights, total: Object.keys(weights).reduce((sum, key) => sum + factors[key] * weights[key], 0) };
}

export function analyzeMarketComparables(input = {}) {
  const analysisAsOf = iso(input.analysisAsOf, "analysisAsOf");
  const subject = {
    whiteRabbitPropertyId: canonicalPropertyId(input.subject?.whiteRabbitPropertyId, true),
    propertyType: required(input.subject?.propertyType, "subject.propertyType").toLowerCase(),
    location: { latitude: number(input.subject?.location?.latitude, "subject.location.latitude"), longitude: number(input.subject?.location?.longitude, "subject.location.longitude") },
    buildingSqFt: number(input.subject?.buildingSqFt, "subject.buildingSqFt", { minimum: 0.01 }),
    yearBuilt: number(input.subject?.yearBuilt, "subject.yearBuilt", { minimum: 1700, allowNull: true }),
  };
  const analysisType = input.analysisType === "rent" ? "rent" : "sale";
  const policy = {
    maxDistanceMiles: Math.max(0.1, Number(input.selectionPolicy?.maxDistanceMiles) || 10),
    maxAgeDays: Math.max(1, Number(input.selectionPolicy?.maxAgeDays) || 365),
    minComparableCount: Math.max(1, Math.trunc(Number(input.selectionPolicy?.minComparableCount) || 3)),
    maxComparableCount: Math.max(1, Math.trunc(Number(input.selectionPolicy?.maxComparableCount) || 8)),
  };
  const excluded = [];
  const candidates = [];
  for (const raw of input.comparables || []) {
    let comparable;
    try { comparable = createMarketComparable(raw); } catch (error) {
      excluded.push({ id: String(raw?.id || "unknown"), reasons: [`invalid-record: ${error.message}`] });
      continue;
    }
    const reasons = [];
    const availableAtMs = new Date(comparable.source.availableAt).getTime();
    const observedAtMs = new Date(comparable.source.observedAt).getTime();
    const transactionMs = new Date(comparable.transactionDate).getTime();
    const analysisMs = new Date(analysisAsOf).getTime();
    const ageDays = (analysisMs - transactionMs) / 86400000;
    const distance = distanceMiles(subject.location, comparable.location);
    if (comparable.comparableType !== analysisType) reasons.push("wrong-comparable-type");
    if (comparable.propertyType !== subject.propertyType) reasons.push("property-type-mismatch");
    if (comparable.source.licenseStatus !== "authorized") reasons.push(`license-${comparable.source.licenseStatus}`);
    if (comparable.source.expiresAt && new Date(comparable.source.expiresAt).getTime() <= analysisMs) reasons.push("license-expired-as-of-analysis");
    if (availableAtMs > analysisMs || observedAtMs > analysisMs || transactionMs > analysisMs) reasons.push("future-evidence");
    if (ageDays < 0 || ageDays > policy.maxAgeDays) reasons.push("outside-freshness-window");
    if (distance > policy.maxDistanceMiles) reasons.push("outside-distance-window");
    if (reasons.length) { excluded.push({ id: comparable.id, reasons }); continue; }
    const sizeRatio = comparable.economics.buildingSqFt / subject.buildingSqFt;
    const yearDifference = subject.yearBuilt === null || comparable.yearBuilt === null ? null : Math.abs(subject.yearBuilt - comparable.yearBuilt);
    const score = selectionScore({ distance, ageDays, sizeRatio, yearDifference, maxDistanceMiles: policy.maxDistanceMiles, maxAgeDays: policy.maxAgeDays });
    const rawUnitValue = analysisType === "sale" ? comparable.economics.salePrice / comparable.economics.buildingSqFt : comparable.economics.annualRent / comparable.economics.buildingSqFt;
    candidates.push({ comparable, distanceMiles: round(distance), ageDays: round(ageDays, 3), sizeRatio: round(sizeRatio), rawUnitValue: round(rawUnitValue), selectionScore: { factors: Object.fromEntries(Object.entries(score.factors).map(([key, value]) => [key, round(value)])), weights: score.weights, total: round(score.total) } });
  }
  candidates.sort((a, b) => b.selectionScore.total - a.selectionScore.total || a.comparable.id.localeCompare(b.comparable.id));
  const selected = candidates.slice(0, policy.maxComparableCount);
  for (const candidate of candidates.slice(policy.maxComparableCount)) excluded.push({ id: candidate.comparable.id, reasons: ["below-selection-cutoff"] });
  const adjustmentPolicy = {
    annualMarketGrowthPct: adjustmentEnvelope(input.adjustmentPolicy?.annualMarketGrowthPct, "annualMarketGrowthPct"),
    sizeElasticityPct: adjustmentEnvelope(input.adjustmentPolicy?.sizeElasticityPct, "sizeElasticityPct"),
    ageAdjustmentPctPerYear: adjustmentEnvelope(input.adjustmentPolicy?.ageAdjustmentPctPerYear, "ageAdjustmentPctPerYear"),
    maxAbsAdjustmentPct: Math.max(1, Math.min(100, Number(input.adjustmentPolicy?.maxAbsAdjustmentPct) || 50)),
  };
  const futureAdjustmentEvidence = [];
  for (const key of ["annualMarketGrowthPct", "sizeElasticityPct", "ageAdjustmentPctPerYear"]) {
    if (adjustmentPolicy[key] && new Date(adjustmentPolicy[key].asOf) > new Date(analysisAsOf)) {
      futureAdjustmentEvidence.push(key);
      adjustmentPolicy[key] = null;
    }
  }
  const missingAdjustmentEvidence = Object.entries(adjustmentPolicy).filter(([key, value]) => key !== "maxAbsAdjustmentPct" && !value).map(([key]) => key);
  const adjusted = selected.map((candidate) => {
    if (missingAdjustmentEvidence.length) return { ...candidate, adjustment: null };
    const comparable = candidate.comparable;
    const elapsedYears = candidate.ageDays / 365.25;
    const timePct = adjustmentPolicy.annualMarketGrowthPct.value * elapsedYears;
    const sizePct = ((subject.buildingSqFt - comparable.economics.buildingSqFt) / comparable.economics.buildingSqFt) * adjustmentPolicy.sizeElasticityPct.value;
    const agePct = subject.yearBuilt === null || comparable.yearBuilt === null ? 0 : (subject.yearBuilt - comparable.yearBuilt) * adjustmentPolicy.ageAdjustmentPctPerYear.value;
    const unclampedPct = timePct + sizePct + agePct;
    const totalPct = Math.max(-adjustmentPolicy.maxAbsAdjustmentPct, Math.min(adjustmentPolicy.maxAbsAdjustmentPct, unclampedPct));
    const adjustedUnitValue = candidate.rawUnitValue * (1 + totalPct / 100);
    return { ...candidate, adjustment: { schemaVersion: COMPARABLE_ADJUSTMENT_VERSION, lines: [
      { factor: "time", adjustmentPct: round(timePct), formula: "annualMarketGrowthPct * elapsedYears", evidence: adjustmentPolicy.annualMarketGrowthPct },
      { factor: "size", adjustmentPct: round(sizePct), formula: "((subjectSqFt - comparableSqFt) / comparableSqFt) * sizeElasticityPct", evidence: adjustmentPolicy.sizeElasticityPct },
      { factor: "age", adjustmentPct: round(agePct), formula: "(subjectYearBuilt - comparableYearBuilt) * ageAdjustmentPctPerYear", evidence: adjustmentPolicy.ageAdjustmentPctPerYear },
    ], unclampedAdjustmentPct: round(unclampedPct), totalAdjustmentPct: round(totalPct), capped: totalPct !== unclampedPct, adjustedUnitValue: round(adjustedUnitValue) } };
  });
  const enough = selected.length >= policy.minComparableCount;
  const fullyAdjusted = enough && !missingAdjustmentEvidence.length;
  let estimate = null;
  if (fullyAdjusted) {
    const totalWeight = adjusted.reduce((sum, item) => sum + item.selectionScore.total, 0);
    const weightedUnitValue = adjusted.reduce((sum, item) => sum + item.adjustment.adjustedUnitValue * item.selectionScore.total, 0) / totalWeight;
    const values = adjusted.map((item) => item.adjustment.adjustedUnitValue);
    const averageScore = adjusted.reduce((sum, item) => sum + item.selectionScore.total, 0) / adjusted.length;
    estimate = { unit: analysisType === "sale" ? "usd_per_sqft" : "usd_per_sqft_year", weightedUnitValue: round(weightedUnitValue), indicatedSubjectValue: round(weightedUnitValue * subject.buildingSqFt, 2), range: { low: round(Math.min(...values)), high: round(Math.max(...values)) }, evidenceCoverage: round(Math.min(1, selected.length / policy.minComparableCount) * averageScore), evidenceCoverageLabel: "deterministic evidence coverage, not a statistical confidence interval" };
  }
  const warnings = [];
  if (!enough) warnings.push(`Only ${selected.length} eligible comparables; ${policy.minComparableCount} required.`);
  if (missingAdjustmentEvidence.length) warnings.push(`Missing adjustment evidence: ${missingAdjustmentEvidence.join(", ")}`);
  if (futureAdjustmentEvidence.length) warnings.push(`Future adjustment evidence excluded: ${futureAdjustmentEvidence.join(", ")}`);
  return {
    schemaVersion: COMPARABLE_ANALYSIS_VERSION,
    analysisType,
    analysisAsOf,
    subject,
    selectionPolicy: policy,
    adjustmentPolicy,
    status: fullyAdjusted ? "adjusted-estimate" : enough ? "evidence-selected" : "insufficient-evidence",
    selected: adjusted,
    excluded,
    estimate,
    missingAdjustmentEvidence,
    futureAdjustmentEvidence,
    warnings,
    formulas: ["selection score = weighted distance + recency + size similarity + age similarity + property type", "adjusted unit value = raw unit value * (1 + total adjustment percent)", "indicated subject value = weighted adjusted unit value * subject building square feet"],
  };
}

export function deriveUnderwritingAssumptions(baseInput = {}, analyses = {}) {
  const next = { ...baseInput };
  const references = {};
  const rent = analyses.rent;
  if ((next.rentPerSqFtAnnual === null || next.rentPerSqFtAnnual === undefined || next.rentPerSqFtAnnual === "") && rent?.status === "adjusted-estimate") {
    next.rentPerSqFtAnnual = { value: rent.estimate.weightedUnitValue, unit: "usd_per_sqft_year", source: "white-rabbit-comparable-analysis", sourceField: "estimate.weightedUnitValue", asOf: rent.analysisAsOf, confidence: rent.estimate.evidenceCoverage };
    references.rent = { schemaVersion: COMPARABLE_DERIVED_ASSUMPTION_VERSION, analysisVersion: rent.schemaVersion, analysisAsOf: rent.analysisAsOf, selectedComparableIds: rent.selected.map((item) => item.comparable.id), evidenceCoverage: rent.estimate.evidenceCoverage };
  }
  const sale = analyses.sale;
  if (sale?.status === "adjusted-estimate") references.sale = { schemaVersion: COMPARABLE_DERIVED_ASSUMPTION_VERSION, indicatedMarketValue: sale.estimate.indicatedSubjectValue, analysisAsOf: sale.analysisAsOf, selectedComparableIds: sale.selected.map((item) => item.comparable.id), evidenceCoverage: sale.estimate.evidenceCoverage, purchasePriceOverwritten: false };
  return { schemaVersion: COMPARABLE_DERIVED_ASSUMPTION_VERSION, assumptions: next, references };
}
