const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const loaderSource = fs.readFileSync(path.join(root, "src", "map", "loadParcels.ts"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(loaderSource.includes("MAX_BROAD_SEARCH_SHARD_RECORDS"), "Search loader must define a broad-shard safety cap");
assert(loaderSource.includes("MAX_SEARCH_QUERY_RECORD_MEMBERSHIPS"), "Search loader must define a per-query search membership budget");
assert(loaderSource.includes("function allowsOversizedSearchShard"), "Search loader must distinguish broad text shards from exact numeric parcel lookups");
assert(loaderSource.includes("if (!shardFiles.length) return []"), "Search loader must avoid fetching when all candidate shards are unsafe");
assert(loaderSource.includes("Math.ceil(terms.length * 0.6)"), "Multi-term parcel text and owner searches must reject weak single-token matches");
assert(loaderSource.includes("hasConflictingStreetNumber"), "Address search must reject otherwise weak matches with a conflicting street number");

const startMarker = "function normalizeParcelId(value: unknown): string {";
const endMarker = "function parcelIdMatchScore(parcel: ParcelRecord, query: string): number {";
const start = loaderSource.indexOf(startMarker);
const end = loaderSource.indexOf(endMarker);
assert(start >= 0 && end > start, "Search shard helper source must be discoverable");

const helperSource = loaderSource
  .slice(start, end)
  .replace(/export const /g, "const ")
  .replace(/export function /g, "function ")
  .replace(/: unknown/g, "")
  .replace(/: number/g, "")
  .replace(/: string\[\]/g, "")
  .replace(/: string/g, "")
  .replace(/: boolean/g, "")
  .replace(/: ParcelServiceManifest\["searchIndexShards"\]/g, "")
  .replace(/new Set<string>\(\)/g, "new Set()")
  .replace(/const files: string\[\] = \[\];/g, "const files = [];")
  .replace(/const seenFiles = new Set<string>\(\);/g, "const seenFiles = new Set();")
  .replace(/ as string\[\]/g, "");

const helpers = new Function(`const MAX_BROAD_SEARCH_SHARD_RECORDS = 125000; const MAX_SEARCH_QUERY_RECORD_MEMBERSHIPS = 250000; ${helperSource}; return { searchShardFilesForQuery };`)();

const harrisLikeShards = {
  keyLength: 2,
  fields: ["sourceCountyId", "accountNum", "address"],
  files: {
    ha: "search/ha.json",
    hc: "search/hc.json",
    pa: "search/pa.json",
    sa: "search/sa.json",
    "12": "search/12.json",
  },
  counts: {
    ha: 1535522,
    hc: 1535522,
    pa: 1535522,
    sa: 8400,
    "12": 341271,
  },
};

assert(helpers.searchShardFilesForQuery("harris", harrisLikeShards).length === 0, "Broad Harris county-name search must not load the whole county shard");
assert(helpers.searchShardFilesForQuery("hcad", harrisLikeShards).length === 0, "Broad HCAD acronym search must not load the whole county shard");
assert(helpers.searchShardFilesForQuery("parcel", harrisLikeShards).length === 0, "Broad parcel label search must not load a full-county label shard");
assert(helpers.searchShardFilesForQuery("sanden", harrisLikeShards).includes("search/sa.json"), "Normal-sized text shard should still load");
assert(helpers.searchShardFilesForQuery("1234567890", harrisLikeShards).includes("search/12.json"), "Long numeric parcel/account lookups should still load their shard");

console.log("White Rabbit search shard safety tests passed.");
