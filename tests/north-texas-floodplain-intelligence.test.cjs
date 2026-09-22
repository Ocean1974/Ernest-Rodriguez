const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const countyId of ["collin-county-tx", "denton-county-tx"]) {
  const manifest = readJson(`public/data/counties/${countyId}/floodplain/manifest.json`);
  const index = readJson(`public/data/counties/${countyId}/floodplain/parcel-floodplain-index.json`);
  const parcelManifest = readJson(`public/data/counties/${countyId}/parcels/manifest.json`);
  const adapter = readJson(`data/county-adapters/${countyId}/adapter.json`);
  const layer = adapter.optionalLayers.find((item) => item.id === "floodplain-intelligence");
  assert(manifest.status === "parcel-index-ready-official-fema-coverage", `${countyId} must retain official FEMA readiness`);
  assert(manifest.sourceFeatureCount > 0 && manifest.parcelIndexCount > 0, `${countyId} must have source and parcel records`);
  assert(index.parcelRecordsScanned === parcelManifest.featureCount, `${countyId} must scan the full emitted parcel service`);
  assert(Object.values(index.counts).reduce((sum, value) => sum + value, 0) === index.parcelFloodplainRecordCount, `${countyId} shards must reconcile`);
  assert(adapter.verifiedCounts.floodHazardSourceFeatures === manifest.sourceFeatureCount, `${countyId} source counts must reconcile`);
  assert(adapter.verifiedCounts.parcelsWithFloodplainClassification === manifest.parcelIndexCount, `${countyId} parcel counts must reconcile`);
  assert(layer.joinBehavior.includes("liveGeometry centroid"), `${countyId} must disclose its spatial join`);
  assert(manifest.regulatoryDisclaimer.includes("not a FEMA insurance"), `${countyId} must retain the FEMA disclaimer`);
}

console.log("White Rabbit North Texas floodplain intelligence tests passed.");
