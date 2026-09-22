const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "output/collin-county-tx/ccad-kmz-audit.json"), "utf8"));
const adapter = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/collin-county-tx/adapter.json"), "utf8"));
const pipeline = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/collin-county-tx/pipeline.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(report.status === "verified-partial-redundant-delivery-wgs84-geometry-cross-check", "KMZ role must be classified without double counting");
assert(report.activationAuthorized === false, "KMZ must not bypass activation gates");
assert(report.schema.kmzFieldCount === 113, "KMZ popup schema must contain the expected 113 fields");
assert(report.schema.fieldSetsMatchExceptObjectId === true, "KMZ schema must match the current CSV except OBJECTID");
assert(report.schema.newFieldsBeyondCurrentCsv.length === 0, "KMZ must not be credited with fields it does not add");
assert(report.features.placemarkCount === 206204 && report.features.globalIdNonblank === 206204, "KMZ feature and identity counts must stay exact");
assert(report.features.globalIdMissing === 0 && report.features.globalIdDuplicates === 0, "KMZ GlobalIDs must be complete and duplicate-free within the partial export");
assert(report.reconciliation.globalIdOverlap === 206204, "Every supplied KMZ parcel ID must reconcile to current intelligence");
assert(report.reconciliation.kmzOnlyGlobalIds === 0, "KMZ must not introduce foreign parcel identities");
assert(report.reconciliation.intelligenceOnlyGlobalIds === 235074, "KMZ must be classified as a partial, not complete, county export");
assert(report.reconciliation.currentRefreshCoveragePercent === 46.7288, "KMZ current-refresh coverage must stay exact");
assert(report.incrementalIntelligenceGroups.length === 0, "Redundant delivery must not inflate the intelligence score");
assert(report.scoreImpact.beforePercent === 92.9 && report.scoreImpact.afterPercent === 92.9, "KMZ must preserve the evidence-backed score");
assert(adapter.verifiedCounts.ccadKmzGlobalIdsMatchedToRefresh === 206204, "Adapter must preserve the audited KMZ match count");
assert(adapter.verifiedCounts.ccadKmzCurrentRefreshCoveragePercent === 46.7288, "Adapter must preserve the audited KMZ coverage");
assert(pipeline.steps.some((step) => step.id === "audit-ccad-kmz" && step.command === "npm.cmd run collin:ccad:kmz:audit"), "County pipeline must register the KMZ audit step");

console.log("Collin CCAD KMZ audit tests passed.");
