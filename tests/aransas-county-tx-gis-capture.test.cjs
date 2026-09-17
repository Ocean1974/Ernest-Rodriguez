const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const captureRoot = path.join(root, "data", "raw", "aransas-county-tx", "public-gis-2026-09-12");
const manifest = JSON.parse(fs.readFileSync(path.join(captureRoot, "capture-manifest.json"), "utf8"));
const inventory = JSON.parse(fs.readFileSync(path.join(root, "data", "county-adapters", "aransas-county-tx", "aransas-county-gis-layer-inventory.json"), "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

assert.equal(manifest.countyFips, "48007");
assert.equal(manifest.activationAuthorized, false);
assert.equal(manifest.counts.aransasCountyBoundaryFeatures, 1);
assert.equal(manifest.counts.aransasCountyRoadFeatures, 2033);
assert.equal(manifest.counts.aransasAreaCensusPlaceFeatures, 3);
assert.equal(manifest.counts.femaFloodHazardEnvelopeFeatures, 1603);
assert.equal(manifest.counts.femaFloodHazardUniqueObjectIds, 1603);
assert.equal(manifest.counts.femaFloodHazardPages, 17);
assert.equal(inventory.layers.length, 20, "The BIS viewer inventory must retain all 20 observed layers");
assert.equal(inventory.layers.filter((layer) => layer.class === "licensed-imagery").length, 9);
assert(!inventory.layers.some((layer) => layer.captureStatus === "production-authorized"));

for (const item of [...manifest.sourceFiles, ...Object.values(manifest.outputs)]) {
  const file = path.join(captureRoot, item.file);
  assert(fs.existsSync(file), `${item.file} must exist`);
  assert.equal(fs.statSync(file).size, item.bytes, `${item.file} byte count must match`);
  assert.equal(sha256(file), item.sha256, `${item.file} SHA-256 must match`);
}

console.log("Real Estate Savant Aransas County public GIS capture tests passed.");
