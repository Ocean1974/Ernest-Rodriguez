const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/el-paso-county-tx/el-paso-county-parcel-source-manifest.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(root, "output/el-paso-county-tx/schema-report.json"), "utf8"));
const joins = fs.readFileSync(path.join(root, "output/el-paso-county-tx/join-key-report.md"), "utf8");
const c = source.observed_counts;

assert.equal(source.parcel_service.item_id, "47bef768aea0456a9a67d449b0a72b97");
assert.equal(source.parcel_service.layer_id, 0);
assert.equal(source.parcel_service.source_spatial_reference.latest_wkid, 2277);
assert.equal(c.parcel_service_features, 400899);
assert.equal(c.missing_geometry, 0);
assert.equal(c.prop_id_text_null, 0);
assert.equal(c.prop_id_text_duplicate_excess, 1269);
assert.equal(c.prop_id_duplicate_excess, 1269);
assert.equal(c.geo_id_duplicate_excess, 1269);
assert.equal(c.all_three_id_fields_duplicate_excess, 1269);
assert.equal(c.duplicate_identifier_groups, 1059);
assert.equal(c.object_id_distinct, c.parcel_service_features);
assert.equal(source.identity_findings.production_feature_identity, "unresolved");
assert.equal(source.activation.authorized, false);
assert.equal(source.render_directly_in_browser, false);
assert.equal(report.fields.length, 44);
assert(joins.includes("refresh stability unproven"));
console.log("White Rabbit El Paso official-source audit tests passed.");

