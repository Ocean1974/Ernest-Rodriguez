export const DALLAS_PILOT_PREFLIGHT_VERSION = "wr-dallas-pilot-preflight-v1";

export const DALLAS_PILOT_EXPECTATIONS = Object.freeze({
  featureCount: 696601,
  chunkCount: 1614,
  searchShardCount: 1224,
  joinedAppraisalCount: 695033,
  query: "10300 SANDEN DR",
  expectedAccount: "008052000B01A0000",
});

function unpackSearchRecords(payload) {
  if (!Array.isArray(payload?.parcels)) return [];
  if (!Array.isArray(payload.fields)) return payload.parcels;
  return payload.parcels.map((packed) => {
    if (!Array.isArray(packed)) return packed;
    const record = {};
    payload.fields.forEach((field, index) => {
      if (packed[index] !== "" && packed[index] !== null && packed[index] !== undefined) record[field] = packed[index];
    });
    return record;
  });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function queryShardKeys(query, keyLength) {
  const keys = new Set();
  for (const token of String(query || "").split(/[^a-z0-9]+/i)) {
    const key = normalize(token).slice(0, keyLength);
    if (key && /[a-z]/.test(key)) keys.add(key);
  }
  return [...keys];
}

async function fetchJson(url, { fetchImpl, timeoutMs, maxBytes }) {
  const startedAt = performance.now();
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.arrayBuffer();
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { payload = null; }
  return {
    url: url.href,
    finalUrl: response.url || url.href,
    status: response.status,
    contentType: String(response.headers.get("content-type") || "").toLowerCase(),
    cacheControl: String(response.headers.get("cache-control") || "").toLowerCase(),
    bodyBytes: body.byteLength,
    elapsedMs,
    withinByteBudget: body.byteLength > 0 && body.byteLength <= maxBytes,
    payload,
  };
}

function validResponse(result, origin, maxResponseMs) {
  return result.status === 200 &&
    result.contentType.includes("application/json") &&
    result.withinByteBudget &&
    result.elapsedMs <= maxResponseMs &&
    new URL(result.finalUrl).origin === origin &&
    result.payload && typeof result.payload === "object";
}

export async function runDallasPilotPreflight({
  baseUrl,
  fetchImpl = globalThis.fetch,
  allowHttpLocalhost = false,
  timeoutMs = 10_000,
  maxResponseMs = 2_000,
  maxManifestBytes = 2_000_000,
  maxSearchShardBytes = 8_000_000,
  maxChunkBytes = 5_000_000,
  generatedAt = new Date(),
  expectations = DALLAS_PILOT_EXPECTATIONS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const base = new URL(baseUrl);
  const localhost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash) throw new TypeError("Dallas pilot base URL must not include credentials, a query, or a fragment.");
  if (base.protocol !== "https:" && !(allowHttpLocalhost && localhost && base.protocol === "http:")) {
    throw new TypeError("Dallas pilot base URL must use HTTPS; HTTP is allowed only for an explicit localhost preflight.");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;

  const manifestResult = await fetchJson(new URL("parcels/manifest.json", base), { fetchImpl, timeoutMs, maxBytes: maxManifestBytes });
  const manifest = manifestResult.payload || {};
  const searchShardFiles = manifest.searchIndexShards?.files || {};
  const searchShardCount = Object.keys(searchShardFiles).length;
  const keyLength = Number(manifest.searchIndexShards?.keyLength || 2);
  const selectedShardKeys = queryShardKeys(expectations.query, keyLength).filter((key) => searchShardFiles[key]);
  const selectedShardFiles = [...new Set(selectedShardKeys.flatMap((key) => Array.isArray(searchShardFiles[key]) ? searchShardFiles[key] : [searchShardFiles[key]]))];
  const searchResults = await Promise.all(selectedShardFiles.map((file) => fetchJson(new URL(`parcels/${file}`, base), { fetchImpl, timeoutMs, maxBytes: maxSearchShardBytes })));
  const searchRecords = searchResults.flatMap((result) => unpackSearchRecords(result.payload));
  const expectedHit = searchRecords.find((record) => String(record?.accountNum || record?.accountNumber || "") === expectations.expectedAccount && normalize(record?.address) === normalize(expectations.query));
  const chunkEntry = manifest.chunks?.find((chunk) => chunk.id === expectedHit?.chunkId);
  const chunkResult = chunkEntry
    ? await fetchJson(new URL(`parcels/${chunkEntry.file}`, base), { fetchImpl, timeoutMs, maxBytes: maxChunkBytes })
    : null;
  const chunkRecords = Array.isArray(chunkResult?.payload?.parcels) ? chunkResult.payload.parcels : [];
  const hydratedHit = chunkRecords.find((record) => String(record?.accountNum || record?.accountNumber || "") === expectations.expectedAccount);

  const checks = {
    manifestResponse: validResponse(manifestResult, base.origin, maxResponseMs),
    exactFeatureCount: Number(manifest.featureCount) === expectations.featureCount,
    exactChunkCount: Number(manifest.chunkCount) === expectations.chunkCount && manifest.chunks?.length === expectations.chunkCount,
    exactSearchShardCount: searchShardCount === expectations.searchShardCount,
    exactAppraisalJoinCount: Number(manifest.joinedAppraisalCount) === expectations.joinedAppraisalCount,
    searchShardsPlanned: selectedShardFiles.length > 0,
    searchShardResponses: searchResults.length > 0 && searchResults.every((result) => validResponse(result, base.origin, maxResponseMs)),
    knownAddressFoundInFullIndex: Boolean(expectedHit),
    matchingViewportChunkDeclared: Boolean(chunkEntry),
    viewportChunkResponse: Boolean(chunkResult && validResponse(chunkResult, base.origin, maxResponseMs)),
    viewportChunkBounded: Boolean(chunkEntry && chunkRecords.length === Number(chunkEntry.count) && chunkRecords.length <= 2500),
    knownParcelHydratedFromViewportChunk: Boolean(hydratedHit),
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    schemaVersion: DALLAS_PILOT_PREFLIGHT_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    status: passed ? "local-pilot-ready" : "blocked",
    localPilotReady: passed,
    productionActivationAuthorized: false,
    baseUrl: base.href,
    query: expectations.query,
    expectedAccount: expectations.expectedAccount,
    checks,
    counts: {
      featureCount: Number(manifest.featureCount || 0),
      chunkCount: Number(manifest.chunkCount || 0),
      searchShardCount,
      joinedAppraisalCount: Number(manifest.joinedAppraisalCount || 0),
      selectedSearchShardCount: selectedShardFiles.length,
      matchingChunkRecordCount: chunkRecords.length,
    },
    responses: {
      manifest: manifestResult,
      searchShards: searchResults,
      viewportChunk: chunkResult,
    },
    releaseBoundary: passed
      ? "Dallas is certified for a local pilot through the viewport JSON service. Production still requires an HTTPS deployment preflight and signed activation decision; PMTiles remains optional until separately verified."
      : "Dallas pilot certification is blocked until every manifest, indexed-search, viewport hydration, size, and latency check passes.",
    lockedUiContract: { earthImageryPreserved: true, dcadParcelLayerPreserved: true, landingPageChanged: false },
  };
}
