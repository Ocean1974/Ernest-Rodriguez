const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const adapter = readJson("data/county-adapters/louisville/adapter.json");
const pipeline = readJson("data/county-adapters/louisville/pipeline.json");
const packageJson = readJson("package.json");
const script = fs.readFileSync(path.join(root, "scripts/build-jefferson-ky-address-index.cjs"), "utf8");

assert.equal(packageJson.scripts["county:jefferson-addresses"], "node scripts/build-jefferson-ky-address-index.cjs");
assert.equal(adapter.sourceFiles.addressesRaw, "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataAddresses/MapServer/0");
const addressLayer = adapter.optionalLayers.find((layer) => layer.id === "lojic-address-intelligence");
assert(addressLayer, "Jefferson adapter must register LOJIC address intelligence");
assert.equal(addressLayer.status, "parcel-index-ready-production-disabled");
assert(pipeline.steps.some((step) => step.command === "node scripts/build-jefferson-ky-address-index.cjs"));
assert(script.includes("PARCELID,LRSN"));
assert(script.includes("open-data-pddl-terms-verified"));

const manifestPath = path.join(root, "public/data/counties/jefferson-ky/addresses/manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = readJson("public/data/counties/jefferson-ky/addresses/manifest.json");
  assert.equal(manifest.fetchedAddressPointCount, manifest.sourceAddressPointCount);
  assert.equal(manifest.matchedAddressPointCount + manifest.unmatchedAddressPointCount, manifest.sourceAddressPointCount);
  assert.equal(manifest.sourceAddressPointCount, 450857);
  assert.equal(manifest.matchedAddressPointCount, 449474);
  assert.equal(manifest.unmatchedAddressPointCount, 1383);
  assert.equal(manifest.parcelCountWithAddress, 275307);
  assert.equal(manifest.productionActivation, false);
}

console.log("Jefferson County LOJIC address index tests passed.");
