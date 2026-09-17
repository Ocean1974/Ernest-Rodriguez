export const PRODUCTION_DATA_PREFLIGHT_VERSION: "wr-production-data-service-preflight-v1";
export const DEFAULT_PRODUCTION_DATA_ENDPOINTS: ReadonlyArray<{ id: string; path: string }>;
export function verifyProductionDataResponse(input?: Record<string, unknown>): Record<string, unknown>;
export function runProductionDataServicePreflight(input?: Record<string, unknown>): Promise<Record<string, unknown>>;
