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

assert(packageJson.scripts["county:tx-ky-start"] === "node scripts/seed-tx-ky-county-adapters.cjs", "Package scripts must expose the TX/KY county start seeder");

execFileSync("node", ["scripts/seed-tx-ky-county-adapters.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/tx-ky-county-start/tx-ky-county-start-report.json");
const reportMd = fs.readFileSync(path.join(root, "output", "tx-ky-county-start", "tx-ky-county-start-report.md"), "utf8");
const expected = ["el-paso-county-tx", "montgomery-county-tx", "williamson-county-tx", "fayette-county-ky"];

assert(report.version === "wr-tx-ky-county-start-v1", "TX/KY start report must use a stable version");
assert(report.uiConstraint.includes("Do not redesign"), "TX/KY start report must preserve the no-redesign rule");
assert(report.stateGate.activeState === "TX", "TX must remain the active work state");
assert(report.stateGate.kentuckyMode === "prep-only-until-texas-complete", "Kentucky must stay prep-only until Texas is complete");
assert(expected.every((countyId) => report.seeded.some((item) => item.countyId === countyId)), "Report must include all new TX/KY counties");

for (const countyId of expected) {
  const adapter = readJson(`data/county-adapters/${countyId}/adapter.json`);
  const pipeline = readJson(`data/county-adapters/${countyId}/pipeline.json`);
  assert(adapter.status === "pilot", `${countyId} must remain pilot-only`);
  const sourceAudited = String(adapter.publicSourceDiscovery?.status || "").includes("audited");
  if (sourceAudited) {
    assert(adapter.joinKeys.primaryParcelAccount.startsWith("unresolved:"), `${countyId} audited non-unique join key must remain explicitly unresolved`);
    assert(adapter.verifiedCounts.parcelGeometryFeatures > 0, `${countyId} audited source must preserve its verified feature count`);
  } else {
    assert(adapter.sourceFiles.parcelGeometry === "source-needed", `${countyId} parcel geometry must remain source-needed`);
    assert(adapter.joinKeys.primaryParcelAccount.includes("source-needed"), `${countyId} primary join key must remain source-needed`);
    assert(adapter.verifiedCounts.parcelGeometryFeatures === 0, `${countyId} must not fake verified parcel counts`);
  }
  assert(adapter.optionalLayers.every((layer) => layer.defaultVisible === false), `${countyId} optional layers must stay default-off`);
  assert(pipeline.steps.some((step) => step.id === "verify-official-sources"), `${countyId} pipeline must start with source verification`);
  assert(pipeline.uiConstraint.includes("Do not redesign"), `${countyId} pipeline must protect the UI baseline`);
}

assert(reportMd.includes("TX/KY County Start Report"), "TX/KY markdown report must exist");

console.log("White Rabbit TX/KY county start tests passed.");
