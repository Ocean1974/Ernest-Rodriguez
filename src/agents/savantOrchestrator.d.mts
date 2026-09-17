export const SAVANT_ORCHESTRATOR_VERSION: "wr-savant-orchestrator-v1";
export const SAVANT_SPECIALISTS: ReadonlyArray<Readonly<Record<string, any>>>;
export const HUMAN_APPROVAL_ACTIONS: ReadonlyArray<string>;
export function routeSavantEvent(input?: Record<string, any>): Readonly<Record<string, any>>;
export function evaluateAgentAction(input?: Record<string, any>): Readonly<Record<string, any>>;
export function createOrchestratorRun(input?: Record<string, any>): Readonly<Record<string, any>>;
export function approveAgentAction(input?: Record<string, any>): Readonly<Record<string, any>>;
