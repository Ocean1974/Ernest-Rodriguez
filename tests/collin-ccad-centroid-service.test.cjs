const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serviceRoot = path.join(root, "public", "data", "counties", "collin-county-tx", "parcels-refresh");
const manifest = JSON.parse(fs.readFileSync(path.join(serviceRoot, "manifest.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(manifest.status === "refresh-spatial-join-service-not-visible-map-service", "Centroid service must not masquerade as visible polygon delivery");
assert(manifest.activationAuthorized === false, "Centroid service must remain activation gated");
assert(manifest.featureCount === 441278, "Centroid service must reconcile every FileGDB row");
assert(manifest.missingGeometry === 1, "Centroid service must preserve the exact null-geometry count");
assert(manifest.invalidCentroid === 1, "Malformed non-null geometry must remain explicit for QC");
assert(manifest.chunkCount === 256, "Centroid service must contain all GlobalID prefix shards");

let total = 0;
for (const chunk of manifest.chunks) {
  const payload = JSON.parse(fs.readFileSync(path.join(serviceRoot, chunk.file), "utf8"));
  assert(payload.parcels.length === chunk.count, `Chunk ${chunk.id} count mismatch`);
  for (const parcel of payload.parcels.slice(0, 5)) {
    assert(parcel.countyParcelId.startsWith(`collin-county-tx:${chunk.id}`), `Chunk ${chunk.id} contains wrong GlobalID prefix`);
    if (parcel.liveGeometry.center) {
      const [lng, lat] = parcel.liveGeometry.center;
      assert(lng >= -97 && lng <= -96 && lat >= 32.8 && lat <= 33.6, `Chunk ${chunk.id} centroid is outside Collin bounds`);
    }
  }
  total += payload.parcels.length;
}
assert(total === manifest.featureCount, "Centroid chunk records must reconcile to the manifest");

console.log("Collin CCAD centroid service tests passed.");
