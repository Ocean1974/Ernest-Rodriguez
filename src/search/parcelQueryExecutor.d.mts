import type { ParcelRecord } from "../map/loadParcels";
import type { ParcelQueryPlan } from "./parcelQueryPlanner.mjs";
export const PARCEL_QUERY_RESULT_VERSION: "wr-parcel-query-result-v1";
export function evaluateParcelQueryPlan(plan: ParcelQueryPlan, parcel: ParcelRecord, context?: Record<string, unknown>): Record<string, unknown>;
export function executeParcelQueryPlan(plan: ParcelQueryPlan, parcels: ParcelRecord[], context?: Record<string, unknown>, options?: { limit?: number; includeIndeterminate?: boolean }): Record<string, unknown>;
