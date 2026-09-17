import { calculateUnderwriting } from "../underwriting/underwritingEngine.mjs";
import { buildOpportunityBrief } from "../briefs/opportunityBrief.mjs";
import { analyzeHighestBestUse, createHighestBestUseDefaults } from "./highestBestUseEngine.mjs";

export const PARCEL_DECISION_RUNTIME_VERSION = "wr-parcel-decision-runtime-v1";

function numberValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(parcel, keys) {
  for (const key of keys) {
    const value = numberValue(parcel?.[key]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

export function createParcelDecisionDefaults(parcel = {}) {
  return {
    underwriting: {
      purchasePrice: firstNumber(parcel, ["totalValue", "marketValue", "assessedValue"]) ?? "",
      grossPotentialRentAnnual: firstNumber(parcel, ["grossPotentialRentAnnual", "annualRent"]) ?? "",
      vacancyPct: 5,
      operatingExpensePct: 35,
      loanToCostPct: 65,
      interestRatePct: 7,
      amortizationYears: 25,
      holdYears: 5,
      exitCapRatePct: 7,
      annualRentGrowthPct: 3,
      annualExpenseGrowthPct: 3,
    },
    feasibility: {
      landAreaSqFt: firstNumber(parcel, ["landAreaSqFt", "landAreaSize", "lotSizeSqFt"]) ?? "",
      floorAreaRatio: 1,
      efficiencyPct: 85,
      hardCostPerSqFt: 225,
      softCostPct: 20,
      rentPerSqFtAnnual: 30,
      vacancyPct: 5,
      operatingExpensePct: 35,
      exitCapRatePct: 7,
    },
    highestBestUse: createHighestBestUseDefaults(parcel),
  };
}

export function runParcelUnderwriting(inputs = {}, options = {}) {
  return calculateUnderwriting(inputs, options);
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function calculateDevelopmentFeasibility(inputs = {}) {
  const a = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, numberValue(value)]));
  const required = ["landAreaSqFt", "floorAreaRatio", "efficiencyPct", "hardCostPerSqFt", "rentPerSqFtAnnual", "exitCapRatePct"];
  const missing = required.filter((key) => a[key] === null || a[key] === undefined);
  const invalid = [
    a.landAreaSqFt !== null && a.landAreaSqFt <= 0 ? "Land area must be greater than zero." : "",
    a.floorAreaRatio !== null && a.floorAreaRatio <= 0 ? "FAR must be greater than zero." : "",
    a.efficiencyPct !== null && (a.efficiencyPct <= 0 || a.efficiencyPct > 100) ? "Efficiency must be between 0 and 100%." : "",
    a.exitCapRatePct !== null && a.exitCapRatePct <= 0 ? "Exit cap rate must be greater than zero." : "",
  ].filter(Boolean);
  if (missing.length || invalid.length) {
    return {
      schemaVersion: PARCEL_DECISION_RUNTIME_VERSION,
      status: "insufficient-evidence",
      metrics: null,
      warnings: [...missing.map((key) => `Missing required assumption: ${key}`), ...invalid],
    };
  }

  const grossBuildableSqFt = a.landAreaSqFt * a.floorAreaRatio;
  const netRentableSqFt = grossBuildableSqFt * a.efficiencyPct / 100;
  const hardCosts = grossBuildableSqFt * a.hardCostPerSqFt;
  const softCosts = hardCosts * (a.softCostPct ?? 20) / 100;
  const totalDevelopmentCost = hardCosts + softCosts;
  const grossPotentialRentAnnual = netRentableSqFt * a.rentPerSqFtAnnual;
  const effectiveRevenue = grossPotentialRentAnnual * (1 - (a.vacancyPct ?? 5) / 100);
  const stabilizedNoi = effectiveRevenue * (1 - (a.operatingExpensePct ?? 35) / 100);
  const stabilizedValue = stabilizedNoi / (a.exitCapRatePct / 100);
  const margin = stabilizedValue - totalDevelopmentCost;

  return {
    schemaVersion: PARCEL_DECISION_RUNTIME_VERSION,
    status: margin >= 0 ? "modeled-positive-spread" : "modeled-negative-spread",
    metrics: {
      grossBuildableSqFt: round(grossBuildableSqFt, 0),
      netRentableSqFt: round(netRentableSqFt, 0),
      totalDevelopmentCost: round(totalDevelopmentCost),
      grossPotentialRentAnnual: round(grossPotentialRentAnnual),
      stabilizedNoi: round(stabilizedNoi),
      yieldOnCostPct: totalDevelopmentCost > 0 ? round(stabilizedNoi / totalDevelopmentCost * 100, 3) : null,
      stabilizedValue: round(stabilizedValue),
      valueCostSpread: round(margin),
    },
    warnings: ["Conceptual screen only. Zoning, setbacks, parking, construction pricing, and entitlements are not yet verified."],
  };
}

export function runHighestBestUseAnalysis(inputs = {}) {
  return analyzeHighestBestUse(inputs);
}

export function buildParcelOpportunityBrief({ parcel = {}, underwriting = null, permitCount = null, zoning = null, floodplain = null, developmentSignalCount = null, generatedAt } = {}) {
  const stableId = String(parcel.countyParcelId || parcel.accountNum || parcel.accountNumber || parcel.gisParcelId || "");
  return buildOpportunityBrief({
    profile: {
      schemaVersion: "wr-local-parcel-profile-v1",
      whiteRabbitPropertyId: stableId,
      accountNum: parcel.accountNum || parcel.accountNumber || "",
      sourceCountyId: parcel.sourceCountyId || parcel.dataLineage?.sourceCountyId || "",
      parcel,
      intelligence: {
        zoning: zoning ? { code: zoning.label || zoning.code || String(zoning), sourceDatasetId: zoning.sourceDatasetId || "county-zoning-layer" } : null,
        floodplain: floodplain ? { designation: floodplain.label || floodplain.designation || String(floodplain), sourceDatasetId: floodplain.sourceDatasetId || "county-floodplain-layer" } : null,
        development: Number.isFinite(developmentSignalCount) ? { signalCount: developmentSignalCount, sourceDatasetId: "parcel-development-index" } : null,
      },
      evidence: {
        permitCount: Number.isFinite(permitCount) ? permitCount : null,
        layerStatus: { permits: Number.isFinite(permitCount) ? (permitCount > 0 ? "matched" : "not-found") : "not-loaded" },
        errors: [],
      },
      lineage: parcel.dataLineage || null,
    },
    underwriting: underwriting?.metrics ? underwriting : null,
    generatedAt,
  });
}
