const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
execFileSync("node", ["scripts/build-county-activation-manifest.cjs"], { cwd: root, stdio: "pipe" });

const report = JSON.parse(fs.readFileSync(path.join(root, "output", "county-activation-manifest.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "output", "county-activation-manifest.md"), "utf8");
const registry = fs.readFileSync(path.join(root, "src", "data", "countyRegistry.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const featureGates = fs.readFileSync(path.join(root, "src", "data", "platformFeatureGates.ts"), "utf8");
const collinAdapter = JSON.parse(fs.readFileSync(path.join(root, "data", "county-adapters", "collin-county-tx", "adapter.json"), "utf8"));

assert.equal(report.schemaVersion, "wr-county-activation-manifest-v1");
assert.equal(report.pageDesignChanged, false);
assert.equal(report.summary.candidateCount, 10);
assert.equal(report.summary.visibleActivationCount, 2);
assert.equal(report.summary.blockedCount, 8);
assert.equal(report.summary.unknownParcelFreshnessCount, 8);
assert.deepEqual(report.baseline.visibleCountyIds, ["dallas-county-dcad", "harris-county-tx", "collin-county-tx"]);
assert.equal(report.baseline.exactParcelFeatureCount, 696601);
assert.equal(report.baseline.exactSearchShardCount, 1224);
assert.equal(report.baseline.dcadLikeWindowReady, true);
assert.equal(report.counties.find((county) => county.countyId === "harris-county-tx")?.activationDecision, "activate");
assert.equal(report.counties.find((county) => county.countyId === "collin-county-tx")?.activationDecision, "activate");
assert(report.counties.filter((county) => !["harris-county-tx", "collin-county-tx"].includes(county.countyId)).every((county) => county.activationDecision === "do-not-activate"));
assert(report.counties.every((county) => county.gates.evidenceReportsPresent === true));
assert.equal(report.counties.find((county) => county.countyId === "harris-county-tx")?.controls.registrySelectable, true);
assert.equal(report.counties.find((county) => county.countyId === "collin-county-tx")?.controls.registrySelectable, true);
assert(report.counties.filter((county) => !["harris-county-tx", "collin-county-tx"].includes(county.countyId)).every((county) => county.controls.registrySelectable === false));
assert.equal(report.counties.find((county) => county.countyId === "harris-county-tx")?.gates.upstreamFreshnessCurrent, true);
assert.equal(report.counties.find((county) => county.countyId === "harris-county-tx")?.blockers.length, 0);
assert.equal(report.counties.find((county) => county.countyId === "collin-county-tx")?.blockers.length, 0);
assert(report.counties.filter((county) => !["harris-county-tx", "collin-county-tx"].includes(county.countyId)).every((county) => county.blockers.length > 0));
assert(report.counties.some((county) => county.gates.fullParcelService && !county.visibilityAuthorized));
assert(report.counties.every((county) => county.gates.fullParcelService), "All ten priority counties now have a full parcel-service artifact");
assert.equal(report.summary.mapSearchCapableButBlockedCount, 8);

for (const countyId of ["tarrant-county-tad", "jefferson-ky", "maricopa-county-az", "king-county-wa"]) {
  const escaped = countyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert(new RegExp(`id: "${escaped}"[\\s\\S]{0,350}?enabled: false`).test(registry), `${countyId} must remain disabled in the selector registry`);
}
assert(new RegExp('id: "harris-county-tx"[\\s\\S]{0,350}?enabled: true').test(registry), "Harris must be enabled in the selector registry");
assert(new RegExp('id: "collin-county-tx"[\\s\\S]{0,350}?enabled: true').test(registry), "Collin must be enabled in the selector registry");
assert(registry.includes("id: activeCountyDataset.id") && registry.includes("enabled: true"), "Dallas must remain enabled");
assert(featureGates.includes("houstonMapSearch: true"), "The scoped Houston map/search feature gate must be enabled");
assert(featureGates.includes("collinMapSearch: true"), "The scoped Collin map/search feature gate must be enabled");
assert(featureGates.includes("priorityCountyActivation: false"), "The broader priority-county production gate must remain default-off");
assert(featureGates.includes("pmtilesRuntime: false"), "PMTiles must remain disabled until independently certified");
assert.equal(collinAdapter.activation.releaseTier, "map-search-pilot");
assert(collinAdapter.activation.excludedUntilCertified.includes("pmtiles-runtime"), "Collin activation must not imply PMTiles readiness");
assert(collinAdapter.activation.excludedUntilCertified.includes("full-production-release-tier"), "Collin activation must not imply full-production certification");
assert(!app.includes("county-activation-manifest"), "The activation manifest must not be wired into visible pages");
assert(app.includes("platformFeatureGates.houstonMapSearch"), "Houston place search must honor its scoped activation gate");
assert(app.includes("platformFeatureGates.collinMapSearch"), "Collin place search must honor its scoped activation gate");
assert(markdown.includes("# County Activation Manifest") && markdown.includes("Exact blockers"));
assert(fs.existsSync(path.join(root, "data", "schemas", "county-activation-manifest.schema.json")));

console.log("White Rabbit county activation manifest tests passed.");
