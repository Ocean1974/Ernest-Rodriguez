const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { normalizeUnderwritingAssumptions, calculateIrr, calculateUnderwriting, buildSensitivityMatrix, compareUnderwritingScenarios } = await import("../src/underwriting/underwritingEngine.mjs");
  const modelSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "underwriting-model.schema.json"), "utf8"));
  const resultSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "underwriting-result.schema.json"), "utf8"));
  assert.equal(modelSchema.properties.schemaVersion.const, "wr-underwriting-model-v1");
  assert.equal(resultSchema.properties.schemaVersion.const, "wr-underwriting-result-v1");
  const generatedAt = "2026-08-13T12:00:00.000Z";
  const base = {
    purchasePrice: { value: 1000000, source: "broker-om", sourceField: "askingPrice", asOf: "2026-08-01", confidence: 0.8 },
    grossPotentialRentAnnual: 150000,
    vacancyPct: 5,
    operatingExpensePct: 35,
    loanToCostPct: 65,
    interestRatePct: 7,
    amortizationYears: 25,
    holdYears: 5,
    exitCapRatePct: 7,
  };

  const normalized = normalizeUnderwritingAssumptions(base);
  assert.equal(normalized.schemaVersion, "wr-underwriting-model-v1");
  assert.equal(normalized.assumptions.purchasePrice.source, "broker-om");
  assert.equal(normalized.assumptions.purchasePrice.sourceField, "askingPrice");
  assert.equal(normalized.assumptions.purchasePrice.confidence, 0.8);
  assert(normalized.defaulted.includes("closingCostsPct"));

  const result = calculateUnderwriting(base, { generatedAt });
  assert.equal(result.schemaVersion, "wr-underwriting-result-v1");
  assert.equal(result.generatedAt, generatedAt);
  assert.equal(result.status, "modeled-with-warnings");
  assert.equal(result.metrics.firstYearNoi, 92625);
  assert(Math.abs(result.metrics.capRatePct - 9.2625) < 0.001);
  assert(result.metrics.irrPct !== null);
  assert(result.metrics.equityMultiple > 1);
  assert.equal(result.annualCashFlows.length, 6);
  assert(result.formulas.some((formula) => formula.includes("IRR")));
  assert(result.warnings.some((warning) => warning.includes("Default assumption used")));

  const noDebt = calculateUnderwriting({ ...base, loanToCostPct: 0 });
  assert.equal(noDebt.metrics.debtServiceCoverageRatio, null);

  const missingRent = calculateUnderwriting({ purchasePrice: 1000000, exitCapRatePct: 7 });
  assert.equal(missingRent.status, "insufficient-evidence");
  assert(missingRent.warnings.some((warning) => warning.includes("grossPotentialRentAnnual")));
  const invalidExit = calculateUnderwriting({ ...base, exitCapRatePct: 0 });
  assert.equal(invalidExit.status, "insufficient-evidence");
  assert.equal(invalidExit.metrics, null);

  const knownIrr = calculateIrr([-100, 60, 60]);
  assert(Math.abs(knownIrr - 0.130662386) < 0.000001);

  const sensitivity = buildSensitivityMatrix(base, { generatedAt });
  assert.equal(sensitivity.schemaVersion, "wr-underwriting-sensitivity-v1");
  assert.equal(sensitivity.cells.length, 9);
  const favorable = sensitivity.cells.find((cell) => cell.exitCapRatePct === 6 && cell.rentMultiplier === 1.1);
  const adverse = sensitivity.cells.find((cell) => cell.exitCapRatePct === 8 && cell.rentMultiplier === 0.9);
  assert(favorable.irrPct > adverse.irrPct);

  const comparison = compareUnderwritingScenarios([
    { id: "base", assumptions: base },
    { id: "higher-rent", assumptions: { ...base, grossPotentialRentAnnual: 170000 } },
  ]);
  assert.equal(comparison.rankedScenarioIds[0], "higher-rent");
  console.log("White Rabbit underwriting engine tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
