const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "raw", "travis-county-tx", "gis", "source-manifest.json"), "utf8"));

assert.strictEqual(manifest.schemaVersion, "wr-official-arcgis-capture-v1");
assert.strictEqual(manifest.countyId, "travis-county-tx");
assert.deepStrictEqual(manifest.sources.map((source) => source.id), [
  "austin-zoning",
  "austin-fully-developed-floodplain",
  "austin-fema-floodplain",
]);

for (const source of manifest.sources) {
  const file = path.join(root, source.file);
  assert(fs.existsSync(file), `${source.id} capture must exist`);
  assert.strictEqual(source.emittedFeatureCount, source.sourceFeatureCount, `${source.id} count must reconcile`);
  const bytes = fs.readFileSync(file);
  assert.strictEqual(bytes.length, source.bytes, `${source.id} byte count must match`);
  assert.strictEqual(crypto.createHash("sha256").update(bytes).digest("hex"), source.sha256, `${source.id} hash must match`);
  assert.strictEqual(bytes.toString("utf8").trimEnd().split("\n").length, source.emittedFeatureCount, `${source.id} NDJSON rows must match`);
}

console.log("Official Austin zoning and floodplain GIS capture tests passed.");
