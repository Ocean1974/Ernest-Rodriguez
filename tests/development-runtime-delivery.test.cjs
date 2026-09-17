const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/data/developments/manifest.json"), "utf8"));
const legacy = JSON.parse(fs.readFileSync(path.join(root, "public/data/developments/parcel-development-index.json"), "utf8"));
const loader = fs.readFileSync(path.join(root, "src/map/loadDevelopments.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const report = JSON.parse(fs.readFileSync(path.join(root, "output/development-runtime-delivery-report.json"), "utf8"));

assert.equal(manifest.schemaVersion, "wr-development-parcel-service-v1");
assert.equal(manifest.sourceCountyId, "dallas-county-dcad");
assert.equal(manifest.parcelCount, legacy.parcelCount);
assert(manifest.parcelCount > 20000);
assert(manifest.recordFileCount > 1);
assert(manifest.searchFileCount > 1);
assert(manifest.maxRecordsPerFile <= 1500);
assert(manifest.maxShardBytes < 1000000, `Development shard is too large: ${manifest.maxShardBytes}`);
assert.equal(Object.values(manifest.recordShards).reduce((sum, shard) => sum + shard.count, 0), manifest.parcelCount);
assert.equal(report.status, "verified-bounded-service");
assert.equal(report.exactCounts.parcelCount, manifest.parcelCount);
assert.equal(report.deliveryBoundary.legacyAuditIndexLoadedInBrowser, false);
assert.equal(report.deliveryBoundary.maximumShardBytes, manifest.maxShardBytes);
assert.equal(report.lockedUiContract.landingPageChanged, false);

for (const group of [manifest.recordShards, manifest.searchShards]) {
  for (const shard of Object.values(group)) {
    for (const relative of shard.files) {
      const fullPath = path.join(root, "public/data/developments", relative);
      assert(fs.existsSync(fullPath), `Missing development shard ${relative}`);
      const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      assert(payload.records.length <= manifest.maxRecordsPerFile);
    }
  }
}

assert(loader.includes("loadDevelopmentRecordsForParcels"));
assert(loader.includes("searchDevelopmentRecords"));
assert(loader.includes("MAX_DEVELOPMENT_QUERY_RECORDS"));
assert(loader.includes("manifest.json"));
assert(loader.includes("function loadManifest()"), "Development manifest must be loaded lazily after map entry or search");
assert(!app.includes('requestJson<{ records?: Array<{ parcelId: string; parcelPropertyName?: string; parcelAddress?: string }> }>("/data/developments/parcel-development-index.json")'));
assert(app.includes("loadDevelopmentRecordsForParcels"));
assert(app.includes("searchDevelopmentRecords"));

console.log("White Rabbit bounded development runtime delivery tests passed.");
