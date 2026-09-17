const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.join(__dirname, "..");
const SOURCE_COUNTY_ID = "jefferson-ky";
const SOURCE_LAYER_URL = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataDevelopment/MapServer/15";
const SOURCE_LAYER_ID = "lojic-zoning";
const SOURCE_LAYER_TITLE = "Jefferson County KY Zoning";
const SOURCE_LAYER_NAME = "LOJIC Jefferson County KY Zoning";
const SOURCE_LAYER_RECORD_TYPE = "base-zoning";

const parcelManifestFile = path.join(root, "public", "data", "counties", "jefferson-ky", "parcels", "manifest.json");
const parcelChunksDir = path.join(root, "public", "data", "counties", "jefferson-ky", "parcels");
const zoningDir = path.join(root, "public", "data", "counties", "jefferson-ky", "zoning");
const parcelIndexDir = path.join(zoningDir, "parcel-index");
const zoningManifestFile = path.join(zoningDir, "manifest.json");
const parcelIndexFile = path.join(zoningDir, "parcel-zoning-index.json");
const searchIndexFile = path.join(zoningDir, "search-index.json");
const outputJsonFile = path.join(root, "output", "jefferson-ky", "zoning-source-report.json");
const outputMdFile = path.join(root, "output", "jefferson-ky", "zoning-source-report.md");
const sourceManifestFile = path.join(root, "data", "county-adapters", "louisville", "lojic-zoning-source-manifest.json");

const PARCEL_ZONING_INDEX_SCHEMA_VERSION = "wr-parcel-zoning-index-v1";
const ZONING_MANIFEST_SCHEMA_VERSION = "wr-jefferson-ky-zoning-manifest-v1";
const RECORD_SCHEMA_VERSION = "wr-lojic-zoning-layer-v1";
const SHARD_KEY_LENGTH = 6;
const SPATIAL_GRID_COLUMNS = 150;
const SPATIAL_GRID_ROWS = 120;
const PAGE_SIZE = 2000;
const COUNTY_BOUNDS = {
  minLng: -85.95,
  minLat: 38.0,
  maxLng: -85.4,
  maxLat: 38.38,
};

const PARCEL_ZONING_FIELDS = [
  "countyParcelId",
  "accountNum",
  "gisParcelId",
  "parcelChunkId",
  "existingParcelZoning",
  "label",
  "baseDistricts",
  "longZoneDistricts",
  "pdNumbers",
  "pdsNumbers",
  "supNumbers",
  "cdNumbers",
  "subdistricts",
  "overlays",
  "caseNumbers",
  "sourceLayerIds",
  "sourceLayerHits",
  "searchText",
];

const SOURCE_HIT_FIELDS = [
  "sourceLayerId",
  "sourceLayerTitle",
  "recordType",
  "objectId",
  "zoneDistrict",
  "longZoneDistrict",
  "pdNumber",
  "pdsNumber",
  "supNumber",
  "cdNumber",
  "subdistrict",
  "caseNumber",
  "overlayName",
  "ordNumber",
];

function assertInsideWorkspace(target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside workspace: ${resolvedTarget}`);
  }
}

function ensureCleanDir(dir) {
  assertInsideWorkspace(dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function ensureDir(dir) {
  assertInsideWorkspace(dir);
  fs.mkdirSync(dir, { recursive: true });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json" }, timeout: 45000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON for ${url}: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Request timed out for ${url}`)));
    request.on("error", reject);
  });
}

function queryUrl(baseUrl, query) {
  const params = new URLSearchParams(query);
  return `${baseUrl}/query?${params.toString()}`;
}

function cleanValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

function firstField(attributes, names) {
  for (const name of names) {
    const value = cleanValue(attributes[name]);
    if (value) return value;
  }
  return "";
}

function pushUnique(list, value) {
  const text = cleanValue(value);
  if (!text) return;
  if (!list.includes(text)) list.push(text);
}

function numericId(attributes, objectIdField) {
  return attributes[objectIdField] ?? attributes.OBJECTID ?? attributes.FID ?? "";
}

function ringBounds(rings) {
  const bounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  let pointCount = 0;
  for (const ring of rings || []) {
    for (const point of ring || []) {
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      bounds.minLng = Math.min(bounds.minLng, lng);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLng = Math.max(bounds.maxLng, lng);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
      pointCount += 1;
    }
  }
  if (!pointCount || bounds.minLng < -180 || bounds.maxLng > 180 || bounds.minLat < -90 || bounds.maxLat > 90) return null;
  return bounds;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  let inside = false;
  for (const ring of rings || []) {
    if (ring.length >= 3 && pointInRing(point, ring)) inside = !inside;
  }
  return inside;
}

function cellX(lng) {
  return Math.max(0, Math.min(SPATIAL_GRID_COLUMNS - 1, Math.floor(((lng - COUNTY_BOUNDS.minLng) / (COUNTY_BOUNDS.maxLng - COUNTY_BOUNDS.minLng)) * SPATIAL_GRID_COLUMNS)));
}

function cellY(lat) {
  return Math.max(0, Math.min(SPATIAL_GRID_ROWS - 1, Math.floor(((lat - COUNTY_BOUNDS.minLat) / (COUNTY_BOUNDS.maxLat - COUNTY_BOUNDS.minLat)) * SPATIAL_GRID_ROWS)));
}

function cellKey(x, y) {
  return `${x}:${y}`;
}

function cellRangeForBounds(bounds) {
  return {
    minX: cellX(bounds.minLng),
    maxX: cellX(bounds.maxLng),
    minY: cellY(bounds.minLat),
    maxY: cellY(bounds.maxLat),
  };
}

function pointInBounds(point, bounds) {
  return point[0] >= bounds.minLng && point[0] <= bounds.maxLng && point[1] >= bounds.minLat && point[1] <= bounds.maxLat;
}

function normalizeFeature(metadata, feature) {
  const attributes = feature.attributes || {};
  const rings = feature.geometry?.rings || [];
  const bounds = ringBounds(rings);
  if (!bounds) return null;
  const zoneDistrict = firstField(attributes, ["ZONING_CODE"]);
  const longZoneDistrict = firstField(attributes, ["ZONING_NAME"]);
  const zoningType = firstField(attributes, ["ZONING_TYPE"]);
  const label = [zoneDistrict, longZoneDistrict].filter(Boolean).join(" - ");
  const hit = {
    sourceLayerId: SOURCE_LAYER_ID,
    sourceLayerTitle: SOURCE_LAYER_TITLE,
    recordType: SOURCE_LAYER_RECORD_TYPE,
    objectId: numericId(attributes, metadata.objectIdField || "OBJECTID"),
    zoneDistrict,
    longZoneDistrict,
    pdNumber: "",
    pdsNumber: "",
    supNumber: "",
    cdNumber: "",
    subdistrict: "",
    caseNumber: "",
    overlayName: zoningType,
    ordNumber: "",
  };
  return {
    id: `${SOURCE_LAYER_ID}:${hit.objectId}`,
    label: zoningType ? `${label || zoneDistrict || longZoneDistrict} (${zoningType})` : label,
    hit,
    rings,
    bounds,
  };
}

async function fetchZoningFeatures() {
  const metadata = await requestJson(`${SOURCE_LAYER_URL}?f=json`);
  const countPayload = await requestJson(
    queryUrl(SOURCE_LAYER_URL, {
      where: "1=1",
      returnCountOnly: "true",
      f: "json",
    }),
  );
  const count = Number(countPayload.count || 0);
  const pageSize = Math.max(1, Math.min(Number(metadata.maxRecordCount || PAGE_SIZE), PAGE_SIZE));
  const features = [];
  for (let offset = 0; offset < count; offset += pageSize) {
    const payload = await requestJson(
      queryUrl(SOURCE_LAYER_URL, {
        where: "1=1",
        outFields: "*",
        returnGeometry: "true",
        returnTrueCurves: "false",
        outSR: "4326",
        geometryPrecision: "7",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        orderByFields: metadata.objectIdField || "OBJECTID",
        f: "json",
      }),
    );
    for (const feature of payload.features || []) {
      const normalized = normalizeFeature(metadata, feature);
      if (normalized) features.push(normalized);
    }
    if (!payload.exceededTransferLimit && (!payload.features || payload.features.length < pageSize)) break;
  }
  return {
    metadata,
    sourceZoningFeatureCount: count,
    features,
  };
}

function buildSpatialIndex(features) {
  const cells = new Map();
  for (const feature of features) {
    const range = cellRangeForBounds(feature.bounds);
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const key = cellKey(x, y);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(feature);
      }
    }
  }
  return {
    cells,
    find(point) {
      const candidates = cells.get(cellKey(cellX(point[0]), cellY(point[1]))) || [];
      return candidates.filter((feature) => pointInBounds(point, feature.bounds) && pointInPolygon(point, feature.rings));
    },
  };
}

function flattenCoordinates(coordinates, output) {
  if (!Array.isArray(coordinates)) return output;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    output.push([coordinates[0], coordinates[1]]);
    return output;
  }
  coordinates.forEach((child) => flattenCoordinates(child, output));
  return output;
}

function parcelCenter(parcel) {
  if (Array.isArray(parcel.liveGeometry?.center) && Number.isFinite(parcel.liveGeometry.center[0]) && Number.isFinite(parcel.liveGeometry.center[1])) {
    return [parcel.liveGeometry.center[0], parcel.liveGeometry.center[1]];
  }
  if (Array.isArray(parcel.realGeometry?.geometry?.coordinates)) {
    const points = [];
    flattenCoordinates(parcel.realGeometry.geometry.coordinates, points);
    if (points.length) {
      const total = points.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0]);
      return [total[0] / points.length, total[1] / points.length];
    }
  }
  return null;
}

function packHit(hit) {
  const values = SOURCE_HIT_FIELDS.map((field) => hit[field] ?? "");
  while (values.length && values[values.length - 1] === "") values.pop();
  return values;
}

function packParcelZoning(record) {
  const values = PARCEL_ZONING_FIELDS.map((field) => record[field] ?? "");
  while (values.length && values[values.length - 1] === "") values.pop();
  return values;
}

function shardKeyForParcel(parcel) {
  const token = cleanValue(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId || parcel.countyParcelId).replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (token.length >= SHARD_KEY_LENGTH) return token.slice(0, SHARD_KEY_LENGTH);
  return "zz";
}

function buildZoningSummary(parcel, hits) {
  const summary = {
    baseDistricts: [],
    longZoneDistricts: [],
    pdNumbers: [],
    pdsNumbers: [],
    supNumbers: [],
    cdNumbers: [],
    subdistricts: [],
    overlays: [],
    caseNumbers: [],
  };
  pushUnique(summary.baseDistricts, parcel.zoning);
  for (const feature of hits) {
    const hit = feature.hit;
    pushUnique(summary.baseDistricts, hit.zoneDistrict);
    pushUnique(summary.longZoneDistricts, hit.longZoneDistrict);
    pushUnique(summary.overlays, hit.overlayName);
  }
  const labelParts = [];
  if (hits[0]?.label) labelParts.push(hits[0].label);
  else if (summary.baseDistricts.length) labelParts.push(summary.baseDistricts.join(", "));
  if (summary.overlays.length) labelParts.push(summary.overlays.join(", "));
  summary.label = Array.from(new Set(labelParts.filter(Boolean))).join(" | ");
  return summary;
}

function buildParcelZoningRecord(parcel, chunkId, hits) {
  const accountNum = cleanValue(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId);
  const sourceCountyId = cleanValue(parcel.sourceCountyId) || SOURCE_COUNTY_ID;
  const countyParcelId = cleanValue(parcel.countyParcelId) || `${sourceCountyId}:${accountNum}`;
  const summary = buildZoningSummary(parcel, hits);
  const hitPayloads = hits.map((feature) => feature.hit);
  const sourceLayerIds = [...new Set(hitPayloads.map((hit) => hit.sourceLayerId))];
  const searchText = [
    countyParcelId,
    accountNum,
    parcel.gisParcelId,
    parcel.address,
    parcel.propertyAddress,
    parcel.zoning,
    summary.label,
    ...summary.baseDistricts,
    ...summary.longZoneDistricts,
    ...summary.overlays,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    countyParcelId,
    accountNum,
    gisParcelId: cleanValue(parcel.gisParcelId),
    parcelChunkId: chunkId,
    existingParcelZoning: cleanValue(parcel.zoning),
    ...summary,
    sourceLayerIds,
    sourceLayerHits: hitPayloads.map(packHit),
    searchText,
  };
}

function addRecordToShard(shards, key, record) {
  if (!shards.has(key)) shards.set(key, []);
  shards.get(key).push(packParcelZoning(record));
}

function summarizeRecordCounters(counters, record) {
  if (record.sourceLayerHits.length) counters.arcgisJoinedParcelCount += 1;
  if (record.baseDistricts.length) counters.parcelsWithBaseZoning += 1;
  if (record.longZoneDistricts.length) counters.parcelsWithZoningNames += 1;
  if (record.overlays.length) counters.parcelsWithZoningTypes += 1;
  counters.sourceHitCount += record.sourceLayerHits.length;
}

function writePublicManifest(index, layerReport) {
  const manifest = {
    schemaVersion: ZONING_MANIFEST_SCHEMA_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    sourceCountyId: SOURCE_COUNTY_ID,
    status: "parcel-index-ready",
    generatedAt: index.generatedAt,
    defaultVisible: false,
    renderDirectlyInBrowser: false,
    runtimeReadiness: "Jefferson zoning parcel index is built and default-off; no visible page redesign is required.",
    maxFeaturesPerViewport: 750,
    chunkCount: 0,
    chunks: [],
    searchIndex: "search-index.json",
    searchIndexCount: 0,
    parcelIndex: "parcel-zoning-index.json",
    parcelIndexDirectory: "parcel-index/",
    parcelIndexCount: index.recordCount,
    parcelIndexShards: {
      keyLength: SHARD_KEY_LENGTH,
      fields: PARCEL_ZONING_FIELDS,
      sourceHitFields: SOURCE_HIT_FIELDS,
      files: index.files,
      counts: index.counts,
    },
    parcelIndexSchemaPath: "data/schemas/parcel-zoning-index.schema.json",
    parcelZoningJoin: {
      method: "parcel centroid spatial join",
      stableId: "countyParcelId/accountNum/gisParcelId",
      baseParcelProtection: "LOJIC parcel foundation is not overwritten.",
      includedZoning: ["ZONING_CODE", "ZONING_NAME", "ZONING_TYPE"],
    },
    sourceLayers: [layerReport],
  };
  fs.writeFileSync(zoningManifestFile, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(searchIndexFile, JSON.stringify({ zoningRecords: [], records: [] }, null, 2));
}

function writeSourceManifest(index, layerReport) {
  const manifest = {
    id: SOURCE_LAYER_ID,
    county_id: SOURCE_COUNTY_ID,
    county_name: "Jefferson County",
    market_name: "Louisville",
    source_name: SOURCE_LAYER_NAME,
    source_url: SOURCE_LAYER_URL,
    service_type: "ArcGIS REST Feature Layer",
    geometry_type: "polygon",
    source_spatial_reference: "EPSG:2246 / NAD 1983 StatePlane Kentucky North FIPS 1601 Feet",
    output_spatial_reference: "EPSG:4326 / WGS 84",
    status: "parcel-index-ready",
    verified_record_count: layerReport.featureCount,
    count_verified_at: index.generatedAt,
    fields: ["OBJECTID", "ZONING_CODE", "ZONING_NAME", "ZONING_TYPE", "SHAPE.AREA", "SHAPE.LEN", "GLOBALID"],
    white_rabbit_field_map: {
      zoneDistrict: "ZONING_CODE",
      longZoneDistrict: "ZONING_NAME",
      zoningType: "ZONING_TYPE",
      objectId: "OBJECTID",
      geometry: "SHAPE",
    },
    join_strategy: {
      method: "offline parcel centroid spatial join to LOJIC parcel polygons",
      parcel_keys: ["countyParcelId", "PARCELID/accountNum", "LRSN/gisParcelId"],
      output_manifest: "public/data/counties/jefferson-ky/zoning/manifest.json",
      output_index: "public/data/counties/jefferson-ky/zoning/parcel-zoning-index.json",
    },
    qa: {
      source_polygon_count: layerReport.featureCount,
      indexed_polygon_count: layerReport.indexedFeatureCount,
      parcel_count_scanned: index.parcelCountScanned,
      parcel_zoning_record_count: index.recordCount,
      parcels_without_zoning_match: index.parcelsWithoutZoningMatch,
      missing_centroid_count: index.missingCentroidCount,
      page_design_changed: false,
    },
  };
  fs.writeFileSync(sourceManifestFile, JSON.stringify(manifest, null, 2));
}

function writeReport(index, layerReport) {
  const report = {
    ...index,
    pageDesignChanged: false,
    sourceLayers: [layerReport],
    sourceUrl: SOURCE_LAYER_URL,
    sourceName: SOURCE_LAYER_NAME,
    sourceZoningFeatureCount: layerReport.featureCount,
    indexedZoningFeatureCount: layerReport.indexedFeatureCount,
  };
  fs.writeFileSync(outputJsonFile, JSON.stringify(report, null, 2));
  const lines = [
    "# Jefferson County KY Zoning Source Report",
    "",
    `Generated: ${index.generatedAt}`,
    "",
    "## Safety",
    "",
    "- Page design changed: no",
    "- Base parcel data overwritten: no",
    "- Runtime visibility: default-off",
    "- Join method: parcel centroid spatial join to official LOJIC zoning polygons",
    "",
    "## Source Layer",
    "",
    `- Source: ${SOURCE_LAYER_NAME}`,
    `- URL: ${SOURCE_LAYER_URL}`,
    `- Source zoning polygons: ${layerReport.featureCount}`,
    `- Indexed zoning polygons: ${layerReport.indexedFeatureCount}`,
    `- Fields: ZONING_CODE, ZONING_NAME, ZONING_TYPE`,
    "",
    "## Parcel Index",
    "",
    `- Parcel chunks scanned: ${index.parcelChunkCount}`,
    `- Parcels scanned: ${index.parcelCountScanned}`,
    `- Parcel zoning records: ${index.recordCount}`,
    `- Parcels with zoning match: ${index.arcgisJoinedParcelCount}`,
    `- Parcels without zoning match: ${index.parcelsWithoutZoningMatch}`,
    `- Missing centroid count: ${index.missingCentroidCount}`,
    `- Source zoning hits: ${index.sourceHitCount}`,
    `- Shards: ${index.shardCount}`,
    "",
    "This report is data plumbing only. It does not alter visible White Rabbit pages.",
    "",
  ];
  fs.writeFileSync(outputMdFile, lines.join("\n"));
}

async function main() {
  if (!fs.existsSync(parcelManifestFile)) throw new Error("Missing public/data/counties/jefferson-ky/parcels/manifest.json");
  ensureDir(zoningDir);
  ensureDir(path.dirname(outputJsonFile));
  ensureCleanDir(parcelIndexDir);

  const { metadata, sourceZoningFeatureCount, features } = await fetchZoningFeatures();
  const layerReport = {
    id: SOURCE_LAYER_ID,
    title: SOURCE_LAYER_TITLE,
    name: SOURCE_LAYER_NAME,
    recordType: SOURCE_LAYER_RECORD_TYPE,
    url: SOURCE_LAYER_URL,
    featureCount: sourceZoningFeatureCount,
    indexedFeatureCount: features.length,
    objectIdField: metadata.objectIdField || "OBJECTID",
    fields: ["ZONING_CODE", "ZONING_NAME", "ZONING_TYPE"],
  };
  console.log(`Fetched ${features.length.toLocaleString()} LOJIC zoning polygons from ${SOURCE_LAYER_TITLE}`);

  const spatialIndex = buildSpatialIndex(features);
  const parcelManifest = JSON.parse(fs.readFileSync(parcelManifestFile, "utf8"));
  const shards = new Map();
  const counters = {
    recordCount: 0,
    arcgisJoinedParcelCount: 0,
    parcelsWithBaseZoning: 0,
    parcelsWithZoningNames: 0,
    parcelsWithZoningTypes: 0,
    sourceHitCount: 0,
    missingCentroidCount: 0,
    parcelsWithoutZoningMatch: 0,
    parcelCountScanned: 0,
    parcelChunkCount: (parcelManifest.chunks || []).length,
  };

  for (const chunk of parcelManifest.chunks || []) {
    const chunkFile = path.join(parcelChunksDir, chunk.file);
    const payload = JSON.parse(fs.readFileSync(chunkFile, "utf8"));
    for (const parcel of payload.parcels || []) {
      counters.parcelCountScanned += 1;
      const center = parcelCenter(parcel);
      if (!center) {
        counters.missingCentroidCount += 1;
        continue;
      }
      const hits = spatialIndex.find(center);
      if (!hits.length) {
        counters.parcelsWithoutZoningMatch += 1;
        continue;
      }
      const record = buildParcelZoningRecord(parcel, chunk.id, hits);
      addRecordToShard(shards, shardKeyForParcel(parcel), record);
      summarizeRecordCounters(counters, record);
      counters.recordCount += 1;
    }
  }

  const files = {};
  const counts = {};
  for (const [key, records] of [...shards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = `${key}.json`;
    const relativeFile = `parcel-index/${fileName}`;
    fs.writeFileSync(
      path.join(parcelIndexDir, fileName),
      JSON.stringify({
        schemaVersion: PARCEL_ZONING_INDEX_SCHEMA_VERSION,
        sourceCountyId: SOURCE_COUNTY_ID,
        fields: PARCEL_ZONING_FIELDS,
        sourceHitFields: SOURCE_HIT_FIELDS,
        records,
      }),
    );
    files[key] = relativeFile;
    counts[key] = records.length;
  }

  const generatedAt = new Date().toISOString();
  const index = {
    schemaVersion: PARCEL_ZONING_INDEX_SCHEMA_VERSION,
    sourceCountyId: SOURCE_COUNTY_ID,
    generatedAt,
    shardKeyLength: SHARD_KEY_LENGTH,
    shardCount: Object.keys(files).length,
    fields: PARCEL_ZONING_FIELDS,
    sourceHitFields: SOURCE_HIT_FIELDS,
    files,
    counts,
    ...counters,
  };
  fs.writeFileSync(parcelIndexFile, JSON.stringify(index, null, 2));
  writePublicManifest(index, layerReport);
  writeSourceManifest(index, layerReport);
  writeReport(index, layerReport);

  console.log(
    JSON.stringify(
      {
        status: "parcel-index-ready",
        sourceZoningFeatureCount,
        indexedZoningFeatureCount: features.length,
        parcelCountScanned: index.parcelCountScanned,
        parcelZoningRecordCount: index.recordCount,
        parcelsWithoutZoningMatch: index.parcelsWithoutZoningMatch,
        shardCount: index.shardCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
