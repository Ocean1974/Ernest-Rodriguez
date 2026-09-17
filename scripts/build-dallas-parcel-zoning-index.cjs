const fs = require("fs");
const https = require("https");
const path = require("path");
const { SOURCE_COUNTY_ID, SOURCE_LAYERS } = require("./build-dallas-zoning-manifest.cjs");

const root = path.join(__dirname, "..");
const parcelManifestFile = path.join(root, "public", "data", "parcels", "manifest.json");
const parcelChunksDir = path.join(root, "public", "data", "parcels");
const zoningDir = path.join(root, "public", "data", "zoning");
const parcelIndexDir = path.join(zoningDir, "parcel-index");
const zoningManifestFile = path.join(zoningDir, "manifest.json");
const parcelIndexFile = path.join(zoningDir, "parcel-zoning-index.json");
const outputJsonFile = path.join(root, "output", "dallas-parcel-zoning-index-report.json");
const outputMdFile = path.join(root, "output", "dallas-parcel-zoning-index-report.md");

const PARCEL_ZONING_INDEX_SCHEMA_VERSION = "wr-parcel-zoning-index-v1";
const SHARD_KEY_LENGTH = 8;
const SPATIAL_GRID_COLUMNS = 180;
const SPATIAL_GRID_ROWS = 140;
const PAGE_SIZE = 2000;
const COUNTY_BOUNDS = {
  minLng: -97.1,
  minLat: 32.55,
  maxLng: -96.45,
  maxLat: 33.05,
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

function ensureCleanDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json" }, timeout: 30000 }, (response) => {
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
  return `${baseUrl}/query?${query}`;
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

function addUniqueFrom(list, values) {
  values.forEach((value) => pushUnique(list, value));
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

function normalizeFeature(layer, metadata, feature) {
  const attributes = feature.attributes || {};
  const rings = feature.geometry?.rings || [];
  const bounds = ringBounds(rings);
  if (!bounds) return null;
  const subdistricts = [
    firstField(attributes, ["SUBDIST1", "SUBDIST_1", "SUB_DIST1", "SUB_DIST_1"]),
    firstField(attributes, ["SUBDIST2", "SUBDIST_2", "SUB_DIST2", "SUB_DIST_2"]),
    firstField(attributes, ["SUBDIST", "SUB_DIST", "SUBDISTRICT", "SUB_DISTRICT"]),
  ].filter(Boolean);
  const hit = {
    sourceLayerId: layer.id,
    sourceLayerTitle: layer.title,
    recordType: layer.recordType,
    objectId: numericId(attributes, metadata.objectIdField || "OBJECTID"),
    zoneDistrict: firstField(attributes, ["ZONE_DIST", "ZONE", "ZONING"]),
    longZoneDistrict: firstField(attributes, ["LONG_ZONE_DIST", "LONG_ZONE", "ZONE_DESC"]),
    pdNumber: firstField(attributes, ["PD_NUM", "PDNUM", "PD_NO", "PD"]),
    pdsNumber: firstField(attributes, ["PDS_NUM", "PDSNUM", "PDS_NO", "PDS"]),
    supNumber: firstField(attributes, ["SUP_NUM", "SUPNUM", "SUP_NO", "SUP"]),
    cdNumber: firstField(attributes, ["CD_NUM", "CDNUM", "CD_NO", "CD"]),
    subdistrict: subdistricts.join(" / "),
    caseNumber: firstField(attributes, ["CASE_NUMBER", "CASE_NO", "CASE"]),
    overlayName: firstField(attributes, ["COMMON_NAME", "DEED_RES", "D_OVERLAY", "H_OVERLAY", "MD_OVERLAY", "P_OVERLAY", "OVERLAY", "NAME"]),
    ordNumber: firstField(attributes, ["ORD_NUM", "ORDINANCE", "ORDINANCE_NUMBER"]),
  };
  return {
    id: `${layer.id}:${hit.objectId}`,
    layer,
    hit,
    rings,
    bounds,
  };
}

async function fetchLayerFeatures(layer) {
  if (layer.id === "city-tax-parcels") return { layer, features: [], skipped: true, featureCount: 0 };
  const metadata = await requestJson(`${layer.url}?f=json`);
  const countPayload = await requestJson(queryUrl(layer.url, "where=1%3D1&returnCountOnly=true&f=json"));
  const count = Number(countPayload.count || 0);
  const pageSize = Math.max(1, Math.min(Number(metadata.maxRecordCount || PAGE_SIZE), PAGE_SIZE));
  const features = [];
  for (let offset = 0; offset < count; offset += pageSize) {
    const query = [
      "where=1%3D1",
      "outFields=*",
      "returnGeometry=true",
      "outSR=4326",
      "geometryPrecision=6",
      `resultOffset=${offset}`,
      `resultRecordCount=${pageSize}`,
      "f=json",
    ].join("&");
    const payload = await requestJson(queryUrl(layer.url, query));
    for (const feature of payload.features || []) {
      const normalized = normalizeFeature(layer, metadata, feature);
      if (normalized) features.push(normalized);
    }
    if (!payload.exceededTransferLimit && (!payload.features || payload.features.length < pageSize)) break;
  }
  console.log(`Fetched ${features.length.toLocaleString()} spatial zoning features from ${layer.title}`);
  return { layer, features, skipped: false, featureCount: count };
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
    features,
    find(point) {
      const candidates = cells.get(cellKey(cellX(point[0]), cellY(point[1]))) || [];
      return candidates.filter((feature) => pointInBounds(point, feature.bounds) && pointInPolygon(point, feature.rings));
    },
  };
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

function flattenCoordinates(coordinates, output) {
  if (!Array.isArray(coordinates)) return output;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    output.push([coordinates[0], coordinates[1]]);
    return output;
  }
  coordinates.forEach((child) => flattenCoordinates(child, output));
  return output;
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
  for (const hit of hits) {
    if (hit.recordType === "base-zoning") {
      pushUnique(summary.baseDistricts, hit.zoneDistrict);
      pushUnique(summary.longZoneDistricts, hit.longZoneDistrict);
    }
    pushUnique(summary.pdNumbers, hit.pdNumber);
    pushUnique(summary.pdsNumbers, hit.pdsNumber);
    pushUnique(summary.supNumbers, hit.supNumber);
    pushUnique(summary.cdNumbers, hit.cdNumber);
    pushUnique(summary.subdistricts, hit.subdistrict);
    if (hit.recordType === "overlay") pushUnique(summary.overlays, hit.overlayName || hit.sourceLayerTitle);
    if (hit.recordType === "subdistrict") pushUnique(summary.subdistricts, hit.overlayName);
    pushUnique(summary.caseNumbers, hit.caseNumber);
  }
  const labelParts = [];
  if (summary.baseDistricts.length) labelParts.push(summary.baseDistricts.join(", "));
  if (summary.pdNumbers.length) labelParts.push(`PD ${summary.pdNumbers.join(", ")}`);
  if (summary.pdsNumbers.length) labelParts.push(`PDS ${summary.pdsNumbers.join(", ")}`);
  if (summary.supNumbers.length) labelParts.push(`SUP ${summary.supNumbers.join(", ")}`);
  if (summary.subdistricts.length) labelParts.push(`Subdistrict ${summary.subdistricts.join(", ")}`);
  summary.label = labelParts.join(" | ");
  return summary;
}

function buildParcelZoningRecord(parcel, chunkId, hits) {
  const accountNum = cleanValue(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId);
  const sourceCountyId = cleanValue(parcel.sourceCountyId) || SOURCE_COUNTY_ID;
  const countyParcelId = cleanValue(parcel.countyParcelId) || `${sourceCountyId}:${accountNum}`;
  const hitPayloads = hits.map((feature) => feature.hit);
  const summary = buildZoningSummary(parcel, hitPayloads);
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
    ...summary.pdNumbers.map((value) => `PD ${value}`),
    ...summary.pdsNumbers.map((value) => `PDS ${value}`),
    ...summary.supNumbers.map((value) => `SUP ${value}`),
    ...summary.cdNumbers.map((value) => `CD ${value}`),
    ...summary.subdistricts,
    ...summary.overlays,
    ...summary.caseNumbers,
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
  if (record.existingParcelZoning && !record.sourceLayerHits.length) counters.parcelZoningOnlyCount += 1;
  if (record.pdNumbers.length) counters.parcelsWithPd += 1;
  if (record.pdsNumbers.length) counters.parcelsWithPds += 1;
  if (record.supNumbers.length) counters.parcelsWithSup += 1;
  if (record.subdistricts.length) counters.parcelsWithSubdistricts += 1;
  if (record.overlays.length) counters.parcelsWithOverlays += 1;
  counters.sourceHitCount += record.sourceLayerHits.length;
}

function writeReport(index, layerReports) {
  fs.writeFileSync(outputJsonFile, JSON.stringify({ ...index, sourceLayers: layerReports }, null, 2));
  const lines = [
    "# Dallas Parcel Zoning Index Report",
    "",
    `Generated: ${index.generatedAt}`,
    "",
    "## Safety",
    "",
    "- Page design changed: no",
    "- Base parcel data overwritten: no",
    "- Runtime visibility: default-off",
    "- Join method: parcel centroid spatial join to official Dallas zoning polygons, plus existing parcel zoning carried from the parcel chunks",
    "",
    "## Parcel Index",
    "",
    `- Parcel zoning records: ${index.recordCount}`,
    `- ArcGIS joined parcels: ${index.arcgisJoinedParcelCount}`,
    `- Existing parcel-zoning-only records: ${index.parcelZoningOnlyCount}`,
    `- Parcels with PD numbers: ${index.parcelsWithPd}`,
    `- Parcels with PDS numbers: ${index.parcelsWithPds}`,
    `- Parcels with SUP numbers: ${index.parcelsWithSup}`,
    `- Parcels with subdistricts: ${index.parcelsWithSubdistricts}`,
    `- Parcels with overlays: ${index.parcelsWithOverlays}`,
    `- Source zoning hits: ${index.sourceHitCount}`,
    `- Shards: ${index.shardCount}`,
    "",
    "## Source Layers",
    "",
    "| Layer | Record type | Source count | Indexed features |",
    "| --- | --- | ---: | ---: |",
    ...layerReports.map((layer) => `| ${layer.title} | ${layer.recordType} | ${layer.featureCount} | ${layer.indexedFeatureCount} |`),
    "",
    "This report is data plumbing only. It does not alter visible White Rabbit pages.",
    "",
  ];
  fs.writeFileSync(outputMdFile, lines.join("\n"));
}

async function main() {
  if (!fs.existsSync(parcelManifestFile)) throw new Error("Missing public/data/parcels/manifest.json");
  fs.mkdirSync(zoningDir, { recursive: true });
  ensureCleanDir(parcelIndexDir);

  const layerResults = [];
  const allSpatialFeatures = [];
  for (const layer of SOURCE_LAYERS) {
    const result = await fetchLayerFeatures(layer);
    layerResults.push({
      id: layer.id,
      title: layer.title,
      recordType: layer.recordType,
      url: layer.url,
      featureCount: result.featureCount,
      indexedFeatureCount: result.features.length,
      skipped: Boolean(result.skipped),
    });
    allSpatialFeatures.push(...result.features);
  }
  const spatialIndex = buildSpatialIndex(allSpatialFeatures);
  console.log(`Indexed ${allSpatialFeatures.length.toLocaleString()} zoning polygons for parcel joins`);

  const parcelManifest = JSON.parse(fs.readFileSync(parcelManifestFile, "utf8"));
  const shards = new Map();
  const counters = {
    recordCount: 0,
    arcgisJoinedParcelCount: 0,
    parcelZoningOnlyCount: 0,
    parcelsWithPd: 0,
    parcelsWithPds: 0,
    parcelsWithSup: 0,
    parcelsWithSubdistricts: 0,
    parcelsWithOverlays: 0,
    sourceHitCount: 0,
    skippedParcels: 0,
  };

  for (const chunk of parcelManifest.chunks || []) {
    const chunkFile = path.join(parcelChunksDir, chunk.file);
    const payload = JSON.parse(fs.readFileSync(chunkFile, "utf8"));
    for (const parcel of payload.parcels || []) {
      const center = parcelCenter(parcel);
      const hits = center ? spatialIndex.find(center) : [];
      if (!hits.length && !cleanValue(parcel.zoning)) continue;
      if (!center && hits.length) counters.skippedParcels += 1;
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

  const manifest = fs.existsSync(zoningManifestFile) ? JSON.parse(fs.readFileSync(zoningManifestFile, "utf8")) : {};
  manifest.status = "parcel-index-ready";
  manifest.defaultVisible = false;
  manifest.renderDirectlyInBrowser = false;
  manifest.runtimeReadiness = "parcel-zoning index is built and default-off; no visible map layer is mounted";
  manifest.parcelIndex = "parcel-zoning-index.json";
  manifest.parcelIndexDirectory = "parcel-index/";
  manifest.parcelIndexCount = index.recordCount;
  manifest.parcelIndexShards = {
    keyLength: SHARD_KEY_LENGTH,
    fields: PARCEL_ZONING_FIELDS,
    sourceHitFields: SOURCE_HIT_FIELDS,
    files,
    counts,
  };
  manifest.parcelIndexSchemaPath = "data/schemas/parcel-zoning-index.schema.json";
  manifest.parcelZoningJoin = {
    method: "parcel centroid spatial join",
    stableId: "countyParcelId/accountNum",
    baseParcelProtection: "DCAD base parcel data is not overwritten.",
    includedZoning: ["base zoning", "PD", "PDS", "SUP", "subdistricts", "overlays", "existing parcel zoning"],
  };
  fs.writeFileSync(zoningManifestFile, JSON.stringify(manifest, null, 2));
  writeReport(index, layerResults);

  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        recordCount: index.recordCount,
        arcgisJoinedParcelCount: index.arcgisJoinedParcelCount,
        parcelsWithPd: index.parcelsWithPd,
        parcelsWithSup: index.parcelsWithSup,
        parcelsWithSubdistricts: index.parcelsWithSubdistricts,
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
