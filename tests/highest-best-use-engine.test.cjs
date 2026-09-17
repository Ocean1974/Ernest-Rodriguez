const assert = require("node:assert/strict");

(async () => {
  const {
    HIGHEST_BEST_USE_VERSION,
    analyzeHighestBestUse,
    createHighestBestUseDefaults,
    highestBestUsePresets,
  } = await import("../src/features/highestBestUseEngine.mjs");

  const defaults = createHighestBestUseDefaults({ landAreaSqFt: "100,000", totalValue: "$2,500,000" });
  assert.equal(defaults.site.landAreaSqFt, 100000);
  assert.equal(defaults.site.acquisitionPrice, 2500000);
  assert.equal(defaults.candidates.length, 6);
  assert.equal(highestBestUsePresets().length, 6);

  const missingSite = analyzeHighestBestUse({ site: {} });
  assert.equal(missingSite.status, "insufficient-evidence");
  assert.deepEqual(missingSite.missingEvidence, ["site:land-area"]);

  const screening = analyzeHighestBestUse({ site: defaults.site, candidates: defaults.candidates });
  assert.equal(screening.schemaVersion, HIGHEST_BEST_USE_VERSION);
  assert.equal(screening.scenarios.length, 6);
  assert(screening.leadingScenarioId);
  assert.equal(screening.recommendedUseId, "");
  assert(screening.missingEvidence.includes("zoning:permitted-use"));
  assert(screening.scenarios.every((scenario) => Number.isFinite(scenario.metrics.residualLandValue)));

  const [multifamily, industrial] = highestBestUsePresets();
  const supported = analyzeHighestBestUse({
    site: {
      landAreaSqFt: 100000,
      acquisitionPrice: 1000000,
      maximumFar: 3,
      maximumCoveragePct: 80,
      maximumHeightFt: 100,
      usableSitePct: 90,
      softCostPct: 10,
      contingencyPct: 5,
      siteWorkPct: 2,
      minimumYieldSpreadPct: 1,
    },
    allowedUses: { multifamily: "allowed", industrial: "allowed" },
    floodplain: { label: "Outside mapped floodplain" },
    candidates: [
      { ...multifamily, hardCostPerSqFt: 120, rentPerSqFtAnnual: 55, exitCapRatePct: 6 },
      { ...industrial, hardCostPerSqFt: 100, rentPerSqFtAnnual: 18, exitCapRatePct: 7 },
    ],
  });
  assert.equal(supported.status, "highest-best-use-supported");
  assert(supported.recommendedUseId);
  assert.equal(supported.scenarios[0].tests.legallyPermissible, "pass");
  assert.equal(supported.scenarios[0].tests.physicallyPossible, "pass");
  assert.equal(supported.scenarios[0].tests.financiallyFeasible, "pass");
  assert.equal(supported.scenarios[0].tests.maximallyProductive, "financial-leader");
  assert(Number.isFinite(supported.scenarios[0].metrics.breakEvenRentPerSqFtAnnual));

  const prohibited = analyzeHighestBestUse({
    site: supported.site,
    allowedUses: { multifamily: "prohibited", industrial: "allowed" },
    floodplain: { label: "Outside mapped floodplain" },
    candidates: [
      { ...multifamily, hardCostPerSqFt: 120, rentPerSqFtAnnual: 55, exitCapRatePct: 6 },
      { ...industrial, hardCostPerSqFt: 100, rentPerSqFtAnnual: 18, exitCapRatePct: 7 },
    ],
  });
  const prohibitedScenario = prohibited.scenarios.find((scenario) => scenario.id === "multifamily");
  assert.equal(prohibitedScenario.tests.legallyPermissible, "fail");
  assert.equal(prohibitedScenario.rank, null);

  const surfaceParking = analyzeHighestBestUse({
    site: { landAreaSqFt: 100000, usableSitePct: 85 },
    candidates: [{ ...industrial, targetFar: 2, stories: 2, parkingSpacesPer1000SqFt: 5, structuredParkingPct: 0 }],
  }).scenarios[0];
  const structuredParking = analyzeHighestBestUse({
    site: { landAreaSqFt: 100000, usableSitePct: 85 },
    candidates: [{ ...industrial, targetFar: 2, stories: 2, parkingSpacesPer1000SqFt: 5, structuredParkingPct: 100 }],
  }).scenarios[0];
  assert(surfaceParking.metrics.grossBuildableSqFt < structuredParking.metrics.grossBuildableSqFt);
  assert(surfaceParking.bindingConstraints.includes("site-plan-or-parking"));

  console.log("White Rabbit highest-and-best-use engine tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
