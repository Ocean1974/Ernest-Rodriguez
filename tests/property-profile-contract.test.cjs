const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { buildPropertyProfile, PROPERTY_PROFILE_SCHEMA_VERSION } = await import("../src/map/propertyProfileContract.mjs");
  const parcel = {
    sourceCountyId: "dallas-county-dcad",
    accountNum: "008052000B01A0000",
    countyParcelId: "dallas-county-dcad:008052000B01A0000",
    dataLineage: { contractVersion: "wr-lineage-v1" },
  };
  const profile = buildPropertyProfile({
    parcel,
    intelligence: { status: { zoning: "matched", floodplain: "matched" } },
    permits: [{ permitNumber: "P-1" }],
  });
  assert.equal(PROPERTY_PROFILE_SCHEMA_VERSION, "wr-property-profile-v1");
  assert.equal(profile.status, "complete");
  assert.equal(profile.whiteRabbitPropertyId, "wrp:v1:dallas-county-dcad:008052000B01A0000");
  assert.equal(profile.evidence.permitCount, 1);
  assert.equal(profile.lineage.contractVersion, "wr-lineage-v1");
  assert.equal(buildPropertyProfile().status, "not-found");

  const loader = fs.readFileSync(path.join(__dirname, "..", "src", "map", "loadPropertyProfile.ts"), "utf8");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "property-profile.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-property-profile-v1");
  assert(schema.required.includes("evidence"));
  assert(loader.includes("parseWhiteRabbitPropertyId"), "Property profile loader must resolve canonical ids");
  assert(loader.includes("Promise.allSettled"), "Optional profile layers must fail independently");
  assert(loader.includes("loadPermitsForParcel"), "Property profile must include parcel-linked permits");
  assert(loader.includes("loadParcelIntelligenceSummary"), "Property profile must include zoning and floodplain intelligence");
  console.log("White Rabbit property profile contract tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
