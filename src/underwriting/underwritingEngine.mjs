export const UNDERWRITING_MODEL_VERSION = "wr-underwriting-model-v1";
export const UNDERWRITING_RESULT_VERSION = "wr-underwriting-result-v1";
export const SENSITIVITY_MATRIX_VERSION = "wr-underwriting-sensitivity-v1";

const DEFINITIONS = {
  purchasePrice: { defaultValue: null, unit: "usd", required: true },
  closingCostsPct: { defaultValue: 2, unit: "percent" },
  renovationCost: { defaultValue: 0, unit: "usd" },
  constructionCost: { defaultValue: 0, unit: "usd" },
  additionalCapex: { defaultValue: 0, unit: "usd" },
  rentableAreaSqFt: { defaultValue: null, unit: "sqft" },
  rentPerSqFtAnnual: { defaultValue: null, unit: "usd_per_sqft_year" },
  grossPotentialRentAnnual: { defaultValue: null, unit: "usd_year" },
  vacancyPct: { defaultValue: 5, unit: "percent" },
  otherIncomeAnnual: { defaultValue: 0, unit: "usd_year" },
  operatingExpensesAnnual: { defaultValue: null, unit: "usd_year" },
  operatingExpensePct: { defaultValue: 35, unit: "percent" },
  loanToCostPct: { defaultValue: 65, unit: "percent" },
  interestRatePct: { defaultValue: 7, unit: "percent" },
  amortizationYears: { defaultValue: 25, unit: "years" },
  holdYears: { defaultValue: 5, unit: "years" },
  exitCapRatePct: { defaultValue: null, unit: "percent", required: true },
  sellingCostsPct: { defaultValue: 2, unit: "percent" },
  annualRentGrowthPct: { defaultValue: 3, unit: "percent" },
  annualExpenseGrowthPct: { defaultValue: 3, unit: "percent" },
  discountRatePct: { defaultValue: 10, unit: "percent" },
};

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function envelope(name, input, definition) {
  const supplied = input && typeof input === "object" && !Array.isArray(input) && "value" in input;
  const rawValue = supplied ? input.value : input;
  const parsed = numeric(rawValue);
  if (parsed !== null) {
    return {
      value: parsed,
      unit: supplied && input.unit ? String(input.unit) : definition.unit,
      source: supplied && input.source ? String(input.source) : "user-provided",
      sourceField: supplied && input.sourceField ? String(input.sourceField) : name,
      asOf: supplied && input.asOf ? String(input.asOf) : "",
      confidence: supplied && numeric(input.confidence) !== null ? Math.max(0, Math.min(1, numeric(input.confidence))) : 1,
      status: "provided",
    };
  }
  if (definition.defaultValue !== null) {
    return { value: definition.defaultValue, unit: definition.unit, source: "white-rabbit-default", sourceField: name, asOf: "", confidence: 0.35, status: "defaulted" };
  }
  return { value: null, unit: definition.unit, source: "", sourceField: name, asOf: "", confidence: 0, status: "missing" };
}

export function normalizeUnderwritingAssumptions(input = {}) {
  const assumptions = {};
  for (const [name, definition] of Object.entries(DEFINITIONS)) assumptions[name] = envelope(name, input[name], definition);
  const missing = Object.entries(assumptions).filter(([, item]) => item.status === "missing").map(([name]) => name);
  const defaulted = Object.entries(assumptions).filter(([, item]) => item.status === "defaulted").map(([name]) => name);
  const requiredMissing = ["purchasePrice", "exitCapRatePct"].filter((name) => assumptions[name].value === null);
  const hasRent = assumptions.grossPotentialRentAnnual.value !== null || (assumptions.rentableAreaSqFt.value !== null && assumptions.rentPerSqFtAnnual.value !== null);
  if (!hasRent) requiredMissing.push("grossPotentialRentAnnual-or-rentableAreaSqFt-and-rentPerSqFtAnnual");
  return { schemaVersion: UNDERWRITING_MODEL_VERSION, assumptions, missing, defaulted, requiredMissing: [...new Set(requiredMissing)] };
}

function monthlyPayment(principal, annualRatePct, amortizationYears) {
  if (principal <= 0) return 0;
  const months = Math.max(1, Math.round(amortizationYears * 12));
  const rate = annualRatePct / 100 / 12;
  if (rate === 0) return principal / months;
  return principal * (rate * (1 + rate) ** months) / ((1 + rate) ** months - 1);
}

function remainingBalance(principal, annualRatePct, amortizationYears, paymentsMade) {
  if (principal <= 0) return 0;
  const totalPayments = Math.max(1, Math.round(amortizationYears * 12));
  const paid = Math.max(0, Math.min(totalPayments, Math.round(paymentsMade)));
  const rate = annualRatePct / 100 / 12;
  if (rate === 0) return principal * (1 - paid / totalPayments);
  const payment = monthlyPayment(principal, annualRatePct, amortizationYears);
  return Math.max(0, principal * (1 + rate) ** paid - payment * (((1 + rate) ** paid - 1) / rate));
}

function npv(rate, cashFlows) {
  return cashFlows.reduce((sum, cashFlow, index) => sum + cashFlow / (1 + rate) ** index, 0);
}

export function calculateIrr(cashFlows) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2 || !cashFlows.some((value) => value < 0) || !cashFlows.some((value) => value > 0)) return null;
  let low = -0.9999;
  let high = 10;
  let lowNpv = npv(low, cashFlows);
  let highNpv = npv(high, cashFlows);
  if (lowNpv * highNpv > 0) return null;
  for (let iteration = 0; iteration < 240; iteration += 1) {
    const middle = (low + high) / 2;
    const middleNpv = npv(middle, cashFlows);
    if (Math.abs(middleNpv) < 0.000001) return middle;
    if (lowNpv * middleNpv <= 0) {
      high = middle;
      highNpv = middleNpv;
    } else {
      low = middle;
      lowNpv = middleNpv;
    }
  }
  return (low + high) / 2;
}

function round(value, digits = 2) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

export function calculateUnderwriting(input = {}, options = {}) {
  const model = input.schemaVersion === UNDERWRITING_MODEL_VERSION ? input : normalizeUnderwritingAssumptions(input);
  const a = Object.fromEntries(Object.entries(model.assumptions).map(([name, item]) => [name, item.value]));
  const invalid = [
    a.purchasePrice <= 0 ? "purchasePrice must be greater than zero" : "",
    a.exitCapRatePct <= 0 ? "exitCapRatePct must be greater than zero" : "",
    a.holdYears <= 0 ? "holdYears must be greater than zero" : "",
    a.amortizationYears <= 0 ? "amortizationYears must be greater than zero" : "",
    a.loanToCostPct < 0 || a.loanToCostPct > 100 ? "loanToCostPct must be between 0 and 100" : "",
    a.vacancyPct < 0 || a.vacancyPct > 100 ? "vacancyPct must be between 0 and 100" : "",
  ].filter(Boolean);
  if (model.requiredMissing.length || invalid.length) {
    return { schemaVersion: UNDERWRITING_RESULT_VERSION, status: "insufficient-evidence", assumptions: model, metrics: null, annualCashFlows: [], equityCashFlows: [], warnings: [...model.requiredMissing.map((name) => `Missing required assumption: ${name}`), ...invalid], formulas: [], generatedAt: options.generatedAt || new Date().toISOString() };
  }

  const grossPotentialRent = a.grossPotentialRentAnnual ?? a.rentableAreaSqFt * a.rentPerSqFtAnnual;
  const totalProjectCost = a.purchasePrice * (1 + a.closingCostsPct / 100) + a.renovationCost + a.constructionCost + a.additionalCapex;
  const loanAmount = totalProjectCost * a.loanToCostPct / 100;
  const initialEquity = totalProjectCost - loanAmount;
  const annualDebtService = monthlyPayment(loanAmount, a.interestRatePct, a.amortizationYears) * 12;
  const holdYears = Math.max(1, Math.round(a.holdYears));
  const baseEffectiveIncome = grossPotentialRent * (1 - a.vacancyPct / 100) + a.otherIncomeAnnual;
  const baseOperatingExpenses = a.operatingExpensesAnnual ?? baseEffectiveIncome * a.operatingExpensePct / 100;
  const annualCashFlows = [];
  const equityCashFlows = [-initialEquity];

  for (let year = 1; year <= holdYears + 1; year += 1) {
    const rentGrowth = (1 + a.annualRentGrowthPct / 100) ** (year - 1);
    const expenseGrowth = (1 + a.annualExpenseGrowthPct / 100) ** (year - 1);
    const potentialRent = grossPotentialRent * rentGrowth;
    const effectiveRentalIncome = potentialRent * (1 - a.vacancyPct / 100);
    const otherIncome = a.otherIncomeAnnual * rentGrowth;
    const operatingExpenses = baseOperatingExpenses * expenseGrowth;
    const noi = effectiveRentalIncome + otherIncome - operatingExpenses;
    if (year <= holdYears) {
      const cashFlowBeforeSale = noi - annualDebtService;
      annualCashFlows.push({ year, potentialRent: round(potentialRent), effectiveRentalIncome: round(effectiveRentalIncome), otherIncome: round(otherIncome), operatingExpenses: round(operatingExpenses), noi: round(noi), debtService: round(annualDebtService), cashFlowBeforeSale: round(cashFlowBeforeSale) });
      equityCashFlows.push(cashFlowBeforeSale);
    } else {
      annualCashFlows.push({ year, potentialRent: round(potentialRent), effectiveRentalIncome: round(effectiveRentalIncome), otherIncome: round(otherIncome), operatingExpenses: round(operatingExpenses), noi: round(noi), debtService: null, cashFlowBeforeSale: null, terminalYear: true });
    }
  }

  const firstYearNoi = annualCashFlows[0].noi;
  const terminalNoi = annualCashFlows[annualCashFlows.length - 1].noi;
  const grossExitValue = terminalNoi / (a.exitCapRatePct / 100);
  const sellingCosts = grossExitValue * a.sellingCostsPct / 100;
  const loanBalanceAtExit = remainingBalance(loanAmount, a.interestRatePct, a.amortizationYears, holdYears * 12);
  const netSaleProceeds = grossExitValue - sellingCosts - loanBalanceAtExit;
  equityCashFlows[equityCashFlows.length - 1] += netSaleProceeds;
  annualCashFlows[holdYears - 1].grossExitValue = round(grossExitValue);
  annualCashFlows[holdYears - 1].sellingCosts = round(sellingCosts);
  annualCashFlows[holdYears - 1].loanBalanceAtExit = round(loanBalanceAtExit);
  annualCashFlows[holdYears - 1].netSaleProceeds = round(netSaleProceeds);
  annualCashFlows[holdYears - 1].totalEquityCashFlow = round(equityCashFlows[equityCashFlows.length - 1]);

  const irr = calculateIrr(equityCashFlows);
  const positiveDistributions = equityCashFlows.slice(1).reduce((sum, value) => sum + Math.max(0, value), 0);
  const metrics = {
    grossPotentialRentAnnual: round(grossPotentialRent),
    firstYearNoi: round(firstYearNoi),
    capRatePct: round(firstYearNoi / a.purchasePrice * 100, 3),
    yieldOnCostPct: round(firstYearNoi / totalProjectCost * 100, 3),
    totalProjectCost: round(totalProjectCost),
    loanAmount: round(loanAmount),
    initialEquity: round(initialEquity),
    annualDebtService: round(annualDebtService),
    debtServiceCoverageRatio: annualDebtService > 0 ? round(firstYearNoi / annualDebtService, 3) : null,
    grossExitValue: round(grossExitValue),
    loanBalanceAtExit: round(loanBalanceAtExit),
    netSaleProceeds: round(netSaleProceeds),
    irrPct: irr === null ? null : round(irr * 100, 3),
    equityMultiple: initialEquity > 0 ? round(positiveDistributions / initialEquity, 3) : null,
    npvAtDiscountRate: round(npv(a.discountRatePct / 100, equityCashFlows)),
  };
  const warnings = [...model.defaulted.map((name) => `Default assumption used: ${name}`)];
  if (metrics.debtServiceCoverageRatio !== null && metrics.debtServiceCoverageRatio < 1.2) warnings.push("Debt service coverage is below 1.20x.");
  return {
    schemaVersion: UNDERWRITING_RESULT_VERSION,
    status: warnings.length ? "modeled-with-warnings" : "modeled",
    assumptions: model,
    metrics,
    annualCashFlows,
    equityCashFlows: equityCashFlows.map((value) => round(value)),
    warnings,
    formulas: [
      "NOI = effective rental income + other income - operating expenses",
      "Cap rate = first-year NOI / purchase price",
      "Yield on cost = first-year NOI / total project cost",
      "Exit value = next-year NOI / exit cap rate",
      "IRR solves NPV(equity cash flows) = 0",
      "Equity multiple = positive equity distributions / initial equity",
    ],
    generatedAt: options.generatedAt || new Date().toISOString(),
  };
}

export function buildSensitivityMatrix(baseInput, options = {}) {
  const base = normalizeUnderwritingAssumptions(baseInput);
  const baseExitCap = base.assumptions.exitCapRatePct.value;
  const baseRent = base.assumptions.grossPotentialRentAnnual.value ?? (base.assumptions.rentableAreaSqFt.value !== null && base.assumptions.rentPerSqFtAnnual.value !== null ? base.assumptions.rentableAreaSqFt.value * base.assumptions.rentPerSqFtAnnual.value : null);
  if (baseExitCap === null || baseRent === null) return { schemaVersion: SENSITIVITY_MATRIX_VERSION, status: "insufficient-evidence", rows: [], columns: [], cells: [] };
  const exitCapDeltas = options.exitCapDeltas || [-1, 0, 1];
  const rentMultipliers = options.rentMultipliers || [0.9, 1, 1.1];
  const cells = exitCapDeltas.flatMap((delta) => rentMultipliers.map((multiplier) => {
    const result = calculateUnderwriting({ ...baseInput, exitCapRatePct: baseExitCap + delta, grossPotentialRentAnnual: baseRent * multiplier }, { generatedAt: options.generatedAt });
    return { exitCapRatePct: baseExitCap + delta, rentMultiplier: multiplier, irrPct: result.metrics?.irrPct ?? null, equityMultiple: result.metrics?.equityMultiple ?? null, npvAtDiscountRate: result.metrics?.npvAtDiscountRate ?? null };
  }));
  return { schemaVersion: SENSITIVITY_MATRIX_VERSION, status: "modeled", rows: exitCapDeltas.map((delta) => baseExitCap + delta), columns: rentMultipliers, cells };
}

export function compareUnderwritingScenarios(scenarios = []) {
  const results = scenarios.map((scenario, index) => ({ id: String(scenario.id || `scenario-${index + 1}`), name: String(scenario.name || `Scenario ${index + 1}`), result: calculateUnderwriting(scenario.assumptions || scenario) }));
  const ranked = [...results].filter((item) => item.result.metrics?.irrPct !== null).sort((a, b) => b.result.metrics.irrPct - a.result.metrics.irrPct);
  return { schemaVersion: "wr-underwriting-comparison-v1", scenarios: results, rankingMetric: "irrPct", rankedScenarioIds: ranked.map((item) => item.id) };
}
