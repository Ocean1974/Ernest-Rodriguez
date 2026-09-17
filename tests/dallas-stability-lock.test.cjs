const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const countyConfigSource = fs.readFileSync(path.join(root, "src", "data", "countyConfig.ts"), "utf8");
const dallas = readJson("data/county-adapters/dallas/adapter.json");
const tarrant = readJson("data/county-adapters/tarrant/adapter.json");
const louisville = readJson("data/county-adapters/louisville/adapter.json");
const harris = readJson("data/county-adapters/harris-county-tx/adapter.json");
const parcelManifest = readJson("public/data/parcels/manifest.json");
const permitManifest = readJson("public/data/permits/manifest.json");
const developmentIndex = readJson("public/data/developments/parcel-development-index.json");
const qcIndex = readJson("output/county-qc/index.json");

const dallasQc = qcIndex.counties.find((county) => county.adapterId === dallas.id);
const tarrantQc = qcIndex.counties.find((county) => county.adapterId === tarrant.id);
const louisvilleQc = qcIndex.counties.find((county) => county.adapterId === louisville.id);
const harrisQc = qcIndex.counties.find((county) => county.adapterId === harris.id);

assert(dallas.id === "dallas-county-dcad", "Dallas adapter ID must remain stable");
assert(dallas.status === "active", "Dallas must remain the active production adapter");
assert(tarrant.status === "pilot", "Tarrant must remain pilot-only until explicitly activated");
assert(louisville.status === "pilot", "Louisville must remain pilot-only until explicitly activated");
assert(harris.status === "pilot", "Harris must remain pilot-only until explicitly activated");
assert(tarrant.id !== dallas.id, "Pilot county adapter must not reuse the Dallas adapter ID");
assert(louisville.id !== dallas.id, "Louisville pilot adapter must not reuse the Dallas adapter ID");
assert(harris.id !== dallas.id, "Harris pilot adapter must not reuse the Dallas adapter ID");

assert(countyConfigSource.includes('id: "dallas-county-dcad"'), "App active county config must remain Dallas County DCAD");
assert(countyConfigSource.includes('countyName: "Dallas County"'), "App active county config must keep Dallas County metadata");
assert(countyConfigSource.includes('appraisalDistrictAcronym: "DCAD"'), "App active county config must keep DCAD metadata");
assert(!countyConfigSource.includes('id: "tarrant-county-tad"'), "Pilot county must not be activated in src/data/countyConfig.ts");
assert(!countyConfigSource.includes('id: "jefferson-ky"'), "Louisville pilot county must not be activated in src/data/countyConfig.ts");
assert(!countyConfigSource.includes('id: "harris-county-tx"'), "Harris pilot county must not be activated in src/data/countyConfig.ts");

assert(dallas.publicDataRoots.parcels === "/data/parcels/", "Dallas parcel root must remain the live public parcel root");
assert(dallas.publicDataRoots.permits === "/data/permits/", "Dallas permit root must remain the live public permit root");
assert(dallas.publicDataRoots.developments === "/data/developments/", "Dallas development root must remain the live public development root");
assert(tarrant.publicDataRoots.parcels !== dallas.publicDataRoots.parcels, "Pilot county parcel root must stay separate from Dallas");
assert(tarrant.publicDataRoots.permits !== dallas.publicDataRoots.permits, "Pilot county permit root must stay separate from Dallas");
assert(tarrant.publicDataRoots.developments !== dallas.publicDataRoots.developments, "Pilot county development root must stay separate from Dallas");
assert(louisville.publicDataRoots.parcels !== dallas.publicDataRoots.parcels, "Louisville pilot parcel root must stay separate from Dallas");
assert(louisville.publicDataRoots.permits !== dallas.publicDataRoots.permits, "Louisville pilot permit root must stay separate from Dallas");
assert(louisville.publicDataRoots.developments !== dallas.publicDataRoots.developments, "Louisville pilot development root must stay separate from Dallas");
assert(harris.publicDataRoots.parcels !== dallas.publicDataRoots.parcels, "Harris pilot parcel root must stay separate from Dallas");
assert(harris.publicDataRoots.permits !== dallas.publicDataRoots.permits, "Harris pilot permit root must stay separate from Dallas");
assert(harris.publicDataRoots.developments !== dallas.publicDataRoots.developments, "Harris pilot development root must stay separate from Dallas");

assert(parcelManifest.source === "output/white-rabbit-dallas-parcels.geojson", "Live parcel manifest must still point to the Dallas parcel output");
assert(parcelManifest.featureCount === dallas.verifiedCounts.parcelGeometryFeatures, "Dallas live parcel feature count must remain exact");
assert(parcelManifest.chunkCount === dallas.verifiedCounts.appParcelChunks, "Dallas live parcel chunk count must remain exact");
assert(
  Object.keys(parcelManifest.searchIndexShards.files).length === dallas.verifiedCounts.parcelSearchShards,
  "Dallas live search shard count must remain exact",
);
assert(permitManifest.permitCount === dallas.verifiedCounts.sourcePermitRecords, "Dallas source permit count must remain exact");
assert(permitManifest.joinedPermitCount === dallas.verifiedCounts.permitRowsJoined, "Dallas joined permit count must remain exact");
assert(permitManifest.unmatchedPermitCount === dallas.verifiedCounts.permitRowsUnmatched, "Dallas unmatched permit count must remain exact");
assert(developmentIndex.parcelCount === dallas.verifiedCounts.parcelsWithDevelopmentSignals, "Dallas development parcel count must remain exact");

assert(qcIndex.countyCount >= 25, "County QC index must include Dallas plus the seeded national pilot counties");
assert(qcIndex.passCount === 1, "Dallas must remain the only passing production-ready county");
assert(qcIndex.warningCount === qcIndex.countyCount - 1, "All non-Dallas county adapters must remain warning-only pilots");
assert(dallasQc && dallasQc.status === "pass", "Dallas QC must pass before refactoring continues");
assert(tarrantQc && tarrantQc.status === "warning", "Pilot county QC must stay warning-only until production data is loaded");
assert(louisvilleQc && louisvilleQc.status === "warning", "Louisville pilot QC must stay warning-only until production data is loaded");
assert(harrisQc && harrisQc.status === "warning", "Harris pilot QC must stay warning-only until production data is loaded");
assert(qcIndex.failCount === 0, "County QC index must not contain failures");

console.log("Dallas stability lock tests passed.");
