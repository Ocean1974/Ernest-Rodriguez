const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const manifest = readJson("public/data/counties/collin-county-tx/zoning/manifest.json");
const parcelManifest = readJson("public/data/counties/collin-county-tx/parcels/manifest.json");
const adapter = readJson("data/county-adapters/collin-county-tx/adapter.json");
const layer = adapter.optionalLayers.find((item) => item.id === "zoning-intelligence");

assert(manifest.status === "parcel-index-ready-partial-municipal-coverage", "Collin zoning must have a bounded partial-coverage status");
assert(manifest.sources.length >= 11, "Collin zoning must retain official municipal source lineage");
assert(manifest.parcelServiceCount === parcelManifest.featureCount, "Collin zoning must reconcile to the advertised parcel service");
assert(Object.values(manifest.parcelIndexShards.counts).reduce((sum, count) => sum + count, 0) === manifest.parcelIndexCount, "Collin zoning shards must reconcile");
assert(manifest.parcelZoningJoin.limitation.includes("Unmatched parcels remain unknown"), "Collin zoning must not infer missing districts");
assert(layer.joinBehavior.includes("unmatched districts remain unknown"), "Collin adapter must retain the zoning limitation");
assert(adapter.verifiedCounts.parcelsWithMunicipalZoning === manifest.parcelIndexCount, "Collin adapter zoning count must reconcile");

console.log("White Rabbit Collin development-control context tests passed.");
