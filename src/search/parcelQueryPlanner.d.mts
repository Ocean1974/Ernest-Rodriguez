export const PARCEL_QUERY_PLAN_VERSION: "wr-parcel-query-plan-v1";
export type ParcelQueryFilter = { field: string; operator: string; value: string | number; unit: string; evidence: string; explanation: string };
export type ParcelQueryPlan = {
  schemaVersion: typeof PARCEL_QUERY_PLAN_VERSION;
  rawQuery: string;
  filters: ParcelQueryFilter[];
  keywords: string[];
  unsupported: string[];
  confidence: number;
  explanation: string[];
  execution: { requiresParcelData: boolean; requiresPermitData: boolean; requiresSpatialContext: boolean };
};
export function planParcelQuery(rawQuery: unknown): ParcelQueryPlan;
