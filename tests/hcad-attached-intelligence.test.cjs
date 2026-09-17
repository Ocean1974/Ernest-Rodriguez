const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const loader = fs.readFileSync(path.join(root, "src/map/loadParcels.ts"), "utf8");
const audit = readJson("output/harris-county-tx/attached-gis-audit.json");
const manifest = readJson("public/data/counties/harris-county-tx/parcels/manifest.json");
const sidecarManifest = readJson("public/data/counties/harris-county-tx/parcels/intelligence/hcad-gis-public-2026-08-04/manifest.json");

assert.equal(audit.source.featureCount, 1546774);
assert.equal(audit.source.crs, "EPSG:2278");
assert.equal(audit.keyAudit.missing, 0);
assert.equal(audit.keyAudit.distinctNonblank, 1546749);
assert.equal(audit.keyAudit.duplicateExcess, 25);
assert.equal(audit.geometryAudit.nonpositiveOrNullShapeArea, 0);
assert.equal(audit.geometryAudit.nonpositiveOrNullShapeLength, 0);
assert.equal(audit.activation.authorized, false);
assert.equal(sidecarManifest.featureCount, audit.distribution.matchedExistingParcels);
assert.equal(sidecarManifest.chunkCount, audit.distribution.sidecarChunkCount);
assert.equal(manifest.intelligenceSidecars.featureCount, sidecarManifest.featureCount);
assert.equal(Object.keys(manifest.intelligenceSidecars.files).length, sidecarManifest.chunkCount);
assert(loader.includes("applyParcelIntelligenceSidecar"));
assert(loader.includes("hcadAttached: true"));
assert(loader.includes("loadParcelIntelligenceSidecar"));
console.log("White Rabbit attached HCAD parcel-intelligence tests passed.");

