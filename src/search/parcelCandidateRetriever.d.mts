export const CANDIDATE_PAGE_VERSION: "wr-parcel-candidate-page-v1";
export const PRODUCTION_QUERY_RESULT_VERSION: "wr-production-parcel-query-result-v1";
export const SEARCH_COMPATIBILITY_VERSION: "wr-search-compatibility-v1";
export const SEARCH_CURSOR_VERSION: "wrc:v1";
export function retrieveParcelCandidates(input?: Record<string, any>): Promise<Record<string, any>>;
export function compareSearchCompatibility(input?: Record<string, any>): Record<string, any>;
export function createInMemoryCandidateAdapter(input?: Record<string, any>): { fetchCandidatePage(input?: Record<string, any>): Promise<Record<string, any>> };
export function createHttpCandidateAdapter(input?: Record<string, any>): { fetchCandidatePage(input?: Record<string, any>): Promise<Record<string, any>> };
