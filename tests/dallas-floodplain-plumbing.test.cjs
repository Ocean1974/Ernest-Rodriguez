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
const parcelIndexSchema = readJson("data/schemas/parcel-floodplain-index.schema.json");
const manifest = readJson("public/data/floodplain/manifest.json");
const parcelIndex = readJson("public/data/floodplain/parcel-floodplain-index.json");
const report = read("output/dallas-parcel-floodplain-index-report.md");
const scriptSource = read("scripts/build-dallas-parcel-floodplain-index.cjs");
const loaderSource = read("src/map/loadFloodplain.ts");
const countyConfigSource = read("src/data/countyConfig.ts");
const appSource = read("src/App.tsx");

const floodplainLayer = adapter.optionalLayers.find((layer) => layer.id === "dallas-floodplain-intelligence");

assert(floodplainLayer, "Dallas adapter must declare the floodplain intelligence optional layer");
assert(floodplainLayer.defaultVisible === false, "Dallas floodplain layer must stay default-off");
assert(floodplainLayer.status === "parcel-index-ready", "Dallas floodplain layer must be parcel-index-ready after the index is built");
assert(floodplainLayer.publicDataRoot === "/data/floodplain/", "Dallas floodplain layer must publish to the floodplain data root");
assert(floodplainLayer.manifestPath === "public/data/floodplain/manifest.json", "Dallas floodplain layer must point to its manifest");
assert(floodplainLayer.parcelIndexPath === "public/data/floodplain/parcel-floodplain-index.json", "Dallas floodplain layer must point to its parcel index");
assert(floodplainLayer.schemaPath === "data/schemas/parcel-floodplain-index.schema.json", "Dallas floodplain layer must point to its schema");
assert(floodplainLayer.parcelIndexSchemaPath === "data/schemas/parcel-floodplain-index.schema.json", "Dallas floodplain layer must point to its parcel index schema");
assert(floodplainLayer.sourceUrls.some((url) => url.includes("Current_Floodplain/FeatureServer")), "Dallas floodplain layer must preserve the Current Floodplain service URL");
assert(floodplainLayer.renderStrategy.includes("sharded parcel ID lookup"), "Dallas floodplain render strategy must use parcel ID shards");
assert(floodplainLayer.maxFeaturesPerViewport <= 750, "Dallas floodplain viewport cap must be bounded");
assert(adapter.joinKeys.floodplain.includes("parcel centroid spatial join"), "Dallas adapter must document the floodplain join key");
assert(adapter.requiredOutputs.includes("public/data/floodplain/manifest.json"), "Dallas adapter must require the floodplain manifest output");
assert(adapter.requiredOutputs.includes("public/data/floodplain/parcel-floodplain-index.json"), "Dallas adapter must require the floodplain parcel index output");

assert(parcelIndexSchema.properties.schemaVersion.const === "wr-parcel-floodplain-index-v1", "Parcel floodplain index schema must preserve its version");
assert(parcelIndexSchema.required.includes("countyParcelId"), "Parcel floodplain index schema must require county parcel IDs");
assert(parcelIndexSchema.required.includes("floodplainSummary"), "Parcel floodplain index schema must require a floodplain summary");
assert(parcelIndexSchema.properties.floodplainSummary.properties.floodZones, "Parcel floodplain index schema must expose flood zones by parcel");
assert(parcelIndexSchema.properties.floodplainSummary.properties.zoneSubtypes, "Parcel floodplain index schema must expose zone subtypes by parcel");
assert(parcelIndexSchema.properties.floodplainSummary.properties.sfha, "Parcel floodplain index schema must expose SFHA flags by parcel");
assert(parcelIndexSchema.properties.floodplainSummary.properties.baseFloodElevations, "Parcel floodplain index schema must expose BFE values by parcel");
assert(parcelIndexSchema.properties.sourceLayerHits.items.properties.sourceCitation, "Parcel floodplain index schema must preserve source citations");

assert(scriptSource.includes("Current_Floodplain/FeatureServer/0"), "Floodplain index builder must use the official Current Floodplain layer");
assert(scriptSource.includes("returnCountOnly=true"), "Floodplain index builder must use ArcGIS count queries");
assert(scriptSource.includes("outSR=4326"), "Floodplain index builder must request WGS84 geometry");
assert(scriptSource.includes("pointInPolygon"), "Floodplain index builder must spatially join floodplain polygons to parcels");
assert(scriptSource.includes("SHARD_KEY_LENGTH = 8"), "Floodplain index builder must use tight shards for safe parcel ID lookup");

assert(manifest.schemaVersion === "wr-dallas-floodplain-manifest-v1", "Dallas floodplain manifest must have a stable schema version");
assert(manifest.recordSchemaVersion === "wr-parcel-floodplain-index-v1", "Dallas floodplain manifest must point to the floodplain record schema");
assert(manifest.sourceCountyId === "dallas-county-dcad", "Dallas floodplain manifest must be county-aware");
assert(manifest.status === "parcel-index-ready", "Dallas floodplain manifest must be parcel-index-ready");
assert(manifest.defaultVisible === false, "Dallas floodplain manifest must stay default-off");
assert(manifest.renderDirectlyInBrowser === false, "Dallas floodplain manifest must prevent direct browser rendering");
assert(manifest.chunkCount === 0, "Dallas floodplain manifest must not pretend viewport chunks exist yet");
assert(Array.isArray(manifest.chunks) && manifest.chunks.length === 0, "Dallas floodplain manifest chunks must start empty");
assert(manifest.parcelIndex === "parcel-floodplain-index.json", "Dallas floodplain manifest must expose the parcel floodplain index");
assert(manifest.parcelIndexCount === parcelIndex.parcelFloodplainRecordCount, "Dallas floodplain manifest parcel index count must match the index");
assert(manifest.parcelIndexShards.keyLength === 8, "Dallas floodplain parcel index must use safe 8-character shards");
assert(manifest.parcelFloodplainJoin.baseParcelProtection.includes("not overwritten"), "Dallas floodplain manifest must protect DCAD base parcels");
assert(manifest.parcelFloodplainJoin.includedFloodplain.includes("FLD_ZONE"), "Dallas floodplain manifest must include flood zones in the parcel join");
assert(manifest.parcelFloodplainJoin.includedFloodplain.includes("SFHA_TF"), "Dallas floodplain manifest must include SFHA flags in the parcel join");

assert(parcelIndex.schemaVersion === "wr-parcel-floodplain-index-v1", "Parcel floodplain index must have a stable schema version");
assert(parcelIndex.sourceCountyId === "dallas-county-dcad", "Parcel floodplain index must be county-aware");
assert(parcelIndex.shardKeyLength === 8, "Parcel floodplain index must use 8-character shard keys");
assert(parcelIndex.sourceFeatureCount > 0, "Parcel floodplain index must include official source floodplain features");
assert(parcelIndex.parcelFloodplainRecordCount > 0, "Parcel floodplain index must include parcel floodplain matches");
assert(parcelIndex.parcelsWithFloodZoneCount > 0, "Parcel floodplain index must include flood zone parcel matches");
assert(parcelIndex.parcelsInSfhaCount > 0, "Parcel floodplain index must include SFHA parcel matches");
assert(parcelIndex.shardCount > 0, "Parcel floodplain index must be sharded for parcel ID lookup");

assert(report.includes("Dallas Parcel Floodplain Index Report"), "Dallas floodplain report must be written");
assert(report.includes("Page design changed: no"), "Dallas floodplain report must document no page design changes");
assert(report.includes("Base parcel data overwritten: no"), "Dallas floodplain report must document base parcel protection");
assert(report.includes("Parcels in SFHA"), "Dallas floodplain report must report SFHA coverage");

assert(countyConfigSource.includes('floodplain: "/data/floodplain/"'), "Active county config must expose a floodplain data root");
assert(countyConfigSource.includes('floodplain: "/data/floodplain/manifest.json"'), "Active county config must expose a floodplain manifest path");
assert(loaderSource.includes("loadFloodplainManifest"), "Floodplain loader must expose manifest loading");
assert(loaderSource.includes("loadParcelFloodplainSummary"), "Floodplain loader must expose parcel ID floodplain summaries");
assert(loaderSource.includes("loadParcelFloodplainSummaries"), "Floodplain loader must expose batched parcel ID floodplain summaries");
assert(loaderSource.includes("loadFloodplainRecordsForParcel"), "Floodplain loader must expose floodplain hits by parcel");
assert(loaderSource.includes("activeCountyDataset.dataRoots.floodplain"), "Floodplain loader must read from active county data roots");
assert(loaderSource.includes("parcelFloodplainShardCache"), "Floodplain loader must cache parcel ID shards");

assert(!appSource.includes("loadFloodplainManifest"), "White Rabbit pages must not load raw floodplain manifests directly");
assert(appSource.includes("loadParcelFloodplainSummary"), "White Rabbit parcel card must load floodplain summaries by parcel ID");
assert(appSource.includes("loadParcelFloodplainSummaries"), "White Rabbit floodplain layer must use batched parcel ID floodplain lookup");
assert(!appSource.includes("loadFloodplainRecordsForParcel"), "White Rabbit pages must not load raw floodplain records directly");
assert(appSource.includes('DetailRow label="Floodplain"'), "White Rabbit parcel card must expose floodplain status");
assert(appSource.includes('DetailRow label="Flood Zone"'), "White Rabbit parcel card must expose flood zones");
assert(appSource.includes('DetailRow label="SFHA"'), "White Rabbit parcel card must expose SFHA status");
assert(appSource.includes('id: "wr-floodplain-parcels-fill"'), "White Rabbit map must include a default-off floodplain fill layer");
assert(appSource.includes('label="Toggle floodplain layer"'), "White Rabbit map must expose a floodplain layer toggle");
assert(appSource.includes("setVisibleParcelFloodplainMap((current) => (current.size ? new Map() : current))"), "Floodplain layer off-state must not loop by replacing an already-empty map");

console.log("Dallas floodplain plumbing tests passed.");
