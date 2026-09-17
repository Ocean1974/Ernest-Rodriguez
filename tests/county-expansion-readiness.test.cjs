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

const scriptSource = fs.readFileSync(path.join(root, "scripts", "build-county-expansion-readiness.cjs"), "utf8");
assert(scriptSource.includes("single-active-county"), "Expansion readiness must enforce exactly one active county");
assert(scriptSource.includes("uncertain-joins-documented"), "Expansion readiness must preserve uncertain DCAD join documentation");
assert(scriptSource.includes("Do not redesign or restyle"), "Expansion readiness must preserve the locked UI constraint");

execFileSync("node", ["scripts/build-county-expansion-readiness.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/county-expansion-readiness-report.json");
const reportMd = fs.readFileSync(path.join(root, "output", "county-expansion-readiness-report.md"), "utf8");

assert(report.status === "ready", "Dallas/DCAD expansion gate should be ready before onboarding another county");
assert(report.activeAdapterId === "dallas-county-dcad", "Dallas/DCAD must remain the active adapter");
assert(report.activeCountyCount === 1, "Only one production county may be active");
assert(report.lockedDallasCounts.parcelGeometryFeatures === 696601, "Readiness report must lock the exact DCAD parcel count");
assert(report.lockedDallasCounts.permitRowsJoined === 97300, "Readiness report must lock the exact joined permit count");
assert(report.lockedDallasJoinKeys.primaryParcelAccount.includes("PARCEL_GEOM.Acct"), "Readiness report must include the primary DCAD join key");
assert(report.lockedDallasJoinKeys.dimensions.includes("spatial"), "Readiness report must document ParcelDimension spatial uncertainty");
assert(report.pilots.some((pilot) => pilot.adapterId === "tarrant-county-tad"), "Readiness report must include the Tarrant pilot");
const tarrant = report.pilots.find((pilot) => pilot.adapterId === "tarrant-county-tad");
assert(tarrant.enabledForProduction === false, "Pilot counties must not be production enabled");
assert(tarrant.missingSources.length > 0, "Tarrant pilot should still list missing source files");
assert(tarrant.placeholderJoinKeys.length > 0, "Tarrant pilot should still list placeholder join keys");
assert(reportMd.includes("County Expansion Readiness Report"), "Readiness markdown report must be written");
assert(reportMd.includes("Do not redesign or restyle"), "Readiness markdown must preserve the UI constraint");

console.log("White Rabbit county expansion readiness tests passed.");
