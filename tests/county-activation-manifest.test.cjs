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

assert.equal(report.schemaVersion, "wr-county-activation-manifest-v1");
assert.equal(report.pageDesignChanged, false);
assert.equal(report.summary.candidateCount, 10);
assert.equal(report.summary.visibleActivationCount, 0);
assert.equal(report.summary.blockedCount, 10);
assert.equal(report.summary.unknownParcelFreshnessCount, 10);
assert.deepEqual(report.baseline.visibleCountyIds, ["dallas-county-dcad"]);
assert.equal(report.baseline.exactParcelFeatureCount, 696601);
assert.equal(report.baseline.exactSearchShardCount, 1224);
assert.equal(report.baseline.dcadLikeWindowReady, true);
assert(report.counties.every((county) => county.activationDecision === "do-not-activate"));
assert(report.counties.every((county) => county.gates.evidenceReportsPresent === true));
assert(report.counties.every((county) => county.controls.registrySelectable === false));
assert(report.counties.every((county) => county.gates.upstreamFreshnessCurrent === false));
assert(report.counties.every((county) => county.blockers.length > 0));
assert(report.counties.some((county) => county.gates.fullParcelService && !county.visibilityAuthorized));
assert(report.counties.every((county) => county.gates.fullParcelService), "All ten priority counties now have a full parcel-service artifact");
assert.equal(report.summary.mapSearchCapableButBlockedCount, 10);

for (const countyId of ["tarrant-county-tad", "jefferson-ky", "harris-county-tx", "maricopa-county-az", "king-county-wa"]) {
  const escaped = countyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert(new RegExp(`id: "${escaped}"[\\s\\S]{0,350}?enabled: false`).test(registry), `${countyId} must remain disabled in the selector registry`);
}
assert(registry.includes("id: activeCountyDataset.id") && registry.includes("enabled: true"), "Dallas must remain enabled");
assert(featureGates.includes("priorityCountyActivation: false"), "County activation feature gate must remain default-off");
assert(!app.includes("county-activation-manifest"), "The activation manifest must not be wired into visible pages");
assert(markdown.includes("# County Activation Manifest") && markdown.includes("Exact blockers"));
assert(fs.existsSync(path.join(root, "data", "schemas", "county-activation-manifest.schema.json")));

console.log("White Rabbit county activation manifest tests passed.");
