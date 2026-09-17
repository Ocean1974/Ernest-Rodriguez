const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const adapter = readJson("data/county-adapters/dallas/adapter.json");
const template = readJson("data/county-adapters/next-county-template.json");
const parcelManifest = readJson("public/data/parcels/manifest.json");
const permitManifest = readJson("public/data/permits/manifest.json");
const developmentIndex = readJson("public/data/developments/parcel-development-index.json");
const countyConfigSource = fs.readFileSync(path.join(root, "src", "data", "countyConfig.ts"), "utf8");
const parcelLoaderSource = fs.readFileSync(path.join(root, "src", "map", "loadParcels.ts"), "utf8");
const permitLoaderSource = fs.readFileSync(path.join(root, "src", "map", "loadPermits.ts"), "utf8");

assert(adapter.id === "dallas-county-dcad", "DCAD adapter must identify Dallas County DCAD");
assert(fs.existsSync(path.join(root, "data", "county-adapters", "dallas", "README.md")), "Dallas county adapter folder must include a README");
assert(adapter.appraisalDistrictAcronym === "DCAD", "DCAD adapter must preserve appraisal district acronym");
assert(adapter.map.geoBounds.minLng === -97.1 && adapter.map.geoBounds.maxLng === -96.45, "DCAD adapter must preserve county map bounds");
assert(adapter.map.locationName === "Dallas County DCAD Zone", "DCAD adapter must preserve county map location metadata");
assert(adapter.publicDataRoots.parcels === "/data/parcels/", "DCAD adapter must publish the parcel service root");
assert(adapter.publicDataRoots.permits === "/data/permits/", "DCAD adapter must publish the permit service root");
assert(adapter.optionalLayers.some((layer) => layer.id === "block-labels" && layer.status === "available"), "DCAD adapter must declare the BLKID optional layer");
assert(adapter.optionalLayers.some((layer) => layer.id === "parcel-dimensions" && layer.status === "available"), "DCAD adapter must declare the ParcelDimension optional layer");
assert(adapter.joinKeys.primaryParcelAccount.includes("PARCEL_GEOM.Acct"), "DCAD adapter must lock the primary parcel join");
assert(adapter.joinKeys.blockLabels.includes("spatial/nearest-label"), "DCAD adapter must document BLKID uncertainty");
assert(adapter.joinKeys.dimensions.includes("spatial/nearest-label"), "DCAD adapter must document ParcelDimension uncertainty");
assert(adapter.verifiedCounts.parcelGeometryFeatures === 696601, "DCAD adapter must preserve exact parcel geometry count");
assert(adapter.verifiedCounts.dcadAccountRows === 861357, "DCAD adapter must preserve exact account row count");
assert(adapter.verifiedCounts.permitRowsJoined === 97300, "DCAD adapter must preserve exact permit join count");
assert(adapter.verifiedCounts.parcelsWithDevelopmentSignals === 24950, "DCAD adapter must preserve exact development parcel count");

assert(template.status === "template", "Next-county adapter template must be marked as a template");
assert(template.joinKeys.primaryParcelAccount.includes("document exact"), "Next-county template must require explicit join-key documentation");
assert(template.notes.includes("do not change visible frontend pages"), "Next-county template must protect the locked UI baseline");

assert(countyConfigSource.includes('id: "dallas-county-dcad"'), "Active county config must point to Dallas County DCAD");
assert(countyConfigSource.includes("verifiedCounts"), "Active county config must carry verified counts");
assert(parcelLoaderSource.includes("activeCountyDataset.dataRoots.parcels"), "Parcel loader must read its service root from active county config");
assert(permitLoaderSource.includes("activeCountyDataset.dataRoots.permits"), "Permit loader must read its service root from active county config");

assert(parcelManifest.featureCount === adapter.verifiedCounts.parcelGeometryFeatures, "Parcel manifest count must match the DCAD adapter");
assert(parcelManifest.chunkCount === adapter.verifiedCounts.appParcelChunks, "Parcel chunk count must match the DCAD adapter");
assert(parcelManifest.searchIndexShards && Object.keys(parcelManifest.searchIndexShards.files).length === adapter.verifiedCounts.parcelSearchShards, "Parcel search shard count must match the DCAD adapter");
assert(permitManifest.joinedPermitCount === adapter.verifiedCounts.permitRowsJoined, "Permit joined count must match the DCAD adapter");
assert(permitManifest.unmatchedPermitCount === adapter.verifiedCounts.permitRowsUnmatched, "Permit unmatched count must match the DCAD adapter");
assert(developmentIndex.parcelCount === adapter.verifiedCounts.parcelsWithDevelopmentSignals, "Development parcel count must match the DCAD adapter");

assert(fs.existsSync(path.join(root, "output", "dcad-county-adapter-report.md")), "DCAD county adapter report must exist");
assert(fs.existsSync(path.join(root, "output", "dcad-final-smoke-test-checklist.md")), "DCAD smoke checklist must exist");

console.log("White Rabbit county adapter config tests passed.");
