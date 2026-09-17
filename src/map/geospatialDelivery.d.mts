export const PMTILES_ARTIFACT_VERSION: "wr-pmtiles-artifact-v1";
export const GEOSPATIAL_DELIVERY_AUDIT_VERSION: "wr-geospatial-delivery-audit-v1";
export const GEOSPATIAL_RUNTIME_DECISION_VERSION: "wr-geospatial-runtime-decision-v1";
export function parsePmtilesHeader(input: Uint8Array | ArrayBuffer): Record<string, any>;
export function verifyPmtilesHeader(input: Uint8Array | ArrayBuffer, expectations?: Record<string, any>): Record<string, any>;
export function verifyPmtilesArtifactManifest(manifest?: Record<string, any>, actual?: Record<string, any>): Record<string, any>;
export function verifyPmtilesHttpDelivery(input?: Record<string, any>): Record<string, any>;
export function selectGeospatialRuntime(input?: Record<string, any>): Record<string, any>;
