export const COUNTY_BOUNDARY_SOURCE_PROBE_VERSION: string;
export const COUNTY_ETJ_RECONCILIATION_VERSION: string;
export const COUNTY_BOUNDARY_SNAPSHOT_POLICY_VERSION: string;
export const COUNTY_PARCEL_JURISDICTION_ASSIGNMENT_VERSION: string;
export function countyBoundarySha256(value: unknown): string;
export function createCountyBoundarySourceProbe(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createCountyEtjReconciliation(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createCountyBoundarySnapshotPolicy(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function classifyParcelJurisdiction(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
