const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  WHITE_RABBIT_LINEAGE_VERSION,
  WHITE_RABBIT_PROPERTY_ID_VERSION,
  createDataLineage,
  createWhiteRabbitPropertyId,
  parseWhiteRabbitPropertyId,
} = require("../scripts/property-identity.cjs");

const id = createWhiteRabbitPropertyId({
  sourceCountyId: " Dallas-County-DCAD ",
  sourceParcelId: " 008052000b01a0000 ",
});
assert.equal(id, "wrp:v1:dallas-county-dcad:008052000B01A0000");
assert.equal(WHITE_RABBIT_PROPERTY_ID_VERSION, "wr-property-id-v1");
assert.equal(createWhiteRabbitPropertyId({ sourceCountyId: "county", sourceParcelId: "A/B 10" }), "wrp:v1:county:A%2FB%2010");
assert.equal(createWhiteRabbitPropertyId({ sourceCountyId: "", sourceParcelId: "10" }), "");
assert.deepEqual(parseWhiteRabbitPropertyId("wrp:v1:dallas-county-dcad:008052000B01A0000"), {
  version: "wr-property-id-v1",
  sourceCountyId: "dallas-county-dcad",
  sourceParcelId: "008052000B01A0000",
});
assert.equal(parseWhiteRabbitPropertyId("not-a-property-id"), null);

const unknown = createDataLineage({ sourceCountyId: "Dallas-County-DCAD", generatedAt: "2026-08-13T00:00:00.000Z" });
assert.equal(unknown.contractVersion, WHITE_RABBIT_LINEAGE_VERSION);
assert.equal(unknown.freshnessStatus, "unknown");
assert.equal(unknown.freshnessAgeDays, null);

const current = createDataLineage({
  sourceCountyId: "dallas-county-dcad",
  sourceUpdatedAt: "2026-08-01T00:00:00.000Z",
  generatedAt: "2026-08-13T00:00:00.000Z",
  maxAgeDays: 30,
});
assert.equal(current.freshnessStatus, "current");
assert.equal(current.freshnessAgeDays, 12);

const stale = createDataLineage({
  sourceCountyId: "dallas-county-dcad",
  sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-08-13T00:00:00.000Z",
  maxAgeDays: 30,
});
assert.equal(stale.freshnessStatus, "stale");

const loaderSource = fs.readFileSync(path.join(__dirname, "..", "src", "map", "loadParcels.ts"), "utf8");
assert(loaderSource.includes("createWhiteRabbitPropertyId"), "Runtime parcel loader must hydrate canonical ids for legacy chunks");
assert(loaderSource.includes("createParcelDataLineage"), "Runtime parcel loader must hydrate lineage for legacy chunks");
assert(loaderSource.includes("parcel.whiteRabbitPropertyId"), "Canonical ids must participate in parcel search");

console.log("White Rabbit property identity and lineage tests passed.");
