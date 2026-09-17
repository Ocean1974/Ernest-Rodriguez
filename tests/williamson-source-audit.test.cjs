const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/williamson-county-tx/williamson-county-parcel-source-manifest.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(root, "output/williamson-county-tx/schema-report.json"), "utf8"));
const joins = fs.readFileSync(path.join(root, "output/williamson-county-tx/join-key-report.md"), "utf8");
const c = source.observed_counts;

assert.equal(source.parcel_dataset.id, "an3x-cnmw");
assert.equal(source.owner_dataset.id, "bbia-wsxs");
assert.equal(c.parcel_rows, 290912);
assert.equal(c.owner_rows, 323955);
assert.equal(c.parcelid_null, c.parcel_rows - c.parcelid_non_null);
assert.equal(c.parcelid_duplicate_excess, c.parcelid_non_null - c.parcelid_distinct_non_null);
assert.equal(c.propertyid_duplicate_excess, c.propertyid_non_null - c.propertyid_distinct_non_null);
assert.equal(c.parcelid_propertyid_pair_duplicate_excess, 289);
assert.equal(c.missing_geometry, 0);
assert.equal(c.owner_propertyid_duplicate_excess, 719);
assert.equal(source.identity_findings.production_feature_identity, "unresolved");
assert.equal(source.activation.authorized, false);
assert.equal(source.render_directly_in_browser, false);
assert.equal(report.fields.parcel.length, 48);
assert.equal(report.fields.owner.length, 39);
assert(joins.includes("Preserve as one-to-many owner relationship"));
console.log("White Rabbit Williamson official-source audit tests passed.");

