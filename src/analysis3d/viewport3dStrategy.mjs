export const VIEWPORT_3D_REQUEST_VERSION = "wr-3d-viewport-request-v1";
export const VIEWPORT_3D_PLAN_VERSION = "wr-3d-viewport-plan-v1";

function bounds(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) throw new TypeError("bounds must be [west, south, east, north]");
  const [west, south, east, north] = value;
  if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) throw new TypeError("bounds are invalid");
  return [west, south, east, north];
}

export function createViewport3dRequest(input = {}) {
  const zoom = Number(input.zoom);
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 24) throw new TypeError("zoom must be between 0 and 24");
  return {
    schemaVersion: VIEWPORT_3D_REQUEST_VERSION,
    bounds: bounds(input.bounds),
    zoom,
    pitch: Math.max(0, Math.min(85, Number(input.pitch) || 0)),
    estimatedFeatureCount: Math.max(0, Math.trunc(Number(input.estimatedFeatureCount) || 0)),
    capabilities: { terrain: input.capabilities?.terrain !== false, buildings: input.capabilities?.buildings !== false, proposals: input.capabilities?.proposals !== false },
    requestedAt: String(input.requestedAt || new Date().toISOString()),
  };
}

export function planViewport3dLoading(input = {}) {
  const request = input.schemaVersion === VIEWPORT_3D_REQUEST_VERSION ? input : createViewport3dRequest(input);
  const overloaded = request.estimatedFeatureCount > 10000;
  let levelOfDetail = request.zoom < 12 ? "regional" : request.zoom < 15 ? "parcel" : request.zoom < 17 ? "building" : "detailed";
  if (overloaded && levelOfDetail === "detailed") levelOfDetail = "building";
  else if (overloaded && levelOfDetail === "building") levelOfDetail = "parcel";
  const detail = {
    regional: { maxFeatures: 1000, geometryToleranceMeters: 20, includeTerrain: false, includeBuildings: false, includeProposals: false },
    parcel: { maxFeatures: 5000, geometryToleranceMeters: 3, includeTerrain: false, includeBuildings: false, includeProposals: false },
    building: { maxFeatures: 8000, geometryToleranceMeters: 0.75, includeTerrain: true, includeBuildings: true, includeProposals: false },
    detailed: { maxFeatures: 2500, geometryToleranceMeters: 0.15, includeTerrain: true, includeBuildings: true, includeProposals: true },
  }[levelOfDetail];
  const layers = [
    { id: "parcels", enabled: levelOfDetail !== "regional", transport: "vector-tile", cacheKeyFields: ["sourceCountyId", "tileZxy", "sourceVersion"] },
    { id: "terrain", enabled: detail.includeTerrain && request.capabilities.terrain, transport: "quantized-mesh-or-raster-dem", cacheKeyFields: ["tileZxy", "sourceVersion"] },
    { id: "buildings", enabled: detail.includeBuildings && request.capabilities.buildings, transport: "3d-tiles-or-vector-extrusion", cacheKeyFields: ["tileZxy", "sourceVersion"] },
    { id: "proposals", enabled: detail.includeProposals && request.capabilities.proposals, transport: "viewport-api", cacheKeyFields: ["organizationId", "dealId", "revision"] },
  ];
  return {
    schemaVersion: VIEWPORT_3D_PLAN_VERSION,
    request,
    levelOfDetail,
    overloaded,
    limits: { maxFeatures: detail.maxFeatures, geometryToleranceMeters: detail.geometryToleranceMeters, abortPreviousViewportRequest: true },
    layers,
    requiredServerBehavior: ["clip-to-viewport", "spatial-index-query", "gzip-or-brotli", "etag-versioning", "request-cancellation"],
    clientRules: ["never-load-countywide-3d-geometry", "discard-stale-viewport-responses", "release-offscreen-geometry", "respect-device-memory-budget"],
  };
}
