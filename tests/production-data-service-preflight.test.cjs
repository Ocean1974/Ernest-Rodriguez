const assert = require("assert");
const http = require("http");

(async () => {
  const preflight = await import("../src/operations/productionDataPreflight.mjs");
  const fixtures = {
    "/data/parcels/manifest.json": { featureCount: 696601, chunkCount: 1, chunks: [{}], searchIndexCount: 696601, searchIndex: "search-index.json" },
    "/data/permits/manifest.json": { permitCount: 150571, chunkCount: 1, chunks: [{}], unmatchedPermitCount: 53271 },
    "/data/developments/manifest.json": { schemaVersion: "wr-development-parcel-service-v1", parcelCount: 24950, maxRecordsPerFile: 1500, maxShardBytes: 449564, recordShards: { "00": {} }, searchShards: { "50": {} } },
    "/data/zoning/manifest.json": { sourceCountyId: "dallas-county-dcad", parcelIndexCount: 665971, parcelIndex: "parcel-zoning-index.json", renderDirectlyInBrowser: false },
    "/data/floodplain/manifest.json": { sourceCountyId: "dallas-county-dcad", parcelIndexCount: 57491, parcelIndex: "parcel-floodplain-index.json", renderDirectlyInBrowser: false },
  };
  let unsafeCache = false;
  const server = http.createServer((request, response) => {
    const payload = fixtures[request.url];
    if (!payload) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": "application/json", "cache-control": unsafeCache && request.url.includes("developments") ? "public, max-age=31536000, immutable" : "no-cache" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/data/`;
    const passed = await preflight.runProductionDataServicePreflight({ baseUrl, allowHttpLocalhost: true, generatedAt: "2026-08-24T12:00:00.000Z" });
    assert.equal(passed.schemaVersion, "wr-production-data-service-preflight-v1");
    assert.equal(passed.status, "passed");
    assert.equal(passed.dataServiceReady, true);
    assert.equal(passed.activationAuthorized, false);
    assert.equal(passed.passedEndpointCount, 5);
    assert(passed.results.every((result) => result.sameOrigin));
    unsafeCache = true;
    const failed = await preflight.runProductionDataServicePreflight({ baseUrl, allowHttpLocalhost: true });
    assert.equal(failed.status, "failed");
    assert.equal(failed.dataServiceReady, false);
    assert.equal(failed.results.find((result) => result.id === "developments").checks.manifestRevalidated, false);
    await assert.rejects(() => preflight.runProductionDataServicePreflight({ baseUrl }), /must use HTTPS/);
    const oversized = preflight.verifyProductionDataResponse({ id: "parcels", status: 200, headers: { "content-type": "application/json", "cache-control": "no-cache" }, bodyBytes: 2_000_001, payload: fixtures["/data/parcels/manifest.json"] });
    assert.equal(oversized.status, "failed");
    assert.equal(oversized.checks.responseBounded, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("White Rabbit production data-service HTTPS, bounds, cache, schema, and fail-closed preflight tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
