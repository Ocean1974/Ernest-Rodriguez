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

assert(packageJson.scripts["county:texas-verification-queue"] === "node scripts/build-texas-county-verification-queue.cjs", "Package scripts must expose the Texas verification queue");

execFileSync("node", ["scripts/build-texas-county-verification-queue.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/texas-county-verification-queue/texas-county-verification-queue.json");
const reportMd = fs.readFileSync(path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.md"), "utf8");

assert(report.version === "wr-texas-county-verification-queue-v1", "Verification queue must use a stable version");
assert(report.method.includes("Texas state queue"), "Verification queue must preserve Texas batch sequencing");
assert(report.summary.texasTotal === 254, "Verification queue must know Texas has 254 counties");
assert(report.summary.texasRemaining === report.summary.texasTotal - report.summary.texasCoreComplete, "Texas remaining count must match the completion gate");
assert(report.summary.kentuckyConcurrent === true, "Kentucky must advance through its own concurrent QC-gated queue");
assert(report.activeBatch.countyCount > 0, "Verification queue must have an active Texas batch");
assert(report.activeBatch.counties.every((county) => county.state === "TX"), "Active batch must include only Texas counties");
assert(report.activeBatch.counties.every((county) => county.status !== "core-complete"), "Active batch must not include completed counties");
assert(report.activeBatch.counties.every((county) => county.requiredEvidence.includes("exact join key from geometry to appraisal/account records")), "Each county must require exact join-key evidence");
assert(report.activeBatch.counties.every((county) => county.sourceSearchQueries.length >= 3), "Each county must carry source discovery queries");
assert(reportMd.includes("Texas County Verification Queue"), "Verification queue markdown must exist");

console.log("White Rabbit Texas county verification queue tests passed.");
