const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
execFileSync("node", ["scripts/build-tx-ky-80-percent-program.cjs"], { cwd: root, stdio: "pipe" });
const report = JSON.parse(fs.readFileSync(path.join(root, "output/tx-ky-80-percent-program/tx-ky-80-percent-program.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "output/tx-ky-80-percent-program/tx-ky-80-percent-program.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(report.schemaVersion, "wr-tx-ky-80-percent-program-v1");
assert.equal(report.summary.totalCountyCount, 374);
assert.equal(report.summary.states.TX.countyCount, 254);
assert.equal(report.summary.states.KY.countyCount, 120);
assert.equal(report.standard.minimumPassingGroupCount, 12);
assert.equal(report.standard.actualPassingPercent, 85.7);
assert.equal(report.blocks[0].name, "big-city-bridge");
assert.equal(report.blocks[0].executionStatus, "active");
assert(report.blocks[0].counties.some((county) => county.primaryMarket === "Houston"));
assert(report.blocks[0].counties.some((county) => county.primaryMarket === "Louisville"));
assert(report.blocks[0].counties.some((county) => county.primaryMarket === "Lexington"));

const counties = report.blocks.flatMap((block) => block.counties);
assert.equal(counties.length, 374);
assert.equal(new Set(counties.map((county) => county.fips)).size, 374);
assert(counties.every((county) => county.state === "TX" || county.state === "KY"));
assert(counties.every((county) => county.readyGroups.includes("migration-demand")));
assert(counties.every((county) => county.migrationDemandEvidence?.status === "ready-aggregate-geography-context"));
assert(counties.filter((county) => county.meets80PercentIntelligence).every((county) => county.readyIntelligenceGroupCount >= 12));
assert(counties.filter((county) => county.productionAuthorized).every((county) => county.meets80PercentIntelligence));
assert(counties.filter((county) => county.currentStage === "scaffolded").every((county) => !county.productionAuthorized));
assert(report.activationPolicy.includes("Fail closed"));
assert(report.cityRankingPolicy.includes("100 down"));
assert(markdown.includes("12 of 14 groups (85.7%)"));
assert.equal(packageJson.scripts["county:tx-ky-80-percent"], "node scripts/build-tx-ky-80-percent-program.cjs");
assert.equal(packageJson.scripts["test:tx-ky-80-percent"], "node tests/tx-ky-80-percent-program.test.cjs");

console.log("White Rabbit Texas/Kentucky 80 percent parcel-intelligence program tests passed.");
