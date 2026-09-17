const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const comparables = await import("../src/underwriting/marketComparables.mjs");
  const underwriting = await import("../src/underwriting/underwritingEngine.mjs");
  const asOf = "2026-08-14T12:00:00.000Z";
  const subject = { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A1", propertyType: "office", location: { latitude: 32.7767, longitude: -96.797 }, buildingSqFt: 10000, yearBuilt: 2005 };
  const source = (id, overrides = {}) => ({ datasetId: "licensed-market-feed", recordId: id, sourceUrl: `https://data.example/${id}`, licenseId: "license-2026", licenseStatus: "authorized", observedAt: "2026-08-01T00:00:00.000Z", availableAt: "2026-08-02T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", sourceFields: { rent: "annual_rent", area: "building_sqft" }, ...overrides });
  const rent = (id, overrides = {}) => ({ id, comparableType: "rent", propertyType: "office", transactionDate: "2026-07-01T00:00:00.000Z", location: { latitude: 32.78, longitude: -96.8 }, economics: { annualRent: 240000, buildingSqFt: 10000 }, yearBuilt: 2002, source: source(id), ...overrides });
  const eligible = [
    rent("rent-1"),
    rent("rent-2", { location: { latitude: 32.79, longitude: -96.81 }, economics: { annualRent: 228000, buildingSqFt: 9500 }, yearBuilt: 2000 }),
    rent("rent-3", { location: { latitude: 32.77, longitude: -96.78 }, economics: { annualRent: 260000, buildingSqFt: 11000 }, transactionDate: "2026-06-01T00:00:00.000Z", yearBuilt: 2008 }),
  ];
  const ineligible = [
    rent("future", { transactionDate: "2026-09-01T00:00:00.000Z", source: source("future", { observedAt: "2026-09-01T00:00:00.000Z", availableAt: "2026-09-02T00:00:00.000Z" }) }),
    rent("restricted", { source: source("restricted", { licenseStatus: "restricted" }) }),
    rent("far", { location: { latitude: 33.5, longitude: -97.5 } }),
    rent("wrong-type", { propertyType: "retail" }),
    { id: "invalid", comparableType: "rent" },
  ];
  const adjustmentPolicy = {
    annualMarketGrowthPct: { value: 3, source: "licensed-market-index", sourceField: "annual_growth", asOf: "2026-08-01T00:00:00.000Z" },
    sizeElasticityPct: { value: -5, source: "reviewed-underwriting-policy", sourceField: "size_elasticity", asOf: "2026-08-01T00:00:00.000Z" },
    ageAdjustmentPctPerYear: { value: 0.1, source: "reviewed-underwriting-policy", sourceField: "age_adjustment", asOf: "2026-08-01T00:00:00.000Z" },
    maxAbsAdjustmentPct: 25,
  };
  const analysis = comparables.analyzeMarketComparables({ analysisType: "rent", analysisAsOf: asOf, subject, comparables: [...eligible, ...ineligible], selectionPolicy: { maxDistanceMiles: 10, maxAgeDays: 365, minComparableCount: 3, maxComparableCount: 5 }, adjustmentPolicy });
  assert.equal(analysis.schemaVersion, "wr-comparable-analysis-v1");
  assert.equal(analysis.status, "adjusted-estimate");
  assert.equal(analysis.selected.length, 3);
  assert(analysis.estimate.weightedUnitValue > 20);
  assert.equal(analysis.estimate.unit, "usd_per_sqft_year");
  assert(analysis.estimate.evidenceCoverageLabel.includes("not a statistical confidence interval"));
  assert(analysis.selected.every((item) => item.adjustment.lines.every((line) => line.evidence.source && line.formula)));
  assert(analysis.excluded.find((item) => item.id === "future").reasons.includes("future-evidence"));
  assert(analysis.excluded.find((item) => item.id === "restricted").reasons.includes("license-restricted"));
  assert(analysis.excluded.find((item) => item.id === "far").reasons.includes("outside-distance-window"));
  assert(analysis.excluded.find((item) => item.id === "wrong-type").reasons.includes("property-type-mismatch"));
  assert(analysis.excluded.find((item) => item.id === "invalid").reasons[0].startsWith("invalid-record"));
  const derived = comparables.deriveUnderwritingAssumptions({ purchasePrice: 1000000, rentableAreaSqFt: 10000, exitCapRatePct: 7 }, { rent: analysis });
  assert.equal(derived.assumptions.rentPerSqFtAnnual.source, "white-rabbit-comparable-analysis");
  assert.deepEqual(derived.references.rent.selectedComparableIds.sort(), ["rent-1", "rent-2", "rent-3"]);
  const result = underwriting.calculateUnderwriting(derived.assumptions, { generatedAt: asOf });
  assert(result.metrics.grossPotentialRentAnnual > 200000);

  const insufficient = comparables.analyzeMarketComparables({ analysisType: "rent", analysisAsOf: asOf, subject, comparables: eligible.slice(0, 2), selectionPolicy: { minComparableCount: 3 }, adjustmentPolicy });
  assert.equal(insufficient.status, "insufficient-evidence");
  assert.equal(insufficient.estimate, null);
  const futureAdjustments = comparables.analyzeMarketComparables({ analysisType: "rent", analysisAsOf: asOf, subject, comparables: eligible, selectionPolicy: { minComparableCount: 3 }, adjustmentPolicy: { ...adjustmentPolicy, annualMarketGrowthPct: { ...adjustmentPolicy.annualMarketGrowthPct, asOf: "2026-09-01T00:00:00.000Z" } } });
  assert.equal(futureAdjustments.status, "evidence-selected");
  assert.equal(futureAdjustments.estimate, null);
  assert(futureAdjustments.futureAdjustmentEvidence.includes("annualMarketGrowthPct"));
  const saleComparables = eligible.map((item, index) => ({ ...item, id: `sale-${index + 1}`, comparableType: "sale", economics: { salePrice: 2000000 + index * 100000, buildingSqFt: item.economics.buildingSqFt }, source: source(`sale-${index + 1}`) }));
  const saleAnalysis = comparables.analyzeMarketComparables({ analysisType: "sale", analysisAsOf: asOf, subject, comparables: saleComparables, selectionPolicy: { minComparableCount: 3 }, adjustmentPolicy });
  const saleDerived = comparables.deriveUnderwritingAssumptions({ purchasePrice: 1750000 }, { sale: saleAnalysis });
  assert.equal(saleDerived.assumptions.purchasePrice, 1750000, "sale evidence must never overwrite negotiated purchase price");
  assert.equal(saleDerived.references.sale.purchasePriceOverwritten, false);
  assert(saleDerived.references.sale.indicatedMarketValue > 0);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "market-comparable.schema.json"), "utf8"));
  assert.equal(schema.$defs.analysis.properties.schemaVersion.const, "wr-comparable-analysis-v1");
  console.log("White Rabbit licensed, point-in-time, explainable market comparable and underwriting-derivation tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
