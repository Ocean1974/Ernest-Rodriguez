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

const adapter = readJson("data/county-adapters/king-county-wa/adapter.json");
const sourceManifest = readJson("data/county-adapters/king-county-wa/king-county-parcel-source-manifest.json");
const fieldMap = readJson("data/county-adapters/king-county-wa/king-universal-field-map.json");
const packageJson = readJson("package.json");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const builderSource = fs.readFileSync(path.join(root, "scripts", "build-king-county-wa-parcels.cjs"), "utf8");
const serviceBuilderSource = fs.readFileSync(path.join(root, "scripts", "build-source-verified-county-parcel-service.cjs"), "utf8");

assert(adapter.id === "king-county-wa", "King adapter id must be stable");
assert(adapter.status === "pilot", "King must stay pilot until chunks/search/QA are built");
assert(adapter.countyName === "King County", "King adapter must identify the county");
assert(adapter.parcelIdField === "PIN", "King parcel id field must be PIN");
assert(adapter.accountIdField === "PIN", "King account id field must be PIN");
assert(adapter.uniqueGisKey === "OBJECTID", "King GIS key must be OBJECTID");
assert(adapter.sourceSpatialReference.includes("EPSG:3857"), "King source spatial reference must be EPSG:3857");
assert(adapter.verifiedCounts.parcelGeometryFeatures === 638648, "King exact geometry count must be locked");
assert(adapter.verifiedCounts.pinMissing === 0, "King missing PIN count must be locked");
assert(adapter.verifiedCounts.duplicatePin === 2581, "King duplicate PIN count must be locked");
assert(adapter.verifiedCounts.propertyInfoRows === 636076, "King property info count must be locked");
assert(adapter.verifiedCounts.recentSalesRows === 110857, "King recent sales count must be locked");
assert(adapter.verifiedCounts.appParcelChunks === 1603, "King built viewport chunk count must be locked");
assert(adapter.verifiedCounts.parcelSearchShards === 614, "King built search shard count must be locked");
assert(adapter.joinKeys.primaryParcelAccount.includes("one-to-many"), "King join key must document duplicate PIN behavior");
assert(adapter.ownerEnrichment.noOfficialEmailFieldNote.includes("Do not infer"), "King owner privacy rule must be documented");
assert(adapter.map.status === "pilot map/search built - activation gated", "King map/search service must be built but activation gated");
assert(adapter.optionalLayers.some((layer) => layer.id === "county-parcels" && layer.status === "official-source-verified-service-built"), "King county parcel layer must be source verified and service built but not active");
assert(adapter.optionalLayers.some((layer) => layer.id === "owner-appraisal" && layer.status === "partial-property-info-owner-needed"), "King property info layer must be partial and owner-needed");
assert(adapter.productionGap.includes("full viewport chunks and production search shards built"), "King adapter must document built map/search service");
assert(adapter.productionGap.includes("duplicate"), "King adapter must document duplicate-PIN production gaps");
assert(adapter.pilotNotes.includes("Do not activate"), "King adapter must prevent premature app activation");

assert(sourceManifest.county_id === adapter.id, "King source manifest must match adapter id");
assert(sourceManifest.service_owner === "King County GIS", "King source manifest must preserve official service lineage");
assert(sourceManifest.arcgis_rest_url === adapter.sourceFiles.parcelGeometry, "King source manifest URL must match adapter parcel geometry source");
assert(sourceManifest.verified_counts.parcel_geometry_features === 638648, "King source manifest must lock geometry count");
assert(sourceManifest.verified_counts.geometry_duplicate_pin === 2581, "King source manifest must lock duplicate PIN count");
assert(sourceManifest.verified_counts.property_info_features === 636076, "King source manifest must lock property info count");
assert(sourceManifest.download_tests.arcgis_rest_query.supported, "King ArcGIS REST query must be supported");
assert(sourceManifest.download_tests.geojson.supported, "King GeoJSON query must be supported");
assert(sourceManifest.owner_appraisal_note.includes("does not expose current owner name"), "King source manifest must protect owner fields");

assert(fieldMap.county_id === adapter.id, "King field map must match adapter id");
assert(fieldMap.field_map.accountNum.sourceField === "PIN", "King accountNum must map from PIN");
assert(fieldMap.field_map.gisParcelId.sourceField === "OBJECTID", "King gisParcelId must map from OBJECTID");
assert(fieldMap.field_map.ownerName.type === "placeholder", "King ownerName must stay blank unless official source includes it");
assert(fieldMap.field_map.ownerPhone.type === "placeholder", "King ownerPhone must stay blank unless official source includes it");
assert(fieldMap.search_index_fields.includes("PIN"), "King search index must include PIN");

assert(packageJson.scripts["king:qa"] === "node scripts/build-king-county-wa-parcels.cjs --qa-only", "King QA npm script must be available");
assert(packageJson.scripts["king:sample"] === "node scripts/build-king-county-wa-parcels.cjs --sample=25", "King sample npm script must be available");
assert(packageJson.scripts["king:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=king-county-wa --sample=25", "King service sample npm script must be available");
assert(packageJson.scripts["king:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=king-county-wa --full", "King service full npm script must be available");
assert(builderSource.includes("King County full build is intentionally blocked"), "King builder must block unsafe full export until viewport chunks exist");
assert(builderSource.includes("ownerName: \"\""), "King builder must keep ownerName blank without official source field");
assert(builderSource.includes("ownerPhone: \"\""), "King builder must keep ownerPhone blank without official source field");
assert(builderSource.includes("ownerEmail: \"\""), "King builder must keep ownerEmail blank without official source field");
assert(serviceBuilderSource.includes('"king-county-wa"'), "Source-verified service builder must support King County");
assert(serviceBuilderSource.includes("full-build-needs-qc-before-app-activation"), "King full service builds must stay QC-gated");
assert(serviceBuilderSource.includes("ownerName: \"\""), "King service builder must keep ownerName blank without official source field");

assert(exists("output/king-county-wa/schema-report.json"), "King schema report JSON must exist");
assert(exists("output/king-county-wa/schema-report.md"), "King schema report markdown must exist");
assert(exists("output/king-county-wa/join-key-report.md"), "King join-key report must exist");
assert(exists("output/king-county-wa/qa-report.json"), "King QA report JSON must exist");
assert(exists("output/king-county-wa/qa-report.md"), "King QA report markdown must exist");
assert(exists("output/king-county-wa/full-parcel-access-report.md"), "King full parcel access report must exist");
assert(exists("output/king-county-wa/king-county-wa-parcel-sample.geojson"), "King sample GeoJSON must exist");
assert(exists("output/king-county-wa/king-county-wa-parcel-search-index.json"), "King sample search index must exist");
assert(exists("output/king-county-wa/king-county-wa-property-info-index.json"), "King sample property info index must exist");
assert(exists("output/king-county-wa/parcel-service-report.json"), "King parcel service report JSON must exist");
assert(exists("output/king-county-wa/parcel-service-report.md"), "King parcel service report markdown must exist");
assert(exists("public/data/counties/king-county-wa/parcels/manifest.json"), "King parcel service manifest must exist");
assert(exists("public/data/counties/king-county-wa/parcels/search-index.json"), "King parcel service search index manifest must exist");

const schemaReport = readJson("output/king-county-wa/schema-report.json");
const qaReport = readJson("output/king-county-wa/qa-report.json");
const sampleGeojson = readJson("output/king-county-wa/king-county-wa-parcel-sample.geojson");
const searchIndex = readJson("output/king-county-wa/king-county-wa-parcel-search-index.json");
const propertyInfoIndex = readJson("output/king-county-wa/king-county-wa-property-info-index.json");
const parcelServiceReport = readJson("output/king-county-wa/parcel-service-report.json");
const parcelServiceManifest = readJson("public/data/counties/king-county-wa/parcels/manifest.json");

assert(schemaReport.county_id === adapter.id, "King schema report must match adapter id");
assert(schemaReport.verified_counts.parcel_geometry_features === 638648, "King schema report must lock exact geometry count");
assert(schemaReport.join_key_notes.some((note) => note.includes("one-to-many")), "King schema report must document one-to-many PIN behavior");
assert(qaReport.source_verified_counts.geometry_duplicate_pin === 2581, "King QA report must preserve duplicate PIN count");
assert(qaReport.blockingProductionGaps.some((gap) => gap.includes("Current owner")), "King QA must keep current owner source as a production gate");
assert(sampleGeojson.type === "FeatureCollection", "King sample GeoJSON must be a FeatureCollection");
assert(sampleGeojson.features.length > 0, "King sample GeoJSON must include mapped parcels");
assert(sampleGeojson.features[0].properties.schemaVersion === "wr-universal-parcel-v1", "King sample parcels must use the universal parcel schema");
assert(sampleGeojson.features[0].properties.ownerName === "", "King sample ownerName must remain blank");
assert(sampleGeojson.features[0].properties.ownerPhone === "", "King sample ownerPhone must remain blank");
assert(sampleGeojson.features[0].properties.ownerEmail === "", "King sample ownerEmail must remain blank");
assert(searchIndex.searchRecordCount === sampleGeojson.features.length, "King search index count must match the sample");
assert(propertyInfoIndex.indexedRecordCount === sampleGeojson.features.length, "King property info index count must match sample GeoJSON");
assert(propertyInfoIndex.privacyNote.includes("blank"), "King property info index must document blank owner contact fields");
assert(parcelServiceManifest.sourceCountyId === adapter.id, "King parcel service manifest must be county-aware");
assert(parcelServiceManifest.mode === "full", "King parcel service manifest must be a full viewport/search build");
assert(parcelServiceManifest.activationStatus === "full-build-needs-qc-before-app-activation", "King full parcel service must stay QC-gated");
assert(parcelServiceManifest.sourceVerifiedFeatureCount === 638648, "King parcel service manifest must preserve the verified source count");
assert(parcelServiceManifest.featureCount === 636076, "King parcel service must lock the built parcel count");
assert(parcelServiceManifest.skipped === 0, "King parcel service must lock the missing-geometry skip count");
assert(parcelServiceManifest.chunkCount === 1603, "King parcel service must lock viewport chunk count");
assert(parcelServiceManifest.joinedAppraisalCount === 0, "King parcel service must keep joined appraisal count blank until owner/appraisal source is joined");
assert(parcelServiceManifest.joinedParcelDimensionCount === 636076, "King parcel service must lock joined property-info count");
assert(Object.keys(parcelServiceManifest.searchIndexShards?.files || {}).length === 614, "King parcel service must lock search shard count");
assert(parcelServiceReport.activationStatus === parcelServiceManifest.activationStatus, "King parcel service report must match manifest activation status");

assert(appSource.includes('id: "king-county-wa"'), "King pilot plumbing must be reachable through the place search path");
assert(appSource.includes("blank-safe parcel window"), "King pilot parcel card must stay blank-safe for missing fields");

console.log("White Rabbit King County WA adapter tests passed.");
