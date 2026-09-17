const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "county-adapters", "montgomery-county-tx", "montgomery-county-parcel-source-manifest.json");
const outputDirectory = path.join(root, "output", "montgomery-county-tx");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const counts = source.observed_counts;
const identity = source.identity_findings;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(counts.pin_null === counts.service_features - counts.pin_non_null, "PIN null reconciliation failed");
assert(counts.pin_duplicate_excess === counts.pin_non_null - counts.pin_distinct_non_null, "PIN duplicate reconciliation failed");
assert(counts.property_number_null === counts.service_features - counts.property_number_non_null, "PropertyNumber null reconciliation failed");
assert(counts.property_number_duplicate_excess === counts.property_number_non_null - counts.property_number_distinct_non_null, "PropertyNumber duplicate reconciliation failed");
assert(counts.objectid_non_null === counts.service_features && counts.objectid_distinct === counts.service_features, "OBJECTID snapshot uniqueness failed");
assert(source.rights.status === "unverified" && source.activation.authorized === false, "Montgomery must remain fail-closed");

const schemaReport = {
  schemaVersion: "wr-county-schema-report-v1",
  countyId: source.county_id,
  generatedFrom: path.relative(root, sourcePath).replaceAll("\\", "/"),
  sourceUrl: source.arcgis_rest_url,
  publishingAuthority: source.publishing_authority,
  sourceAttribution: source.source_attribution,
  geometryType: source.geometry_type,
  spatialReference: source.public_service_spatial_reference,
  maxRecordCount: source.max_record_count,
  fields: source.schema_fields,
  exactObservedCounts: counts,
  identity: identity,
  freshness: source.freshness_findings,
  rights: source.rights,
  activation: source.activation,
};

const schemaMarkdown = `# Montgomery County parcel source schema report

- Source: ${source.arcgis_rest_url}
- Publisher: ${source.publishing_authority}; attribution: ${source.source_attribution}
- Geometry: ${source.geometry_type}
- Public service CRS: EPSG:${source.public_service_spatial_reference.latest_wkid}
- Fields: ${source.schema_fields.length}
- Exact observed service features: ${counts.service_features.toLocaleString("en-US")}
- Missing geometry: ${counts.missing_geometry.toLocaleString("en-US")}
- Rights: ${source.rights.status}
- Activation: blocked

The service count is exact for the observed query response, but county completeness and production reuse are not certified.
`;

const joinKeyMarkdown = `# Montgomery County join-key report

| Candidate | Non-null | Null | Distinct non-null | Duplicate excess | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| PIN | ${counts.pin_non_null} | ${counts.pin_null} | ${counts.pin_distinct_non_null} | ${counts.pin_duplicate_excess} | Reject as standalone feature identity |
| PropertyNumber | ${counts.property_number_non_null} | ${counts.property_number_null} | ${counts.property_number_distinct_non_null} | ${counts.property_number_duplicate_excess} | Reject as standalone feature identity |
| OBJECTID | ${counts.objectid_non_null} | 0 | ${counts.objectid_distinct} | 0 | Snapshot-unique only; stability across refreshes unverified |

The PIN + PropertyNumber pair is also not unique. One observed pair occurs ${identity.composite_duplicate_proof.feature_count} times. The production countyParcelId remains unresolved; no business key is promoted.
`;

const accessMarkdown = `# Montgomery County full parcel access report

- Query capability: observed
- Exact observed feature count: ${counts.service_features.toLocaleString("en-US")}
- Maximum service page size: ${source.max_record_count.toLocaleString("en-US")}
- Missing geometry: ${counts.missing_geometry}
- Direct browser rendering: prohibited
- Raw snapshot capture: not authorized pending rights review
- County completeness: not certified
- Freshness: unresolved; EditDate aggregates to ${source.freshness_findings.edit_date_max}
- Production activation: blocked

## Remaining gates

${source.activation.blockers.map((blocker) => `- ${blocker}`).join("\n")}
`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "schema-report.json"), `${JSON.stringify(schemaReport, null, 2)}\n`);
fs.writeFileSync(path.join(outputDirectory, "schema-report.md"), schemaMarkdown);
fs.writeFileSync(path.join(outputDirectory, "join-key-report.md"), joinKeyMarkdown);
fs.writeFileSync(path.join(outputDirectory, "full-parcel-access-report.md"), accessMarkdown);

console.log(JSON.stringify({ countyId: source.county_id, exactObservedFeatures: counts.service_features, pinNull: counts.pin_null, pinDuplicateExcess: counts.pin_duplicate_excess, propertyNumberNull: counts.property_number_null, propertyNumberDuplicateExcess: counts.property_number_duplicate_excess, activationAuthorized: source.activation.authorized }, null, 2));

