const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "public/data/counties/collin-county-tx/permits-refresh/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(manifest.status === "official-ccad-permits-joined-to-refresh", "CCAD permit source must be verified and refresh-scoped");
assert(manifest.activationAuthorized === false, "Permit refresh must remain activation gated");
assert(manifest.source.datasetId === "82ee-gbj5", "Official source dataset ID must be preserved");
assert(manifest.source.sourceRecordCount === 112627, "Official permit source count must remain exact");
assert(manifest.identity.duplicatePermitIdCount === 2533, "Non-unique source permit IDs must remain explicitly counted");
assert(manifest.identity.permitIdStatus.includes("non-unique"), "Source permit identity limitation must be documented");
assert(manifest.quality.futureIssuedDateCount > 0, "Future-dated permit records must be identified and quarantined");
assert(manifest.join.joinedRecordCount + manifest.join.missingPropertyId + manifest.join.ambiguousPropertyId + manifest.join.unmatchedPropertyId + manifest.quality.futureIssuedDateCount === manifest.source.sourceRecordCount, "Every permit must reconcile to a delivery or quarantine outcome");
assert(manifest.join.joinedRecordCount > 100000, "Most CCAD permits must join exactly to the refresh");
assert(manifest.join.distinctParcelsWithPermits > 50000, "Permit intelligence must cover a material parcel set");
assert(manifest.delivery.shardCount > 200, "Permit delivery must be distributed across refresh GlobalID shards");
assert(manifest.truthBoundary.some((line) => line.includes("not proof of construction")), "Permit truth boundary must remain explicit");

let delivered = 0;
for (const [key, relative] of Object.entries(manifest.delivery.files)) {
  const payload = JSON.parse(fs.readFileSync(path.join(root, "public/data/counties/collin-county-tx/permits-refresh", relative), "utf8"));
  assert(payload.records.length === manifest.delivery.counts[key], `Permit shard ${key} count mismatch`);
  assert(payload.records.every((record) => record.globalId.startsWith(key)), `Permit shard ${key} has wrong refresh GlobalID`);
  delivered += payload.records.length;
}
assert(delivered === manifest.join.joinedRecordCount, "Delivered permits must reconcile to exact joins");

console.log("Collin CCAD permit intelligence tests passed.");
