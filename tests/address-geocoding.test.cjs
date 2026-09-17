const assert = require("assert");

(async () => {
  const geocoder = await import("../src/map/geocodeAddress.mjs");
  const payload = {
    result: {
      input: { benchmark: { benchmarkName: "Public_AR_Current" } },
      addressMatches: [{
        coordinates: { x: -77.03518753691, y: 38.89869893252 },
        matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
        addressComponents: { city: "WASHINGTON", state: "DC", zip: "20500" },
      }],
    },
  };
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(new URL(url));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await geocoder.geocodeAddress("  1600 Pennsylvania Ave NW, Washington, DC 20500  ", { fetchImpl });
  assert.deepEqual(result.coordinates, [-77.03518753691, 38.89869893252]);
  assert.equal(result.matchedAddress, "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500");
  assert.equal(result.source, "U.S. Census Bureau Geocoder");
  assert.equal(requests[0].pathname, "/api/geocode");
  assert.equal(requests[0].searchParams.get("benchmark"), "Public_AR_Current");
  assert.equal(requests[0].searchParams.get("address"), "1600 Pennsylvania Ave NW, Washington, DC 20500");
  assert.equal(await geocoder.geocodeAddress("x".repeat(101), { fetchImpl }), null);
  assert.deepEqual(geocoder.parseCensusAddressResponse({ result: { addressMatches: [{ coordinates: { x: "bad", y: 1 } }] } }), []);
  console.log("White Rabbit nationwide U.S. address geocoding tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
