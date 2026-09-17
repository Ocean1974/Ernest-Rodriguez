const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const loaderSource = read("src/map/loadParcelIntelligence.ts");
const zoningLoaderSource = read("src/map/loadZoning.ts");
const floodplainLoaderSource = read("src/map/loadFloodplain.ts");
const appSource = read("src/App.tsx");
const packageJson = readJson("package.json");
const report = readJson("output/dallas-parcel-intelligence-report.json");
const reportMd = read("output/dallas-parcel-intelligence-report.md");
const dallasAdapter = readJson("data/county-adapters/dallas/adapter.json");
const dallasPipeline = readJson("data/county-adapters/dallas/pipeline.json");

assert(loaderSource.includes("loadParcelZoningSummary"), "Parcel intelligence loader must call parcel zoning summaries");
assert(loaderSource.includes("loadParcelFloodplainSummary"), "Parcel intelligence loader must call parcel floodplain summaries");
assert(loaderSource.includes("loadParcelIntelligenceSummary"), "Parcel intelligence loader must expose one combined parcel ID lookup");
assert(loaderSource.includes("Promise.allSettled"), "Parcel intelligence loader must keep optional layer failures isolated");
assert(loaderSource.includes("sourceCountyId: activeCountyDataset.id"), "Parcel intelligence loader must remain county-aware");
assert(loaderSource.includes("countyParcelId"), "Parcel intelligence loader must preserve county parcel IDs");
assert(loaderSource.includes("accountNum"), "Parcel intelligence loader must preserve account numbers");
assert(loaderSource.includes("gisParcelId"), "Parcel intelligence loader must preserve GIS parcel IDs");
assert(zoningLoaderSource.includes("serviceBase?: string"), "Zoning loader options must accept a county-specific service root");
assert(zoningLoaderSource.includes("zoningServiceBase"), "Zoning loader must normalize county-specific zoning roots");
assert(zoningLoaderSource.includes("manifestPromises"), "Zoning loader must cache manifests by service root");
assert(zoningLoaderSource.includes("loadParcelZoningSummary(parcelAccountOrCountyId: string, serviceBase"), "Zoning parcel summary lookup must accept a county-specific service root");
assert(zoningLoaderSource.includes("loadParcelZoningSummaries(parcelAccountOrCountyIds: string[], maxParcels = 750, serviceBase"), "Zoning batch lookup must accept a county-specific service root");
assert(floodplainLoaderSource.includes("floodplainServiceBase"), "Floodplain loader must normalize county-specific floodplain roots");
assert(floodplainLoaderSource.includes("floodplainManifestPromises"), "Floodplain loader must cache manifests by service root");
assert(floodplainLoaderSource.includes("loadParcelFloodplainSummary(parcelAccountOrCountyId: string, serviceBase"), "Floodplain parcel summary lookup must accept a county-specific service root");
assert(floodplainLoaderSource.includes("loadParcelFloodplainSummaries(parcelAccountOrCountyIds: string[], maxParcels = 750, serviceBase"), "Floodplain batch lookup must accept a county-specific service root");

assert(!appSource.includes("loadParcelIntelligenceSummary"), "White Rabbit pages must not activate the combined parcel intelligence loader yet");
assert(appSource.includes("loadParcelFloodplainSummary"), "White Rabbit parcel card must load floodplain by parcel ID");
assert(appSource.includes("loadParcelFloodplainSummaries"), "White Rabbit floodplain layer must batch parcel ID floodplain lookup");
assert(appSource.includes("loadParcelZoningSummary"), "White Rabbit parcel card must load zoning by parcel ID");
assert(appSource.includes("JEFFERSON_KY_ZONING_SERVICE_ROOT"), "White Rabbit parcel card must point Jefferson parcels at the Jefferson zoning service root");
assert(appSource.includes("JEFFERSON_KY_FLOODPLAIN_SERVICE_ROOT"), "White Rabbit parcel card must point Jefferson parcels at the Jefferson floodplain service root");
assert(appSource.includes("loadParcelZoningSummary(parcelLookupId, zoningServiceRoot)"), "White Rabbit parcel card must pass the county zoning service root into selected parcel zoning lookup");
assert(appSource.includes("loadParcelZoningSummaries(parcelIds, ZONING_LAYER_LOOKUP_LIMIT, zoningServiceRoot)"), "White Rabbit zoning layer must pass the county zoning service root into batch zoning lookup");
assert(appSource.includes("loadParcelFloodplainSummary(parcelLookupId, floodplainServiceRoot)"), "White Rabbit parcel card must pass the county floodplain service root into selected parcel floodplain lookup");
assert(appSource.includes("loadParcelFloodplainSummaries(parcelIds, FLOODPLAIN_LAYER_LOOKUP_LIMIT, floodplainServiceRoot)"), "White Rabbit floodplain layer must pass the county floodplain service root into batch floodplain lookup");
assert(appSource.includes('DetailRow label="Zoning"'), "White Rabbit parcel card must expose zoning");
assert(appSource.includes('DetailRow label="Subdistricts"'), "White Rabbit parcel card must expose subdistricts");
assert(appSource.includes('DetailRow label="PD"'), "White Rabbit parcel card must expose PD numbers");
assert(appSource.includes('DetailRow label="SUP"'), "White Rabbit parcel card must expose SUP numbers");
assert(appSource.includes('DetailRow label="Floodplain"'), "White Rabbit parcel card must expose floodplain");
assert(appSource.includes('label="Toggle floodplain layer"'), "White Rabbit must expose the floodplain layer toggle");
assert(appSource.includes("buildParcelWebCompletionIntel"), "White Rabbit parcel card must build public web completion intelligence");
assert(appSource.includes('data-parcel-web-completion="active"'), "White Rabbit parcel card must expose the public web completion section");
assert(appSource.includes("PVA owner/appraisal export needed"), "Jefferson parcel cards must mark PVA owner/appraisal as source-needed");
assert(appSource.includes("no contact details inferred"), "Parcel cards must not infer owner phone/email from public web sources");
assert(appSource.includes("Land records source identified; parcel document join pending"), "Jefferson parcel cards must show land-record joins as pending");
assert(appSource.includes("official active permit records available; parcel join pending"), "Jefferson parcel cards must show permit source as verified but unjoined");

assert(packageJson.scripts["parcel-intel:report"] === "node scripts/build-dallas-parcel-intelligence-report.cjs", "Package scripts must expose parcel intelligence report generation");
assert(dallasAdapter.requiredOutputs.includes("output/dallas-parcel-intelligence-report.md"), "Dallas adapter must require the parcel intelligence markdown report");
assert(dallasAdapter.requiredOutputs.includes("output/dallas-parcel-intelligence-report.json"), "Dallas adapter must require the parcel intelligence JSON report");
assert(dallasPipeline.steps.some((step) => step.id === "build-parcel-intelligence-report"), "Dallas pipeline must publish the parcel intelligence readiness report");

assert(report.schemaVersion === "wr-dallas-parcel-intelligence-report-v1", "Parcel intelligence report must keep a stable schema version");
assert(report.sourceCountyId === "dallas-county-dcad", "Parcel intelligence report must be county-aware");
assert(report.pageDesignChanged === false, "Parcel intelligence report must document no page design changes");
assert(report.baseParcelDataOverwritten === false, "Parcel intelligence report must document base parcel protection");
assert(report.runtimeVisibility === "default-off", "Parcel intelligence report must stay default-off");
assert(report.parcelIdContract.unifiedLoader === "src/map/loadParcelIntelligence.ts", "Parcel intelligence report must point to the combined loader");
assert(report.parcelIdContract.uiActivation === "parcel-card-zoning-floodplain-and-optional-floodplain-layer", "Parcel intelligence report must document parcel-card zoning/floodplain and optional floodplain layer activation");
assert(report.zoning.parcelsWithPd > 50000, "Parcel intelligence report must include PD parcel coverage");
assert(report.zoning.parcelsWithSup > 4000, "Parcel intelligence report must include SUP parcel coverage");
assert(report.zoning.parcelsWithSubdistricts > 40000, "Parcel intelligence report must include subdistrict parcel coverage");
assert(report.floodplain.parcelFloodplainRecordCount > 0, "Parcel intelligence report must include floodplain parcel coverage");
assert(report.floodplain.parcelsInSfhaCount > 0, "Parcel intelligence report must include SFHA parcel coverage");
assert(reportMd.includes("Page design changed: no"), "Parcel intelligence markdown report must document no page design changes");
assert(reportMd.includes("UI activation: parcel-card zoning/floodplain + optional floodplain layer"), "Parcel intelligence markdown report must document parcel-card zoning/floodplain and optional floodplain layer activation");

console.log("White Rabbit parcel intelligence plumbing tests passed.");
