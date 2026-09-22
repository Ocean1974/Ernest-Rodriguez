const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8"));
const county = ["public", "data", "counties", "collin-county-tx"];
const permits = read(...county, "permits", "manifest.json");
const developments = read(...county, "developments", "manifest.json");

assert.strictEqual(permits.schemaVersion, "wr-permit-service-v1");
assert.strictEqual(permits.permitCount, 109634);
assert.strictEqual(permits.joinedPermitCount, 109634);
assert.strictEqual(permits.searchIndexCount, 109634);
assert.strictEqual(permits.chunks.reduce((sum, chunk) => sum + chunk.count, 0), 109634);
assert.strictEqual(permits.sourceDatasetId, "82ee-gbj5");
assert.strictEqual(permits.parcelSearchShards.keyLength, 2);
assert(Object.keys(permits.parcelSearchShards.files).length > 0, "Permit lookups must use bounded account shards instead of the full search file");
const permitChunk = read(...county, "permits", ...permits.chunks[0].file.split("/"));
assert(permitChunk.permits[0].parcelAccountNum && permitChunk.permits[0].permitRecordId, "Runtime permit records must be parcel-linked and stable");
assert(Number.isFinite(permitChunk.permits[0].latitude) && Number.isFinite(permitChunk.permits[0].longitude), "Runtime permits must use joined parcel locations");

assert.strictEqual(developments.schemaVersion, "wr-development-parcel-service-v1");
assert.strictEqual(developments.parcelCount, 91211);
assert.strictEqual(developments.sourcePermitCount, 109634);
assert(Object.keys(developments.recordShards).length > 0, "Development service must publish parcel record shards");
const developmentFile = Object.values(developments.recordShards)[0].files[0];
const developmentShard = read(...county, "developments", ...developmentFile.split("/"));
assert(developmentShard.records[0].signalTypes.includes("building-permit"), "Development records must preserve their permit signal type");

console.log("Collin runtime permit and development services passed.");
