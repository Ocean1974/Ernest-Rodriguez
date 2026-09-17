const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const dallas = readJson("data/county-adapters/dallas/adapter.json");
const tarrant = readJson("data/county-adapters/tarrant/adapter.json");
const louisville = readJson("data/county-adapters/louisville/adapter.json");
const schema = readJson("data/schemas/universal-parcel.schema.json");
const builderSource = fs.readFileSync(path.join(root, "scripts", "build-app-parcel-service.cjs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const registrySource = fs.readFileSync(path.join(root, "src", "data", "countyRegistry.ts"), "utf8");
const qcSource = fs.readFileSync(path.join(root, "scripts", "build-county-qc-reports.cjs"), "utf8");

assert(schema.properties.sourceCountyId, "Universal schema must include sourceCountyId");
assert(schema.properties.countyParcelId, "Universal schema must include countyParcelId");
assert(dallas.status === "active", "Dallas must be the first active adapter");
assert(tarrant.status === "pilot", "New counties must start as pilot adapters");
assert(louisville.status === "pilot", "Louisville must start as a pilot adapter");
assert(dallas.universalParcelSchema.version === schema.properties.schemaVersion.const, "Dallas must map into the universal parcel schema");
assert(tarrant.universalParcelSchema.version === schema.properties.schemaVersion.const, "Pilot counties must map into the universal parcel schema");
assert(louisville.universalParcelSchema.version === schema.properties.schemaVersion.const, "Louisville pilot must map into the universal parcel schema");

assert(builderSource.includes("resolveCountyAdapter"), "Parcel service builder must resolve a county adapter");
assert(builderSource.includes("adapter.productionOutputs?.parcelGeojson"), "Parcel service builder must read county-specific parcel output paths");
assert(builderSource.includes("adapter.publicDataRoots?.parcels"), "Parcel service builder must read county-specific public parcel roots");
assert(builderSource.includes("adapter.map?.geoBounds"), "Parcel service builder must read county-specific map bounds");
assert(!builderSource.includes('const SOURCE_COUNTY_ID = "dallas-county-dcad"'), "Parcel service builder must not hardcode Dallas as the only source");

assert(Array.isArray(dallas.optionalLayers) && dallas.optionalLayers.length >= 3, "Dallas adapter must declare optional county layers");
assert(Array.isArray(tarrant.optionalLayers) && tarrant.optionalLayers.length >= 1, "Pilot adapter must declare optional county layers");
assert(Array.isArray(louisville.optionalLayers) && louisville.optionalLayers.some((layer) => layer.source === "County parcel geometry service"), "Louisville pilot must declare its county parcel source");
assert(qcSource.includes("Optional county layers are declared"), "County QA must report optional county layers");

assert(registrySource.includes("availableCountyDatasets"), "County registry must expose selector options");
assert(registrySource.includes("enabled: true"), "County registry must mark Dallas as enabled");
assert(registrySource.includes('id: "tarrant-county-tad"') && registrySource.includes("enabled: false"), "County registry must keep source-needed pilots disabled");
assert(registrySource.includes("jefferson-ky"), "County registry must include Louisville/Jefferson County as a pilot");
assert(registrySource.includes("harris-county-tx"), "County registry must include Harris County as a pilot-online county");
assert(registrySource.includes("maricopa-county-az"), "County registry must include Maricopa County as a pilot-online county");
assert(registrySource.includes("king-county-wa"), "County registry must include King County as a pilot-online county");
assert(appSource.includes("data-county-selector=\"white-rabbit\""), "App must include the county selector hook");
assert(appSource.includes("sr-only"), "County selector must not change visible page layout");

console.log("White Rabbit county adapter architecture tests passed.");
