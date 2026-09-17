export const HIGHEST_BEST_USE_VERSION = "wr-highest-best-use-v1";

const USE_PRESETS = Object.freeze([
  {
    id: "multifamily",
    name: "Multifamily",
    targetFar: 2.25,
    stories: 5,
    floorToFloorHeightFt: 11,
    efficiencyPct: 82,
    hardCostPerSqFt: 235,
    rentPerSqFtAnnual: 31,
    vacancyPct: 6,
    operatingExpensePct: 38,
    exitCapRatePct: 5.75,
    parkingSpacesPer1000SqFt: 1.75,
    parkingAreaPerSpaceSqFt: 325,
    structuredParkingPct: 70,
    averageUnitSqFt: 875,
  },
  {
    id: "industrial",
    name: "Industrial / logistics",
    targetFar: 0.42,
    stories: 1,
    floorToFloorHeightFt: 36,
    efficiencyPct: 95,
    hardCostPerSqFt: 145,
    rentPerSqFtAnnual: 14,
    vacancyPct: 5,
    operatingExpensePct: 22,
    exitCapRatePct: 6.5,
    parkingSpacesPer1000SqFt: 0.65,
    parkingAreaPerSpaceSqFt: 350,
    structuredParkingPct: 0,
    averageUnitSqFt: null,
  },
  {
    id: "retail",
    name: "Retail",
    targetFar: 0.32,
    stories: 1,
    floorToFloorHeightFt: 18,
    efficiencyPct: 91,
    hardCostPerSqFt: 205,
    rentPerSqFtAnnual: 32,
    vacancyPct: 7,
    operatingExpensePct: 28,
    exitCapRatePct: 6.75,
    parkingSpacesPer1000SqFt: 4,
    parkingAreaPerSpaceSqFt: 325,
    structuredParkingPct: 0,
    averageUnitSqFt: null,
  },
  {
    id: "office",
    name: "Office",
    targetFar: 1.6,
    stories: 4,
    floorToFloorHeightFt: 13,
    efficiencyPct: 84,
    hardCostPerSqFt: 290,
    rentPerSqFtAnnual: 39,
    vacancyPct: 16,
    operatingExpensePct: 36,
    exitCapRatePct: 7.5,
    parkingSpacesPer1000SqFt: 3.5,
    parkingAreaPerSpaceSqFt: 325,
    structuredParkingPct: 75,
    averageUnitSqFt: null,
  },
  {
    id: "mixed-use",
    name: "Mixed-use",
    targetFar: 2.75,
    stories: 6,
    floorToFloorHeightFt: 12,
    efficiencyPct: 80,
    hardCostPerSqFt: 280,
    rentPerSqFtAnnual: 35,
    vacancyPct: 8,
    operatingExpensePct: 35,
    exitCapRatePct: 6.25,
    parkingSpacesPer1000SqFt: 2.25,
    parkingAreaPerSpaceSqFt: 325,
    structuredParkingPct: 80,
    averageUnitSqFt: 900,
  },
  {
    id: "self-storage",
    name: "Self-storage",
    targetFar: 1.5,
    stories: 4,
    floorToFloorHeightFt: 11,
    efficiencyPct: 78,
    hardCostPerSqFt: 125,
    rentPerSqFtAnnual: 19,
    vacancyPct: 10,
    operatingExpensePct: 32,
    exitCapRatePct: 6.5,
    parkingSpacesPer1000SqFt: 0.25,
    parkingAreaPerSpaceSqFt: 325,
    structuredParkingPct: 0,
    averageUnitSqFt: null,
  },
]);

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(value, keys) {
  for (const key of keys) {
    const parsed = numeric(value?.[key]);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedPermission(value) {
  return ["allowed", "conditional", "prohibited"].includes(value) ? value : "unknown";
}

export function highestBestUsePresets() {
  return USE_PRESETS.map((preset) => ({ ...preset }));
}

export function createHighestBestUseDefaults(parcel = {}) {
  return {
    site: {
      landAreaSqFt: firstNumber(parcel, ["landAreaSqFt", "landAreaSize", "lotSizeSqFt"]) ?? "",
      acquisitionPrice: firstNumber(parcel, ["totalValue", "marketValue", "assessedValue", "landValue"]) ?? "",
      maximumFar: "",
      maximumCoveragePct: "",
      maximumHeightFt: "",
      usableSitePct: 85,
      softCostPct: 20,
      contingencyPct: 7.5,
      siteWorkPct: 5,
      minimumYieldSpreadPct: 1.25,
    },
    candidates: highestBestUsePresets(),
  };
}

function evaluateCandidate(candidateInput, site, context) {
  const candidate = { ...candidateInput };
  const landAreaSqFt = numeric(site.landAreaSqFt);
  const acquisitionPrice = numeric(site.acquisitionPrice) ?? 0;
  const maximumFar = numeric(site.maximumFar);
  const maximumCoveragePct = numeric(site.maximumCoveragePct);
  const maximumHeightFt = numeric(site.maximumHeightFt);
  const usableSitePct = clamp(numeric(site.usableSitePct) ?? 85, 1, 100);
  const targetFar = numeric(candidate.targetFar);
  const requestedStories = numeric(candidate.stories);
  const floorToFloorHeightFt = numeric(candidate.floorToFloorHeightFt);
  const efficiencyPct = numeric(candidate.efficiencyPct);
  const hardCostPerSqFt = numeric(candidate.hardCostPerSqFt);
  const rentPerSqFtAnnual = numeric(candidate.rentPerSqFtAnnual);
  const vacancyPct = numeric(candidate.vacancyPct);
  const operatingExpensePct = numeric(candidate.operatingExpensePct);
  const exitCapRatePct = numeric(candidate.exitCapRatePct);
  const parkingSpacesPer1000SqFt = numeric(candidate.parkingSpacesPer1000SqFt) ?? 0;
  const parkingAreaPerSpaceSqFt = numeric(candidate.parkingAreaPerSpaceSqFt) ?? 325;
  const structuredParkingPct = clamp(numeric(candidate.structuredParkingPct) ?? 0, 0, 100);
  const permission = normalizedPermission(context.allowedUses?.[candidate.id] ?? candidate.permission);

  const required = {
    landAreaSqFt,
    targetFar,
    stories: requestedStories,
    floorToFloorHeightFt,
    efficiencyPct,
    hardCostPerSqFt,
    rentPerSqFtAnnual,
    vacancyPct,
    operatingExpensePct,
    exitCapRatePct,
  };
  const missingInputs = Object.entries(required).filter(([, value]) => value === null).map(([key]) => key);
  const invalidInputs = [
    landAreaSqFt !== null && landAreaSqFt <= 0 ? "landAreaSqFt" : "",
    targetFar !== null && targetFar <= 0 ? "targetFar" : "",
    requestedStories !== null && requestedStories < 1 ? "stories" : "",
    efficiencyPct !== null && (efficiencyPct <= 0 || efficiencyPct > 100) ? "efficiencyPct" : "",
    vacancyPct !== null && (vacancyPct < 0 || vacancyPct >= 100) ? "vacancyPct" : "",
    operatingExpensePct !== null && (operatingExpensePct < 0 || operatingExpensePct >= 100) ? "operatingExpensePct" : "",
    exitCapRatePct !== null && exitCapRatePct <= 0 ? "exitCapRatePct" : "",
  ].filter(Boolean);

  if (missingInputs.length || invalidInputs.length) {
    return {
      id: String(candidate.id || "candidate"),
      name: String(candidate.name || candidate.id || "Candidate use"),
      status: "insufficient-evidence",
      permission,
      metrics: null,
      tests: { legallyPermissible: "indeterminate", physicallyPossible: "indeterminate", financiallyFeasible: "indeterminate", maximallyProductive: "not-tested" },
      missingEvidence: [...missingInputs.map((key) => `input:${key}`), ...invalidInputs.map((key) => `invalid:${key}`)],
      assumptions: candidate,
    };
  }

  const heightLimitedStories = maximumHeightFt !== null
    ? Math.max(0, Math.floor(maximumHeightFt / floorToFloorHeightFt))
    : requestedStories;
  const modeledStories = Math.max(0, Math.min(requestedStories, heightLimitedStories));
  const farLimit = maximumFar !== null ? Math.min(targetFar, maximumFar) : targetFar;
  const coverageLimitPct = maximumCoveragePct !== null ? maximumCoveragePct : usableSitePct;
  const usableSiteAreaSqFt = landAreaSqFt * usableSitePct / 100;
  const maximumFootprintSqFt = landAreaSqFt * coverageLimitPct / 100;
  const surfaceParkingRatio = parkingSpacesPer1000SqFt * (1 - structuredParkingPct / 100);
  const siteAreaPerGrossSqFt = modeledStories > 0
    ? (1 / modeledStories) + (surfaceParkingRatio * parkingAreaPerSpaceSqFt / 1000)
    : Number.POSITIVE_INFINITY;
  const grossBySitePlan = usableSiteAreaSqFt / siteAreaPerGrossSqFt;
  const grossByFar = landAreaSqFt * farLimit;
  const grossByCoverageAndHeight = maximumFootprintSqFt * modeledStories;
  const grossBuildableSqFt = Math.max(0, Math.min(grossBySitePlan, grossByFar, grossByCoverageAndHeight));
  const footprintAreaSqFt = modeledStories > 0 ? grossBuildableSqFt / modeledStories : 0;
  const netRentableSqFt = grossBuildableSqFt * efficiencyPct / 100;
  const parkingSpaces = grossBuildableSqFt / 1000 * parkingSpacesPer1000SqFt;
  const surfaceParkingSqFt = parkingSpaces * parkingAreaPerSpaceSqFt * (1 - structuredParkingPct / 100);
  const estimatedUnits = numeric(candidate.averageUnitSqFt) ? Math.floor(netRentableSqFt / numeric(candidate.averageUnitSqFt)) : null;

  const hardCosts = grossBuildableSqFt * hardCostPerSqFt;
  const softCosts = hardCosts * (numeric(site.softCostPct) ?? 20) / 100;
  const contingency = hardCosts * (numeric(site.contingencyPct) ?? 7.5) / 100;
  const siteWork = hardCosts * (numeric(site.siteWorkPct) ?? 5) / 100;
  const developmentCostExcludingLand = hardCosts + softCosts + contingency + siteWork;
  const totalProjectCost = developmentCostExcludingLand + acquisitionPrice;
  const grossPotentialRevenue = netRentableSqFt * rentPerSqFtAnnual;
  const effectiveRevenue = grossPotentialRevenue * (1 - vacancyPct / 100);
  const stabilizedNoi = effectiveRevenue * (1 - operatingExpensePct / 100);
  const stabilizedValue = stabilizedNoi / (exitCapRatePct / 100);
  const valueCostSpread = stabilizedValue - totalProjectCost;
  const residualLandValue = stabilizedValue - developmentCostExcludingLand;
  const yieldOnCostPct = totalProjectCost > 0 ? stabilizedNoi / totalProjectCost * 100 : null;
  const minimumYieldSpreadPct = numeric(site.minimumYieldSpreadPct) ?? 1.25;
  const requiredYieldOnCostPct = exitCapRatePct + minimumYieldSpreadPct;
  const breakEvenRentPerSqFtAnnual = netRentableSqFt > 0
    ? totalProjectCost * (exitCapRatePct / 100) / (netRentableSqFt * (1 - vacancyPct / 100) * (1 - operatingExpensePct / 100))
    : null;

  const physicallyPossible = modeledStories >= 1 && grossBuildableSqFt > 0 ? "pass" : "fail";
  const zoningConstraintsKnown = maximumFar !== null && maximumCoveragePct !== null && maximumHeightFt !== null;
  const legallyPermissible = permission === "prohibited"
    ? "fail"
    : permission === "allowed" && zoningConstraintsKnown
      ? "pass"
      : "indeterminate";
  const financiallyFeasible = valueCostSpread > 0 && yieldOnCostPct >= requiredYieldOnCostPct ? "pass" : "fail";
  const evidenceGaps = [
    permission === "unknown" ? "zoning:permitted-use" : "",
    maximumFar === null ? "zoning:maximum-far" : "",
    maximumCoveragePct === null ? "zoning:maximum-coverage" : "",
    maximumHeightFt === null ? "zoning:maximum-height" : "",
    "market:rent-assumption",
    "market:exit-cap-assumption",
    "cost:construction-assumption",
    context.floodplainKnown ? "" : "physical:floodplain-status",
  ].filter(Boolean);

  return {
    id: candidate.id,
    name: candidate.name,
    status: physicallyPossible === "pass" && financiallyFeasible === "pass" ? "financially-leading-candidate" : "screened-out",
    permission,
    metrics: {
      modeledFar: round(grossBuildableSqFt / landAreaSqFt, 3),
      modeledStories,
      modeledHeightFt: round(modeledStories * floorToFloorHeightFt, 1),
      grossBuildableSqFt: round(grossBuildableSqFt, 0),
      footprintAreaSqFt: round(footprintAreaSqFt, 0),
      netRentableSqFt: round(netRentableSqFt, 0),
      estimatedUnits,
      parkingSpaces: round(parkingSpaces, 0),
      surfaceParkingSqFt: round(surfaceParkingSqFt, 0),
      acquisitionPrice: round(acquisitionPrice),
      developmentCostExcludingLand: round(developmentCostExcludingLand),
      totalProjectCost: round(totalProjectCost),
      grossPotentialRevenue: round(grossPotentialRevenue),
      stabilizedNoi: round(stabilizedNoi),
      stabilizedValue: round(stabilizedValue),
      valueCostSpread: round(valueCostSpread),
      residualLandValue: round(residualLandValue),
      yieldOnCostPct: round(yieldOnCostPct, 3),
      requiredYieldOnCostPct: round(requiredYieldOnCostPct, 3),
      breakEvenRentPerSqFtAnnual: round(breakEvenRentPerSqFtAnnual, 2),
    },
    tests: {
      legallyPermissible,
      physicallyPossible,
      financiallyFeasible,
      maximallyProductive: "pending-comparison",
    },
    missingEvidence: evidenceGaps,
    bindingConstraints: [
      grossBuildableSqFt === grossByFar ? "floor-area-ratio" : "",
      grossBuildableSqFt === grossByCoverageAndHeight ? "coverage-or-height" : "",
      grossBuildableSqFt === grossBySitePlan ? "site-plan-or-parking" : "",
    ].filter(Boolean),
    assumptions: candidate,
  };
}

export function analyzeHighestBestUse({ site = {}, candidates = USE_PRESETS, zoning = null, floodplain = null, allowedUses = {} } = {}) {
  const landAreaSqFt = numeric(site.landAreaSqFt);
  if (landAreaSqFt === null || landAreaSqFt <= 0) {
    return {
      schemaVersion: HIGHEST_BEST_USE_VERSION,
      status: "insufficient-evidence",
      leadingScenarioId: "",
      recommendedUseId: "",
      scenarios: [],
      missingEvidence: ["site:land-area"],
      disclaimer: "A parcel land area is required before highest-and-best-use alternatives can be screened.",
    };
  }

  const context = {
    allowedUses,
    floodplainKnown: Boolean(floodplain && !/loading|unknown/i.test(String(floodplain.label || floodplain.designation || floodplain))),
  };
  const scenarios = (candidates || []).map((candidate) => evaluateCandidate(candidate, site, context));
  const ranked = scenarios
    .filter((scenario) => scenario.metrics && scenario.tests.physicallyPossible === "pass" && scenario.permission !== "prohibited")
    .sort((left, right) => {
      if (left.tests.financiallyFeasible !== right.tests.financiallyFeasible) return left.tests.financiallyFeasible === "pass" ? -1 : 1;
      return (right.metrics.residualLandValue ?? Number.NEGATIVE_INFINITY) - (left.metrics.residualLandValue ?? Number.NEGATIVE_INFINITY);
    });
  ranked.forEach((scenario, index) => {
    scenario.rank = index + 1;
    scenario.tests.maximallyProductive = index === 0 ? "financial-leader" : "not-leading";
  });
  const rankedIds = new Set(ranked.map((scenario) => scenario.id));
  const orderedScenarios = [...ranked, ...scenarios.filter((scenario) => !rankedIds.has(scenario.id)).map((scenario) => ({ ...scenario, rank: null }))];
  const leader = ranked[0] || null;
  const recommended = leader
    && leader.tests.legallyPermissible === "pass"
    && leader.tests.physicallyPossible === "pass"
    && leader.tests.financiallyFeasible === "pass"
      ? leader
      : null;
  const missingEvidence = [...new Set(scenarios.flatMap((scenario) => scenario.missingEvidence || []))];

  return {
    schemaVersion: HIGHEST_BEST_USE_VERSION,
    status: recommended ? "highest-best-use-supported" : leader ? "comparative-screen-complete-evidence-required" : "no-viable-scenario",
    leadingScenarioId: leader?.id || "",
    recommendedUseId: recommended?.id || "",
    zoningLabel: String(zoning?.label || zoning?.code || zoning || ""),
    floodplainLabel: String(floodplain?.label || floodplain?.designation || floodplain || ""),
    site: { ...site, landAreaSqFt },
    scenarios: orderedScenarios,
    missingEvidence,
    disclaimer: recommended
      ? "The leading use passed the supplied legal, physical, financial, and maximum-productivity screens. It remains a conceptual decision aid, not an entitlement or appraisal conclusion."
      : "The financial leader is an assumption-based screen, not a highest-and-best-use conclusion. Verify permitted use, dimensional standards, parking, market evidence, construction costs, access, utilities, title, and environmental constraints.",
  };
}
