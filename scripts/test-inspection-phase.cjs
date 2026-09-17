const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourceZips = [
  "data/raw/PARCEL_GEOM.zip",
  "data/raw/DCAD2026_CURRENT.ZIP",
  "data/raw/BLKID.zip",
  "data/raw/ParcelDimension.zip",
];

const extractedPaths = [
  "data/extracted/PARCEL_GEOM",
  "data/extracted/DCAD2026_CURRENT",
  "data/extracted/BLKID",
  "data/extracted/ParcelDimension",
];

for (const relativePath of sourceZips) {
  assert(fs.existsSync(path.join(root, relativePath)), `${relativePath} is missing`);
}

for (const relativePath of extractedPaths) {
  const fullPath = path.join(root, relativePath);
  assert(fs.existsSync(fullPath), `${relativePath} was not extracted`);
  assert(fs.readdirSync(fullPath).length > 0, `${relativePath} is empty`);
}

const parcelCountFile = path.join(root, "output", "parcel-count.txt");
const schemaReportFile = path.join(root, "output", "schema-report.json");
const schemaReportMd = path.join(root, "output", "schema-report.md");
const joinKeyReportFile = path.join(root, "output", "join-key-report.md");
const fullAccessReport = path.join(root, "output", "full-parcel-access-report.md");

assert(fs.existsSync(parcelCountFile), "output/parcel-count.txt is missing");
assert(fs.existsSync(schemaReportFile), "output/schema-report.json is missing");
assert(fs.existsSync(schemaReportMd), "output/schema-report.md is missing");
assert(fs.existsSync(joinKeyReportFile), "output/join-key-report.md is missing");
assert(fs.existsSync(fullAccessReport), "output/full-parcel-access-report.md is missing");

const parcelCount = Number(fs.readFileSync(parcelCountFile, "utf8").trim());
assert(parcelCount > 1000, "parcel count is not greater than 1,000");

const schema = JSON.parse(fs.readFileSync(schemaReportFile, "utf8"));
assert(schema.sources.some((source) => source.filename === "PARCEL_GEOM.shp/.dbf"), "PARCEL_GEOM schema is missing");
assert(schema.sources.some((source) => source.filename === "ACCOUNT_INFO.CSV"), "ACCOUNT_INFO schema is missing");

const joinReport = fs.readFileSync(joinKeyReportFile, "utf8");
assert(joinReport.includes("PARCEL_GEOM.Acct -> DCAD ACCOUNT_NUM"), "primary join key is not documented");

console.log("White Rabbit inspection-phase tests passed.");
