const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const dallas = readJson("data/county-adapters/dallas/adapter.json");
const tarrant = readJson("data/county-adapters/tarrant/adapter.json");
const parcelManifest = readJson("public/data/parcels/manifest.json");
const permitManifest = readJson("public/data/permits/manifest.json");
const developmentIndex = readJson("public/data/developments/parcel-development-index.json");
const qcIndex = readJson("output/county-qc/index.json");
const dallasQc = readJson("output/county-qc/dallas-county-dcad.json");
const registrySource = fs.readFileSync(path.join(root, "src", "data", "countyRegistry.ts"), "utf8");
const countyConfigSource = fs.readFileSync(path.join(root, "src", "data", "countyConfig.ts"), "utf8");

const requiredDallasReports = [
  "output/schema-report.md",
  "output/schema-report.json",
  "output/join-key-report.md",
  "output/full-parcel-access-report.md",
  "output/dcad-county-adapter-report.md",
  "output/dallas-stability-lock-report.md",
  "output/final-acceptance-criteria.md",
  "output/county-adapter-architecture-report.md",
  "output/county-qc/dallas-county-dcad.md",
  "output/county-qc/dallas-county-dcad.json",
];

for (const reportPath of requiredDallasReports) {
  assert(exists(reportPath), `Dallas pre-expansion report is missing: ${reportPath}`);
}

assert(dallas.id === "dallas-county-dcad", "Dallas adapter id must be locked before expansion");
assert(dallas.status === "active", "Dallas must be the only active production adapter before expansion");
assert(tarrant.status === "pilot", "Next county must remain pilot-only before Dallas expansion gate is cleared");
assert(countyConfigSource.includes('id: "dallas-county-dcad"'), "Live app config must still activate Dallas/DCAD");
assert(!countyConfigSource.includes('id: "tarrant-county-tad"'), "Pilot county must not be activated in live config");
assert(registrySource.includes("enabled: true"), "County registry must keep Dallas enabled");
assert(registrySource.includes('id: "tarrant-county-tad"') && registrySource.includes("enabled: false"), "County registry must keep source-needed pilots disabled");
assert(registrySource.includes("pilot-online-sample"), "County registry must allow built sample counties through the pilot-online path");

assert(dallasQc.status === "pass", "Dallas QC must pass before expanding");
assert(dallasQc.failCount === 0, "Dallas QC must have zero failures before expanding");
assert(dallasQc.warningCount === 0, "Dallas QC must have zero warnings before expanding");
assert(qcIndex.failCount === 0, "County QC index must have zero failures");

assert(parcelManifest.source === dallas.productionOutputs.parcelGeojson, "Live parcel manifest must point to Dallas output");
assert(parcelManifest.featureCount === dallas.verifiedCounts.parcelGeometryFeatures, "Dallas parcel count must match verified count");
assert(parcelManifest.chunkCount === dallas.verifiedCounts.appParcelChunks, "Dallas chunk count must match verified count");
assert(Object.keys(parcelManifest.searchIndexShards.files).length === dallas.verifiedCounts.parcelSearchShards, "Dallas search shard count must match verified count");
assert(permitManifest.permitCount === dallas.verifiedCounts.sourcePermitRecords, "Dallas permit source count must match verified count");
assert(permitManifest.joinedPermitCount === dallas.verifiedCounts.permitRowsJoined, "Dallas joined permits must match verified count");
assert(permitManifest.unmatchedPermitCount === dallas.verifiedCounts.permitRowsUnmatched, "Dallas unmatched permits must match verified count");
assert(developmentIndex.parcelCount === dallas.verifiedCounts.parcelsWithDevelopmentSignals, "Dallas development parcel count must match verified count");

assert(dallas.joinKeys.primaryParcelAccount.includes("PARCEL_GEOM.Acct"), "Dallas primary parcel join key must be documented");
assert(dallas.joinKeys.blockLabels.includes("spatial/nearest-label"), "Dallas BLKID join uncertainty must stay documented");
assert(dallas.joinKeys.dimensions.includes("spatial/nearest-label"), "Dallas ParcelDimension join uncertainty must stay documented");
assert(dallas.ownerEnrichment.officialJoinKey === "PARCEL_GEOM.Acct -> DCAD ACCOUNT_INFO.ACCOUNT_NUM", "Dallas owner enrichment join key must be locked");

console.log("Dallas pre-expansion gate tests passed.");
