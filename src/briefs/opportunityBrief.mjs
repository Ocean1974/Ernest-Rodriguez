export const OPPORTUNITY_BRIEF_VERSION = "wr-opportunity-brief-v1";

function present(value) {
  return value !== null && value !== undefined && value !== "";
}

function fact(id, label, value, source, sourceField, options = {}) {
  const hasValue = present(value);
  return {
    id,
    label,
    value: hasValue ? value : null,
    status: hasValue ? "observed" : "unknown",
    source: hasValue ? source : "",
    sourceField: hasValue ? sourceField : "",
    asOf: hasValue ? String(options.asOf || "") : "",
    confidence: hasValue ? Math.max(0, Math.min(1, Number(options.confidence ?? 1))) : 0,
  };
}

function section(id, title, facts) {
  const observed = facts.filter((item) => item.status === "observed").length;
  return { id, title, status: observed === facts.length ? "complete" : observed ? "partial" : "insufficient-evidence", facts };
}

export function buildOpportunityBrief({ profile = {}, opportunitySignals = null, underwriting = null, sensitivity = null, scenarioComparison = null, generatedAt = new Date().toISOString() } = {}) {
  const parcel = profile.parcel || {};
  const intelligence = profile.intelligence || {};
  const lineage = profile.lineage || parcel.dataLineage || null;
  const parcelSource = lineage?.sourceDatasetId || parcel.sourceDatasetId || profile.sourceCountyId || "parcel-source";
  const parcelAsOf = lineage?.sourceAsOf || lineage?.generatedAt || "";
  const permitEvidence = profile.evidence?.layerStatus?.permits;
  const sections = [
    section("identity", "Property identity", [
      fact("property-id", "White Rabbit property ID", profile.whiteRabbitPropertyId, "white-rabbit-identity", "whiteRabbitPropertyId"),
      fact("account-number", "County account number", profile.accountNum || parcel.accountNum || parcel.accountNumber, parcelSource, "accountNum", { asOf: parcelAsOf }),
      fact("address", "Site address", parcel.siteAddress || parcel.address || parcel.propertyAddress, parcelSource, "siteAddress", { asOf: parcelAsOf }),
    ]),
    section("ownership", "Ownership", [
      fact("owner", "Owner", parcel.ownerName || parcel.ownerName1, parcelSource, "ownerName", { asOf: parcelAsOf }),
      fact("ownership-tenure", "Ownership tenure (years)", parcel.ownershipTenureYears, parcelSource, "ownershipTenureYears", { asOf: parcelAsOf }),
    ]),
    section("site", "Site", [
      fact("land-area", "Land area", parcel.landAreaSize ?? parcel.landAreaSqFt, parcelSource, present(parcel.landAreaSize) ? "landAreaSize" : "landAreaSqFt", { asOf: parcelAsOf }),
      fact("year-built", "Year built", parcel.yearBuilt, parcelSource, "yearBuilt", { asOf: parcelAsOf }),
      fact("total-value", "Assessed total value", parcel.totalValue, parcelSource, "totalValue", { asOf: parcelAsOf }),
    ]),
    section("zoning-risk", "Zoning and risk", [
      fact("zoning", "Zoning", intelligence.zoning?.code || intelligence.zoningCode, intelligence.zoning?.sourceDatasetId || "zoning-source", intelligence.zoning?.code ? "zoning.code" : "zoningCode", { asOf: intelligence.zoning?.sourceAsOf }),
      fact("floodplain", "Floodplain", intelligence.floodplain?.designation || intelligence.floodplainStatus, intelligence.floodplain?.sourceDatasetId || "floodplain-source", intelligence.floodplain?.designation ? "floodplain.designation" : "floodplainStatus", { asOf: intelligence.floodplain?.sourceAsOf }),
    ]),
    section("activity", "Permit and development activity", [
      fact("permit-count", "Linked permit count", permitEvidence === "matched" || permitEvidence === "not-found" ? profile.evidence?.permitCount : null, "property-profile", "evidence.permitCount"),
      fact("development-signals", "Development signal count", intelligence.development?.signalCount, intelligence.development?.sourceDatasetId || "development-source", "development.signalCount", { asOf: intelligence.development?.latestActivityDate }),
    ]),
    section("economics", "Modeled economics", [
      fact("noi", "First-year NOI", underwriting?.metrics?.firstYearNoi, "underwriting-model", "metrics.firstYearNoi", { asOf: underwriting?.generatedAt, confidence: 0.7 }),
      fact("irr", "Levered IRR (%)", underwriting?.metrics?.irrPct, "underwriting-model", "metrics.irrPct", { asOf: underwriting?.generatedAt, confidence: 0.7 }),
      fact("equity-multiple", "Equity multiple", underwriting?.metrics?.equityMultiple, "underwriting-model", "metrics.equityMultiple", { asOf: underwriting?.generatedAt, confidence: 0.7 }),
    ]),
  ];
  const observedFacts = sections.flatMap((item) => item.facts).filter((item) => item.status === "observed").length;
  const totalFacts = sections.flatMap((item) => item.facts).length;
  const warnings = [
    ...(profile.evidence?.errors || []).map(String),
    ...(underwriting?.warnings || []).map(String),
    ...(opportunitySignals?.missingEvidence || []).map((item) => `Opportunity signal evidence missing: ${item}`),
  ];
  return {
    schemaVersion: OPPORTUNITY_BRIEF_VERSION,
    status: !profile.parcel ? "insufficient-evidence" : observedFacts === totalFacts ? "complete" : "partial",
    generatedAt,
    whiteRabbitPropertyId: String(profile.whiteRabbitPropertyId || ""),
    profileSchemaVersion: String(profile.schemaVersion || ""),
    sections,
    opportunitySignals,
    underwriting,
    sensitivity,
    scenarioComparison,
    evidenceSummary: { observedFacts, unknownFacts: totalFacts - observedFacts, totalFacts, completenessPct: totalFacts ? Number((observedFacts / totalFacts * 100).toFixed(1)) : 0 },
    warnings: [...new Set(warnings)],
    lineage,
    exportModel: { formatVersion: OPPORTUNITY_BRIEF_VERSION, title: parcel.siteAddress || parcel.address || profile.accountNum || "White Rabbit Opportunity Brief", sectionOrder: sections.map((item) => item.id), disclaimer: "Observed facts and modeled assumptions are separated. Verify source data and assumptions before making an investment decision." },
  };
}
