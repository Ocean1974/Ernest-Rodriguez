const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const packageJson = readJson("package.json");
assert(packageJson.scripts["county:kentucky-source-audit"] === "node scripts/build-kentucky-source-audit-report.cjs", "Package scripts must expose the Kentucky source audit");

execFileSync("node", ["scripts/build-kentucky-source-audit-report.cjs"], { cwd: root, stdio: "pipe" });
const report = readJson("output/kentucky-source-audit/kentucky-source-audit.json");
const markdown = fs.readFileSync(path.join(root, "output", "kentucky-source-audit", "kentucky-source-audit.md"), "utf8");

assert(report.version === "wr-kentucky-source-audit-v1", "Kentucky source audit must use a stable version");
assert(report.batchCount === 5, "Kentucky's 120 counties must be covered by five 25-county batches");
assert(report.summary.countyCount === 120, "Kentucky source audit must cover all 120 counties");
assert(report.counties.every((county) => county.state === "KY"), "Kentucky source audit must remain state-scoped");
assert(report.counties.every((county) => county.safeVisibleActivation === "do-not-activate-until-county-gate-passes"), "Every Kentucky county must remain individually activation-gated");
assert(report.counties.every((county) => county.remainingBlockers.length > 0), "Every incomplete Kentucky county must publish remaining blockers");
const jefferson = report.counties.find((county) => county.adapterId === "jefferson-ky");
assert(jefferson?.auditStatus === "map-search-pilot-built", "Jefferson must remain the Kentucky map/search pilot");
assert(jefferson.exactCounts.parcelGeometryFeatures === 284553, "Jefferson's exact official source count must remain locked");
assert(jefferson.exactCounts.emittedParcelFeatures === 284552, "Jefferson's exact emitted parcel count must remain locked");
assert(jefferson.exactCounts.geometrySkipped === 1, "Jefferson's source-to-emitted geometry discrepancy must remain visible");
assert(report.counties.some((county) => county.adapterId === "fayette-county-ky"), "Kentucky audit must include Fayette County");
const probed = report.counties.filter((county) => county.sourceProbe?.status === "official-source-probed");
assert(probed.length === 7, "Kentucky audit must incorporate all seven verified live source probes");
assert(probed.every((county) => county.sourceProbe.captureAuthorized === false), "A source probe must not authorize full capture");
assert(probed.reduce((sum, county) => sum + county.sourceProbe.exactFeatureCount, 0) === 587316, "Kentucky live source counts must reconcile exactly");
assert(markdown.includes("Kentucky Source Audit"), "Kentucky source audit markdown must exist");
assert(markdown.includes("Every county remains disabled"), "Kentucky source audit must preserve the activation rule");

console.log("White Rabbit Kentucky source audit report tests passed.");
