function textOf(...values) {
  return values.map((value) => String(value ?? "")).join(" ").toLowerCase();
}

function numberValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyDevelopmentSignal(permit) {
  const text = textOf(permit.permitType, permit.permitSubtype, permit.description, permit.landUse, permit.occupancy);
  const valuation = numberValue(permit.valuation);
  if (/new construction|new building|\bnew\b/.test(text)) {
    return {
      signalType: "new_construction",
      stage: "permitted",
      confidence: 0.95,
      reason: "Permit text indicates new construction.",
    };
  }
  if (/demolition|demo\b/.test(text)) {
    return {
      signalType: "demolition",
      stage: "site_preparation",
      confidence: 0.86,
      reason: "Permit text indicates demolition or site clearing.",
    };
  }
  if (/grading|paving|foundation|excavation|site work|retaining wall|drainage/.test(text)) {
    return {
      signalType: "site_work",
      stage: "site_preparation",
      confidence: 0.82,
      reason: "Permit text indicates site work or early construction preparation.",
    };
  }
  if (/zoning|specific use|planned development|development plan|sup\b|zoning permit/.test(text)) {
    return {
      signalType: "zoning_or_entitlement",
      stage: "entitlement",
      confidence: 0.8,
      reason: "Permit text indicates zoning or entitlement activity.",
    };
  }
  if (/certificate of occupancy|occupancy|\bco\b/.test(text)) {
    return {
      signalType: "certificate_of_occupancy",
      stage: "delivered_or_tenanting",
      confidence: 0.72,
      reason: "Certificate of Occupancy indicates delivery, tenanting, or use activation.",
    };
  }
  if (/renovation|remodel|alteration|addition|finish out|tenant finish|interior remodel/.test(text) && valuation >= 250000) {
    return {
      signalType: "major_renovation",
      stage: "permitted",
      confidence: 0.74,
      reason: "Permit text and declared value indicate major reinvestment.",
    };
  }
  if (/multi[- ]?family|apartment|mixed use|hotel|warehouse|industrial|office|retail|restaurant/.test(text) && valuation >= 100000) {
    return {
      signalType: "commercial_activity",
      stage: "permitted",
      confidence: 0.66,
      reason: "Use and valuation indicate commercial development activity.",
    };
  }
  return null;
}

function signalWeight(signalType) {
  return {
    new_construction: 100,
    demolition: 82,
    site_work: 76,
    zoning_or_entitlement: 72,
    major_renovation: 68,
    commercial_activity: 55,
    certificate_of_occupancy: 38,
  }[signalType] || 25;
}

function getActivityDate(permit) {
  return permit.finalDate || permit.issueDate || permit.applicationDate || permit.recordDate || "";
}

function buildDevelopmentSignal(permit) {
  const classification = classifyDevelopmentSignal(permit);
  if (!classification) return null;
  const parcelId = String(permit.parcelAccountNum || "").trim();
  const valuation = numberValue(permit.valuation);
  return {
    signalId: `dev-${permit.permitRecordId || permit.sourceDataset + "-" + permit.permitNumber}`,
    parcelId,
    parcelAccountNum: parcelId,
    parcelGisId: String(permit.parcelGisId || "").trim(),
    parcelAddress: String(permit.parcelAddress || permit.address || "").trim(),
    parcelPropertyName: String(permit.parcelPropertyName || "").trim(),
    signalType: classification.signalType,
    stage: classification.stage,
    confidence: classification.confidence,
    score: signalWeight(classification.signalType) + Math.min(25, Math.floor(valuation / 1000000)),
    reason: classification.reason,
    source: {
      dataset: permit.sourceDataset,
      name: permit.sourceName,
      url: permit.sourceUrl,
      permitRecordId: permit.permitRecordId,
      permitNumber: permit.permitNumber,
      permitType: permit.permitType,
      permitStatus: permit.permitStatus,
      issueDate: permit.issueDate,
      finalDate: permit.finalDate,
      recordDate: permit.recordDate || "",
      activityDate: getActivityDate(permit),
      dateSemantics: permit.dateSemantics || (permit.issueDate ? "permit-issue-date" : "activity-date"),
      valuation,
      joinMethod: permit.joinMethod || "",
    },
    location: {
      latitude: permit.latitude ?? null,
      longitude: permit.longitude ?? null,
    },
    provenance: [
      { field: "parcelId", sourceField: "parcelAccountNum", source: permit.parcelJoinSource || "Dallas permit parcel join" },
      { field: "signalType", sourceField: "permitType/description/landUse", source: "classification rule" },
      { field: "stage", sourceField: "permitType/description/landUse", source: "classification rule" },
      { field: "sourceUrl", sourceField: "sourceUrl", source: permit.sourceName || permit.sourceDataset || "" },
    ],
  };
}

module.exports = {
  buildDevelopmentSignal,
  classifyDevelopmentSignal,
  getActivityDate,
  numberValue,
  signalWeight,
};
