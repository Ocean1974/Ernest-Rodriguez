const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "data/county-adapters/williamson-county-tx/williamson-county-parcel-source-manifest.json");
const outputDirectory = path.join(root, "output/williamson-county-tx");
const source = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const c = source.observed_counts;

function check(value, message) { if (!value) throw new Error(message); }
check(c.parcelid_null === c.parcel_rows - c.parcelid_non_null, "PARCELID null reconciliation failed");
check(c.parcelid_duplicate_excess === c.parcelid_non_null - c.parcelid_distinct_non_null, "PARCELID duplicate reconciliation failed");
check(c.propertyid_null === c.parcel_rows - c.propertyid_non_null, "PropertyID null reconciliation failed");
check(c.propertyid_duplicate_excess === c.propertyid_non_null - c.propertyid_distinct_non_null, "PropertyID duplicate reconciliation failed");
check(c.parcelid_propertyid_pair_duplicate_excess === c.parcelid_propertyid_both_non_null - c.parcelid_propertyid_pair_distinct, "Composite duplicate reconciliation failed");
check(c.missing_geometry === c.parcel_rows - c.geometry_non_null, "Geometry reconciliation failed");
check(c.owner_propertyid_duplicate_excess === c.owner_propertyid_non_null - c.owner_propertyid_distinct, "Owner PropertyID reconciliation failed");
check(source.activation.authorized === false, "Williamson activation must remain blocked");

const report = {
  schemaVersion: "wr-county-schema-report-v1",
  countyId: source.county_id,
  sourceDatasets: [source.parcel_dataset, source.owner_dataset],
  propertyExportLayout: source.property_export_layout,
  fields: source.schema_fields,
  exactObservedCounts: c,
  identity: source.identity_findings,
  rights: source.rights,
  activation: source.activation,
};

const schemaMd = `# Williamson County parcel source schema report\n\n- Parcel dataset: ${source.parcel_dataset.id} (${source.parcel_dataset.updated_at})\n- Owner dataset: ${source.owner_dataset.id} (${source.owner_dataset.updated_at})\n- Parcel fields: ${source.schema_fields.parcel.length}\n- Owner fields: ${source.schema_fields.owner.length}\n- Exact observed parcel rows: ${c.parcel_rows.toLocaleString("en-US")}\n- Exact observed owner rows: ${c.owner_rows.toLocaleString("en-US")}\n- Missing parcel geometry: ${c.missing_geometry}\n- Rights: ${source.rights.status}\n- Activation: blocked\n`;
const joinMd = `# Williamson County join-key report\n\n| Candidate | Non-null | Null | Distinct | Duplicate excess | Decision |\n| --- | ---: | ---: | ---: | ---: | --- |\n| Parcel PARCELID | ${c.parcelid_non_null} | ${c.parcelid_null} | ${c.parcelid_distinct_non_null} | ${c.parcelid_duplicate_excess} | Reject as unique feature identity |\n| Parcel PropertyID | ${c.propertyid_non_null} | ${c.propertyid_null} | ${c.propertyid_distinct_non_null} | ${c.propertyid_duplicate_excess} | Candidate owner join; reject as unique feature identity |\n| PARCELID + PropertyID | ${c.parcelid_propertyid_both_non_null} | ${c.parcel_rows - c.parcelid_propertyid_both_non_null} | ${c.parcelid_propertyid_pair_distinct} | ${c.parcelid_propertyid_pair_duplicate_excess} | Reject as unique feature identity |\n| Owner PropertyID | ${c.owner_propertyid_non_null} | 0 | ${c.owner_propertyid_distinct} | ${c.owner_propertyid_duplicate_excess} | Preserve as one-to-many owner relationship |\n\nNo production countyParcelId is selected. Geometry-part identity or another stable source key must be proven.\n`;
const accessMd = `# Williamson County full parcel access report\n\n- Public API read access: observed\n- Exact parcel rows: ${c.parcel_rows.toLocaleString("en-US")}\n- Exact owner rows: ${c.owner_rows.toLocaleString("en-US")}\n- Missing geometry: ${c.missing_geometry}\n- Direct browser rendering: prohibited\n- Production capture and redistribution: blocked pending rights review\n- County completeness: not certified\n- Production activation: blocked\n\n## Remaining gates\n\n${source.activation.blockers.map((item) => `- ${item}`).join("\n")}\n`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "schema-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, "schema-report.md"), schemaMd);
fs.writeFileSync(path.join(outputDirectory, "join-key-report.md"), joinMd);
fs.writeFileSync(path.join(outputDirectory, "full-parcel-access-report.md"), accessMd);
console.log(JSON.stringify({ countyId: source.county_id, parcelRows: c.parcel_rows, ownerRows: c.owner_rows, missingGeometry: c.missing_geometry, parcelIdDuplicateExcess: c.parcelid_duplicate_excess, propertyIdDuplicateExcess: c.propertyid_duplicate_excess, activationAuthorized: false }, null, 2));

