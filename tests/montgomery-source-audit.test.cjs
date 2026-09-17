const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/montgomery-county-tx/montgomery-county-parcel-source-manifest.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "output/montgomery-county-tx/schema-report.json"), "utf8"));
const joinReport = fs.readFileSync(path.join(root, "output/montgomery-county-tx/join-key-report.md"), "utf8");
const accessReport = fs.readFileSync(path.join(root, "output/montgomery-county-tx/full-parcel-access-report.md"), "utf8");

const counts = manifest.observed_counts;
assert.equal(counts.service_features, 276557);
assert.equal(counts.pin_null, counts.service_features - counts.pin_non_null);
assert.equal(counts.pin_duplicate_excess, counts.pin_non_null - counts.pin_distinct_non_null);
assert.equal(counts.property_number_null, counts.service_features - counts.property_number_non_null);
assert.equal(counts.property_number_duplicate_excess, counts.property_number_non_null - counts.property_number_distinct_non_null);
assert.equal(counts.objectid_distinct, counts.service_features);
assert.equal(counts.missing_geometry, 0);
assert.equal(manifest.identity_findings.pin_property_number_composite_status, "not-unique");
assert.equal(manifest.identity_findings.production_county_parcel_id, "unresolved");
assert.equal(manifest.rights.status, "unverified");
assert.equal(manifest.activation.authorized, false);
assert.equal(manifest.render_directly_in_browser, false);
assert.equal(schema.fields.length, 20);
assert(joinReport.includes("Reject as standalone feature identity"));
assert(accessReport.includes("Production activation: blocked"));

console.log("White Rabbit Montgomery official-source audit tests passed.");

