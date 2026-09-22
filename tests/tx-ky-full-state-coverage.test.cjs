const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const universe = readJson("data/national-county-intelligence/us-county-universe.json");

assert(packageJson.scripts["county:tx-ky-full-coverage"] === "node scripts/seed-all-tx-ky-county-adapters.cjs", "Package scripts must expose full TX/KY coverage seeding");

execFileSync("node", ["scripts/seed-all-tx-ky-county-adapters.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/tx-ky-full-state-coverage/tx-ky-full-state-coverage-report.json");
const reportMd = fs.readFileSync(path.join(root, "output", "tx-ky-full-state-coverage", "tx-ky-full-state-coverage-report.md"), "utf8");
const targets = universe.counties.filter((county) => county.state === "TX" || county.state === "KY");
const canonicalIds = new Map([
  ["dallas-county-tx", "dallas-county-dcad"],
  ["tarrant-county-tx", "tarrant-county-tad"],
  ["jefferson-county-ky", "jefferson-ky"],
]);

assert(report.version === "wr-tx-ky-full-state-coverage-v1", "Full-state report must use a stable version");
assert(report.uiConstraint.includes("Do not redesign"), "Full-state report must preserve the UI constraint");
assert(report.stateCounts.TX === 254, "Texas county coverage must include all 254 counties");
assert(report.stateCounts.KY === 120, "Kentucky county coverage must include all 120 counties");
assert(report.stateCounts.total === 374, "TX/KY county coverage must include 374 counties total");
assert(report.stateGate.activeStates.join(",") === "TX,KY", "Texas and Kentucky must both remain active state pipelines");
assert(report.stateGate.kentuckyMode === "active-concurrent-state-pipeline", "Kentucky must advance concurrently with Texas");
assert(report.completionMeaning.includes("source-needed"), "Report must distinguish adapter coverage from verified data completion");
assert(report.createdCount === 0, "Rerunning full-state coverage must not duplicate existing adapters");
assert(report.synchronizedExistingCount === 371, "All non-alias Texas/Kentucky pipelines must be synchronized");
assert(report.preservedPromotedAliasCount === 3, "Dallas, Tarrant, and Jefferson bespoke pipelines must be preserved");
assert(targets.every((county) => {
  const adapterId = canonicalIds.get(county.countyId) || county.countyId;
  if (["dallas-county-dcad", "tarrant-county-tad"].includes(adapterId)) {
    const folder = adapterId === "dallas-county-dcad" ? "dallas" : "tarrant";
    return fs.existsSync(path.join(root, "data", "county-adapters", folder, "adapter.json"));
  }
  if (adapterId === "jefferson-ky") return fs.existsSync(path.join(root, "data", "county-adapters", "louisville", "adapter.json"));
  return fs.existsSync(path.join(root, "data", "county-adapters", adapterId, "adapter.json"));
}), "Every TX/KY county must have an adapter shell or established legacy adapter");
assert(report.seeded.some((county) => county.censusCountyId === "dallas-county-tx" && county.countyId === "dallas-county-dcad"), "Dallas Census county must map to the DCAD model adapter");
assert(report.seeded.some((county) => county.censusCountyId === "tarrant-county-tx" && county.countyId === "tarrant-county-tad"), "Tarrant Census county must map to the TAD pilot adapter");
assert(report.seeded.some((county) => county.censusCountyId === "jefferson-county-ky" && county.countyId === "jefferson-ky"), "Jefferson KY Census county must map to the Louisville pilot adapter");

const canonicalStepIds = [
  "verify-official-sources", "verify-join-keys", "build-parcel-geojson", "build-parcel-service",
  "build-owner-matches", "build-permit-service", "build-zoning-index", "build-floodplain-index",
  "build-development-index", "build-migration-demand", "validate",
];
for (const item of report.seeded) {
  const adapter = readJson(item.adapterPath);
  const pipeline = readJson(item.pipelinePath);
  const promotedAlias = ["dallas-county-dcad", "tarrant-county-tad", "jefferson-ky"].includes(item.countyId);
  if (!promotedAlias) {
    assert(canonicalStepIds.every((id) => pipeline.steps.some((step) => step.id === id)), `${item.countyId} must include every canonical pipeline stage`);
    assert(["parcel-dimensions", "block-grid", "development-signals"].every((id) => adapter.optionalLayers.some((layer) => layer.id === id)), `${item.countyId} must scaffold dimension, block, and development layers`);
    assert(adapter.publicSourceDiscovery?.problemSolvingLoop?.length === 6, `${item.countyId} must publish the county problem-solving loop`);
  }
  assert(pipeline.pipelineContract?.mode === "evidence-gated", `${item.countyId} must publish the evidence-gated pipeline contract`);
  assert(pipeline.pipelineContract?.failurePolicy.includes("never hide"), `${item.countyId} must preserve count discrepancies`);
  assert(pipeline.productionTileStep?.expectedOutput, `${item.countyId} must retain a production tile handoff`);
  if (item.countyId === "harris-county-tx") {
    assert(pipeline.enabledForProduction === true && pipeline.activationScope === "map-search-pilot", "Harris must be explicitly limited to its authorized map/search pilot scope");
  } else {
    assert(pipeline.enabledForProduction !== true, `${item.countyId} must not be automatically enabled for production`);
  }
}

assert(readJson("data/county-adapters/collin-county-tx/adapter.json").verifiedCounts.parcelGeometryFeatures === 441252, "Synchronization must preserve Collin's exact current-refresh polygon count");
assert(readJson("data/county-adapters/denton-county-tx/adapter.json").verifiedCounts.parcelGeometryFeatures === 384684, "Synchronization must preserve Denton's promoted exact count");
assert(readJson("data/county-adapters/collin-county-tx/pipeline.json").steps.find((step) => step.id === "build-parcel-service").command === "npm.cmd run collin:ccad:service:refresh", "Synchronization must preserve Collin's executable current-refresh service command");
assert(readJson("data/county-adapters/denton-county-tx/pipeline.json").steps.find((step) => step.id === "build-parcel-service").command === "npm.cmd run denton:service:sample", "Synchronization must preserve Denton's executable sample command");

for (const item of report.seeded.filter((seed) => seed.status === "created-source-needed-shell").slice(0, 25)) {
  const adapter = readJson(item.adapterPath);
  const pipeline = readJson(item.pipelinePath);
  assert(adapter.status === "pilot", `${item.countyId} must remain pilot-only`);
  assert(adapter.sourceFiles.parcelGeometry === "source-needed", `${item.countyId} must not fake parcel geometry`);
  assert(adapter.joinKeys.primaryParcelAccount.includes("source-needed"), `${item.countyId} must not fake join keys`);
  assert(adapter.verifiedCounts.parcelGeometryFeatures === 0, `${item.countyId} must not fake counts`);
  assert(adapter.optionalLayers.every((layer) => layer.defaultVisible === false), `${item.countyId} optional layers must stay default-off`);
  assert(pipeline.uiConstraint.includes("Do not redesign"), `${item.countyId} pipeline must protect the UI baseline`);
}

assert(reportMd.includes("TX/KY Full-State County Coverage Report"), "Full-state markdown report must exist");
assert(reportMd.includes("Texas counties tracked: 254"), "Markdown must report all Texas counties");
assert(reportMd.includes("Kentucky counties tracked: 120"), "Markdown must report all Kentucky counties");

console.log("White Rabbit TX/KY full-state coverage tests passed.");
