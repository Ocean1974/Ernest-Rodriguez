export const PMTILES_ARTIFACT_VERSION = "wr-pmtiles-artifact-v1";
export const GEOSPATIAL_DELIVERY_AUDIT_VERSION = "wr-geospatial-delivery-audit-v1";
export const GEOSPATIAL_RUNTIME_DECISION_VERSION = "wr-geospatial-runtime-decision-v1";

function uint64(view, offset) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 2 ** 32 + low;
}

function headerValue(headers, name) {
  if (headers?.get) return headers.get(name) || headers.get(name.toLowerCase()) || "";
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(entry?.[1] || "");
}

export function parsePmtilesHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.byteLength < 127) throw new TypeError("PMTiles header requires at least 127 bytes");
  const magic = new TextDecoder().decode(bytes.slice(0, 7));
  if (magic !== "PMTiles") throw new TypeError("PMTiles magic number is invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    specVersion: view.getUint8(7),
    rootDirectoryOffset: uint64(view, 8), rootDirectoryLength: uint64(view, 16),
    jsonMetadataOffset: uint64(view, 24), jsonMetadataLength: uint64(view, 32),
    leafDirectoryOffset: uint64(view, 40), leafDirectoryLength: uint64(view, 48),
    tileDataOffset: uint64(view, 56), tileDataLength: uint64(view, 64),
    numAddressedTiles: uint64(view, 72), numTileEntries: uint64(view, 80), numTileContents: uint64(view, 88),
    clustered: view.getUint8(96) === 1,
    internalCompression: view.getUint8(97), tileCompression: view.getUint8(98), tileType: view.getUint8(99),
    minZoom: view.getUint8(100), maxZoom: view.getUint8(101),
    minLon: view.getInt32(102, true) / 1e7, minLat: view.getInt32(106, true) / 1e7,
    maxLon: view.getInt32(110, true) / 1e7, maxLat: view.getInt32(114, true) / 1e7,
    centerZoom: view.getUint8(118), centerLon: view.getInt32(119, true) / 1e7, centerLat: view.getInt32(123, true) / 1e7,
  };
}

export function verifyPmtilesHeader(input, expectations = {}) {
  try {
    const header = parsePmtilesHeader(input);
    const checks = {
      specVersion3: header.specVersion === 3,
      vectorTileType: header.tileType === 1,
      zoomRangeValid: header.minZoom <= header.maxZoom && header.maxZoom <= 24,
      rootDirectoryWithinFirst16KiB: header.rootDirectoryOffset >= 127 && header.rootDirectoryOffset + header.rootDirectoryLength <= 16384,
      tileDataPresent: header.tileDataLength > 0 && header.numTileContents > 0 && header.numTileEntries > 0,
      boundsValid: header.minLon < header.maxLon && header.minLat < header.maxLat && header.minLon >= -180 && header.maxLon <= 180 && header.minLat >= -90 && header.maxLat <= 90,
      expectedMinZoom: expectations.minZoom === undefined || header.minZoom === expectations.minZoom,
      expectedMaxZoom: expectations.maxZoom === undefined || header.maxZoom === expectations.maxZoom,
    };
    return { status: Object.values(checks).every(Boolean) ? "passed" : "failed", header, checks, errors: [] };
  } catch (error) {
    return { status: "failed", header: null, checks: {}, errors: [String(error.message || error)] };
  }
}

export function verifyPmtilesArtifactManifest(manifest = {}, actual = {}, expectations = {}) {
  const expectedCountyId = String(expectations.sourceCountyId || "dallas-county-dcad");
  const expectedFeatureCount = Number(expectations.expectedFeatureCount ?? 696601);
  const checks = {
    schemaVersion: manifest.schemaVersion === PMTILES_ARTIFACT_VERSION,
    sourceCountyId: manifest.sourceCountyId === expectedCountyId,
    featureCount: Number(manifest.expectedFeatureCount) === expectedFeatureCount,
    artifactBytes: Number(manifest.artifactBytes) > 0 && (actual.artifactBytes === undefined || Number(manifest.artifactBytes) === Number(actual.artifactBytes)),
    sha256: /^[a-f0-9]{64}$/.test(String(manifest.sha256 || "")) && (!actual.sha256 || String(manifest.sha256).toLowerCase() === String(actual.sha256).toLowerCase()),
    immutableDeployment: manifest.immutableDeploymentRequired === true,
    zooms: Number(manifest.minZoom) <= Number(manifest.maxZoom),
  };
  return { status: Object.values(checks).every(Boolean) ? "passed" : "failed", checks };
}

export function verifyPmtilesHttpDelivery({ status, headers = {}, requestedRange = { start: 0, end: 16383 }, bodyBytes = 0 } = {}) {
  const contentRange = headerValue(headers, "content-range");
  const acceptRanges = headerValue(headers, "accept-ranges").toLowerCase();
  const etag = headerValue(headers, "etag");
  const cacheControl = headerValue(headers, "cache-control").toLowerCase();
  const contentType = headerValue(headers, "content-type").toLowerCase();
  const exposeHeaders = headerValue(headers, "access-control-expose-headers").toLowerCase();
  const maxAgeMatch = /(?:^|[,\s])max-age=(\d+)/.exec(cacheControl);
  const expectedLength = Number(requestedRange.end) - Number(requestedRange.start) + 1;
  const checks = {
    partialContent: Number(status) === 206,
    byteRanges: acceptRanges.includes("bytes"),
    contentRange: new RegExp(`^bytes\\s+${requestedRange.start}-${requestedRange.end}/\\d+$`, "i").test(contentRange),
    responseLength: Number(bodyBytes) === expectedLength,
    strongEtag: Boolean(etag) && !etag.startsWith("W/"),
    immutableCache: cacheControl.includes("immutable") && Number(maxAgeMatch?.[1] || 0) >= 31536000,
    pmtilesContentType: contentType.includes("application/vnd.pmtiles") || contentType.includes("application/octet-stream"),
    corsExposesValidationHeaders: ["etag", "content-range", "accept-ranges"].every((name) => exposeHeaders.includes(name)),
  };
  return { status: Object.values(checks).every(Boolean) ? "passed" : "failed", checks, observed: { status: Number(status), contentRange, acceptRanges, etag, cacheControl, contentType, exposeHeaders, bodyBytes: Number(bodyBytes) } };
}

export function selectGeospatialRuntime({ pmtilesFeatureEnabled = false, artifactVerification = null, httpVerification = null, currentRuntime = "viewport-geojson-service", pmtilesUrl = "" } = {}) {
  const reasons = [];
  if (!pmtilesFeatureEnabled) reasons.push("pmtiles-feature-disabled");
  if (artifactVerification?.status !== "passed") reasons.push("artifact-verification-not-passed");
  if (httpVerification?.status !== "passed") reasons.push("http-delivery-verification-not-passed");
  if (!String(pmtilesUrl || "").startsWith("https://")) reasons.push("immutable-https-pmtiles-url-required");
  const usePmtiles = reasons.length === 0;
  return { schemaVersion: GEOSPATIAL_RUNTIME_DECISION_VERSION, selectedRuntime: usePmtiles ? "pmtiles" : currentRuntime, pmtilesUrl: usePmtiles ? pmtilesUrl : "", fallbackPreserved: !usePmtiles, reasons, visualContract: { earthImageryPreserved: true, dcadParcelLayerPreserved: true, landingPageChanged: false } };
}
