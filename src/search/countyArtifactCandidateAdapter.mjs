export const COUNTY_ARTIFACT_CANDIDATE_ADAPTER_VERSION = "wr-county-artifact-candidate-adapter-v1";
export const COUNTY_ARTIFACT_CURSOR_VERSION = "wrac:v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function error(code, message) {
  const value = new Error(message);
  value.code = code;
  return value;
}

function normalizeToken(value) { return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }

function safeArtifactPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..") || !normalized.endsWith(".json")) throw error("WR_ARTIFACT_PATH_INVALID", "Manifest artifact path is invalid or escapes its parcel-service directory");
  return normalized;
}

function shardKeys(plan, keyLength) {
  const values = [...(plan?.keywords || [])];
  const raw = String(plan?.rawQuery || "").trim();
  if (!values.length && /^[a-z0-9][a-z0-9 .#_-]{2,}$/i.test(raw) && !(plan?.filters || []).length) values.push(raw);
  const keys = new Set();
  for (const value of values) {
    const whole = normalizeToken(value);
    if (whole.length >= keyLength) keys.add(whole.slice(0, keyLength));
    for (const part of String(value).split(/[^a-z0-9]+/i)) {
      const token = normalizeToken(part);
      if (token.length >= keyLength) keys.add(token.slice(0, keyLength));
    }
  }
  return [...keys].sort();
}

function encodeCursor(value) { return `${COUNTY_ARTIFACT_CURSOR_VERSION}:${encodeURIComponent(JSON.stringify(value))}`; }

function decodeCursor(value, mode, sourceVersion) {
  if (!value) return { mode, fileIndex: 0, rowOffset: 0, sourceVersion };
  const prefix = `${COUNTY_ARTIFACT_CURSOR_VERSION}:`;
  if (!String(value).startsWith(prefix)) throw error("WR_ARTIFACT_CURSOR_INVALID", "County artifact cursor version is invalid");
  let parsed;
  try { parsed = JSON.parse(decodeURIComponent(String(value).slice(prefix.length))); } catch { throw error("WR_ARTIFACT_CURSOR_INVALID", "County artifact cursor payload is invalid"); }
  if (parsed.mode !== mode || parsed.sourceVersion !== sourceVersion) throw error("WR_ARTIFACT_CURSOR_STALE", "County artifact cursor no longer matches its source or retrieval mode");
  return { mode, fileIndex: Math.max(0, Math.trunc(Number(parsed.fileIndex || 0))), rowOffset: Math.max(0, Math.trunc(Number(parsed.rowOffset || 0))), sourceVersion };
}

function normalizeBounds(input, countyBounds) {
  if (!input) return null;
  const west = Number(input.west ?? input.minLng ?? input.minX);
  const east = Number(input.east ?? input.maxLng ?? input.maxX);
  const south = Number(input.south ?? input.minLat ?? input.minY);
  const north = Number(input.north ?? input.maxLat ?? input.maxY);
  if (![west, east, south, north].every(Number.isFinite) || west >= east || south >= north) throw error("WR_QUERY_BOUNDS_INVALID", "Candidate query bounds are invalid");
  const looksGeographic = Math.abs(west) <= 180 && Math.abs(east) <= 180 && Math.abs(south) <= 90 && Math.abs(north) <= 90;
  if (!looksGeographic) return { minX: west, maxX: east, minY: south, maxY: north };
  const width = Number(countyBounds.maxLng) - Number(countyBounds.minLng);
  const height = Number(countyBounds.maxLat) - Number(countyBounds.minLat);
  if (!(width > 0 && height > 0)) throw error("WR_MANIFEST_BOUNDS_INVALID", "County manifest bounds are invalid");
  return {
    minX: (west - Number(countyBounds.minLng)) / width * 100,
    maxX: (east - Number(countyBounds.minLng)) / width * 100,
    minY: (Number(countyBounds.maxLat) - north) / height * 100,
    maxY: (Number(countyBounds.maxLat) - south) / height * 100,
  };
}

function intersects(a, b) { return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY; }

function unpackSearchRows(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  return (payload?.parcels || []).map((row) => {
    if (!Array.isArray(row)) return row;
    return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
  });
}

function canonicalParcel(parcel, countyId) {
  const account = required(parcel.accountNum || parcel.accountNumber || parcel.sourceParcelId || parcel.displayParcelId, "parcel account identity");
  return { ...parcel, sourceCountyId: countyId, whiteRabbitPropertyId: `wrp:v1:${countyId}:${account}` };
}

function sourceFilesForSearch(manifest, plan, maxShardMemberships) {
  const shards = manifest.searchIndexShards;
  if (!shards?.files) return [];
  const files = [];
  const seen = new Set();
  let memberships = 0;
  for (const key of shardKeys(plan, Math.max(1, Number(shards.keyLength || 2)))) {
    const count = Math.max(0, Number(shards.counts?.[key] || 0));
    if (count > maxShardMemberships || (memberships && memberships + count > maxShardMemberships)) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    for (const fileValue of Array.isArray(shards.files[key]) ? shards.files[key] : [shards.files[key]]) {
      const file = safeArtifactPath(fileValue);
      if (!seen.has(file)) { seen.add(file); files.push(file); }
    }
    memberships += count;
  }
  return files;
}

export function createCountyArtifactCandidateAdapter({
  manifestPath,
  readJson,
  expectedCountyId,
  expectedFeatureCount = null,
  sourceVersion,
  sourceUpdatedAt,
  freshnessStatus = "unknown",
  maxShardMemberships = 200000,
  maxBoundedChunks = 64,
} = {}) {
  const path = required(manifestPath, "manifestPath");
  const countyId = required(expectedCountyId, "expectedCountyId");
  const version = required(sourceVersion, "sourceVersion");
  const updatedAt = required(sourceUpdatedAt, "sourceUpdatedAt");
  if (typeof readJson !== "function") throw new TypeError("readJson is required");
  if (!["current", "stale", "unknown"].includes(freshnessStatus)) throw new TypeError("freshnessStatus is invalid");
  let manifestPromise;
  const artifactPromises = new Map();
  const loadArtifact = (relativePath) => {
    if (!artifactPromises.has(relativePath)) artifactPromises.set(relativePath, Promise.resolve(readJson(relativePath, path)));
    return artifactPromises.get(relativePath);
  };
  const loadManifest = async () => {
    if (!manifestPromise) manifestPromise = Promise.resolve(readJson(path)).then((manifest) => {
      if (String(manifest?.sourceCountyId || "") !== countyId) throw error("WR_MANIFEST_COUNTY_MISMATCH", `Manifest county does not match ${countyId}`);
      const featureCount = Number(manifest.featureCount);
      const searchCount = Number(manifest.searchIndexCount);
      if (!Number.isInteger(featureCount) || featureCount <= 0 || searchCount !== featureCount) throw error("WR_MANIFEST_COUNT_PARITY", "Manifest feature and search counts must be exact and equal");
      if (expectedFeatureCount !== null && featureCount !== Number(expectedFeatureCount)) throw error("WR_MANIFEST_EXPECTED_COUNT_MISMATCH", `Manifest count ${featureCount} does not match expected ${expectedFeatureCount}`);
      return manifest;
    });
    return manifestPromise;
  };
  const sourceEvidence = (partial = false) => [{ sourceCountyId: countyId, datasetId: `${countyId}-parcel-artifacts`, sourceVersion: version, sourceUpdatedAt: updatedAt, freshnessStatus, partial }];

  return Object.freeze({
    schemaVersion: COUNTY_ARTIFACT_CANDIDATE_ADAPTER_VERSION,
    async fetchCandidatePage({ plan, countyIds = [], bounds = null, cursor = "", limit = 500, signal = null } = {}) {
      if (signal?.aborted) throw error("ABORT_ERR", "Candidate artifact read was aborted");
      const requested = [...new Set((countyIds || []).map(String).filter(Boolean))];
      if (requested.length && (requested.length !== 1 || requested[0] !== countyId)) throw error("WR_CANDIDATE_COUNTY_SCOPE_VIOLATION", `Adapter is restricted to ${countyId}`);
      const manifest = await loadManifest();
      const searchFiles = sourceFilesForSearch(manifest, plan, Math.max(1, Number(maxShardMemberships)));
      let mode = searchFiles.length ? "search" : bounds ? "viewport" : "blocked";
      if (mode === "blocked") return { schemaVersion: "wr-parcel-candidate-page-v1", candidates: [], nextCursor: "", scannedRecords: 0, sourceEvidence: sourceEvidence(true), partial: true, errors: [{ code: "WR_BOUNDED_QUERY_REQUIRED", message: "County-wide filter scans are disabled; supply map bounds or a selective search term." }] };
      let files = searchFiles;
      const searchBounds = mode === "search" && bounds ? normalizeBounds(bounds, manifest.bounds || {}) : null;
      if (mode === "viewport") {
        const normalized = normalizeBounds(bounds, manifest.bounds || {});
        files = (manifest.chunks || []).filter((chunk) => intersects(chunk.bounds, normalized)).map((chunk) => safeArtifactPath(chunk.file));
        if (files.length > maxBoundedChunks) return { schemaVersion: "wr-parcel-candidate-page-v1", candidates: [], nextCursor: "", scannedRecords: 0, sourceEvidence: sourceEvidence(true), partial: true, errors: [{ code: "WR_VIEWPORT_CHUNK_BUDGET", message: `Viewport intersects ${files.length} chunks; maximum is ${maxBoundedChunks}.` }] };
      }
      const state = decodeCursor(cursor, mode, version);
      const candidates = [];
      let scannedRecords = 0;
      let fileIndex = state.fileIndex;
      let rowOffset = state.rowOffset;
      const pageLimit = Math.max(1, Math.min(1000, Math.trunc(Number(limit || 500))));
      while (fileIndex < files.length && candidates.length < pageLimit) {
        if (signal?.aborted) throw error("ABORT_ERR", "Candidate artifact read was aborted");
        const payload = await loadArtifact(files[fileIndex]);
        const records = mode === "search" ? unpackSearchRows(payload) : (payload?.parcels || []);
        while (rowOffset < records.length && candidates.length < pageLimit) {
          const parcel = records[rowOffset++];
          scannedRecords += 1;
          if (searchBounds) {
            const centroid = parcel?.centroid;
            if (!Array.isArray(centroid) || centroid.length < 2 || !Number.isFinite(Number(centroid[0])) || !Number.isFinite(Number(centroid[1])) || Number(centroid[0]) < searchBounds.minX || Number(centroid[0]) > searchBounds.maxX || Number(centroid[1]) < searchBounds.minY || Number(centroid[1]) > searchBounds.maxY) continue;
          }
          try { candidates.push(canonicalParcel(parcel, countyId)); } catch {}
        }
        if (rowOffset >= records.length) { fileIndex += 1; rowOffset = 0; }
      }
      const nextCursor = fileIndex < files.length ? encodeCursor({ mode, fileIndex, rowOffset, sourceVersion: version }) : "";
      return { schemaVersion: "wr-parcel-candidate-page-v1", candidates, nextCursor, scannedRecords, sourceEvidence: sourceEvidence(false), partial: false, errors: [] };
    },
  });
}
