export const PRODUCTION_DATA_PREFLIGHT_VERSION = "wr-production-data-service-preflight-v1";
export const DEFAULT_PRODUCTION_DATA_ENDPOINTS = Object.freeze([
  Object.freeze({ id: "parcels", path: "parcels/manifest.json" }),
  Object.freeze({ id: "permits", path: "permits/manifest.json" }),
  Object.freeze({ id: "developments", path: "developments/manifest.json" }),
  Object.freeze({ id: "zoning", path: "zoning/manifest.json" }),
  Object.freeze({ id: "floodplain", path: "floodplain/manifest.json" }),
]);

function headerValue(headers, name) {
  if (headers?.get) return String(headers.get(name) || "");
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(entry?.[1] || "");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function datasetChecks(id, payload) {
  if (id === "parcels") return {
    exactFeatureCountPresent: Number(payload.featureCount) > 0,
    viewportChunksPresent: Number(payload.chunkCount) > 0 && Array.isArray(payload.chunks) && payload.chunks.length === Number(payload.chunkCount),
    indexedSearchPresent: Number(payload.searchIndexCount) > 0 && Boolean(payload.searchIndex),
  };
  if (id === "permits") return {
    exactPermitCountPresent: Number(payload.permitCount) > 0,
    boundedChunksPresent: Number(payload.chunkCount) > 0 && Array.isArray(payload.chunks) && payload.chunks.length === Number(payload.chunkCount),
    unmatchedPermitsRecorded: Number(payload.unmatchedPermitCount) >= 0,
  };
  if (id === "developments") return {
    boundedServiceSchema: payload.schemaVersion === "wr-development-parcel-service-v1",
    exactParcelCountPresent: Number(payload.parcelCount) > 0,
    recordShardsPresent: isObject(payload.recordShards) && Object.keys(payload.recordShards).length > 0,
    searchShardsPresent: isObject(payload.searchShards) && Object.keys(payload.searchShards).length > 0,
    shardRecordLimit: Number(payload.maxRecordsPerFile) > 0 && Number(payload.maxRecordsPerFile) <= 1500,
    shardByteLimit: Number(payload.maxShardBytes) > 0 && Number(payload.maxShardBytes) < 1_000_000,
  };
  if (id === "zoning" || id === "floodplain") return {
    countyIdentityPresent: Boolean(payload.sourceCountyId),
    parcelIndexPresent: Number(payload.parcelIndexCount) > 0 && Boolean(payload.parcelIndex),
    directBrowserRenderDisabled: payload.renderDirectlyInBrowser === false,
  };
  return { recognizedDataset: false };
}

export function verifyProductionDataResponse({ id, status, headers = {}, bodyBytes = 0, payload = null, maxManifestBytes = 2_000_000 } = {}) {
  const contentType = headerValue(headers, "content-type").toLowerCase();
  const cacheControl = headerValue(headers, "cache-control").toLowerCase();
  const maxAge = Number(/(?:^|[\s,])max-age=(\d+)/.exec(cacheControl)?.[1] || 0);
  const revalidated = cacheControl.includes("no-cache") || cacheControl.includes("must-revalidate") || (cacheControl.includes("max-age=") && maxAge <= 300);
  const checks = {
    okStatus: Number(status) === 200,
    jsonContentType: contentType.includes("application/json"),
    responsePresent: Number(bodyBytes) > 0,
    responseBounded: Number(bodyBytes) <= Number(maxManifestBytes),
    manifestRevalidated: revalidated && !cacheControl.includes("immutable"),
    jsonObject: isObject(payload),
    ...datasetChecks(id, payload || {}),
  };
  return {
    id: String(id || ""),
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    checks,
    observed: { status: Number(status), contentType, cacheControl, bodyBytes: Number(bodyBytes), maxManifestBytes: Number(maxManifestBytes) },
  };
}

function validatedBaseUrl(baseUrl, allowHttpLocalhost) {
  const parsed = new URL(baseUrl);
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.username || parsed.password) throw new TypeError("Production data base URL must not contain credentials.");
  if (parsed.search || parsed.hash) throw new TypeError("Production data base URL must not contain a query or fragment.");
  if (parsed.protocol !== "https:" && !(allowHttpLocalhost && local && parsed.protocol === "http:")) {
    throw new TypeError("Production data base URL must use HTTPS; HTTP is allowed only for an explicit localhost preflight.");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
  return parsed;
}

export async function runProductionDataServicePreflight({
  baseUrl,
  fetchImpl = globalThis.fetch,
  endpoints = DEFAULT_PRODUCTION_DATA_ENDPOINTS,
  allowHttpLocalhost = false,
  maxManifestBytes = 2_000_000,
  timeoutMs = 10_000,
  generatedAt = new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const base = validatedBaseUrl(baseUrl, allowHttpLocalhost);
  const results = await Promise.all(endpoints.map(async (endpoint) => {
    const url = new URL(endpoint.path.replace(/^\/+/, ""), base);
    try {
      const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.arrayBuffer();
      let payload = null;
      try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { payload = null; }
      const verification = verifyProductionDataResponse({ id: endpoint.id, status: response.status, headers: response.headers, bodyBytes: body.byteLength, payload, maxManifestBytes });
      return { ...verification, url: url.href, finalUrl: response.url || url.href, sameOrigin: new URL(response.url || url.href).origin === base.origin };
    } catch (error) {
      return { id: endpoint.id, url: url.href, status: "failed", checks: { responseReceived: false }, observed: {}, error: String(error?.message || error) };
    }
  }));
  const allPassed = results.every((result) => result.status === "passed" && result.sameOrigin !== false);
  return {
    schemaVersion: PRODUCTION_DATA_PREFLIGHT_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    baseUrl: base.href,
    status: allPassed ? "passed" : "failed",
    dataServiceReady: allPassed,
    activationAuthorized: false,
    endpointCount: results.length,
    passedEndpointCount: results.filter((result) => result.status === "passed" && result.sameOrigin !== false).length,
    results,
    releaseBoundary: "This preflight verifies the data service only. A signed capability release decision and all platform gates are still required for production activation.",
    lockedUiContract: { earthImageryPreserved: true, dcadParcelLayerPreserved: true, landingPageChanged: false },
  };
}
