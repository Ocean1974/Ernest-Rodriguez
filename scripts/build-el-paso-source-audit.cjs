const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "data/county-adapters/el-paso-county-tx/el-paso-county-parcel-source-manifest.json");
const outputDirectory = path.join(root, "output/el-paso-county-tx");
const source = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const c = source.observed_counts;

function check(value, message) { if (!value) throw new Error(message); }
for (const field of ["prop_id_text", "prop_id", "geo_id"]) {
  check(c[`${field}_null`] === c.parcel_service_features - c[`${field}_non_null`], `${field} null reconciliation failed`);
  check(c[`${field}_duplicate_excess`] === c[`${field}_non_null`] - c[`${field}_distinct`], `${field} duplicate reconciliation failed`);
}
for (const prefix of ["prop_id_text_prop_id", "prop_id_text_geo_id", "prop_id_geo_id", "all_three_id_fields"]) {
  check(c[`${prefix}_duplicate_excess`] === c.parcel_service_features - c[`${prefix}_distinct`], `${prefix} reconciliation failed`);
}
check(c.missing_geometry === c.parcel_service_features - c.geometry_non_null, "Geometry reconciliation failed");
check(c.object_id_distinct === c.parcel_service_features, "Snapshot OBJECTID uniqueness failed");
check(source.activation.authorized === false, "El Paso activation must remain blocked");

const report = {
  schemaVersion: "wr-county-schema-report-v1",
  countyId: source.county_id,
  parcelService: source.parcel_service,
  officialDownloads: source.official_downloads,
  fields: source.schema_fields,
  exactObservedCounts: c,
  identity: source.identity_findings,
  rights: source.rights,
  activation: source.activation,
};

const schemaMd = `# El Paso County parcel source schema report\n\n- Official portal: ${source.official_portal}\n- Parcel service item: ${source.parcel_service.item_id}\n- Parcel service layer: ${source.parcel_service.layer_id}\n- Fields: ${source.schema_fields.length}\n- Geometry: ${source.parcel_service.geometry_type}\n- Source CRS: WKID ${source.parcel_service.source_spatial_reference.wkid}, latest WKID ${source.parcel_service.source_spatial_reference.latest_wkid}\n- Exact observed service features: ${c.parcel_service_features.toLocaleString("en-US")}\n- Missing geometry: ${c.missing_geometry}\n- Service last edit: ${source.parcel_service.data_last_edit_at}\n- Rights: ${source.rights.status}\n- Activation: blocked\n`;
const joinMd = `# El Paso County join-key report\n\n| Candidate | Non-null | Null | Distinct | Duplicate excess | Decision |\n| --- | ---: | ---: | ---: | ---: | --- |\n| prop_id_text | ${c.prop_id_text_non_null} | ${c.prop_id_text_null} | ${c.prop_id_text_distinct} | ${c.prop_id_text_duplicate_excess} | Candidate appraisal join; reject as feature identity |\n| prop_id | ${c.prop_id_non_null} | ${c.prop_id_null} | ${c.prop_id_distinct} | ${c.prop_id_duplicate_excess} | Candidate appraisal join; reject as feature identity |\n| geo_id | ${c.geo_id_non_null} | ${c.geo_id_null} | ${c.geo_id_distinct} | ${c.geo_id_duplicate_excess} | Candidate GIS join; reject as feature identity |\n| All three ID fields | ${c.parcel_service_features} | 0 | ${c.all_three_id_fields_distinct} | ${c.all_three_id_fields_duplicate_excess} | Reject as feature identity |\n| ObjectID_1 | ${c.parcel_service_features} | 0 | ${c.object_id_distinct} | 0 | Snapshot identity only; refresh stability unproven |\n\nThe three business-ID fields are complete and one-to-one correlated but repeat across 1,059 identifier groups. A stable geometry-part key or documented multipart consolidation rule must be proven before production.\n`;
const accessMd = `# El Paso County full parcel access report\n\n- Public feature-service query access: observed\n- Official annual GIS/appraisal downloads: published\n- Exact service features: ${c.parcel_service_features.toLocaleString("en-US")}\n- Missing geometry: ${c.missing_geometry}\n- Direct browser rendering: prohibited\n- Production capture and redistribution: blocked pending rights/provenance review\n- County completeness: not certified\n- Production activation: blocked\n\n## Remaining gates\n\n${source.activation.blockers.map((item) => `- ${item}`).join("\n")}\n`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "schema-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, "schema-report.md"), schemaMd);
fs.writeFileSync(path.join(outputDirectory, "join-key-report.md"), joinMd);
fs.writeFileSync(path.join(outputDirectory, "full-parcel-access-report.md"), accessMd);
console.log(JSON.stringify({ countyId: source.county_id, serviceFeatures: c.parcel_service_features, missingGeometry: c.missing_geometry, distinctBusinessIds: c.prop_id_text_distinct, duplicateExcess: c.prop_id_text_duplicate_excess, duplicateGroups: c.duplicate_identifier_groups, activationAuthorized: false }, null, 2));

