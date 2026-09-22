const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
execFileSync("node", ["scripts/build-national-exponential-rollout.cjs"], { cwd: root, stdio: "pipe" });
const report = JSON.parse(fs.readFileSync(path.join(root, "output/national-county-intelligence/exponential-rollout.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "output/national-county-intelligence/exponential-rollout.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(report.schemaVersion, "wr-national-exponential-rollout-v1");
assert.equal(report.summary.countyEquivalentCount, 3235);
assert.equal(report.summary.uniqueFipsCount, 3235);
assert.equal(report.summary.finalCumulativeCountyCount, 3235);
assert.equal(report.waves[0].targetCountyCount, 16);
assert.equal(report.summary.activeWorkBlock, 1);
assert.equal(report.waves[0].executionStatus, "active-work-block");
assert(report.waves.slice(1).every((wave) => wave.executionStatus === "queued-work-block"));

const counties = report.waves.flatMap((wave) => wave.counties);
assert.equal(counties.length, 3235);
assert.equal(new Set(counties.map((county) => county.fips)).size, 3235);
assert(counties.every((county) => /^\d{5}$/.test(county.fips)));
assert(counties.filter((county) => county.activationAuthorized).every((county) => county.currentStage === "live"));
assert(counties.filter((county) => county.currentStage === "scaffolded").every((county) => !county.activationAuthorized));
assert(report.waves.slice(0, -1).every((wave, index) => index === 0 || wave.targetCountyCount === report.waves[index - 1].targetCountyCount * 2));
assert(report.waves.at(-1).targetCountyCount <= report.waves.at(-2).targetCountyCount * 2);
assert(report.waves[0].counties.some((county) => county.countyName === "Dallas County" && county.state === "TX"));
assert(report.promotionContract.cityMarketRequirement.includes("100-to-1"));
assert(report.truthBoundary.includes("not a coverage claim"));
assert(markdown.includes("No empty county shell is presented as live parcel intelligence."));
assert.equal(packageJson.scripts["national:exponential-rollout"], "node scripts/build-national-exponential-rollout.cjs");
assert.equal(packageJson.scripts["test:national-exponential-rollout"], "node tests/national-exponential-rollout.test.cjs");

console.log("White Rabbit national exponential rollout tests passed.");
