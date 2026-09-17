export const UNDERWRITING_MODEL_VERSION: "wr-underwriting-model-v1";
export const UNDERWRITING_RESULT_VERSION: "wr-underwriting-result-v1";
export const SENSITIVITY_MATRIX_VERSION: "wr-underwriting-sensitivity-v1";
export function normalizeUnderwritingAssumptions(input?: Record<string, unknown>): Record<string, unknown>;
export function calculateIrr(cashFlows: number[]): number | null;
export function calculateUnderwriting(input?: Record<string, unknown>, options?: Record<string, unknown>): Record<string, any>;
export function buildSensitivityMatrix(baseInput: Record<string, unknown>, options?: Record<string, unknown>): Record<string, any>;
export function compareUnderwritingScenarios(scenarios?: Array<Record<string, any>>): Record<string, any>;
