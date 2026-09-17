const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const dallas = readJson("data/county-adapters/dallas/adapter.json");
const tarrant = readJson("data/county-adapters/tarrant/adapter.json");
const harris = readJson("data/county-adapters/harris-county-tx/adapter.json");
const parcelManifest = readJson("public/data/parcels/manifest.json");
const permitManifest = readJson("public/data/permits/manifest.json");
const developmentIndex = readJson("public/data/developments/parcel-development-index.json");
const qcIndex = readJson("output/county-qc/index.json");
const countyConfigSource = fs.readFileSync(path.join(root, "src", "data", "countyConfig.ts"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const registrySource = fs.readFileSync(path.join(root, "src", "data", "countyRegistry.ts"), "utf8");

const requiredOutputs = [
  "output/schema-report.md",
  "output/schema-report.json",
  "output/join-key-report.md",
  "output/full-parcel-access-report.md",
  "output/white-rabbit-dallas-parcels.geojson",
  "output/vector-tiles/README.md",
  "output/dcad-county-adapter-report.md",
  "output/dallas-stability-lock-report.md",
  "output/dallas-zoning-source-report.md",
  "output/dallas-zoning-source-report.json",
  "output/dallas-parcel-zoning-index-report.md",
  "output/dallas-parcel-zoning-index-report.json",
  "output/dallas-parcel-floodplain-index-report.md",
  "output/dallas-parcel-floodplain-index-report.json",
  "output/dallas-parcel-intelligence-report.md",
  "output/dallas-parcel-intelligence-report.json",
  "output/county-qc/dallas-county-dcad.md",
  "output/county-qc/dallas-county-dcad.json",
  "output/county-qc/tarrant-county-tad.md",
  "output/county-qc/tarrant-county-tad.json",
  "output/county-qc/harris-county-tx.md",
  "output/county-qc/harris-county-tx.json",
  "output/county-qc/index.md",
  "output/county-qc/index.json",
  "public/data/zoning/manifest.json",
  "public/data/zoning/parcel-zoning-index.json",
  "public/data/floodplain/manifest.json",
  "public/data/floodplain/parcel-floodplain-index.json",
];

const dallasQc = qcIndex.counties.find((county) => county.adapterId === "dallas-county-dcad");
const tarrantQc = qcIndex.counties.find((county) => county.adapterId === "tarrant-county-tad");
const harrisQc = qcIndex.counties.find((county) => county.adapterId === "harris-county-tx");

for (const outputPath of requiredOutputs) {
  assert(exists(outputPath), `Required acceptance output is missing: ${outputPath}`);
}

assert(dallas.status === "active", "Dallas adapter must be active");
assert(tarrant.status === "pilot", "Next county adapter must remain pilot-only");
assert(harris.status === "pilot", "Harris adapter must remain pilot-only");
assert(countyConfigSource.includes('id: "dallas-county-dcad"'), "The live app config must remain Dallas");
assert(!countyConfigSource.includes('id: "tarrant-county-tad"'), "The pilot county must not be activated in the live app config");
assert(!countyConfigSource.includes('id: "harris-county-tx"'), "Harris pilot county must not be activated in the live app config");

assert(dallas.publicDataRoots.parcels === "/data/parcels/", "Dallas parcel public root must remain stable");
assert(dallas.publicDataRoots.permits === "/data/permits/", "Dallas permit public root must remain stable");
assert(dallas.publicDataRoots.developments === "/data/developments/", "Dallas development public root must remain stable");
assert(dallas.publicDataRoots.zoning === "/data/zoning/", "Dallas zoning public root must be isolated from base parcel data");

assert(parcelManifest.featureCount === 696601, "Dallas parcel geometry count must remain 696,601");
assert(parcelManifest.chunkCount === 1614, "Dallas parcel chunk count must remain 1,614");
assert(Object.keys(parcelManifest.searchIndexShards.files).length === 1224, "Dallas search shard count must remain 1,224");
assert(permitManifest.permitCount === 150571, "Dallas permit source count must remain 150,571");
assert(permitManifest.joinedPermitCount === 97300, "Dallas joined permit count must remain 97,300");
assert(permitManifest.unmatchedPermitCount === 53271, "Dallas unmatched permit count must remain 53,271");
assert(developmentIndex.parcelCount === 24950, "Dallas development parcel count must remain 24,950");
const zoningManifest = readJson("public/data/zoning/manifest.json");
assert(zoningManifest.defaultVisible === false, "Dallas zoning must stay default-off");
assert(zoningManifest.renderDirectlyInBrowser === false, "Dallas zoning must not render raw ArcGIS layers directly in the browser");
assert(zoningManifest.chunkCount === 0, "Dallas zoning must not claim production chunks until they are built");
assert(zoningManifest.parcelIndex === "parcel-zoning-index.json", "Dallas zoning must expose parcel ID zoning lookup plumbing");
assert(zoningManifest.parcelIndexShards.keyLength === 8, "Dallas zoning parcel index must use safe lookup shards");
const parcelZoningIndex = readJson("public/data/zoning/parcel-zoning-index.json");
assert(parcelZoningIndex.parcelsWithPd > 50000, "Dallas zoning parcel index must include PD parcel matches");
assert(parcelZoningIndex.parcelsWithSup > 4000, "Dallas zoning parcel index must include SUP parcel matches");
assert(parcelZoningIndex.parcelsWithSubdistricts > 40000, "Dallas zoning parcel index must include subdistrict parcel matches");
const floodplainManifest = readJson("public/data/floodplain/manifest.json");
assert(floodplainManifest.defaultVisible === false, "Dallas floodplain must stay default-off");
assert(floodplainManifest.renderDirectlyInBrowser === false, "Dallas floodplain must not render raw ArcGIS layers directly in the browser");
assert(floodplainManifest.parcelIndex === "parcel-floodplain-index.json", "Dallas floodplain must expose parcel ID floodplain lookup plumbing");
assert(floodplainManifest.parcelIndexShards.keyLength === 8, "Dallas floodplain parcel index must use safe lookup shards");
const parcelFloodplainIndex = readJson("public/data/floodplain/parcel-floodplain-index.json");
assert(parcelFloodplainIndex.parcelFloodplainRecordCount > 0, "Dallas floodplain parcel index must include parcel matches");
assert(parcelFloodplainIndex.parcelsInSfhaCount > 0, "Dallas floodplain parcel index must include SFHA parcel matches");
const parcelIntelligenceReport = readJson("output/dallas-parcel-intelligence-report.json");
assert(parcelIntelligenceReport.parcelIdContract.unifiedLoader === "src/map/loadParcelIntelligence.ts", "Dallas parcel intelligence must expose one parcel ID lookup loader");
assert(parcelIntelligenceReport.parcelIdContract.uiActivation === "parcel-card-zoning-floodplain-and-optional-floodplain-layer", "Dallas parcel intelligence must document parcel-card zoning/floodplain and optional floodplain layer activation");

assert(dallasQc && dallasQc.status === "pass", "Dallas county QC must pass");
assert(tarrantQc && tarrantQc.status === "warning", "Pilot county QC must be warning-only");
assert(harrisQc && harrisQc.status === "warning", "Harris pilot county QC must be warning-only");
assert(qcIndex.failCount === 0, "County QC must have zero failures");

assert(appSource.includes("earth-blue-marble-2048.png"), "Locked landing page baseline must still use the Earth imagery asset");
assert(appSource.includes("Earth from space") || appSource.includes('alt="Earth"'), "Locked landing page baseline must still expose Earth imagery");
assert(appSource.includes("Enter Map"), "Locked landing page baseline must still expose Enter Map");
assert(appSource.includes("activeCountyDataset"), "Frontend must continue using the active county dataset plumbing");
assert(appSource.includes("data-county-selector=\"white-rabbit\""), "Frontend must include a county selector hook");
assert(appSource.includes("loadParcelZoningSummary"), "Frontend must load parcel zoning on demand for the parcel card");
assert(appSource.includes("loadParcelZoningSummaries"), "Frontend must load parcel zoning in parcel-safe batches for the optional layer");
assert(appSource.includes('DetailRow label="Zoning"'), "Frontend must show zoning on the parcel card");
assert(appSource.includes('DetailRow label="Subdistricts"'), "Frontend must show subdistricts on the parcel card");
assert(appSource.includes('label="Toggle zoning layer"'), "Frontend must expose the default-off zoning layer toggle");
assert(appSource.includes('"wr-zoning-parcels-fill"'), "Frontend must render zoning through the parcel-safe overlay layer");
assert(appSource.includes("loadParcelFloodplainSummary"), "Frontend must load parcel floodplain plumbing for the parcel card");
assert(appSource.includes("loadParcelFloodplainSummaries"), "Frontend must load parcel floodplain plumbing for the optional floodplain layer");
assert(appSource.includes('DetailRow label="Floodplain"'), "Frontend must show floodplain on the parcel card");
assert(appSource.includes('label="Toggle floodplain layer"'), "Frontend must expose the default-off floodplain layer toggle");
assert(!appSource.includes("loadParcelIntelligenceSummary"), "Frontend must not visually activate combined parcel intelligence plumbing yet");
assert(registrySource.includes("availableCountyDatasets"), "County selector registry must expose available county datasets");
assert(registrySource.includes("tarrant-county-tad"), "County selector registry must include the pilot county without activating it");
assert(registrySource.includes("jefferson-ky"), "County selector registry must include Louisville/Jefferson County as a pilot county");
assert(registrySource.includes("harris-county-tx"), "County selector registry must include Harris County as a pilot-online county");
assert(registrySource.includes("maricopa-county-az"), "County selector registry must include Maricopa County as a pilot-online county");
assert(registrySource.includes("king-county-wa"), "County selector registry must include King County as a pilot-online county");

console.log("White Rabbit final acceptance tests passed.");
