export const HBU_SEARCH_VERSION: "wr-hbu-search-v1";
export function parseHighestBestUseSearch(query: string): null | Record<string, any>;
export function rankParcelsForHighestBestUse(parcels?: Array<Record<string, any>>, useId?: string, options?: Record<string, any>): Array<Record<string, any>>;
