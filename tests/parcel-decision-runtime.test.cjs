const assert = require("node:assert/strict");

(async () => {
  const { createParcelDecisionDefaults, runParcelUnderwriting, calculateDevelopmentFeasibility, buildParcelOpportunityBrief } = await import("../src/features/parcelDecisionRuntime.mjs");
  const parcel = { accountNum: "123", sourceCountyId: "dallas-county-tx", address: "100 Main St", totalValue: "1000000", landAreaSqFt: "40000" };
  const defaults = createParcelDecisionDefaults(parcel);
  assert.equal(defaults.underwriting.purchasePrice, 1000000);
  assert.equal(defaults.feasibility.landAreaSqFt, 40000);

  const incomplete = runParcelUnderwriting(defaults.underwriting, { generatedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(incomplete.status, "insufficient-evidence");
  const modeled = runParcelUnderwriting({ ...defaults.underwriting, grossPotentialRentAnnual: 150000 }, { generatedAt: "2026-09-11T00:00:00.000Z" });
  assert(modeled.metrics.irrPct !== null);

  const feasibility = calculateDevelopmentFeasibility(defaults.feasibility);
  assert.equal(feasibility.metrics.grossBuildableSqFt, 40000);
  assert(Number.isFinite(feasibility.metrics.valueCostSpread));
  assert(calculateDevelopmentFeasibility({}).warnings.some((warning) => warning.includes("landAreaSqFt")));

  const brief = buildParcelOpportunityBrief({ parcel, underwriting: modeled, permitCount: 0, generatedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(brief.whiteRabbitPropertyId, "123");
  assert.equal(brief.status, "partial");
  assert(brief.evidenceSummary.observedFacts > 0);
  console.log("White Rabbit parcel decision runtime tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
