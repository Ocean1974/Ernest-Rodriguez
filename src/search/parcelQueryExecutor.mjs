export const PARCEL_QUERY_RESULT_VERSION = "wr-parcel-query-result-v1";

function numberValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parcelKey(parcel) {
  return String(parcel?.whiteRabbitPropertyId || parcel?.countyParcelId || parcel?.accountNum || parcel?.accountNumber || parcel?.gisParcelId || "");
}

function landAreaAcres(parcel) {
  const size = numberValue(parcel?.landAreaSize);
  const unit = String(parcel?.landAreaUnit || "").toLowerCase();
  if (size !== null && /acre|\bac\b/.test(unit)) return size;
  if (size !== null && /sq|square|sf|feet|foot/.test(unit)) return size / 43560;
  const squareFeet = numberValue(parcel?.landAreaSqFt);
  if (squareFeet !== null) return squareFeet / 43560;
  const label = /([\d,.]+)\s*acre/i.exec(String(parcel?.areaLabel || ""));
  return label ? numberValue(label[1]) : null;
}

function ownerEntityType(parcel) {
  const owner = [parcel?.ownerName, parcel?.ownerName2, parcel?.businessName, parcel?.propertyName].filter(Boolean).join(" ").toUpperCase();
  if (!owner) return null;
  if (/\bL\.?L\.?C\.?\b/.test(owner)) return "llc";
  if (/\b(INC|INCORPORATED|CORP|CORPORATION)\b/.test(owner)) return "corporation";
  if (/\b(LP|LLP|PARTNERSHIP|PARTNERS)\b/.test(owner)) return "partnership";
  if (/\b(COMPANY|CO\.)\b/.test(owner)) return "company";
  return "individual-or-other";
}

function compare(actual, operator, expected, record) {
  if (actual === null || actual === undefined || actual === "") return null;
  if (operator === "<field") {
    const other = numberValue(record?.[expected]);
    const numeric = numberValue(actual);
    return numeric === null || other === null ? null : numeric < other;
  }
  if (operator === "contains") return String(actual).toLowerCase().includes(String(expected).toLowerCase());
  if (operator === "is-entity") return actual !== "individual-or-other" && (expected === "entity" || actual === expected || (expected === "corp" && actual === "corporation"));
  if (typeof expected === "boolean" && operator === "=") return Boolean(actual) === expected;
  const numericActual = numberValue(actual);
  const numericExpected = numberValue(expected);
  if (numericActual === null || numericExpected === null) return null;
  if (operator === ">") return numericActual > numericExpected;
  if (operator === ">=") return numericActual >= numericExpected;
  if (operator === "<") return numericActual < numericExpected;
  if (operator === "<=") return numericActual <= numericExpected;
  if (operator === "=") return numericActual === numericExpected;
  return null;
}

function valueForFilter(parcel, filter, context) {
  const key = parcelKey(parcel);
  if (filter.field === "landAreaAcres") return landAreaAcres(parcel);
  if (filter.field === "ownerEntityType") return ownerEntityType(parcel);
  if (filter.field === "recentPermitCount") {
    const keys = [key, parcel?.countyParcelId, parcel?.accountNum, parcel?.accountNumber, parcel?.gisParcelId].map(String).filter(Boolean);
    let permits = null;
    for (const candidate of keys) {
      permits = context?.permitsByParcel?.get?.(candidate) ?? context?.permitsByParcel?.[candidate] ?? null;
      if (Array.isArray(permits)) break;
    }
    return Array.isArray(permits) ? permits.length : null;
  }
  if (filter.field === "ownershipTenureYears") return numberValue(parcel?.ownershipTenureYears);
  if (filter.field === "grossBuildingArea") return numberValue(parcel?.grossBuildingArea ?? parcel?.buildingAreaSqFt ?? parcel?.buildingArea ?? parcel?.rentableAreaSqFt);
  if (filter.field === "vacantLand") {
    const classification = [parcel?.buildingClass, parcel?.landUseDescription, parcel?.propertyName, parcel?.businessName].filter(Boolean).join(" ").toUpperCase();
    return classification ? /\b(VACANT|LAND ONLY|UNIMPROVED)\b/.test(classification) : null;
  }
  return parcel?.[filter.field] ?? null;
}

function searchableText(parcel) {
  return [parcel?.address, parcel?.propertyAddress, parcel?.ownerName, parcel?.ownerName2, parcel?.businessName, parcel?.propertyName, parcel?.zoning, parcel?.landUseCode, parcel?.landUseDescription, parcel?.buildingClass]
    .filter(Boolean).join(" ").toLowerCase();
}

export function evaluateParcelQueryPlan(plan, parcel, context = {}) {
  const filterEvidence = (plan?.filters || []).map((filter) => {
    const actual = valueForFilter(parcel, filter, context);
    const matched = compare(actual, filter.operator, filter.value, parcel);
    return {
      field: filter.field,
      operator: filter.operator,
      expected: filter.value,
      actual,
      status: matched === null ? "unknown" : matched ? "matched" : "not-matched",
      explanation: matched === null ? `${filter.field} is unavailable for this parcel.` : `${filter.explanation}: ${matched ? "matched" : "did not match"}.`,
      sourceEvidence: filter.evidence,
    };
  });
  const text = searchableText(parcel);
  const keywordEvidence = (plan?.keywords || []).map((keyword) => ({ keyword, status: text.includes(String(keyword).toLowerCase()) ? "matched" : "not-matched" }));
  const hasFailure = [...filterEvidence, ...keywordEvidence].some((item) => item.status === "not-matched");
  const hasUnknown = filterEvidence.some((item) => item.status === "unknown");
  return {
    whiteRabbitPropertyId: parcelKey(parcel),
    status: hasFailure ? "not-matched" : hasUnknown ? "indeterminate" : "matched",
    filterEvidence,
    keywordEvidence,
  };
}

export function executeParcelQueryPlan(plan, parcels, context = {}, options = {}) {
  const evaluated = (Array.isArray(parcels) ? parcels : []).map((parcel) => ({ parcel, evaluation: evaluateParcelQueryPlan(plan, parcel, context) }));
  const matches = evaluated.filter((item) => item.evaluation.status === "matched");
  const indeterminate = evaluated.filter((item) => item.evaluation.status === "indeterminate");
  const limit = Math.max(1, Number(options.limit || 250));
  return {
    schemaVersion: PARCEL_QUERY_RESULT_VERSION,
    planVersion: String(plan?.schemaVersion || ""),
    rawQuery: String(plan?.rawQuery || ""),
    totals: { evaluated: evaluated.length, matched: matches.length, indeterminate: indeterminate.length, rejected: evaluated.length - matches.length - indeterminate.length },
    matches: matches.slice(0, limit),
    indeterminate: options.includeIndeterminate ? indeterminate.slice(0, limit) : [],
    unsupported: Array.isArray(plan?.unsupported) ? plan.unsupported : [],
  };
}
