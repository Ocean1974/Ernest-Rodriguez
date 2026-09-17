const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const adapter = readJson("data/county-adapters/dallas/adapter.json");
const schema = readJson("data/schemas/dallas-zoning-layer.schema.json");
const parcelIndexSchema = readJson("data/schemas/parcel-zoning-index.schema.json");
const manifest = readJson("public/data/zoning/manifest.json");
const parcelIndex = readJson("public/data/zoning/parcel-zoning-index.json");
const report = read("output/dallas-zoning-source-report.md");
const parcelIndexReport = read("output/dallas-parcel-zoning-index-report.md");
const scriptSource = read("scripts/build-dallas-zoning-manifest.cjs");
const parcelIndexScriptSource = read("scripts/build-dallas-parcel-zoning-index.cjs");
const loaderSource = read("src/map/loadZoning.ts");
const countyConfigSource = read("src/data/countyConfig.ts");
const appSource = read("src/App.tsx");

const zoningLayer = adapter.optionalLayers.find((layer) => layer.id === "dallas-zoning-intelligence");

assert(zoningLayer, "Dallas adapter must declare the zoning intelligence optional layer");
assert(zoningLayer.defaultVisible === false, "Dallas zoning layer must stay default-off");
assert(zoningLayer.status === "metadata-ready", "Dallas zoning layer must be metadata-ready before visual activation");
assert(zoningLayer.publicDataRoot === "/data/zoning/", "Dallas zoning layer must publish to the zoning data root");
assert(zoningLayer.manifestPath === "public/data/zoning/manifest.json", "Dallas zoning layer must point to its manifest");
assert(zoningLayer.parcelIndexPath === "public/data/zoning/parcel-zoning-index.json", "Dallas zoning layer must point to its parcel zoning index");
assert(zoningLayer.schemaPath === "data/schemas/dallas-zoning-layer.schema.json", "Dallas zoning layer must point to its schema");
assert(zoningLayer.parcelIndexSchemaPath === "data/schemas/parcel-zoning-index.schema.json", "Dallas zoning layer must point to its parcel zoning index schema");
assert(zoningLayer.reportPath === "output/dallas-zoning-source-report.md", "Dallas zoning layer must point to its source report");
assert(zoningLayer.sourceUrls.includes("https://developmentweb.dallascityhall.com/publiczoningweb/"), "Dallas zoning layer must preserve the public zoning app URL");
assert(zoningLayer.sourceUrls.some((url) => url.includes("FeatureServer/4")), "Dallas zoning layer must include the SUP FeatureServer URL");
assert(zoningLayer.sourceUrls.some((url) => url.includes("FeatureServer/9")), "Dallas zoning layer must include the PD subdistrict FeatureServer URL");
assert(zoningLayer.sourceUrls.some((url) => url.includes("FeatureServer/11")), "Dallas zoning layer must include the PDS subdistrict FeatureServer URL");
assert(zoningLayer.sourceUrls.some((url) => url.includes("FeatureServer/15")), "Dallas zoning layer must include the base zoning FeatureServer URL");
assert(zoningLayer.sourceUrls.some((url) => url.includes("FeatureServer/10")), "Dallas zoning layer must include the current-year zoning cases FeatureServer URL");
assert(zoningLayer.renderStrategy.includes("viewport") && zoningLayer.renderStrategy.includes("offline"), "Dallas zoning render strategy must be viewport-safe");
assert(zoningLayer.maxFeaturesPerViewport <= 750, "Dallas zoning viewport cap must be bounded");
assert(adapter.joinKeys.zoning.includes("ACCT/GIS_ACCT"), "Dallas adapter must document the zoning join keys");
assert(adapter.requiredOutputs.includes("public/data/zoning/manifest.json"), "Dallas adapter must require the zoning manifest output");

assert(schema.properties.schemaVersion.const === "wr-dallas-zoning-layer-v1", "Dallas zoning schema must preserve its record schema version");
assert(schema.required.includes("sourceCountyId"), "Dallas zoning schema must require a source county id");
assert(schema.required.includes("zoningRecordId"), "Dallas zoning schema must require a stable zoning record id");
assert(schema.properties.recordType.enum.includes("base-zoning"), "Dallas zoning schema must support base zoning records");
assert(schema.properties.recordType.enum.includes("special-use-permit"), "Dallas zoning schema must support SUP records");
assert(schema.properties.recordType.enum.includes("subdistrict"), "Dallas zoning schema must support subdistrict records");
assert(schema.properties.pdNumber, "Dallas zoning schema must expose PD numbers");
assert(schema.properties.supNumber, "Dallas zoning schema must expose SUP numbers");
assert(schema.properties.subdistricts, "Dallas zoning schema must expose subdistricts");
assert(schema.properties.joinMethod.enum.includes("spatial"), "Dallas zoning schema must support spatial joins");
assert(parcelIndexSchema.properties.schemaVersion.const === "wr-parcel-zoning-index-v1", "Parcel zoning index schema must preserve its version");
assert(parcelIndexSchema.required.includes("countyParcelId"), "Parcel zoning index schema must require county parcel IDs");
assert(parcelIndexSchema.properties.zoningSummary.properties.pdNumbers, "Parcel zoning index schema must expose PD numbers by parcel");
assert(parcelIndexSchema.properties.zoningSummary.properties.supNumbers, "Parcel zoning index schema must expose SUP numbers by parcel");
assert(parcelIndexSchema.properties.zoningSummary.properties.subdistricts, "Parcel zoning index schema must expose subdistricts by parcel");

assert(scriptSource.includes("returnCountOnly=true"), "Zoning manifest builder must use ArcGIS count queries");
assert(scriptSource.includes("resultRecordCount=3"), "Zoning manifest builder must sample only a tiny record set");
assert(scriptSource.includes("renderDirectlyInBrowser: false"), "Zoning manifest builder must block direct browser rendering");
assert(scriptSource.includes("CRMHostedLayers/FeatureServer/13"), "Zoning manifest builder must inspect City Dallas tax parcels");
assert(scriptSource.includes("Dallas_Zoning/FeatureServer/15"), "Zoning manifest builder must inspect base zoning");
assert(scriptSource.includes("Dallas_Zoning/FeatureServer/4"), "Zoning manifest builder must inspect SUP");
assert(scriptSource.includes("Dallas_Zoning/FeatureServer/9"), "Zoning manifest builder must inspect PD subdistricts");
assert(scriptSource.includes("Dallas_Zoning/FeatureServer/11"), "Zoning manifest builder must inspect PDS subdistricts");
assert(scriptSource.includes("AreasOfRequest/FeatureServer/10"), "Zoning manifest builder must inspect current-year zoning cases");
assert(parcelIndexScriptSource.includes("pointInPolygon"), "Parcel zoning index builder must spatially join zoning polygons to parcels");
assert(parcelIndexScriptSource.includes("pdNumbers"), "Parcel zoning index builder must collect PD numbers");
assert(parcelIndexScriptSource.includes("supNumbers"), "Parcel zoning index builder must collect SUP numbers");
assert(parcelIndexScriptSource.includes("subdistricts"), "Parcel zoning index builder must collect subdistricts");
assert(parcelIndexScriptSource.includes("SHARD_KEY_LENGTH = 8"), "Parcel zoning index builder must use tight shards for safe parcel ID lookup");

assert(manifest.schemaVersion === "wr-dallas-zoning-manifest-v1", "Dallas zoning manifest must have a stable schema version");
assert(manifest.recordSchemaVersion === "wr-dallas-zoning-layer-v1", "Dallas zoning manifest must point to the zoning record schema");
assert(manifest.sourceCountyId === "dallas-county-dcad", "Dallas zoning manifest must be county-aware");
assert(["metadata-ready", "parcel-index-ready"].includes(manifest.status), "Dallas zoning manifest must be ready");
assert(manifest.defaultVisible === false, "Dallas zoning manifest must stay default-off");
assert(manifest.renderDirectlyInBrowser === false, "Dallas zoning manifest must prevent direct browser rendering");
assert(manifest.chunkCount === 0, "Dallas zoning manifest must not pretend viewport chunks exist yet");
assert(Array.isArray(manifest.chunks) && manifest.chunks.length === 0, "Dallas zoning manifest chunks must start empty");
assert(manifest.searchIndexCount === 0, "Dallas zoning search index must start empty until normalized records are built");
assert(manifest.maxFeaturesPerViewport <= 750, "Dallas zoning manifest must carry the viewport feature cap");
assert(Array.isArray(manifest.sourceLayers) && manifest.sourceLayers.length >= 4, "Dallas zoning manifest must include source layer inventory");
assert(manifest.sourceLayers.some((layer) => layer.id === "city-tax-parcels" && Number.isFinite(layer.featureCount)), "Dallas zoning manifest must count the city tax parcel bridge");
assert(manifest.sourceLayers.some((layer) => layer.id === "base-zoning" && Number.isFinite(layer.featureCount)), "Dallas zoning manifest must count base zoning");
assert(manifest.sourceLayers.some((layer) => layer.id === "special-use-permits" && Number.isFinite(layer.featureCount)), "Dallas zoning manifest must count SUP");
assert(manifest.sourceLayers.some((layer) => layer.id === "pd-subdistricts" && Number.isFinite(layer.featureCount)), "Dallas zoning manifest must count PD subdistricts");
assert(manifest.sourceLayers.some((layer) => layer.id === "pds-subdistricts" && Number.isFinite(layer.featureCount)), "Dallas zoning manifest must count PDS subdistricts");
assert(manifest.sourceLayers.some((layer) => layer.id === "current-year-zoning-cases" && Number.isFinite(layer.featureCount)), "Dallas zoning manifest must count current-year zoning cases");
assert(manifest.joinPlan.baseParcelProtection.includes("never overwrite DCAD base parcel data"), "Dallas zoning manifest must protect DCAD base parcels");
assert(manifest.parcelIndex === "parcel-zoning-index.json", "Dallas zoning manifest must expose the parcel zoning index");
assert(manifest.parcelIndexCount === parcelIndex.recordCount, "Dallas zoning manifest parcel index count must match the index");
assert(manifest.parcelIndexShards.keyLength === 8, "Dallas zoning parcel index must use safe 8-character shards");
assert(manifest.parcelZoningJoin.includedZoning.includes("PD"), "Dallas zoning manifest must include PD in the parcel join");
assert(manifest.parcelZoningJoin.includedZoning.includes("SUP"), "Dallas zoning manifest must include SUP in the parcel join");
assert(manifest.parcelZoningJoin.includedZoning.includes("subdistricts"), "Dallas zoning manifest must include subdistricts in the parcel join");

assert(parcelIndex.schemaVersion === "wr-parcel-zoning-index-v1", "Parcel zoning index must have a stable schema version");
assert(parcelIndex.sourceCountyId === "dallas-county-dcad", "Parcel zoning index must be county-aware");
assert(parcelIndex.shardKeyLength === 8, "Parcel zoning index must use 8-character shard keys");
assert(parcelIndex.recordCount > 600000, "Parcel zoning index must include the Dallas parcel zoning records");
assert(parcelIndex.arcgisJoinedParcelCount > 250000, "Parcel zoning index must include ArcGIS-joined parcels");
assert(parcelIndex.parcelsWithPd > 50000, "Parcel zoning index must include PD parcel matches");
assert(parcelIndex.parcelsWithSup > 4000, "Parcel zoning index must include SUP parcel matches");
assert(parcelIndex.parcelsWithSubdistricts > 40000, "Parcel zoning index must include subdistrict parcel matches");
assert(parcelIndex.shardCount > 1000, "Parcel zoning index must be sharded for parcel ID lookup");

assert(report.includes("Dallas Zoning Source Report"), "Dallas zoning source report must be written");
assert(report.includes("Render directly in browser: false"), "Dallas zoning source report must document browser safety");
assert(report.includes("never overwrite DCAD base parcel data"), "Dallas zoning source report must document base parcel protection");
assert(parcelIndexReport.includes("Page design changed: no"), "Parcel zoning index report must document no page design changes");
assert(parcelIndexReport.includes("Parcels with PD numbers"), "Parcel zoning index report must report PD coverage");
assert(parcelIndexReport.includes("Parcels with SUP numbers"), "Parcel zoning index report must report SUP coverage");
assert(parcelIndexReport.includes("Parcels with subdistricts"), "Parcel zoning index report must report subdistrict coverage");

assert(countyConfigSource.includes('zoning: "/data/zoning/"'), "Active county config must expose a zoning data root");
assert(countyConfigSource.includes('zoning: "/data/zoning/manifest.json"'), "Active county config must expose a zoning manifest path");
assert(loaderSource.includes("MAX_ZONING_FEATURES_PER_VIEWPORT"), "Zoning loader must cap viewport records");
assert(loaderSource.includes("chunkCache"), "Zoning loader must cache viewport chunks");
assert(loaderSource.includes("loadZoningRecordsForViewport"), "Zoning loader must expose viewport loading");
assert(loaderSource.includes("searchFullZoningRecords"), "Zoning loader must expose search plumbing");
assert(loaderSource.includes("loadParcelZoningSummary"), "Zoning loader must expose parcel ID zoning summaries");
assert(loaderSource.includes("loadParcelZoningSummaries"), "Zoning loader must expose batch parcel zoning summaries for the optional layer");
assert(loaderSource.includes("activeCountyDataset.dataRoots.zoning"), "Zoning loader must read from active county data roots");

assert(!appSource.includes("loadZoningManifest"), "White Rabbit pages must not load zoning during page render yet");
assert(appSource.includes("loadParcelZoningSummary"), "White Rabbit parcel card must load parcel zoning summaries on demand");
assert(appSource.includes("loadParcelZoningSummaries"), "White Rabbit zoning layer must use parcel-safe batch summaries");
assert(appSource.includes('DetailRow label="Zoning"'), "White Rabbit parcel card must expose zoning summaries");
assert(appSource.includes('DetailRow label="Subdistricts"'), "White Rabbit parcel card must expose subdistricts");
assert(appSource.includes('label="Toggle zoning layer"'), "White Rabbit map must expose a default-off zoning layer toggle");
assert(appSource.includes('"wr-zoning-parcels-fill"'), "White Rabbit map must render zoning as a parcel-safe overlay");
assert(appSource.includes("visibleParcelZoningMap"), "White Rabbit zoning layer must be driven by visible parcel lookups");

console.log("Dallas zoning plumbing tests passed.");
