const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const root = path.resolve(__dirname, "..");
  execFileSync("node", ["scripts/build-national-parcel-search-manifest.cjs"], { cwd: root, stdio: "pipe" });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "data", "national", "parcel-search-manifest.json"), "utf8"));
  const geography = await import("../src/map/countyGeography.mjs");
  const national = await import("../src/map/nationalParcelSearch.mjs");
  assert.equal(manifest.connectedCountyCount, 9);
  assert.equal(manifest.connectedStateCount, 4);
  assert(manifest.exactConnectedParcelCount > 6800000);
  assert.equal(new Set(manifest.counties.map((county) => county.countyFips)).size, manifest.counties.length);
  assert.equal(national.routeForCountyFips(manifest, "21111").datasetId, "jefferson-ky");
  assert.equal(national.routeForCountyFips(manifest, "48453").datasetId, "travis-county-tx");
  assert.equal(national.routeForCountyFips(manifest, "48201").datasetId, "harris-county-tx");
  assert.equal(national.routeForCoordinates(manifest, [-95.3698, 29.7604]).datasetId, "harris-county-tx");
  assert.equal(national.routeForCoordinates(manifest, [-97.7431, 30.2672]).datasetId, "travis-county-tx");
  assert.equal(national.routeForCountyFips(manifest, "06037"), null);
  assert.equal(national.looksLikeUsStreetAddress("527 W Jefferson St, Louisville, KY 40202"), true);
  assert.equal(national.looksLikeUsStreetAddress("1100 Congress Avenue Austin Texas"), true);
  assert.equal(national.looksLikeUsStreetAddress("008052000B01A0000"), false);
  const parsed = geography.parseCountyGeographyResponse({ result: { geographies: { Counties: [{ STATE: "21", COUNTY: "111", NAME: "Jefferson County", GEOID: "21111" }] } } });
  assert.equal(parsed.countyFips, "21111");
  const searches = [];
  const result = await national.searchNationalParcelAddress("527 W Jefferson St, Louisville, KY 40202", {
    geocode: async () => ({ matchedAddress: "527 W JEFFERSON ST, LOUISVILLE, KY, 40202", coordinates: [-85.759, 38.254], addressComponents: { fromAddress: "527", preDirection: "W", streetName: "JEFFERSON", suffixType: "ST" } }),
    resolveGeography: async () => parsed,
    loadManifest: async () => manifest,
    searchDataset: async (query, limit, dataset) => { searches.push({ query, limit, dataset }); return query === "527 W JEFFERSON ST" ? [{ accountNum: "TEST-1", address: "527 W JEFFERSON ST", sourceCountyId: dataset.id }] : []; },
  });
  assert.equal(result.status, "parcel-found");
  assert.equal(result.route.countyFips, "21111");
  assert.equal(result.parcels[0].sourceCountyId, "jefferson-ky");
  assert.equal(searches.at(-1).dataset.dataRoots.parcels, "/data/counties/jefferson-ky/parcels/");
  assert.equal(national.parcelMatchesGeocodedStreet({ address: "527 W Jefferson Street STE 100" }, { addressComponents: { fromAddress: "527", preDirection: "W", streetName: "JEFFERSON", suffixType: "ST" } }), true);
  assert.equal(national.parcelMatchesGeocodedStreet({ address: "2505 WOOLDRIDGE DR" }, { addressComponents: { fromAddress: "1100", streetName: "CONGRESS", suffixType: "AVE" } }), false);
  const unsupported = await national.searchNationalParcelAddress("Los Angeles, CA", { geocode: async () => ({ coordinates: [-118.24, 34.05] }), resolveGeography: async () => ({ countyFips: "06037" }), loadManifest: async () => manifest, searchDataset: async () => { throw new Error("must not search an unsupported county"); } });
  assert.equal(unsupported.status, "county-not-connected");
  console.log("White Rabbit national address-to-county parcel routing tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
