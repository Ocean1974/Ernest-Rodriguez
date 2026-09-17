function positiveNumber(value) {
  const number = typeof value === "string" ? Number(value.replace(/[$,%\s,]/g, "")) : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function parseListingCoordinates(value) {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => Number.isFinite(Number(item)))) return [Number(value[0]), Number(value[1])];
  const numbers = String(value || "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (numbers.length < 2) return null;
  const [first, second] = numbers;
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return [second, first];
  return Math.abs(first) <= 180 && Math.abs(second) <= 90 ? [first, second] : null;
}

function distanceMiles(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function calculateNearbyDevelopmentImpact(propertyCoordinates, developments = []) {
  const origin = parseListingCoordinates(propertyCoordinates);
  if (!origin) return { adjustment: 0, nearbyCount: 0, majorCount: 0, basis: "Nearby development unavailable until parcel coordinates are provided", records: [] };
  const nearby = developments.map((record) => {
    const coordinates = parseListingCoordinates(record.coordinates || record.centroid || [record.longitude, record.latitude]);
    if (!coordinates) return null;
    const miles = distanceMiles(origin, coordinates);
    if (miles > 0.5) return null;
    const scale = record.scale === "major" ? 15 : record.scale === "medium" ? 7 : 3;
    const distanceWeight = miles <= 0.1 ? 1 : miles <= 0.25 ? 0.7 : 0.35;
    const evidenceWeight = record.evidenceStrength === "verified-construction" ? 1 : record.evidenceStrength === "issued-permit" ? 0.8 : 0.45;
    const direction = record.impact === "negative" ? -1 : record.impact === "neutral" ? 0 : 1;
    return { ...record, distanceMiles: Number(miles.toFixed(2)), points: scale * distanceWeight * evidenceWeight * direction };
  }).filter(Boolean).sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const adjustment = Math.round(clamp(nearby.reduce((sum, record) => sum + record.points, 0), -20, 20));
  const majorCount = nearby.filter((record) => record.scale === "major").length;
  return {
    adjustment,
    nearbyCount: nearby.length,
    majorCount,
    basis: nearby.length ? `${nearby.length} development signal${nearby.length === 1 ? "" : "s"} within 0.5 mile${majorCount ? ` · ${majorCount} major` : ""} · ${adjustment >= 0 ? "+" : ""}${adjustment} points` : "No verified nearby development signals within 0.5 mile",
    records: nearby,
  };
}

export function calculateListingDeal(property, options = {}) {
  const askingPrice = positiveNumber(property.askingPrice);
  const estimatedMarketValue = positiveNumber(property.estimatedMarketValue);
  const monthlyRent = positiveNumber(property.monthlyRent);
  const marketMonthlyRent = positiveNumber(property.marketMonthlyRent);
  const monthlyExpenses = positiveNumber(property.monthlyExpenses) || 0;
  const annualNoi = positiveNumber(property.annualNoi);
  const discountSignals = [];
  const basis = [];

  if (askingPrice && estimatedMarketValue) {
    const discountPct = ((estimatedMarketValue - askingPrice) / estimatedMarketValue) * 100;
    discountSignals.push(discountPct);
    basis.push(`${Math.abs(discountPct).toFixed(1)}% ${discountPct >= 0 ? "below" : "above"} estimated value`);
  }
  if (monthlyRent && marketMonthlyRent) {
    const rentDiscountPct = ((marketMonthlyRent - monthlyRent) / marketMonthlyRent) * 100;
    discountSignals.push(rentDiscountPct);
    basis.push(`${Math.abs(rentDiscountPct).toFixed(1)}% ${rentDiscountPct >= 0 ? "below" : "above"} market rent`);
  }

  const discountPct = discountSignals.length
    ? discountSignals.reduce((sum, value) => sum + value, 0) / discountSignals.length
    : 0;
  const derivedAnnualNoi = annualNoi || (monthlyRent ? Math.max(0, monthlyRent - monthlyExpenses) * 12 : null);
  const yieldPct = askingPrice && derivedAnnualNoi ? (derivedAnnualNoi / askingPrice) * 100 : null;
  if (yieldPct !== null) basis.push(`${yieldPct.toFixed(1)}% annual income yield`);

  const discountAdjustment = clamp(discountPct * 1.5, -45, 45);
  const yieldAdjustment = yieldPct === null ? 0 : clamp((yieldPct - 6) * 3, -20, 20);
  const development = calculateNearbyDevelopmentImpact(property.coordinates, options.nearbyDevelopments || []);
  const score = Math.round(clamp(50 + discountAdjustment + yieldAdjustment + development.adjustment, 0, 100));
  const label = score >= 80 ? "Great Deal" : score >= 65 ? "Good Deal" : score >= 45 ? "Fair Deal" : "Not Ready to Sell";

  return {
    score,
    label,
    discountPct: Number(discountPct.toFixed(2)),
    yieldPct: yieldPct === null ? null : Number(yieldPct.toFixed(2)),
    hasPricingEvidence: discountSignals.length > 0 || yieldPct !== null,
    basis: basis.length ? basis.join(" · ") : "Limited pricing data; neutral 50-point baseline",
    development,
    equation: "score = clamp(50 + clamp(1.5 × discount%, -45, 45) + clamp(3 × (yield% - 6), -20, 20) + clamp(nearby development impact, -20, 20), 0, 100)",
  };
}
