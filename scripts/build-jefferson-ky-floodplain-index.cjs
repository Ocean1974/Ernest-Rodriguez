const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.join(__dirname, "..");
const SOURCE_COUNTY_ID = "jefferson-ky";
const SOURCE_SERVICE_URL = "https://gis.lojic.org/maps/rest/services/PvaGis/CamaFloodContour/MapServer";
const SOURCE_LAYER_URL = `${SOURCE_SERVICE_URL}/2`;
const SOURCE_LAYER_ID = "current-fema-flood-zones";
const SOURCE_LAYER_TITLE = "Current FEMA Flood Zones";

const parcelManifestFile = path.join(root, "public", "data", "counties", "jefferson-ky", "parcels", "manifest.json");
const parcelChunksDir = path.join(root, "public", "data", "counties", "jefferson-ky", "parcels");
const floodplainDir = path.join(root, "public", "data", "counties", "jefferson-ky", "floodplain");
const parcelIndexDir = path.join(floodplainDir, "parcel-index");
const floodplainManifestFile = path.join(floodplainDir, "manifest.json");
const parcelIndexFile = path.join(floodplainDir, "parcel-floodplain-index.json");
const outputJsonFile = path.join(root, "output", "jefferson-ky", "floodplain-source-report.json");
const outputMdFile = path.join(root, "output", "jefferson-ky", "floodplain-source-report.md");
const sourceManifestFile = path.join(root, "data", "county-adapters", "louisville", "fema-floodplain-source-manifest.json");

const PARCEL_FLOODPLAIN_INDEX_SCHEMA_VERSION = "wr-parcel-floodplain-index-v1";
const FLOODPLAIN_MANIFEST_SCHEMA_VERSION = "wr-jefferson-ky-floodplain-manifest-v1";
const SHARD_KEY_LENGTH = 6;
const SPATIAL_GRID_COLUMNS = 150;
const SPATIAL_GRID_ROWS = 120;
const OBJECT_ID_BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = 120000;
const REQUEST_RETRY_COUNT = 3;
const COUNTY_BOUNDS = {
  minLng: -85.95,
  minLat: 38.0,
  maxLng: -85.4,
  maxLat: 38.38,
};

const FLOODPLAIN_KEY_FIELDS = [
  "OBJECTID",
  "FLD_AR_ID",
  "FLD_ZONE",
  "FLOODWAY",
  "SFHA_TF",
  "STATIC_BFE",
  "V_DATUM",
  "DEPTH",
  "LEN_UNIT",
  "VELOCITY",
  "VEL_UNIT",
  "SOURCE_CIT",
  "PLOTCODE",
  "DFIRM_ID",
  "VERSION_ID",
  "STUDY_TYP",
  "ZONE_SUBTY",
  "EFF_DATE",
];

const PARCEL_FLOODPLAIN_FIELDS = [
  "countyParcelId",
  "accountNum",
  "gisParcelId",
  "parcelChunkId",
  "label",
  "floodZones",
  "zoneSubtypes",
  "sfha",
  "baseFloodElevations",
  "verticalDatums",
  "depths",
  "velocities",
  "sourceCitations",
  "sourceLayerIds",
  "sourceLayerHits",
  "searchText",
];

const SOURCE_HIT_FIELDS = [
  "sourceLayerId",
  "sourceLayerTitle",
  "objectId",
  "floodZone",
  "zoneSubtype",
  "sfha",
  "staticBfe",
  "verticalDatum",
  "depth",
  "lengthUnit",
  "velocity",
  "velocityUnit",
  "sourceCitation",
  "gfid",
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

function requestJson(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json" }, timeout: REQUEST_TIMEOUT_MS }, (response) => {
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
    request.on("error", (error) => {
      if (attempt < REQUEST_RETRY_COUNT) {
        setTimeout(() => {
          requestJson(url, attempt + 1).then(resolve).catch(reject);
        }, 1000 * attempt);
        return;
      }
      reject(error);
    });
  });
}

function requestJsonPost(baseUrl, query, attempt = 1) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(query).toString();
    const url = `${baseUrl}/query`;
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode} for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(responseBody));
          } catch (error) {
            reject(new Error(`Invalid JSON for ${url}: ${error.message}`));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`Request timed out for ${url}`)));
    request.on("error", (error) => {
      if (attempt < REQUEST_RETRY_COUNT) {
        setTimeout(() => {
          requestJsonPost(baseUrl, query, attempt + 1).then(resolve).catch(reject);
        }, 1000 * attempt);
        return;
      }
      reject(error);
    });
    request.write(body);
    request.end();
  });
}

function queryUrl(baseUrl, query) {
  const params = new URLSearchParams(query);
  return `${baseUrl}/query?${params.toString()}`;
}

function throwIfArcgisError(payload, label) {
  if (!payload?.error) return;
  const details = Array.isArray(payload.error.details) ? ` ${payload.error.details.join("; ")}` : "";
  throw new Error(`${label}: ArcGIS ${payload.error.code || ""} ${payload.error.message || "query error"}${details}`.trim());
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

function isSfha(value, floodZone = "") {
  const flag = cleanValue(value).toLowerCase();
  if (["t", "true", "yes", "y", "1"].includes(flag)) return true;
  const zone = cleanValue(floodZone).toUpperCase();
  return zone.startsWith("A") || zone.startsWith("V");
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

function plotCodeLabel(plotCode, floodway) {
  const floodwayText = cleanValue(floodway).toUpperCase();
  if (floodwayText === "FLOODWAY" || String(plotCode) === "23") return "Floodway";
  return "Floodplain";
}

function normalizeFeature(metadata, feature) {
  const attributes = feature.attributes || {};
  const rings = feature.geometry?.rings || [];
  const bounds = ringBounds(rings);
  if (!bounds) return null;
  const floodZone = firstField(attributes, ["FLD_ZONE", "FLOOD_ZONE", "ZONE"]);
  const hit = {
    sourceLayerId: SOURCE_LAYER_ID,
    sourceLayerTitle: SOURCE_LAYER_TITLE,
    objectId: numericId(attributes, metadata.objectIdField || "OBJECTID"),
    floodZone,
    zoneSubtype: firstField(attributes, ["ZONE_SUBTY", "ZONE_SUBTYPE", "FLOODWAY"]) || plotCodeLabel(attributes.PLOTCODE, attributes.FLOODWAY),
    sfha: firstField(attributes, ["SFHA_TF", "SFHA"]),
    staticBfe: firstField(attributes, ["STATIC_BFE", "BFE"]),
    verticalDatum: firstField(attributes, ["V_DATUM", "VERT_DATUM"]),
    depth: firstField(attributes, ["DEPTH"]),
    lengthUnit: firstField(attributes, ["LEN_UNIT"]),
    velocity: firstField(attributes, ["VELOCITY"]),
    velocityUnit: firstField(attributes, ["VEL_UNIT"]),
    sourceCitation: firstField(attributes, ["SOURCE_CIT", "SOURCE_CITATION", "DFIRM_ID"]),
    gfid: firstField(attributes, ["FLD_AR_ID", "HYDRO_ID", "DFIRM_ID"]),
  };
  return {
    id: `${SOURCE_LAYER_ID}:${hit.objectId}`,
    hit,
    rings,
    bounds,
  };
}

async function fetchFloodplainFeatures() {
  const metadata = await requestJson(`${SOURCE_LAYER_URL}?f=json`);
  throwIfArcgisError(metadata, "Floodplain metadata");
  const countPayload = await requestJsonPost(SOURCE_LAYER_URL, {
    where: "1=1",
    returnCountOnly: "true",
    f: "json",
  });
  throwIfArcgisError(countPayload, "Floodplain count query");
  const count = Number(countPayload.count || 0);
  const idPayload = await requestJsonPost(SOURCE_LAYER_URL, {
    where: "1=1",
    returnIdsOnly: "true",
    f: "json",
  });
  throwIfArcgisError(idPayload, "Floodplain object ID query");
  const objectIds = (idPayload.objectIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const features = [];
  for (let index = 0; index < objectIds.length; index += OBJECT_ID_BATCH_SIZE) {
    const batch = objectIds.slice(index, index + OBJECT_ID_BATCH_SIZE);
    const payload = await requestJsonPost(SOURCE_LAYER_URL, {
      objectIds: batch.join(","),
      outFields: FLOODPLAIN_KEY_FIELDS.join(","),
      returnGeometry: "true",
      returnTrueCurves: "false",
      outSR: "4326",
      geometryPrecision: "7",
      f: "json",
    });
    throwIfArcgisError(payload, `Floodplain feature batch ${index + 1}-${index + batch.length}`);
    for (const feature of payload.features || []) {
      const normalized = normalizeFeature(metadata, feature);
      if (normalized) features.push(normalized);
    }
    if (!index || index + OBJECT_ID_BATCH_SIZE >= objectIds.length || Math.floor(index / OBJECT_ID_BATCH_SIZE) % 4 === 0) {
      console.log(`Fetched ${Math.min(index + OBJECT_ID_BATCH_SIZE, objectIds.length).toLocaleString()} of ${objectIds.length.toLocaleString()} floodplain features`);
    }
  }
  return {
    metadata,
    count,
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

function packParcelFloodplain(record) {
  const values = PARCEL_FLOODPLAIN_FIELDS.map((field) => record[field] ?? "");
  while (values.length && values[values.length - 1] === "") values.pop();
  return values;
}

function shardKeyForParcel(parcel) {
  const token = cleanValue(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId || parcel.countyParcelId).replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (token.length >= SHARD_KEY_LENGTH) return token.slice(0, SHARD_KEY_LENGTH);
  return "zz";
}

function buildDepthLabel(hit) {
  const depth = cleanValue(hit.depth);
  if (!depth) return "";
  const unit = cleanValue(hit.lengthUnit);
  return unit ? `${depth} ${unit}` : depth;
}

function buildVelocityLabel(hit) {
  const velocity = cleanValue(hit.velocity);
  if (!velocity) return "";
  const unit = cleanValue(hit.velocityUnit);
  return unit ? `${velocity} ${unit}` : velocity;
}

function buildFloodplainSummary(hits) {
  const summary = {
    floodZones: [],
    zoneSubtypes: [],
    sfha: [],
    baseFloodElevations: [],
    verticalDatums: [],
    depths: [],
    velocities: [],
    sourceCitations: [],
  };
  for (const feature of hits) {
    const hit = feature.hit;
    pushUnique(summary.floodZones, hit.floodZone);
    pushUnique(summary.zoneSubtypes, hit.zoneSubtype);
    pushUnique(summary.sfha, hit.sfha || (isSfha(hit.sfha, hit.floodZone) ? "T" : ""));
    pushUnique(summary.baseFloodElevations, hit.staticBfe);
    pushUnique(summary.verticalDatums, hit.verticalDatum);
    pushUnique(summary.depths, buildDepthLabel(hit));
    pushUnique(summary.velocities, buildVelocityLabel(hit));
    pushUnique(summary.sourceCitations, hit.sourceCitation);
  }
  const labelParts = [];
  if (summary.floodZones.length) labelParts.push(`Zone ${summary.floodZones.join(", ")}`);
  if (summary.zoneSubtypes.length) labelParts.push(summary.zoneSubtypes.join(", "));
  if (summary.sfha.some((value) => isSfha(value, summary.floodZones[0]))) labelParts.push("SFHA");
  if (summary.baseFloodElevations.length) labelParts.push(`BFE ${summary.baseFloodElevations.join(", ")}`);
  summary.label = labelParts.join(" | ");
  return summary;
}

function buildParcelFloodplainRecord(parcel, chunkId, hits) {
  const accountNum = cleanValue(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId);
  const sourceCountyId = cleanValue(parcel.sourceCountyId) || SOURCE_COUNTY_ID;
  const countyParcelId = cleanValue(parcel.countyParcelId) || `${sourceCountyId}:${accountNum}`;
  const hitPayloads = hits.map((feature) => feature.hit);
  const summary = buildFloodplainSummary(hits);
  const sourceLayerIds = [...new Set(hitPayloads.map((hit) => hit.sourceLayerId))];
  const searchText = [
    countyParcelId,
    accountNum,
    parcel.gisParcelId,
    parcel.address,
    parcel.propertyAddress,
    summary.label,
    ...summary.floodZones,
    ...summary.zoneSubtypes,
    ...summary.sfha,
    ...summary.baseFloodElevations,
    ...summary.verticalDatums,
    ...summary.depths,
    ...summary.velocities,
    ...summary.sourceCitations,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    countyParcelId,
    accountNum,
    gisParcelId: cleanValue(parcel.gisParcelId),
    parcelChunkId: chunkId,
    ...summary,
    sourceLayerIds,
    sourceLayerHits: hitPayloads.map(packHit),
    searchText,
  };
}

function addRecordToShard(shards, key, record) {
  if (!shards.has(key)) shards.set(key, []);
  shards.get(key).push(packParcelFloodplain(record));
}

function summarizeRecordCounters(counters, record) {
  if (record.floodZones.length) counters.parcelsWithFloodZoneCount += 1;
  if (record.sfha.some((value) => isSfha(value, record.floodZones[0]))) counters.parcelsInSfhaCount += 1;
  if (record.zoneSubtypes.some((value) => cleanValue(value).toLowerCase().includes("floodway"))) counters.parcelsInFloodwayCount += 1;
  counters.sourceHitCount += record.sourceLayerHits.length;
}

function writePublicManifest(index, sourceReport) {
  const manifest = {
    schemaVersion: FLOODPLAIN_MANIFEST_SCHEMA_VERSION,
    recordSchemaVersion: PARCEL_FLOODPLAIN_INDEX_SCHEMA_VERSION,
    sourceCountyId: SOURCE_COUNTY_ID,
    generatedAt: index.generatedAt,
    status: "parcel-index-ready",
    defaultVisible: false,
    renderDirectlyInBrowser: false,
    runtimeReadiness: "parcel-floodplain index is built; parcel-card lookup and the default-off floodplain layer are runtime-safe",
    publicDataRoot: "/data/counties/jefferson-ky/floodplain/",
    maxFeaturesPerViewport: 750,
    parcelIndex: "parcel-floodplain-index.json",
    parcelIndexDirectory: "parcel-index/",
    parcelIndexCount: index.parcelFloodplainRecordCount,
    parcelIndexShards: {
      keyLength: SHARD_KEY_LENGTH,
      fields: PARCEL_FLOODPLAIN_FIELDS,
      sourceHitFields: SOURCE_HIT_FIELDS,
      files: index.files,
      counts: index.counts,
    },
    sourceService: sourceReport,
    sourceLayerCount: 1,
    sourceLayers: [sourceReport],
    parcelIndexSchemaPath: "data/schemas/parcel-floodplain-index.schema.json",
    parcelFloodplainJoin: {
      method: "parcel centroid spatial join",
      stableId: "countyParcelId/accountNum/gisParcelId",
      baseParcelProtection: "County parcel foundation is not overwritten.",
      includedFloodplain: FLOODPLAIN_KEY_FIELDS,
    },
  };
  fs.writeFileSync(floodplainManifestFile, JSON.stringify(manifest, null, 2));
}

function writeSourceManifest(index, sourceReport) {
  const manifest = {
    id: SOURCE_LAYER_ID,
    county_id: SOURCE_COUNTY_ID,
    county_name: "Jefferson County",
    market_name: "Louisville",
    source_name: SOURCE_LAYER_TITLE,
    source_url: SOURCE_LAYER_URL,
    service_type: "ArcGIS REST Feature Layer",
    geometry_type: "polygon",
    source_spatial_reference: "EPSG:2246 / NAD 1983 StatePlane Kentucky North FIPS 1601 Feet",
    output_spatial_reference: "EPSG:4326 / WGS 84",
    status: "parcel-index-ready",
    verified_record_count: sourceReport.featureCount,
    count_verified_at: index.generatedAt,
    fields: FLOODPLAIN_KEY_FIELDS,
    white_rabbit_field_map: {
      floodZone: "FLD_ZONE",
      zoneSubtype: "ZONE_SUBTY / FLOODWAY / PLOTCODE",
      sfha: "SFHA_TF",
      staticBfe: "STATIC_BFE",
      verticalDatum: "V_DATUM",
      depth: "DEPTH",
      velocity: "VELOCITY",
      sourceCitation: "SOURCE_CIT",
      geometry: "SHAPE",
    },
    join_strategy: {
      method: "offline parcel centroid spatial join to current FEMA flood zone polygons",
      parcel_keys: ["countyParcelId", "PARCELID/accountNum", "LRSN/gisParcelId"],
      output_manifest: "public/data/counties/jefferson-ky/floodplain/manifest.json",
      output_index: "public/data/counties/jefferson-ky/floodplain/parcel-floodplain-index.json",
    },
    qa: {
      source_polygon_count: sourceReport.featureCount,
      indexed_polygon_count: sourceReport.indexedFeatureCount,
      parcel_count_scanned: index.parcelCountScanned,
      parcel_floodplain_record_count: index.parcelFloodplainRecordCount,
      parcels_in_sfha: index.parcelsInSfhaCount,
      parcels_in_floodway: index.parcelsInFloodwayCount,
      missing_centroid_count: index.parcelsWithoutCenter,
      page_design_changed: false,
    },
  };
  fs.writeFileSync(sourceManifestFile, JSON.stringify(manifest, null, 2));
}

function writeReport(index, sourceReport) {
  const report = {
    ...index,
    pageDesignChanged: false,
    sourceLayer: sourceReport,
  };
  fs.writeFileSync(outputJsonFile, JSON.stringify(report, null, 2));
  const lines = [
    "# Jefferson County KY Floodplain Source Report",
    "",
    `Generated: ${index.generatedAt}`,
    "",
    "## Safety",
    "",
    "- Page design changed: no",
    "- Base parcel data overwritten: no",
    "- Runtime visibility: default-off",
    "- Join method: parcel centroid spatial join to current FEMA flood zone polygons",
    "",
    "## Source Layer",
    "",
    `- Source: ${SOURCE_LAYER_TITLE}`,
    `- URL: ${SOURCE_LAYER_URL}`,
    `- Source floodplain polygons: ${sourceReport.featureCount}`,
    `- Indexed floodplain polygons: ${sourceReport.indexedFeatureCount}`,
    `- Fields: ${FLOODPLAIN_KEY_FIELDS.join(", ")}`,
    "",
    "## Parcel Index",
    "",
    `- Parcel chunks scanned: ${index.parcelChunkCount}`,
    `- Parcels scanned: ${index.parcelCountScanned}`,
    `- Parcel floodplain records: ${index.parcelFloodplainRecordCount}`,
    `- Parcels in SFHA: ${index.parcelsInSfhaCount}`,
    `- Parcels in floodway: ${index.parcelsInFloodwayCount}`,
    `- Missing centroid count: ${index.parcelsWithoutCenter}`,
    `- Source floodplain hits: ${index.sourceHitCount}`,
    `- Shards: ${index.shardCount}`,
    "",
    "This report is data plumbing only. It does not alter visible White Rabbit pages.",
    "",
  ];
  fs.writeFileSync(outputMdFile, lines.join("\n"));
}

async function main() {
  if (!fs.existsSync(parcelManifestFile)) throw new Error("Missing public/data/counties/jefferson-ky/parcels/manifest.json");
  ensureDir(floodplainDir);
  ensureDir(path.dirname(outputJsonFile));
  ensureCleanDir(parcelIndexDir);

  const sourceResult = await fetchFloodplainFeatures();
  const sourceReport = {
    id: SOURCE_LAYER_ID,
    title: SOURCE_LAYER_TITLE,
    recordType: "floodplain",
    serviceUrl: SOURCE_SERVICE_URL,
    url: SOURCE_LAYER_URL,
    featureCount: sourceResult.count,
    indexedFeatureCount: sourceResult.features.length,
    objectIdField: sourceResult.metadata.objectIdField || "OBJECTID",
    fields: (sourceResult.metadata.fields || []).map((field) => field.name).filter(Boolean),
  };
  console.log(`Fetched ${sourceResult.features.length.toLocaleString()} floodplain polygons from ${SOURCE_LAYER_TITLE}`);
  const spatialIndex = buildSpatialIndex(sourceResult.features);

  const parcelManifest = JSON.parse(fs.readFileSync(parcelManifestFile, "utf8"));
  const shards = new Map();
  const counters = {
    parcelFloodplainRecordCount: 0,
    parcelsWithFloodZoneCount: 0,
    parcelsInSfhaCount: 0,
    parcelsInFloodwayCount: 0,
    sourceHitCount: 0,
    parcelsWithoutCenter: 0,
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
        counters.parcelsWithoutCenter += 1;
        continue;
      }
      const hits = spatialIndex.find(center);
      if (!hits.length) continue;
      const record = buildParcelFloodplainRecord(parcel, chunk.id, hits);
      addRecordToShard(shards, shardKeyForParcel(parcel), record);
      summarizeRecordCounters(counters, record);
      counters.parcelFloodplainRecordCount += 1;
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
        schemaVersion: PARCEL_FLOODPLAIN_INDEX_SCHEMA_VERSION,
        sourceCountyId: SOURCE_COUNTY_ID,
        fields: PARCEL_FLOODPLAIN_FIELDS,
        sourceHitFields: SOURCE_HIT_FIELDS,
        records,
      }),
    );
    files[key] = relativeFile;
    counts[key] = records.length;
  }

  const generatedAt = new Date().toISOString();
  const index = {
    schemaVersion: PARCEL_FLOODPLAIN_INDEX_SCHEMA_VERSION,
    sourceCountyId: SOURCE_COUNTY_ID,
    generatedAt,
    sourceServiceUrl: SOURCE_SERVICE_URL,
    sourceLayerUrl: SOURCE_LAYER_URL,
    sourceFeatureCount: sourceResult.count,
    indexedFeatureCount: sourceResult.features.length,
    shardKeyLength: SHARD_KEY_LENGTH,
    shardCount: Object.keys(files).length,
    fields: PARCEL_FLOODPLAIN_FIELDS,
    sourceHitFields: SOURCE_HIT_FIELDS,
    files,
    counts,
    ...counters,
  };
  fs.writeFileSync(parcelIndexFile, JSON.stringify(index, null, 2));
  writePublicManifest(index, sourceReport);
  writeSourceManifest(index, sourceReport);
  writeReport(index, sourceReport);

  console.log(
    JSON.stringify(
      {
        status: "parcel-index-ready",
        sourceFeatureCount: index.sourceFeatureCount,
        indexedFeatureCount: index.indexedFeatureCount,
        parcelCountScanned: index.parcelCountScanned,
        parcelFloodplainRecordCount: index.parcelFloodplainRecordCount,
        parcelsInSfhaCount: index.parcelsInSfhaCount,
        parcelsInFloodwayCount: index.parcelsInFloodwayCount,
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
