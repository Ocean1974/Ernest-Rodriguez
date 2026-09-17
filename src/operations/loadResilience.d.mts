export const LOAD_SCENARIO_VERSION: "wr-load-scenario-v1";
export const LOAD_RESILIENCE_REPORT_VERSION: "wr-load-resilience-report-v1";
export function createLoadScenario(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function runLoadResilienceScenario(input?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
