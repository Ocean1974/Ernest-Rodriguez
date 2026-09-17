export const OPPORTUNITY_SIGNAL_VERSION = "wr-opportunity-signal-v1";

function numberValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function acres(parcel) {
  const size = numberValue(parcel?.landAreaSize);
  const unit = String(parcel?.landAreaUnit || "").toLowerCase();
  if (size !== null && /acre|\bac\b/.test(unit)) return size;
  const squareFeet = numberValue(parcel?.landAreaSqFt);
  return squareFeet === null ? null : squareFeet / 43560;
}

function factor(id, label, points, confidence, evidence, sourceFields) {
  return { id, label, points, confidence, evidence, sourceFields };
}

function ageDays(value, observedAt) {
  const activity = Date.parse(String(value || ""));
  const observed = Date.parse(String(observedAt || ""));
  if (!Number.isFinite(activity) || !Number.isFinite(observed)) return null;
  return Math.max(0, Math.floor((observed - activity) / 86400000));
}

export function buildOpportunitySignals({ parcel = {}, permits = null, development = null, observedAt = new Date().toISOString() } = {}) {
  const factors = [];
  const landValue = numberValue(parcel.landValue);
  const improvementValue = numberValue(parcel.improvementValue);
  const totalValue = numberValue(parcel.totalValue);
  const landAcres = acres(parcel);
  const yearBuilt = numberValue(parcel.yearBuilt);
  const owner = [parcel.ownerName, parcel.ownerName2, parcel.businessName, parcel.propertyName].filter(Boolean).join(" ").toUpperCase();
  const tenure = numberValue(parcel.ownershipTenureYears);

  if (landValue !== null && improvementValue !== null && landValue > 0 && improvementValue / landValue <= 0.25) factors.push(factor("low-improvement-to-land", "Low improvement value relative to land", 24, 0.94, { landValue, improvementValue, ratio: Number((improvementValue / landValue).toFixed(3)) }, ["landValue", "improvementValue"]));
  if (landAcres !== null && landAcres >= 5) factors.push(factor("large-site", "Site is at least five acres", 15, 0.98, { landAcres: Number(landAcres.toFixed(3)) }, ["landAreaSize", "landAreaUnit", "landAreaSqFt"]));
  if (yearBuilt !== null && yearBuilt > 0 && yearBuilt <= 1980) factors.push(factor("older-improvements", "Improvements were built in or before 1980", 10, 0.9, { yearBuilt }, ["yearBuilt"]));
  if (/\b(L\.?L\.?C\.?|INC|CORP|CORPORATION|LP|LLP|PARTNERSHIP)\b/.test(owner)) factors.push(factor("entity-owner", "Owner appears to be a business entity", 7, 0.82, { owner }, ["ownerName", "ownerName2", "businessName", "propertyName"]));
  if (tenure !== null && tenure >= 10) factors.push(factor("long-ownership", "Ownership tenure is at least ten years", 16, 0.9, { ownershipTenureYears: tenure }, ["ownershipTenureYears"]));
  if (Array.isArray(permits) && permits.length === 0) factors.push(factor("no-linked-permits", "No linked permit activity in the supplied evidence window", 8, 0.7, { permitCount: 0 }, ["permits"]));
  const developmentAgeDays = ageDays(development?.latestActivityDate, observedAt);
  if (development?.signalCount > 0 && developmentAgeDays !== null && developmentAgeDays <= 730) factors.push(factor("development-momentum", "Joined development activity occurred within the last two years", Math.min(20, 8 + Number(development.signalCount || 0) * 2), 0.86, { signalCount: development.signalCount, signalTypes: development.signalTypes || [], latestActivityDate: development.latestActivityDate || "", activityAgeDays: developmentAgeDays, maximumAgeDays: 730 }, ["development.signalCount", "development.signalTypes", "development.latestActivityDate"]));

  const score = Math.min(100, factors.reduce((sum, item) => sum + item.points, 0));
  const missingEvidence = [landValue === null ? "landValue" : "", improvementValue === null ? "improvementValue" : "", landAcres === null ? "landArea" : "", tenure === null ? "ownershipTenureYears" : "", Array.isArray(permits) ? "" : "permits"].filter(Boolean);
  return {
    schemaVersion: OPPORTUNITY_SIGNAL_VERSION,
    whiteRabbitPropertyId: String(parcel.whiteRabbitPropertyId || ""),
    observedAt,
    score,
    tier: score >= 70 ? "high" : score >= 40 ? "medium" : score > 0 ? "emerging" : "insufficient-evidence",
    factors,
    missingEvidence,
    explanation: factors.map((item) => `${item.label} (+${item.points})`),
    scoringRule: "Additive factor points capped at 100; every point must have factor-level evidence; development momentum expires after 730 days.",
    sourceLineage: parcel.dataLineage || null,
  };
}
