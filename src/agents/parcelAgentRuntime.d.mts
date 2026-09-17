export const PARCEL_AGENT_VERSION: "wr-parcel-agents-v1";
export const PARCEL_AGENTS: ReadonlyArray<Record<string, string>>;
export function buildParcelAgentContext(input?: Record<string, any>): Record<string, any>;
export function runLocalParcelAgent(input?: Record<string, any>): Record<string, any>;
export function requestParcelAgent(input?: Record<string, any>): Promise<Record<string, any>>;
