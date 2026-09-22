const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "output/collin-county-tx/parcel-intelligence-readiness.json"), "utf8"));
const zoning = JSON.parse(fs.readFileSync(path.join(root, "public/data/counties/collin-county-tx/zoning/manifest.json"), "utf8"));
const flood = JSON.parse(fs.readFileSync(path.join(root, "public/data/counties/collin-county-tx/floodplain/manifest.json"), "utf8"));
const permits = JSON.parse(fs.readFileSync(path.join(root, "public/data/counties/collin-county-tx/permits/manifest.json"), "utf8"));
const adapter = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/collin-county-tx/adapter.json"), "utf8"));
const pipeline = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/collin-county-tx/pipeline.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(report.status === "ready-in-savant-tools", "Collin must be marked ready in Savant Tools");
assert(report.score.readyGroupCount === 14 && report.score.totalGroupCount === 14, "Collin score must be 14 of 14 groups");
assert(report.score.intelligencePercent === 100, "Collin parcel-intelligence readiness must be 100% of defined groups");
assert(report.score.missingGroups.length === 0, "No defined intelligence group may remain missing");
assert(report.production.activationAuthorized === true && report.production.visibleUiChanged === true, "Savant Tools activation must be recorded");
assert(zoning.parcelIndexCount === 317979, "Municipal zoning coverage must remain exact");
assert(flood.parcelServiceManifest.endsWith("parcels/manifest.json") && flood.parcelIndexCount === 441258, "Floodplain must target the live parcel service");
assert(permits.joinedPermitCount === 109634 && report.evidence.parcelsWithDevelopmentSignals === 91211, "Runtime permit and development joins must remain exact");
assert(adapter.verifiedCounts.permitRowsFutureDatedQuarantined === 71, "Adapter must expose the future-date permit quarantine");
assert(adapter.optionalLayers.find((layer) => layer.id === "permits")?.publicManifestPath?.includes("permits-refresh"), "Adapter permits must target the current CCAD refresh");
for (const id of ["build-ccad-refresh-centroids", "build-permit-service", "build-zoning-index", "build-floodplain-index", "score-parcel-intelligence-readiness"]) {
  assert(pipeline.steps.some((step) => step.id === id), `Pipeline must register ${id}`);
}

console.log("Collin parcel-intelligence readiness tests passed.");
