const assert = require("assert");

function jsonResponse(url, payload, elapsed = 0) {
  return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
  })), elapsed)).then((response) => Object.defineProperty(response, "url", { value: url }));
}

(async () => {
  const pilot = await import("../src/operations/dallasPilotPreflight.mjs");
  const fields = ["accountNum", "address", "chunkId"];
  const manifest = {
    featureCount: 696601,
    chunkCount: 1614,
    chunks: Array.from({ length: 1614 }, (_, index) => index === 0 ? { id: "30-32", file: "chunks/30-32.json", count: 1 } : { id: `x-${index}`, file: `chunks/x-${index}.json`, count: 0 }),
    joinedAppraisalCount: 695033,
    searchIndexShards: { keyLength: 2, files: { sa: "search/sa.json", dr: "search/dr.json", ...Object.fromEntries(Array.from({ length: 1222 }, (_, index) => [`x${index}`, `search/x${index}.json`])) } },
  };
  const fixtures = {
    "/data/parcels/manifest.json": manifest,
    "/data/parcels/search/sa.json": { fields, parcels: [["008052000B01A0000", "10300 SANDEN DR", "30-32"]] },
    "/data/parcels/search/dr.json": { fields, parcels: [] },
    "/data/parcels/chunks/30-32.json": { parcels: [{ accountNum: "008052000B01A0000", address: "10300 SANDEN DR", points: [[1, 1], [2, 1], [2, 2], [1, 1]] }] },
  };
  const fetchImpl = (url) => jsonResponse(String(url), fixtures[new URL(url).pathname]);
  const report = await pilot.runDallasPilotPreflight({ baseUrl: "https://data.example.com/data/", fetchImpl, generatedAt: "2026-09-09T12:00:00Z" });
  assert.equal(report.schemaVersion, "wr-dallas-pilot-preflight-v1");
  assert.equal(report.status, "local-pilot-ready");
  assert.equal(report.localPilotReady, true);
  assert.equal(report.productionActivationAuthorized, false);
  assert(Object.values(report.checks).every(Boolean));

  const brokenFetch = (url) => {
    const parsed = new URL(url);
    const payload = parsed.pathname.endsWith("manifest.json") ? { ...manifest, featureCount: 4 } : fixtures[parsed.pathname];
    return jsonResponse(String(url), payload);
  };
  const blocked = await pilot.runDallasPilotPreflight({ baseUrl: "https://data.example.com/data/", fetchImpl: brokenFetch });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.checks.exactFeatureCount, false);
  await assert.rejects(() => pilot.runDallasPilotPreflight({ baseUrl: "http://data.example.com/data/", fetchImpl }), /must use HTTPS/);
  console.log("White Rabbit Dallas full-index search, viewport hydration, bounds, and latency pilot tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
