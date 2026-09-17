export const SERVICE_TELEMETRY_EVENT_VERSION: "wr-service-telemetry-event-v1";
export const SERVICE_TELEMETRY_SNAPSHOT_VERSION: "wr-service-telemetry-snapshot-v1";
export const SERVICE_SLO_POLICY_VERSION: "wr-service-slo-policy-v1";
export const SERVICE_SLO_REPORT_VERSION: "wr-service-slo-report-v1";
export function createServiceTelemetryEvent(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createTelemetryCollector(options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createServiceSloPolicy(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function evaluateServiceSlo(snapshot: Record<string, unknown>, policy: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
