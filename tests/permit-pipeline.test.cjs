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
  "data/permits/raw/e7gq-4sah.json",
  "data/permits/raw/9qet-qt9e.json",
  "output/permit-schema-report.md",
  "output/permit-schema-report.json",
  "data/permits/processed/dallas-permits-normalized.json",
  "data/permits/processed/dallas-permits-joined.json",
  "output/permit-join-report.md",
  "output/white-rabbit-dallas-permits.geojson",
  "output/white-rabbit-dallas-permit-index.json",
  "output/white-rabbit-dallas-parcel-permit-join.geojson",
  "public/data/permits/manifest.json",
  "public/data/permits/search-index.json",
];

for (const relative of requiredFiles) {
  const file = path.join(root, relative);
  assert(fs.existsSync(file), `Missing permit pipeline output: ${relative}`);
  assert(fs.statSync(file).size > 0, `Permit pipeline output is empty: ${relative}`);
}

const schema = readJson(path.join(root, "output", "permit-schema-report.json"));
assert(schema.sources.length >= 2, "Permit schema report should include both official sources");
assert(schema.sources.some((source) => source.datasetIdentifier === "e7gq-4sah"), "Missing Building Permits source");
assert(schema.sources.some((source) => source.datasetIdentifier === "9qet-qt9e"), "Missing Certificates of Occupancy source");

const manifest = readJson(path.join(root, "public", "data", "permits", "manifest.json"));
assert(manifest.permitCount === 150571, "Permit manifest should expose all mined permit rows");
assert(manifest.joinedPermitCount > 0, "At least one permit should join to a parcel");
assert(manifest.unmatchedPermitCount >= 0, "Permit manifest should report unmatched rows");
assert(manifest.chunkCount > 1, "Permit service should be chunked for viewport loading");
assert(manifest.searchIndexCount === manifest.permitCount, "Permit search index should cover all permits");

const locatedChunk = manifest.chunks.find((chunk) => chunk.bounds && chunk.count > 0);
assert(locatedChunk, "Expected at least one located permit chunk");
const chunkPayload = readJson(path.join(root, "public", "data", "permits", locatedChunk.file));
assert(chunkPayload.permits.length > 0, "Located permit chunk should contain permit records");
assert(chunkPayload.permits.some((permit) => permit.parcelAccountNum), "Located permit chunk should include parcel-linked permits");
assert(chunkPayload.permits.every((permit) => !permit.ownerPhone && !permit.ownerEmail), "Permit contractor/applicant contacts must not be promoted to owner contact fields");

console.log("White Rabbit permit pipeline tests passed.");
