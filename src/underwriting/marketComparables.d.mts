export const MARKET_COMPARABLE_VERSION: "wr-market-comparable-v1";
export const COMPARABLE_ANALYSIS_VERSION: "wr-comparable-analysis-v1";
export const COMPARABLE_ADJUSTMENT_VERSION: "wr-comparable-adjustment-v1";
export const COMPARABLE_DERIVED_ASSUMPTION_VERSION: "wr-comparable-derived-assumption-v1";
export function createMarketComparable(input?: Record<string, any>): Readonly<Record<string, any>>;
export function analyzeMarketComparables(input?: Record<string, any>): Record<string, any>;
export function deriveUnderwritingAssumptions(baseInput?: Record<string, any>, analyses?: Record<string, any>): Record<string, any>;
