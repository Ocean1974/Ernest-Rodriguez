const assert = require("assert");

(async () => {
  const national = await import("../src/map/nationalParcelSearch.mjs");
  const manifest = {
    schemaVersion: "wr-national-parcel-search-manifest-v1",
    counties: [
      { countyFips: "48113", datasetId: "dallas-county-dcad", countyName: "Dallas County", searchReady: true, accessMode: "production", dataRoot: "/data/counties/dallas-county-dcad/parcels/", map: {} },
      { countyFips: "48085", datasetId: "collin-county-tx", countyName: "Collin County", searchReady: true, accessMode: "verified-map-search-pilot", dataRoot: "/data/counties/collin-county-tx/parcels/", map: {} },
      { countyFips: "48201", datasetId: "harris-county-tx", countyName: "Harris County", searchReady: true, accessMode: "blocked", dataRoot: "/data/counties/harris-county-tx/parcels/", map: {} },
    ],
  };
  const searched = [];
  const result = await national.searchNationalParcelAddress("2608 pelican bay dr", {
    geocode: async () => null,
    loadManifest: async () => manifest,
    searchDataset: async (query, limit, dataset) => {
      searched.push(`${dataset.id}:${query}`);
      return dataset.id === "collin-county-tx" && query === "2608 pelican bay dr" ? [{ sourceCountyId: dataset.id, accountNum: "TEST", address: "2608 PELICAN BAY DR , PLANO, TX 75093" }] : [];
    },
  });
  assert.equal(result.status, "parcel-found");
  assert.equal(result.route.datasetId, "collin-county-tx");
  assert.equal(result.matchStrategy, "connected-county-address-index");
  assert(searched.some((value) => value.startsWith("dallas-county-dcad:")) && searched.includes("collin-county-tx:2608 pelican bay dr"));
  assert(!searched.some((value) => value.startsWith("harris-county-tx:")), "Blocked counties must not be searched by fallback routing");
  assert.equal(national.parcelMatchesAddressQuery({ address: "2608 PELICAN BAY DRIVE, PLANO, TX 75093" }, "2608 pelican bay dr"), true);
  console.log("National address typeahead fallback tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
