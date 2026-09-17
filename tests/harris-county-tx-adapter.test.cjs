const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const adapter = readJson("data/county-adapters/harris-county-tx/adapter.json");
const sourceManifest = readJson("data/county-adapters/harris-county-tx/harris-county-parcel-source-manifest.json");
const fieldMap = readJson("data/county-adapters/harris-county-tx/harris-universal-field-map.json");
const pipeline = readJson("data/county-adapters/harris-county-tx/pipeline.json");
const packageJson = readJson("package.json");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const builderSource = fs.readFileSync(path.join(root, "scripts", "build-harris-county-tx-parcels.cjs"), "utf8");

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

assert(adapter.id === "harris-county-tx", "Harris adapter id must be stable");
assert(adapter.status === "pilot", "Harris must stay pilot until chunks/search/QA are built");
assert(adapter.countyName === "Harris County", "Harris adapter must identify the county");
assert(adapter.appraisalDistrictAcronym === "HCAD", "Harris adapter must identify HCAD");
assert(adapter.parcelIdField === "HCAD_NUM", "Harris parcel id field must be HCAD_NUM");
assert(adapter.accountIdField === "acct_num", "Harris account id field must be acct_num");
assert(adapter.uniqueGisKey === "GlobalID", "Harris unique GIS key must be GlobalID");
assert(adapter.sourceSpatialReference.includes("EPSG:2278"), "Harris source spatial reference must be EPSG:2278");
assert(adapter.verifiedCounts.parcelGeometryFeatures === 1535525, "Harris exact parcel count must be locked");
assert(adapter.verifiedCounts.missingGeometry === 3, "Harris missing geometry count must be locked");
assert(adapter.verifiedCounts.hcadNumMissing === 1, "Harris missing HCAD_NUM count must be locked");
assert(adapter.verifiedCounts.globalIdDistinctValues === 1535525, "Harris GlobalID must be unique across the verified layer");
assert(adapter.ownerEnrichment.officialJoinKey.includes("HCAD_NUM/acct_num"), "Harris owner/appraisal join must use HCAD_NUM/acct_num");
assert(adapter.ownerEnrichment.noOfficialEmailFieldNote.includes("Do not infer"), "Harris owner email privacy rule must be documented");
assert(adapter.optionalLayers.some((layer) => layer.id === "hcad-owner-appraisal" && layer.status === "ready"), "Harris owner/appraisal layer must be joined into the QC-gated full parcel service");
assert(adapter.optionalLayers.some((layer) => layer.id === "block-labels" && layer.status === "ready"), "Harris block/legal context must be joined into the QC-gated full parcel service");
assert(adapter.optionalLayers.some((layer) => layer.id === "parcel-dimensions" && layer.status === "ready"), "Harris parcel dimension fields must be joined into the QC-gated full parcel service");
assert(adapter.optionalLayers.some((layer) => layer.id === "permits" && layer.status === "source-needed"), "Harris permit layer must remain source-needed");
assert(adapter.optionalLayers.some((layer) => layer.id === "zoning-intelligence" && layer.status === "source-needed-fragmented"), "Harris zoning must document fragmented source status");
assert(adapter.productionGap.includes("full viewport chunks, search shards, owner/appraisal joins"), "Harris adapter must document built QC-gated parcel service progress");
assert(adapter.productionGap.includes("permit/CO joins"), "Harris adapter must document remaining production gaps");
assert(adapter.pilotNotes.includes("Do not activate"), "Harris adapter must prevent premature app activation");

assert(sourceManifest.county_id === adapter.id, "Harris source manifest must match adapter id");
assert(sourceManifest.service_owner === "HarrisCountyGIS", "Harris source manifest must preserve the official ArcGIS owner");
assert(sourceManifest.arcgis_rest_url === adapter.sourceFiles.parcelGeometry, "Harris source manifest URL must match adapter parcel geometry source");
assert(sourceManifest.verified_counts.all_layer_features === 1535525, "Harris source manifest must lock exact source count");
assert(sourceManifest.verified_counts.globalid_missing === 0, "Harris source manifest must lock missing GlobalID count");
assert(sourceManifest.download_tests.arcgis_rest_query.supported, "Harris ArcGIS REST query must be supported");
assert(sourceManifest.download_tests.geojson.supported, "Harris GeoJSON query must be supported");
assert(sourceManifest.download_tests.pbf.supported, "Harris PBF query must be supported");
assert(sourceManifest.owner_appraisal_note.includes("does not expose official owner phone or email"), "Harris source manifest must protect owner contact fields");

assert(fieldMap.county_id === adapter.id, "Harris field map must match adapter id");
assert(fieldMap.field_map.accountNum.sourceField === "acct_num", "Harris accountNum must map from acct_num");
assert(fieldMap.field_map.sourceParcelId.sourceField === "HCAD_NUM", "Harris sourceParcelId must map from HCAD_NUM");
assert(fieldMap.field_map.gisParcelId.sourceField === "GlobalID", "Harris gisParcelId must map from GlobalID");
assert(fieldMap.field_map.ownerName.sourceField === "owner_name_1", "Harris ownerName must map from owner_name_1");
assert(fieldMap.field_map.ownerPhone.type === "placeholder", "Harris ownerPhone must stay blank unless official source includes it");
assert(fieldMap.search_index_fields.includes("HCAD_NUM"), "Harris search index must include HCAD_NUM");
assert(fieldMap.search_index_fields.includes("acct_num"), "Harris search index must include acct_num");

assert(pipeline.countyAdapter === "data/county-adapters/harris-county-tx/adapter.json", "Harris pipeline must point to the Harris adapter");
assert(pipeline.uiConstraint.includes("Do not redesign"), "Harris pipeline must protect the no-redesign rule");
assert(pipeline.steps.some((step) => step.id === "build-parcel-service"), "Harris pipeline must include parcel chunks/search");
assert(pipeline.steps.some((step) => step.id === "build-owner-matches"), "Harris pipeline must include owner matches");
assert(pipeline.steps.some((step) => step.id === "validate"), "Harris pipeline must include validation");

assert(packageJson.scripts["harris:qa"] === "node scripts/build-harris-county-tx-parcels.cjs --qa-only", "Harris QA npm script must be available");
assert(packageJson.scripts["harris:sample"] === "node scripts/build-harris-county-tx-parcels.cjs --sample=25", "Harris sample npm script must be available");
assert(packageJson.scripts["harris:service:sample"] === "node scripts/build-harris-county-tx-parcel-service.cjs --sample=500", "Harris parcel service sample npm script must be available");
assert(packageJson.scripts["harris:service:full"] === "node scripts/build-harris-county-tx-parcel-service.cjs --full", "Harris parcel service full npm script must be available");
assert(builderSource.includes("Harris full build is intentionally blocked"), "Harris builder must block unsafe full export until viewport chunks exist");
assert(builderSource.includes("ownerPhone: \"\""), "Harris builder must keep ownerPhone blank without official source field");
assert(builderSource.includes("ownerEmail: \"\""), "Harris builder must keep ownerEmail blank without official source field");
assert(fs.existsSync(path.join(root, "scripts", "build-harris-county-tx-parcel-service.cjs")), "Harris parcel service builder must exist");

assert(exists("output/harris-county-tx/schema-report.json"), "Harris schema report JSON must exist");
assert(exists("output/harris-county-tx/schema-report.md"), "Harris schema report markdown must exist");
assert(exists("output/harris-county-tx/join-key-report.md"), "Harris join-key report must exist");
assert(exists("output/harris-county-tx/qa-report.json"), "Harris QA report JSON must exist");
assert(exists("output/harris-county-tx/qa-report.md"), "Harris QA report markdown must exist");
assert(exists("output/harris-county-tx/full-parcel-access-report.md"), "Harris full parcel access report must exist");
assert(exists("output/harris-county-tx/harris-county-tx-parcel-sample.geojson"), "Harris sample GeoJSON must exist");
assert(exists("output/harris-county-tx/harris-county-tx-parcel-search-index.json"), "Harris sample search index must exist");
assert(exists("output/harris-county-tx/harris-county-tx-owner-appraisal-index.json"), "Harris sample owner/appraisal index must exist");
assert(exists("output/harris-county-tx/parcel-service-report.json"), "Harris parcel service report JSON must exist");
assert(exists("output/harris-county-tx/parcel-service-report.md"), "Harris parcel service report markdown must exist");
assert(exists("public/data/counties/harris-county-tx/parcels/manifest.json"), "Harris parcel service manifest must exist");
assert(exists("public/data/counties/harris-county-tx/parcels/search-index.json"), "Harris parcel service search index manifest must exist");

const schemaReport = readJson("output/harris-county-tx/schema-report.json");
const qaReport = readJson("output/harris-county-tx/qa-report.json");
const sampleGeojson = readJson("output/harris-county-tx/harris-county-tx-parcel-sample.geojson");
const searchIndex = readJson("output/harris-county-tx/harris-county-tx-parcel-search-index.json");
const ownerAppraisalIndex = readJson("output/harris-county-tx/harris-county-tx-owner-appraisal-index.json");
const parcelServiceReport = readJson("output/harris-county-tx/parcel-service-report.json");
const parcelServiceManifest = readJson("public/data/counties/harris-county-tx/parcels/manifest.json");

assert(schemaReport.county_id === adapter.id, "Harris schema report must match adapter id");
assert(schemaReport.verified_counts.all_layer_features === 1535525, "Harris schema report must lock exact parcel count");
assert(schemaReport.required_universal_fields.includes("ownerName"), "Harris schema report must include ownerName in the parcel-window contract");
assert(schemaReport.privacy_notes.some((note) => note.includes("Do not infer owner phone/email")), "Harris schema report must preserve privacy rule");
assert(qaReport.source_verified_counts.all_layer_features === 1535525, "Harris QA report must lock source verified count");
assert(qaReport.blockingProductionGaps.some((gap) => gap.includes("Full viewport parcel chunks")), "Harris QA must keep viewport chunks as a production gate");
assert(sampleGeojson.type === "FeatureCollection", "Harris sample GeoJSON must be a FeatureCollection");
assert(sampleGeojson.features.length > 0, "Harris sample GeoJSON must include mapped parcels");
assert(sampleGeojson.features[0].properties.schemaVersion === "wr-universal-parcel-v1", "Harris sample parcels must use the universal parcel schema");
assert(sampleGeojson.features[0].properties.ownerPhone === "", "Harris sample ownerPhone must remain blank");
assert(sampleGeojson.features[0].properties.ownerEmail === "", "Harris sample ownerEmail must remain blank");
assert(searchIndex.searchRecordCount === sampleGeojson.features.length, "Harris search index count must match the sample");
assert(searchIndex.searchFields.includes("HCAD_NUM"), "Harris search index must include HCAD_NUM");
assert(ownerAppraisalIndex.indexedRecordCount === sampleGeojson.features.length, "Harris owner/appraisal sample index count must match sample GeoJSON");
assert(ownerAppraisalIndex.privacyNote.includes("blank"), "Harris owner/appraisal index must document blank phone/email fields");
assert(parcelServiceManifest.sourceCountyId === adapter.id, "Harris parcel service manifest must be county-aware");
assert(parcelServiceManifest.mode === "full", "Harris parcel service manifest must be a full viewport/search build");
assert(parcelServiceManifest.activationStatus === "full-build-needs-qc-before-app-activation", "Harris full parcel service must stay QC-gated");
assert(parcelServiceManifest.sourceVerifiedFeatureCount === 1535525, "Harris parcel service manifest must preserve the full source count");
assert(parcelServiceManifest.featureCount === 1535522, "Harris parcel service must contain every parcel with geometry");
assert(parcelServiceManifest.skipped === 3, "Harris parcel service must preserve the missing-geometry skip count");
assert(parcelServiceManifest.chunkCount === 1345, "Harris parcel service must lock viewport chunk count");
assert(parcelServiceManifest.joinedAppraisalCount === 1513724, "Harris parcel service must lock joined appraisal count");
assert(parcelServiceManifest.joinedParcelDimensionCount === 1535522, "Harris parcel service must lock joined parcel dimension count");
assert(parcelServiceManifest.searchIndexShards?.fields?.includes("sourceParcelId"), "Harris parcel service search shards must include sourceParcelId");
assert(Object.keys(parcelServiceManifest.searchIndexShards?.files || {}).length === 1210, "Harris parcel service must lock search shard count");
assert(parcelServiceReport.activationStatus === parcelServiceManifest.activationStatus, "Harris parcel service report must match manifest activation status");

assert(appSource.includes('id: "harris-county-tx"'), "Harris pilot plumbing must be reachable through the place search path");
assert(appSource.includes("blank-safe parcel window"), "Harris pilot parcel card must stay blank-safe for missing fields");

console.log("White Rabbit Harris County TX adapter tests passed.");
