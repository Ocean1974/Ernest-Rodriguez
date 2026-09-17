export declare const COUNTY_ARTIFACT_QUERY_RUNTIME_VERSION: "wr-county-artifact-query-runtime-v1";
export declare function createCountyArtifactQueryRuntime(options: {
  candidateAdapter: { fetchCandidatePage(input?: Record<string, unknown>): Promise<Record<string, unknown>> };
  allowedCountyIds: string[];
  releaseDecision?: Record<string, unknown> | null;
  verifyReleaseDecision?: ((decision: Record<string, unknown>) => { valid: boolean; activationAuthorized: boolean }) | null;
  graphService?: unknown;
  clock?: () => string;
  telemetrySink?: unknown;
}): {
  readonly schemaVersion: typeof COUNTY_ARTIFACT_QUERY_RUNTIME_VERSION;
  readonly activationAuthorized: boolean;
  execute(input?: Record<string, unknown>, execution?: Record<string, unknown>): Promise<Record<string, unknown>>;
};
