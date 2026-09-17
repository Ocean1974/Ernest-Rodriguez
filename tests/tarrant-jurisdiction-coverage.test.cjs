const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (value) => JSON.parse(fs.readFileSync(path.join(root, value), "utf8"));

const registry = read("data/county-adapters/tarrant/jurisdiction-source-registry.json");
const artifact = read("output/tarrant/jurisdiction-coverage/tarrant-jurisdiction-coverage.json");
assert.equal(registry.municipalities.length, 41, "Official Tarrant planning universe must contain exactly 41 incorporated areas");
assert.equal(new Set(registry.municipalities).size, 41, "Incorporated area names must be unique");
assert.equal(artifact.universe.jurisdictions.length, 42, "Coverage universe must add one explicit unincorporated scope");
assert.equal(artifact.evidence.length, 3, "This discovery tranche must preserve the exact three verified official candidates");
assert(artifact.evidence.every((item) => item.status === "discovery-only" && item.captureAuthorized === false), "Discovery must never imply capture rights");
const zoning = artifact.report.plans.find((item) => item.layer === "zoning");
const permits = artifact.report.plans.find((item) => item.layer === "permits");
assert.equal(zoning.coveredJurisdictionIds.length, 0);
assert.equal(permits.coveredJurisdictionIds.length, 0);
assert.equal(zoning.uncoveredJurisdictionIds.length, 42);
assert.equal(permits.uncoveredJurisdictionIds.length, 42);
assert.equal(artifact.report.complete, false);
assert.equal(artifact.report.activationAuthorized, false);
const adapter = read("data/county-adapters/tarrant/adapter.json");
for (const id of ["permits", "zoning-intelligence", "floodplain-intelligence"]) {
  const layer = adapter.optionalLayers.find((item) => item.id === id);
  assert.equal(layer.defaultVisible, false);
  assert.equal(layer.status, "source-discovered-rights-needed");
}
console.log("White Rabbit Tarrant 42-scope source discovery coverage remains evidence-gated and default-off.");
