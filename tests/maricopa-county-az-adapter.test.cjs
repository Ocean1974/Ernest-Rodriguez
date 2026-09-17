const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const adapter = readJson("data/county-adapters/maricopa-county-az/adapter.json");
const sourceManifest = readJson("data/county-adapters/maricopa-county-az/maricopa-county-parcel-source-manifest.json");
const fieldMap = readJson("data/county-adapters/maricopa-county-az/maricopa-universal-field-map.json");
const pipeline = readJson("data/county-adapters/maricopa-county-az/pipeline.json");
const packageJson = readJson("package.json");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const builderSource = fs.readFileSync(path.join(root, "scripts", "build-maricopa-county-az-parcels.cjs"), "utf8");
const serviceBuilderSource = fs.readFileSync(path.join(root, "scripts", "build-source-verified-county-parcel-service.cjs"), "utf8");

assert(adapter.id === "maricopa-county-az", "Maricopa adapter id must be stable");
assert(adapter.status === "pilot", "Maricopa must stay pilot until chunks/search/QA are built");
assert(adapter.countyName === "Maricopa County", "Maricopa adapter must identify the county");
assert(adapter.appraisalDistrictName === "Maricopa County Assessor", "Maricopa adapter must identify the assessor");
assert(adapter.parcelIdField === "APN", "Maricopa parcel id field must be APN");
assert(adapter.accountIdField === "APN", "Maricopa account id field must be APN");
assert(adapter.uniqueGisKey === "OBJECTID", "Maricopa GIS key must be OBJECTID");
assert(adapter.sourceSpatialReference.includes("EPSG:3857"), "Maricopa source spatial reference must be EPSG:3857");
assert(adapter.verifiedCounts.parcelGeometryFeatures === 1758244, "Maricopa exact parcel count must be locked");
assert(adapter.verifiedCounts.missingGeometry === 0, "Maricopa missing geometry count must be locked");
assert(adapter.verifiedCounts.apnMissing === 0, "Maricopa missing APN count must be locked");
assert(adapter.verifiedCounts.duplicateApn === 0, "Maricopa duplicate APN count must be locked");
assert(adapter.verifiedCounts.appParcelChunks === 943, "Maricopa built viewport chunk count must be locked");
assert(adapter.verifiedCounts.parcelSearchShards === 1117, "Maricopa built search shard count must be locked");
assert(adapter.ownerEnrichment.officialJoinKey.includes("APN"), "Maricopa owner/appraisal join must use APN");
assert(adapter.ownerEnrichment.noOfficialEmailFieldNote.includes("Do not infer"), "Maricopa owner email privacy rule must be documented");
assert(adapter.map.status === "pilot map/search built - activation gated", "Maricopa map/search service must be built but activation gated");
assert(adapter.optionalLayers.some((layer) => layer.id === "county-parcels" && layer.status === "official-source-verified-service-built"), "Maricopa county parcel layer must be source verified and service built but not active");
assert(adapter.optionalLayers.some((layer) => layer.id === "owner-appraisal" && layer.status === "official-source-verified-service-built"), "Maricopa owner/appraisal layer must be source verified and service built but not active");
assert(adapter.optionalLayers.some((layer) => layer.id === "permits" && layer.status === "source-needed"), "Maricopa permits must remain source-needed");
assert(adapter.productionGap.includes("full viewport chunks and production search shards built"), "Maricopa adapter must document built map/search service and remaining production gaps");
assert(adapter.pilotNotes.includes("Do not activate"), "Maricopa adapter must prevent premature app activation");

assert(sourceManifest.county_id === adapter.id, "Maricopa source manifest must match adapter id");
assert(sourceManifest.service_owner === "Maricopa County Assessor GIS", "Maricopa source manifest must preserve official service lineage");
assert(sourceManifest.arcgis_rest_url === adapter.sourceFiles.parcelGeometry, "Maricopa source manifest URL must match adapter parcel geometry source");
assert(sourceManifest.verified_counts.all_layer_features === 1758244, "Maricopa source manifest must lock exact source count");
assert(sourceManifest.verified_counts.duplicate_apn === 0, "Maricopa source manifest must lock duplicate APN count");
assert(sourceManifest.download_tests.arcgis_rest_query.supported, "Maricopa ArcGIS REST query must be supported");
assert(sourceManifest.download_tests.geojson.supported, "Maricopa GeoJSON query must be supported");
assert(sourceManifest.download_tests.shapefile_zip.supported === false, "Maricopa shapefile ZIP must not be claimed without verification");
assert(sourceManifest.owner_appraisal_note.includes("does not expose official owner phone or owner email"), "Maricopa source manifest must protect owner contact fields");

assert(fieldMap.county_id === adapter.id, "Maricopa field map must match adapter id");
assert(fieldMap.field_map.accountNum.sourceField === "APN", "Maricopa accountNum must map from APN");
assert(fieldMap.field_map.sourceParcelId.sourceField === "APN", "Maricopa sourceParcelId must map from APN");
assert(fieldMap.field_map.gisParcelId.sourceField === "OBJECTID", "Maricopa gisParcelId must map from OBJECTID");
assert(fieldMap.field_map.ownerName.sourceField === "OWNER_NAME", "Maricopa ownerName must map from OWNER_NAME");
assert(fieldMap.field_map.ownerPhone.type === "placeholder", "Maricopa ownerPhone must stay blank unless official source includes it");
assert(fieldMap.search_index_fields.includes("APN"), "Maricopa search index must include APN");
assert(fieldMap.search_index_fields.includes("APN_DASH"), "Maricopa search index must include APN_DASH");

assert(pipeline.countyAdapter === "data/county-adapters/maricopa-county-az/adapter.json", "Maricopa pipeline must point to the adapter");
assert(pipeline.uiConstraint.includes("Do not redesign"), "Maricopa pipeline must protect the no-redesign rule");
assert(pipeline.steps.some((step) => step.id === "build-parcel-service"), "Maricopa pipeline must include parcel chunks/search");
assert(pipeline.steps.some((step) => step.id === "build-owner-matches"), "Maricopa pipeline must include owner matches");
assert(pipeline.steps.some((step) => step.id === "validate"), "Maricopa pipeline must include validation");

assert(packageJson.scripts["maricopa:qa"] === "node scripts/build-maricopa-county-az-parcels.cjs --qa-only", "Maricopa QA npm script must be available");
assert(packageJson.scripts["maricopa:sample"] === "node scripts/build-maricopa-county-az-parcels.cjs --sample=25", "Maricopa sample npm script must be available");
assert(packageJson.scripts["maricopa:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=maricopa-county-az --sample=25", "Maricopa service sample npm script must be available");
assert(packageJson.scripts["maricopa:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=maricopa-county-az --full", "Maricopa service full npm script must be available");
assert(builderSource.includes("Maricopa full build is intentionally blocked"), "Maricopa builder must block unsafe full export until viewport chunks exist");
assert(builderSource.includes("ownerPhone: \"\""), "Maricopa builder must keep ownerPhone blank without official source field");
assert(builderSource.includes("ownerEmail: \"\""), "Maricopa builder must keep ownerEmail blank without official source field");
assert(serviceBuilderSource.includes('"maricopa-county-az"'), "Source-verified service builder must support Maricopa");
assert(serviceBuilderSource.includes("full-build-needs-qc-before-app-activation"), "Maricopa full service builds must stay QC-gated");
assert(serviceBuilderSource.includes("ownerPhone: \"\""), "Maricopa service builder must keep ownerPhone blank without official source field");

assert(exists("output/maricopa-county-az/schema-report.json"), "Maricopa schema report JSON must exist");
assert(exists("output/maricopa-county-az/schema-report.md"), "Maricopa schema report markdown must exist");
assert(exists("output/maricopa-county-az/join-key-report.md"), "Maricopa join-key report must exist");
assert(exists("output/maricopa-county-az/qa-report.json"), "Maricopa QA report JSON must exist");
assert(exists("output/maricopa-county-az/qa-report.md"), "Maricopa QA report markdown must exist");
assert(exists("output/maricopa-county-az/full-parcel-access-report.md"), "Maricopa full parcel access report must exist");
assert(exists("output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson"), "Maricopa sample GeoJSON must exist");
assert(exists("output/maricopa-county-az/maricopa-county-az-parcel-search-index.json"), "Maricopa sample search index must exist");
assert(exists("output/maricopa-county-az/maricopa-county-az-owner-appraisal-index.json"), "Maricopa sample owner/appraisal index must exist");
assert(exists("output/maricopa-county-az/parcel-service-report.json"), "Maricopa parcel service report JSON must exist");
assert(exists("output/maricopa-county-az/parcel-service-report.md"), "Maricopa parcel service report markdown must exist");
assert(exists("public/data/counties/maricopa-county-az/parcels/manifest.json"), "Maricopa parcel service manifest must exist");
assert(exists("public/data/counties/maricopa-county-az/parcels/search-index.json"), "Maricopa parcel service search index manifest must exist");

const schemaReport = readJson("output/maricopa-county-az/schema-report.json");
const qaReport = readJson("output/maricopa-county-az/qa-report.json");
const sampleGeojson = readJson("output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson");
const searchIndex = readJson("output/maricopa-county-az/maricopa-county-az-parcel-search-index.json");
const ownerAppraisalIndex = readJson("output/maricopa-county-az/maricopa-county-az-owner-appraisal-index.json");
const parcelServiceReport = readJson("output/maricopa-county-az/parcel-service-report.json");
const parcelServiceManifest = readJson("public/data/counties/maricopa-county-az/parcels/manifest.json");

assert(schemaReport.county_id === adapter.id, "Maricopa schema report must match adapter id");
assert(schemaReport.verified_counts.all_layer_features === 1758244, "Maricopa schema report must lock exact parcel count");
assert(schemaReport.required_universal_fields.includes("ownerName"), "Maricopa schema report must include ownerName in the parcel-window contract");
assert(schemaReport.privacy_notes.some((note) => note.includes("Do not infer owner phone/email")), "Maricopa schema report must preserve privacy rule");
assert(qaReport.source_verified_counts.all_layer_features === 1758244, "Maricopa QA report must lock source verified count");
assert(qaReport.blockingProductionGaps.some((gap) => gap.includes("Full viewport parcel chunks")), "Maricopa QA must keep viewport chunks as a production gate");
assert(sampleGeojson.type === "FeatureCollection", "Maricopa sample GeoJSON must be a FeatureCollection");
assert(sampleGeojson.features.length > 0, "Maricopa sample GeoJSON must include mapped parcels");
assert(sampleGeojson.features[0].properties.schemaVersion === "wr-universal-parcel-v1", "Maricopa sample parcels must use the universal parcel schema");
assert(sampleGeojson.features[0].properties.ownerPhone === "", "Maricopa sample ownerPhone must remain blank");
assert(sampleGeojson.features[0].properties.ownerEmail === "", "Maricopa sample ownerEmail must remain blank");
assert(searchIndex.searchRecordCount === sampleGeojson.features.length, "Maricopa search index count must match the sample");
assert(searchIndex.searchFields.includes("APN"), "Maricopa search index must include APN");
assert(ownerAppraisalIndex.indexedRecordCount === sampleGeojson.features.length, "Maricopa owner/appraisal sample index count must match sample GeoJSON");
assert(ownerAppraisalIndex.privacyNote.includes("blank"), "Maricopa owner/appraisal index must document blank phone/email fields");
assert(parcelServiceManifest.sourceCountyId === adapter.id, "Maricopa parcel service manifest must be county-aware");
assert(parcelServiceManifest.mode === "full", "Maricopa parcel service manifest must be a full viewport/search build");
assert(parcelServiceManifest.activationStatus === "full-build-needs-qc-before-app-activation", "Maricopa full parcel service must stay QC-gated");
assert(parcelServiceManifest.sourceVerifiedFeatureCount === 1758244, "Maricopa parcel service manifest must preserve the verified source count");
assert(parcelServiceManifest.featureCount === 1758443, "Maricopa parcel service must lock the built parcel count");
assert(parcelServiceManifest.skipped === 0, "Maricopa parcel service must lock the missing-geometry skip count");
assert(parcelServiceManifest.chunkCount === 943, "Maricopa parcel service must lock viewport chunk count");
assert(parcelServiceManifest.joinedAppraisalCount === 1758443, "Maricopa parcel service must lock joined appraisal count");
assert(parcelServiceManifest.joinedParcelDimensionCount === 1758443, "Maricopa parcel service must lock joined parcel dimension count");
assert(Object.keys(parcelServiceManifest.searchIndexShards?.files || {}).length === 1117, "Maricopa parcel service must lock search shard count");
assert(parcelServiceReport.activationStatus === parcelServiceManifest.activationStatus, "Maricopa parcel service report must match manifest activation status");

assert(appSource.includes('id: "maricopa-county-az"'), "Maricopa pilot plumbing must be reachable through the place search path");
assert(appSource.includes("blank-safe parcel window"), "Maricopa pilot parcel card must stay blank-safe for missing fields");

console.log("White Rabbit Maricopa County AZ adapter tests passed.");
