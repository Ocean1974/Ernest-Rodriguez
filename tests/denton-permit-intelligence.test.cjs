const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const permits = readJson("public/data/counties/denton-county-tx/permits/manifest.json");
const developments = readJson("public/data/counties/denton-county-tx/developments/parcel-development-index.json");
const report = readJson("output/denton-county-tx/denton-permit-intelligence-report.json");
const adapter = readJson("data/county-adapters/denton-county-tx/adapter.json");
const permitLayer = adapter.optionalLayers.find((item) => item.id === "permits");
const developmentLayer = adapter.optionalLayers.find((item) => item.id === "development-signals");

assert(permits.status === "parcel-index-ready-current-partial-municipal-coverage", "Denton permit status must retain bounded municipal coverage");
assert(permits.permitCount === permits.joinedPermitCount + permits.unmatchedPermitCount + permits.ambiguousPermitCount, "Denton permit outcomes must reconcile");
assert(permits.chunks.reduce((sum, chunk) => sum + chunk.count, 0) === permits.joinedPermitCount, "Denton permit chunks must reconcile");
assert(report.parcelRecordsScanned === report.sourceParcelRecords, "Denton permit build must scan the full parcel service");
assert(developments.parcelCount === permits.parcelsWithPermits, "Denton development and permit parcel coverage must reconcile");
assert(adapter.verifiedCounts.permitRowsJoined === permits.joinedPermitCount, "Denton adapter permit count must reconcile");
assert(adapter.verifiedCounts.parcelsWithDevelopmentSignals === developments.parcelCount, "Denton adapter development count must reconcile");
assert(permitLayer.joinBehavior.includes("SITE_APN"), "Denton permit layer must disclose the exact APN join");
assert(developmentLayer.joinBehavior.includes("municipal coverage only"), "Denton development layer must not overclaim countywide coverage");
assert(permits.source.datasetId && permits.source.resourceId && permits.source.sha256, "Denton permit lineage must preserve dataset/resource IDs and hash");

console.log("White Rabbit Denton permit intelligence tests passed.");
