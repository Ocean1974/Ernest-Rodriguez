const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8"));
const source = read("data", "raw", "travis-county-tx", "permits", "source-manifest.json");
const permits = read("public", "data", "counties", "travis-county-tx", "permits", "manifest.json");
const development = read("public", "data", "counties", "travis-county-tx", "developments", "parcel-development-index.json");
const report = read("output", "travis-county-tx", "austin-permit-intelligence-report.json");
const raw = fs.readFileSync(path.join(root, source.file));

assert.strictEqual(source.sourceFeatureCount, source.emittedFeatureCount);
assert.strictEqual(crypto.createHash("sha256").update(raw).digest("hex"), source.sha256);
assert.strictEqual(permits.permitCount, source.sourceFeatureCount);
assert.strictEqual(permits.joinedPermitCount + permits.unmatchedPermitCount, permits.permitCount);
assert.strictEqual(permits.searchIndexCount, permits.permitCount);
assert(permits.joinedPermitCount > 0);
assert.strictEqual(development.parcelCount, development.records.length);
assert(development.parcelCount > 0);
assert.strictEqual(report.permits.joinedRecordCount, permits.joinedPermitCount);
assert.match(permits.coverageJurisdiction, /City of Austin/i);

console.log("Austin permit/CO capture, conservative parcel joins, and development signals passed.");
