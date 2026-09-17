const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const schema = readJson("data/schemas/universal-parcel.schema.json");
const docs = fs.readFileSync(path.join(root, "data", "schemas", "universal-parcel.md"), "utf8");
const dallasAdapter = readJson("data/county-adapters/dallas/adapter.json");
const builderSource = fs.readFileSync(path.join(root, "scripts", "build-app-parcel-service.cjs"), "utf8");
const parcelManifest = readJson("public/data/parcels/manifest.json");

const requiredFields = [
  "schemaVersion",
  "sourceCountyId",
  "countyParcelId",
  "accountNum",
  "accountNumber",
  "gisParcelId",
  "address",
  "centroid",
  "points",
  "liveGeometry",
  "realGeometry",
  "joins",
  "sourceReferences",
];

assert(schema.title === "White Rabbit Universal Parcel", "Universal parcel schema title is missing");
assert(schema.properties.schemaVersion.const === "wr-universal-parcel-v1", "Universal parcel schema version must be locked");
for (const field of requiredFields) {
  assert(schema.required.includes(field), `Universal parcel schema must require ${field}`);
  assert(schema.properties[field] || field === "schemaVersion", `Universal parcel schema must document ${field}`);
}

assert(schema.properties.accountNum.description.includes("primary parcel join key"), "accountNum must be documented as the primary join key");
assert(schema.properties.sourceCountyId.description.includes("County adapter id"), "sourceCountyId must point back to the county adapter");
assert(schema.properties.countyParcelId.description.includes("County-aware stable parcel id"), "countyParcelId must be documented as the county-aware id");
assert(schema.properties.whiteRabbitPropertyId.pattern.startsWith("^wrp:v1:"), "White Rabbit property ids must use the versioned canonical namespace");
assert(schema.properties.dataLineage.properties.freshnessStatus.enum.includes("unknown"), "Lineage must support an honest unknown freshness state");
assert(schema.properties.liveGeometry.required.includes("center"), "liveGeometry must require center");
assert(schema.properties.liveGeometry.required.includes("points"), "liveGeometry must require points");
assert(schema.$defs.geojsonFeature.required.includes("geometry"), "realGeometry must require GeoJSON geometry");
assert(schema.properties.joins.properties.appraisal.type === "boolean", "joins.appraisal must be a boolean");
assert(schema.properties.sourceReferences.description.includes("Original dataset"), "sourceReferences must preserve lineage");

assert(docs.includes("wr-universal-parcel-v1"), "Universal parcel docs must name the schema version");
assert(docs.includes("whiteRabbitPropertyId"), "Universal parcel docs must describe canonical identity");
assert(docs.includes("County Adapter Rule"), "Universal parcel docs must describe the adapter rule");
assert(docs.includes("No page redesign"), "Universal parcel docs must protect the visual baseline");

assert(dallasAdapter.universalParcelSchema.version === "wr-universal-parcel-v1", "Dallas adapter must declare the universal parcel schema version");
assert(dallasAdapter.propertyIdentity.version === "wr-property-id-v1", "Dallas adapter must declare the canonical property identity version");
assert(dallasAdapter.universalParcelSchema.schemaPath === "data/schemas/universal-parcel.schema.json", "Dallas adapter must point to the universal schema file");
assert(builderSource.includes("const UNIVERSAL_PARCEL_SCHEMA_VERSION = adapter.universalParcelSchema?.version"), "Parcel service builder must stamp the adapter universal schema version");
assert(builderSource.includes("resolveCountyAdapter"), "Parcel service builder must read the county adapter");
assert(builderSource.includes("const SOURCE_COUNTY_ID = adapter.id"), "Parcel service builder must stamp records with the adapter id");
assert(builderSource.includes("schemaVersion: UNIVERSAL_PARCEL_SCHEMA_VERSION"), "Parcel service records must include schemaVersion");
assert(builderSource.includes("sourceCountyId: SOURCE_COUNTY_ID"), "Parcel service records must include sourceCountyId");
assert(builderSource.includes("countyParcelId"), "Parcel service records must include countyParcelId");
assert(builderSource.includes("whiteRabbitPropertyId"), "Parcel service records must include canonical White Rabbit property identity");
assert(builderSource.includes("dataLineage"), "Parcel service records must include normalized lineage and freshness metadata");
assert(parcelManifest.featureCount === 696601, "Universal schema test should not disturb the current Dallas parcel service");

console.log("White Rabbit universal parcel schema tests passed.");
