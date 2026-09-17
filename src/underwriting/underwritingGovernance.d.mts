export const UNDERWRITING_SCENARIO_VERSION: "wr-underwriting-scenario-v1";
export const UNDERWRITING_REVIEW_VERSION: "wr-underwriting-review-v1";
export const UNDERWRITING_APPROVAL_VERSION: "wr-underwriting-approval-v1";
export const UNDERWRITING_GOVERNANCE_STATE_VERSION: "wr-underwriting-governance-state-v1";
export const UNDERWRITING_GOVERNANCE_ACTIVITY_VERSION: "wr-underwriting-governance-activity-v1";
export class UnderwritingRevisionConflictError extends Error { code: "WR_REVISION_CONFLICT"; expectedRevision: number; actualRevision: number; }
export function createUnderwritingScenario(input?: Record<string, any>): Record<string, any>;
export function createUnderwritingGovernanceState(input?: Record<string, any>): Record<string, any>;
export function addUnderwritingScenario(stateInput: Record<string, any>, scenarioInput: Record<string, any>, contextInput?: Record<string, any>, options?: Record<string, any>): Record<string, any>;
export function reviseUnderwritingScenario(stateInput: Record<string, any>, scenarioId: string, changes?: Record<string, any>, contextInput?: Record<string, any>, options?: Record<string, any>): Record<string, any>;
export function submitUnderwritingScenario(stateInput: Record<string, any>, scenarioId: string, contextInput?: Record<string, any>, options?: Record<string, any>): Record<string, any>;
export function recordUnderwritingReview(stateInput: Record<string, any>, scenarioId: string, reviewInput?: Record<string, any>, contextInput?: Record<string, any>, options?: Record<string, any>): Record<string, any>;
export function decideUnderwritingScenario(stateInput: Record<string, any>, scenarioId: string, decisionInput?: Record<string, any>, contextInput?: Record<string, any>, options?: Record<string, any>): Record<string, any>;
