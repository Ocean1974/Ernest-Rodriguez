const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const requiredFiles = [
  "data/permits/raw/market-intel-source-manifest.json",
  "data/permits/raw/louisville-building-permit-applications.json",
  "data/permits/raw/louisville-building-permit-applications-metadata.json",
  "data/permits/processed/louisville-permits-normalized.json",
  "output/white-rabbit-market-permit-intel.json",
  "public/data/market-intel/permits/manifest.json",
  "public/data/market-intel/permits/search-index.json",
];

for (const relative of requiredFiles) {
  const file = path.join(root, relative);
  assert(fs.existsSync(file), `Missing market permit intel output: ${relative}`);
  assert(fs.statSync(file).size > 0, `Market permit intel output is empty: ${relative}`);
}

const sourceManifest = readJson(path.join(root, "data", "permits", "raw", "market-intel-source-manifest.json"));
assert(sourceManifest.sources.some((source) => source.id === "e7gq-4sah"), "Market intel must include Dallas building permits");
assert(sourceManifest.sources.some((source) => source.id === "9qet-qt9e"), "Market intel must include Dallas certificates of occupancy");
assert(
  sourceManifest.sources.some((source) => source.id === "louisville-building-permit-applications"),
  "Market intel must include Louisville building permit applications",
);

const louisville = readJson(path.join(root, "data", "permits", "processed", "louisville-permits-normalized.json"));
assert(louisville.count > 20000, "Louisville permit pull should include the official active construction permit records");
assert(louisville.permits.some((permit) => permit.market === "Louisville" && permit.state === "KY"), "Louisville permits must be normalized with market/state");
assert(louisville.permits.some((permit) => permit.latitude !== null && permit.longitude !== null), "Louisville permits must retain map coordinates");
assert(louisville.permits.every((permit) => permit.latitude === null || (permit.latitude >= 37.8 && permit.latitude <= 38.5)), "Louisville permits must not retain out-of-market latitude coordinates");
assert(louisville.permits.every((permit) => permit.longitude === null || (permit.longitude >= -86.1 && permit.longitude <= -85.2)), "Louisville permits must not retain out-of-market longitude coordinates");

const manifest = readJson(path.join(root, "public", "data", "market-intel", "permits", "manifest.json"));
assert(manifest.permitCount === manifest.searchIndexCount, "Market intel search index must cover every permit");
assert(manifest.marketCounts.Dallas > 100000, "Market intel must include Dallas permit records");
assert(manifest.marketCounts.Louisville > 20000, "Market intel must include Louisville permit records");
const locatedLouisvilleCount = louisville.permits.filter((permit) => permit.latitude !== null && permit.longitude !== null).length;
assert(manifest.locatedMarketCounts.Louisville === locatedLouisvilleCount, "Louisville located count must exactly reconcile after coordinate validation");
assert(manifest.locatedMarketCounts.Louisville < manifest.marketCounts.Louisville, "Louisville source coordinate outliers must remain unlocated");
assert(manifest.chunkCount > 2, "Market intel permits must be chunked for map/search loading");

const louisvilleChunk = manifest.chunks.find((chunk) => chunk.id.startsWith("louisville-") && chunk.bounds);
assert(louisvilleChunk, "Expected at least one located Louisville permit chunk");
const chunkPayload = readJson(path.join(root, "public", "data", "market-intel", "permits", louisvilleChunk.file));
assert(chunkPayload.permits.some((permit) => permit.market === "Louisville"), "Louisville chunk should contain Louisville records");

console.log("White Rabbit market permit intel tests passed.");
