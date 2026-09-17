const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

const packageJson = readJson("package.json");
assert(
  packageJson.scripts["county:tx-ky-verification-queues"] === "node scripts/build-tx-ky-verification-queues.cjs",
  "Package scripts must expose concurrent TX/KY verification queues",
);

execFileSync("node", ["scripts/build-tx-ky-verification-queues.cjs"], { cwd: root, stdio: "pipe" });
const report = readJson("output/tx-ky-verification-queues/tx-ky-verification-queues.json");
const markdown = fs.readFileSync(
  path.join(root, "output", "tx-ky-verification-queues", "tx-ky-verification-queues.md"),
  "utf8",
);

assert(report.version === "wr-tx-ky-verification-queues-v1", "TX/KY queues must use a stable version");
assert(report.activeStates.join(",") === "TX,KY", "Texas and Kentucky must both be active");
assert(report.summary.totalCounties === 374, "TX/KY queues must cover 254 Texas and 120 Kentucky counties");
assert(report.uiConstraint.includes("Do not redesign"), "TX/KY queues must preserve the locked UI");
assert(report.states.length === 2 && report.states.every((state) => state.active), "Both state queues must be active");
const texas = report.states.find((state) => state.state === "TX");
const kentucky = report.states.find((state) => state.state === "KY");
assert(texas.total === 254, "Texas queue must cover 254 counties");
assert(kentucky.total === 120, "Kentucky queue must cover 120 counties");
assert(texas.activeBatch.counties[0].adapterId === "harris-county-tx", "Harris must lead the Texas completion batch");
assert(kentucky.activeBatch.counties[0].adapterId === "jefferson-ky", "Jefferson must lead the Kentucky completion batch");
assert(
  report.states.every((state) =>
    state.activeBatch.counties.every(
      (county) => county.canActivate === false && county.activationStatus === "do-not-activate-until-county-gate-passes",
    ),
  ),
  "Every active-batch county must remain disabled until its county gate passes",
);
assert(markdown.includes("Texas and Kentucky Verification Queues"), "TX/KY queue markdown must exist");
assert(markdown.includes("Do not redesign"), "TX/KY queue markdown must preserve the UI constraint");

console.log("White Rabbit Texas/Kentucky verification queue tests passed.");
