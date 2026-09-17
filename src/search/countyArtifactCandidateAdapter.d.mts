export interface CountyArtifactCandidateAdapterOptions {
  manifestPath: string;
  readJson: (relativePath: string, manifestPath?: string) => Promise<unknown> | unknown;
  expectedCountyId: string;
  expectedFeatureCount?: number | null;
  sourceVersion: string;
  sourceUpdatedAt: string;
  freshnessStatus?: "current" | "stale" | "unknown";
  maxShardMemberships?: number;
  maxBoundedChunks?: number;
}
export declare const COUNTY_ARTIFACT_CANDIDATE_ADAPTER_VERSION: "wr-county-artifact-candidate-adapter-v1";
export declare const COUNTY_ARTIFACT_CURSOR_VERSION: "wrac:v1";
export declare function createCountyArtifactCandidateAdapter(options: CountyArtifactCandidateAdapterOptions): {
  readonly schemaVersion: typeof COUNTY_ARTIFACT_CANDIDATE_ADAPTER_VERSION;
  fetchCandidatePage(input?: Record<string, unknown>): Promise<Record<string, unknown>>;
};
