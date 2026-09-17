const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const shapefile = require("shapefile");
const proj4 = require("proj4");

const root = path.join(__dirname, "..");
const adapterPath = path.join(root, "data", "county-adapters", "louisville", "adapter.json");
const sourceManifestPath = path.join(root, "data", "county-adapters", "louisville", "lojic-parcel-source-manifest.json");
const fieldMapPath = path.join(root, "data", "county-adapters", "louisville", "lojic-universal-field-map.json");
const outputDir = path.join(root, "output", "jefferson-ky");
const pvaOwnerAppraisalIndexPath = path.join(outputDir, "jefferson-county-ky-pva-owner-appraisal-index.json");

const adapter = readJson(adapterPath);
const sourceManifest = readJson(sourceManifestPath);
const fieldMap = readJson(fieldMapPath);
const pvaOwnerAppraisalIndex = loadPvaOwnerAppraisalIndex();

const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
const qaOnly = args.has("--qa-only");
const fullBuild = args.has("--full");
const sampleBuild = Number.isFinite(limit) && limit > 0;
const pageSize = Number(process.env.WR_JEFFERSON_KY_PAGE_SIZE || sourceManifest.query.page_size || 2000);
const localCsvPath = adapter.sourceFiles?.parcelAttributesCsv ? path.join(root, adapter.sourceFiles.parcelAttributesCsv) : null;
const localGeoJsonPath = adapter.sourceFiles?.parcelGeometryGeojson ? path.join(root, adapter.sourceFiles.parcelGeometryGeojson) : null;
const shapefileSource = adapter.sourceFiles?.parcelGeometryShp ? {
  shp: path.join(root, adapter.sourceFiles.parcelGeometryShp),
  dbf: path.join(root, adapter.sourceFiles.parcelGeometryDbf),
} : null;
const forceShapefileGeometry = args.has("--shapefile");
const forceLocalGeoJsonGeometry = args.has("--geojson") || args.has("--local-geojson");
const useRestGeometry = args.has("--rest");
const useLocalGeoJsonGeometry = !useRestGeometry && !forceShapefileGeometry && forceLocalGeoJsonGeometry;
const useShapefileGeometry = !useRestGeometry && !useLocalGeoJsonGeometry && (forceShapefileGeometry || (shapefileSource && fs.existsSync(shapefileSource.shp) && fs.existsSync(shapefileSource.dbf)));

proj4.defs(
  "EPSG:2246",
  "+proj=lcc +lat_0=37.5 +lon_0=-84.25 +lat_1=37.9666666666667 +lat_2=38.9666666666667 +x_0=500000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs",
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function compact(value) {
  return String(value ?? "").trim();
}

function firstNonEmpty(...values) {
  return values.map(compact).find(Boolean) || "";
}

function normalizeJoinValue(value) {
  return compact(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function unpackPvaOwnerAppraisalRows(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.map((record) => {
    if (!Array.isArray(record)) return record || {};
    return Object.fromEntries(fields.map((field, index) => [field, record[index] ?? ""]));
  });
}

function loadPvaOwnerAppraisalIndex() {
  const empty = {
    status: "source-needed",
    sourceFile: "",
    records: 0,
    byParcelId: new Map(),
    byLrsn: new Map(),
    byPin: new Map(),
  };
  if (!fs.existsSync(pvaOwnerAppraisalIndexPath)) return empty;
  const payload = readJson(pvaOwnerAppraisalIndexPath);
  const rows = unpackPvaOwnerAppraisalRows(payload);
  const index = {
    status: payload.status || "",
    sourceFile: payload.sourceFile || "",
    records: rows.length,
    byParcelId: new Map(),
    byLrsn: new Map(),
    byPin: new Map(),
  };
  for (const row of rows) {
    const parcelId = normalizeJoinValue(row.parcelId || row.accountNum);
    const lrsn = normalizeJoinValue(row.lrsn || row.gisParcelId);
    const pin = normalizeJoinValue(row.pin);
    if (parcelId && !index.byParcelId.has(parcelId)) index.byParcelId.set(parcelId, row);
    if (lrsn && !index.byLrsn.has(lrsn)) index.byLrsn.set(lrsn, row);
    if (pin && !index.byPin.has(pin)) index.byPin.set(pin, row);
  }
  return index;
}

function pvaOwnerAppraisalForParcel({ parcelId, lrsn, pin }) {
  const parcelIdKey = normalizeJoinValue(parcelId);
  const lrsnKey = normalizeJoinValue(lrsn);
  const pinKey = normalizeJoinValue(pin);
  return (
    (parcelIdKey && pvaOwnerAppraisalIndex.byParcelId.get(parcelIdKey)) ||
    (lrsnKey && pvaOwnerAppraisalIndex.byLrsn.get(lrsnKey)) ||
    (pinKey && pvaOwnerAppraisalIndex.byPin.get(pinKey)) ||
    null
  );
}

function applyPvaOwnerAppraisal(record, pvaRecord) {
  if (!pvaRecord) return record;
  const enriched = {
    ...record,
    address: firstNonEmpty(pvaRecord.address, record.address),
    propertyAddress: firstNonEmpty(pvaRecord.propertyAddress, pvaRecord.address, record.propertyAddress),
    city: firstNonEmpty(pvaRecord.city, record.city),
    propertyZip: firstNonEmpty(pvaRecord.propertyZip, record.propertyZip),
    propertyName: firstNonEmpty(pvaRecord.propertyName, pvaRecord.address, record.propertyName),
    ownerName: firstNonEmpty(pvaRecord.ownerName, record.ownerName),
    ownerName2: firstNonEmpty(pvaRecord.ownerName2, record.ownerName2),
    businessName: firstNonEmpty(pvaRecord.businessName, record.businessName),
    ownerMailingAddress: firstNonEmpty(pvaRecord.ownerMailingAddress, record.ownerMailingAddress),
    ownerMailingAddress2: firstNonEmpty(pvaRecord.ownerMailingAddress2, record.ownerMailingAddress2),
    ownerCity: firstNonEmpty(pvaRecord.ownerCity, record.ownerCity),
    ownerState: firstNonEmpty(pvaRecord.ownerState, record.ownerState),
    ownerZip: firstNonEmpty(pvaRecord.ownerZip, record.ownerZip),
    ownerCountry: firstNonEmpty(pvaRecord.ownerCountry, record.ownerCountry),
    ownerPhone: firstNonEmpty(pvaRecord.ownerPhone, record.ownerPhone),
    ownerEmail: firstNonEmpty(pvaRecord.ownerEmail, record.ownerEmail),
    landValue: firstNonEmpty(pvaRecord.landValue, record.landValue),
    improvementValue: firstNonEmpty(pvaRecord.improvementValue, record.improvementValue),
    totalValue: firstNonEmpty(pvaRecord.totalValue, record.totalValue),
    landAreaSize: firstNonEmpty(pvaRecord.landAreaSize, record.landAreaSize),
    landAreaUnit: firstNonEmpty(pvaRecord.landAreaUnit, record.landAreaUnit),
    landAreaSqFt: firstNonEmpty(pvaRecord.landAreaSqFt, record.landAreaSqFt),
    buildingClass: firstNonEmpty(pvaRecord.buildingClass, record.buildingClass),
    landUseCode: firstNonEmpty(pvaRecord.landUseCode, record.landUseCode),
    landUseDescription: firstNonEmpty(pvaRecord.landUseDescription, record.landUseDescription),
    yearBuilt: firstNonEmpty(pvaRecord.yearBuilt, record.yearBuilt),
    grossBuildingArea: firstNonEmpty(pvaRecord.grossBuildingArea, record.grossBuildingArea),
    quality: firstNonEmpty(pvaRecord.quality, record.quality),
    condition: firstNonEmpty(pvaRecord.condition, record.condition),
  };
  enriched.joins = {
    ...record.joins,
    pvaOwnerAppraisal: true,
    appraisal: Boolean(enriched.totalValue || enriched.landValue || enriched.improvementValue),
    land: Boolean(enriched.landAreaSize || enriched.landAreaSqFt || enriched.landValue),
  };
  enriched.sourceReferences = {
    ...record.sourceReferences,
    pvaOwnerAppraisal: {
      source: "Jefferson County PVA owner/appraisal export",
      sourceFile: pvaOwnerAppraisalIndex.sourceFile,
      sourceRow: pvaRecord.sourceRow || "",
      PARCELID: pvaRecord.parcelId || pvaRecord.accountNum || "",
      LRSN: pvaRecord.lrsn || pvaRecord.gisParcelId || "",
      PIN: pvaRecord.pin || "",
      neighborhood: pvaRecord.neighborhood || "",
      deedBook: pvaRecord.deedBook || "",
      deedPage: pvaRecord.deedPage || "",
    },
  };
  return enriched;
}

function geometrySourceMode() {
  if (useLocalGeoJsonGeometry) return "local-geojson";
  if (useShapefileGeometry) return "local-shapefile-zip";
  return "arcgis-rest-geojson";
}

function geometrySourcePath() {
  if (useLocalGeoJsonGeometry) return path.relative(root, localGeoJsonPath).replace(/\\/g, "/");
  if (useShapefileGeometry) return path.relative(root, shapefileSource.shp).replace(/\\/g, "/");
  return sourceManifest.arcgis_rest_url;
}

function normalizeCsvRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    const cleanKey = key.replace(/^\uFEFF/, "");
    normalized[cleanKey] = value;
  }
  normalized.PARCEL_TYPE = normalized.PARCEL_TYPE ?? normalized.PARCEL_TYP ?? "";
  normalized["SHAPE.AREA"] = normalized["SHAPE.AREA"] ?? normalized.SHAPEAREA ?? "";
  normalized["SHAPE.LEN"] = normalized["SHAPE.LEN"] ?? normalized.SHAPELEN ?? "";
  return normalized;
}

function normalizeProperties(properties) {
  return normalizeCsvRow(properties);
}

function readLocalCsvIdentifierRows() {
  if (!localCsvPath || !fs.existsSync(localCsvPath)) return null;
  const rows = parse(fs.readFileSync(localCsvPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  }).map(normalizeCsvRow);
  return {
    rows,
    sourceMode: "local-csv",
    sourceFile: path.relative(root, localCsvPath).replace(/\\/g, "/"),
  };
}

function arcgisQueryUrl(params) {
  const url = new URL(`${sourceManifest.arcgis_rest_url}/query`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function requestJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`LOJIC request failed ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`LOJIC response was not JSON: ${text.slice(0, 500)}`);
  }
}

async function fetchCount(where) {
  const payload = await requestJson(
    arcgisQueryUrl({
      where,
      returnCountOnly: "true",
      f: "json",
    }),
  );
  return Number(payload.count || 0);
}

async function fetchIdentifierRows(maxRows = Number.POSITIVE_INFINITY) {
  const rows = [];
  let offset = 0;
  while (rows.length < maxRows) {
    const remaining = Number.isFinite(maxRows) ? Math.max(0, maxRows - rows.length) : pageSize;
    const resultRecordCount = Math.min(pageSize, remaining || pageSize);
    const payload = await requestJson(
      arcgisQueryUrl({
        where: sourceManifest.query.primary_where,
        outFields: "OBJECTID,PARCELID,PARCEL_TYPE,LRSN,PIN",
        returnGeometry: "false",
        orderByFields: "OBJECTID",
        resultOffset: String(offset),
        resultRecordCount: String(resultRecordCount),
        f: "json",
      }),
    );
    const features = payload.features || [];
    for (const feature of features) rows.push(feature.attributes || {});
    if (features.length < resultRecordCount || features.length === 0) break;
    offset += features.length;
    if (rows.length % 50000 === 0) console.log(`Read ${rows.length.toLocaleString()} LOJIC parcel identifier rows...`);
  }
  return rows;
}

async function loadIdentifierRows(maxRows = Number.POSITIVE_INFINITY) {
  const localRows = readLocalCsvIdentifierRows();
  if (localRows) {
    const rows = Number.isFinite(maxRows) ? localRows.rows.slice(0, maxRows) : localRows.rows;
    return { ...localRows, rows };
  }
  return {
    rows: await fetchIdentifierRows(maxRows),
    sourceMode: "arcgis-rest",
    sourceFile: sourceManifest.arcgis_rest_url,
  };
}

async function fetchGeoJsonFeatures(maxFeatures = Number.POSITIVE_INFINITY) {
  const features = [];
  let offset = 0;
  while (features.length < maxFeatures) {
    const remaining = Number.isFinite(maxFeatures) ? Math.max(0, maxFeatures - features.length) : pageSize;
    const resultRecordCount = Math.min(pageSize, remaining || pageSize);
    const payload = await requestJson(
      arcgisQueryUrl({
        where: sourceManifest.query.primary_where,
        outFields: sourceManifest.query.out_fields.join(","),
        returnGeometry: "true",
        outSR: String(sourceManifest.query.geometry_out_sr),
        orderByFields: "OBJECTID",
        resultOffset: String(offset),
        resultRecordCount: String(resultRecordCount),
        f: "geojson",
      }),
    );
    const nextFeatures = payload.features || [];
    features.push(...nextFeatures);
    if (nextFeatures.length < resultRecordCount || nextFeatures.length === 0) break;
    offset += nextFeatures.length;
    if (features.length % 25000 === 0) console.log(`Fetched ${features.length.toLocaleString()} LOJIC parcel polygons...`);
  }
  return features;
}

async function streamRestUniversalRecords(onRecord, maxFeatures = Number.POSITIVE_INFINITY) {
  let offset = 0;
  let fetchedCount = 0;
  let emittedCount = 0;
  while (fetchedCount < maxFeatures) {
    const remaining = Number.isFinite(maxFeatures) ? Math.max(0, maxFeatures - fetchedCount) : pageSize;
    const resultRecordCount = Math.min(pageSize, remaining || pageSize);
    const payload = await requestJson(
      arcgisQueryUrl({
        where: sourceManifest.query.primary_where,
        outFields: sourceManifest.query.out_fields.join(","),
        returnGeometry: "true",
        outSR: String(sourceManifest.query.geometry_out_sr),
        orderByFields: "OBJECTID",
        resultOffset: String(offset),
        resultRecordCount: String(resultRecordCount),
        f: "geojson",
      }),
    );
    const features = payload.features || [];
    for (const feature of features) {
      fetchedCount += 1;
      const record = mapFeatureToUniversal(feature);
      if (!record) continue;
      await onRecord(record);
      emittedCount += 1;
    }
    if (features.length < resultRecordCount || features.length === 0) break;
    offset += features.length;
    if (fetchedCount % 25000 === 0) console.log(`Streamed ${fetchedCount.toLocaleString()} LOJIC parcel polygons...`);
  }
  return emittedCount;
}

async function streamGeoJsonFeatureObjects(file, onFeature) {
  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let preamble = "";
  let started = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = "";
  let count = 0;

  async function ingest(text) {
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        current += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }
      if (char === "\"") {
        inString = true;
        current += char;
        continue;
      }
      if (char === "{") {
        depth += 1;
        current += char;
      } else if (char === "}") {
        depth -= 1;
        current += char;
        if (depth === 0 && current) {
          const shouldContinue = await onFeature(JSON.parse(current), count);
          count += 1;
          current = "";
          if (shouldContinue === false) return true;
        }
      } else if (depth > 0) {
        current += char;
      } else if (char === "]") {
        return true;
      }
    }
    return false;
  }

  for await (const chunk of stream) {
    if (!started) {
      preamble += chunk;
      const marker = preamble.indexOf("\"features\"");
      if (marker < 0) {
        preamble = preamble.slice(-64);
        continue;
      }
      const arrayStart = preamble.indexOf("[", marker);
      if (arrayStart < 0) continue;
      started = true;
      if (await ingest(preamble.slice(arrayStart + 1))) return count;
      preamble = "";
      continue;
    }
    if (await ingest(chunk)) return count;
  }
  return count;
}

async function fetchLocalGeoJsonFeatures(maxFeatures = Number.POSITIVE_INFINITY) {
  if (!localGeoJsonPath || !fs.existsSync(localGeoJsonPath)) {
    throw new Error("Missing Jefferson County local GeoJSON source path");
  }
  const features = [];
  await streamGeoJsonFeatureObjects(localGeoJsonPath, async (feature) => {
    const normalizedFeature = {
      ...feature,
      properties: normalizeProperties(feature.properties || {}),
    };
    if (compact(normalizedFeature.properties.PARCEL_TYPE) !== "0") return true;
    features.push(normalizedFeature);
    if (features.length % 25000 === 0) console.log(`Read ${features.length.toLocaleString()} LOJIC local GeoJSON parcel polygons...`);
    return features.length < maxFeatures;
  });
  return features;
}

function transformPosition(position) {
  if (!Array.isArray(position) || position.length < 2) return position;
  const [lng, lat] = proj4("EPSG:2246", "EPSG:4326", [Number(position[0]), Number(position[1])]);
  return [lng, lat];
}

function transformCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") return transformPosition(coordinates);
  return coordinates.map(transformCoordinates);
}

function transformFeatureFromShapefile(feature) {
  return {
    type: "Feature",
    properties: normalizeProperties(feature.properties || {}),
    geometry: feature.geometry ? {
      ...feature.geometry,
      coordinates: transformCoordinates(feature.geometry.coordinates),
    } : null,
  };
}

async function fetchShapefileFeatures(maxFeatures = Number.POSITIVE_INFINITY) {
  if (!shapefileSource || !fs.existsSync(shapefileSource.shp) || !fs.existsSync(shapefileSource.dbf)) {
    throw new Error("Missing Jefferson County shapefile source paths");
  }
  const source = await shapefile.open(shapefileSource.shp, shapefileSource.dbf);
  const features = [];
  while (features.length < maxFeatures) {
    const next = await source.read();
    if (next.done) break;
    const feature = transformFeatureFromShapefile(next.value);
    if (compact(feature.properties.PARCEL_TYPE) !== "0") continue;
    features.push(feature);
    if (features.length % 25000 === 0) console.log(`Read ${features.length.toLocaleString()} LOJIC shapefile parcel polygons...`);
  }
  return features;
}

function duplicateSummary(rows, field) {
  const counts = new Map();
  let missing = 0;
  for (const row of rows) {
    const value = compact(row[field]);
    if (!value) {
      missing += 1;
      continue;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const duplicateGroups = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const duplicateFeatureCount = duplicateGroups.reduce((sum, [, count]) => sum + count, 0);
  return {
    field,
    uniqueCount: counts.size,
    missing,
    duplicateGroupCount: duplicateGroups.length,
    duplicateFeatureCount,
    sampleDuplicateGroups: duplicateGroups.slice(0, 25).map(([value, count]) => ({ value, count })),
  };
}

function flattenRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.filter(Array.isArray);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => (Array.isArray(polygon) ? polygon : []));
  return [];
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(ring) {
  const area = ringArea(ring);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) return null;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function geometryCentroid(geometry) {
  const rings = flattenRings(geometry).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  if (!rings.length) return null;
  const sorted = [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const centroid = ringCentroid(sorted[0]);
  if (centroid) return centroid;
  const points = sorted[0];
  const bounds = points.reduce(
    (acc, [lng, lat]) => ({
      minLng: Math.min(acc.minLng, lng),
      minLat: Math.min(acc.minLat, lat),
      maxLng: Math.max(acc.maxLng, lng),
      maxLat: Math.max(acc.maxLat, lat),
    }),
    { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
  );
  return [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function toScreenPoint([lng, lat]) {
  const bounds = adapter.map.geoBounds;
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
  return [Number(Math.min(100, Math.max(0, x)).toFixed(4)), Number(Math.min(100, Math.max(0, y)).toFixed(4))];
}

function simplifyRing(ring, maxPoints = 40) {
  if (!Array.isArray(ring)) return [];
  if (ring.length <= maxPoints) return ring;
  const stride = Math.ceil(ring.length / maxPoints);
  const simplified = [];
  for (let index = 0; index < ring.length; index += stride) simplified.push(ring[index]);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) simplified.push(first);
  return simplified;
}

function primaryRing(geometry) {
  const rings = flattenRings(geometry).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  return [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0] || [];
}

function mapFeatureToUniversal(feature) {
  const properties = normalizeProperties(feature.properties || {});
  const lrsn = compact(properties.LRSN);
  const parcelId = compact(properties.PARCELID);
  const parcelType = compact(properties.PARCEL_TYPE);
  const pin = compact(properties.PIN);
  const centroidLngLat = geometryCentroid(feature.geometry);
  if (!lrsn || !centroidLngLat || !feature.geometry) return null;
  const accountNum = parcelId || lrsn;
  const ring = simplifyRing(primaryRing(feature.geometry), 40);
  const sourceArea = properties["SHAPE.AREA"] ?? properties.SHAPE_AREA ?? "";
  const sourceLength = properties["SHAPE.LEN"] ?? properties.SHAPE_LEN ?? "";
  const record = {
    schemaVersion: fieldMap.schema_version,
    sourceCountyId: adapter.id,
    countyParcelId: `${adapter.id}:${lrsn}`,
    sourceParcelId: parcelId,
    accountNum,
    accountNumber: accountNum,
    gisParcelId: lrsn,
    address: "",
    propertyAddress: "",
    city: "Louisville",
    propertyZip: "",
    propertyName: `LOJIC Parcel ${parcelId || lrsn}`,
    ownerName: "",
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: "",
    ownerMailingAddress2: "",
    ownerCity: "",
    ownerState: "",
    ownerZip: "",
    ownerPhone: "",
    ownerEmail: "",
    landAreaSqFt: sourceArea,
    areaLabel: sourceArea ? `${sourceArea} source square feet` : "",
    perimeter: sourceLength,
    centroid: toScreenPoint(centroidLngLat),
    points: ring.map(toScreenPoint),
    liveGeometry: {
      center: centroidLngLat.map((value) => Number(value.toFixed(7))),
      points: ring.map(([lng, lat]) => [Number(lng.toFixed(7)), Number(lat.toFixed(7))]),
    },
    realGeometry: {
      type: "Feature",
      properties: {
        countyParcelId: `${adapter.id}:${lrsn}`,
        accountNum,
        gisParcelId: lrsn,
      },
      geometry: feature.geometry,
    },
    joins: {
      pvaOwnerAppraisal: false,
    },
    sourceReferences: {
      lojic: {
        OBJECTID: properties.OBJECTID ?? "",
        LRSN: lrsn,
        PARCELID: parcelId,
        PARCEL_TYPE: parcelType,
        PIN: pin,
        SHAPE_AREA: sourceArea,
        SHAPE_LEN: sourceLength,
        sourceSpatialReference: sourceManifest.source_spatial_reference.label,
        geometrySourceMode: geometrySourceMode(),
      },
    },
  };
  return applyPvaOwnerAppraisal(record, pvaOwnerAppraisalForParcel({ parcelId, lrsn, pin }));
}

function geometryBuildMetadata(buildMode, recordCount, generatedAt) {
  return {
    generatedAt,
    county_id: adapter.id,
    source: sourceManifest.gis_source,
    sourceUrl: sourceManifest.arcgis_rest_url,
    sourceSpatialReference: sourceManifest.source_spatial_reference.label,
    geometrySourceMode: geometrySourceMode(),
    geometrySourcePath: geometrySourcePath(),
    uniqueGisKey: adapter.uniqueGisKey,
    parcelIdField: adapter.parcelIdField,
    recordCount,
    buildMode,
    propertyGeometryStorage: "feature.geometry",
  };
}

function geoJsonFeatureForRecord(record) {
  const { realGeometry, ...properties } = record;
  return {
    type: "Feature",
    properties,
    geometry: realGeometry.geometry,
  };
}

function writeGeoJsonFeatureCollection(outputFile, records, metadataBase) {
  writeJson(outputFile, {
    type: "FeatureCollection",
    features: records.map(geoJsonFeatureForRecord),
    metadata: geometryBuildMetadata(metadataBase.buildMode, records.length, metadataBase.generatedAt),
  });
}

function openGeoJsonFeatureCollectionWriter(outputFile, metadataBase) {
  ensureDir(path.dirname(outputFile));
  const fd = fs.openSync(outputFile, "w");
  let count = 0;
  let closed = false;
  fs.writeSync(fd, '{"type":"FeatureCollection","features":[');
  return {
    write(record) {
      fs.writeSync(fd, `${count ? "," : ""}${JSON.stringify(geoJsonFeatureForRecord(record))}`);
      count += 1;
    },
    close() {
      if (closed) return count;
      fs.writeSync(fd, `],"metadata":${JSON.stringify(geometryBuildMetadata(metadataBase.buildMode, count, metadataBase.generatedAt))}}\n`);
      fs.closeSync(fd);
      closed = true;
      return count;
    },
    abort() {
      if (closed) return;
      fs.closeSync(fd);
      closed = true;
    },
  };
}

async function streamShapefileUniversalRecords(onRecord, maxFeatures = Number.POSITIVE_INFINITY) {
  if (!shapefileSource || !fs.existsSync(shapefileSource.shp) || !fs.existsSync(shapefileSource.dbf)) {
    throw new Error("Missing Jefferson County shapefile source paths");
  }
  const source = await shapefile.open(shapefileSource.shp, shapefileSource.dbf);
  let recordCount = 0;
  while (recordCount < maxFeatures) {
    const next = await source.read();
    if (next.done) break;
    const feature = transformFeatureFromShapefile(next.value);
    if (compact(feature.properties.PARCEL_TYPE) !== "0") continue;
    const record = mapFeatureToUniversal(feature);
    if (!record) continue;
    await onRecord(record, recordCount);
    recordCount += 1;
    if (recordCount % 25000 === 0) console.log(`Streamed ${recordCount.toLocaleString()} LOJIC shapefile parcel records...`);
  }
  return recordCount;
}

async function streamLocalGeoJsonUniversalRecords(onRecord, maxFeatures = Number.POSITIVE_INFINITY) {
  if (!localGeoJsonPath || !fs.existsSync(localGeoJsonPath)) {
    throw new Error("Missing Jefferson County local GeoJSON source path");
  }
  let recordCount = 0;
  await streamGeoJsonFeatureObjects(localGeoJsonPath, async (feature) => {
    const normalizedFeature = {
      ...feature,
      properties: normalizeProperties(feature.properties || {}),
    };
    if (compact(normalizedFeature.properties.PARCEL_TYPE) !== "0") return true;
    const record = mapFeatureToUniversal(normalizedFeature);
    if (!record) return true;
    await onRecord(record, recordCount);
    recordCount += 1;
    if (recordCount % 25000 === 0) console.log(`Streamed ${recordCount.toLocaleString()} LOJIC local GeoJSON parcel records...`);
    return recordCount < maxFeatures;
  });
  return recordCount;
}

function searchRecordFor(record) {
  return {
    countyParcelId: record.countyParcelId,
    sourceCountyId: record.sourceCountyId,
    accountNum: record.accountNum,
    parcelId: record.sourceParcelId,
    gisParcelId: record.gisParcelId,
    lrsn: record.gisParcelId,
    searchText: [record.accountNum, record.gisParcelId, record.countyParcelId, record.propertyName].filter(Boolean).join(" "),
    centroid: record.centroid,
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function openSearchOutputWriters(sampleSuffix = "", generatedAt = new Date().toISOString()) {
  const jsonFile = path.join(outputDir, `jefferson-county-ky-parcel-search-index${sampleSuffix}.json`);
  const csvFile = path.join(outputDir, `jefferson-county-ky-parcel-search-index${sampleSuffix}.csv`);
  const headers = ["countyParcelId", "PARCELID", "LRSN", "searchText", "centroidX", "centroidY"];
  const jsonFd = fs.openSync(jsonFile, "w");
  const csvFd = fs.openSync(csvFile, "w");
  let count = 0;
  let closed = false;
  fs.writeSync(
    jsonFd,
    `{"generatedAt":${JSON.stringify(generatedAt)},"county_id":${JSON.stringify(adapter.id)},"searchFields":${JSON.stringify(["PARCELID", "LRSN", "countyParcelId"])},"parcels":[`,
  );
  fs.writeSync(csvFd, `${headers.join(",")}\n`);
  return {
    write(record) {
      const searchRecord = searchRecordFor(record);
      fs.writeSync(jsonFd, `${count ? "," : ""}${JSON.stringify(searchRecord)}`);
      fs.writeSync(
        csvFd,
        `${[
          searchRecord.countyParcelId,
          searchRecord.parcelId,
          searchRecord.lrsn,
          searchRecord.searchText,
          searchRecord.centroid?.[0] ?? "",
          searchRecord.centroid?.[1] ?? "",
        ]
          .map(csvEscape)
          .join(",")}\n`,
      );
      count += 1;
    },
    close() {
      if (closed) return { jsonFile, csvFile, searchRecordCount: count };
      fs.writeSync(jsonFd, `],"searchRecordCount":${count}}\n`);
      fs.closeSync(jsonFd);
      fs.closeSync(csvFd);
      closed = true;
      return { jsonFile, csvFile, searchRecordCount: count };
    },
    abort() {
      if (closed) return;
      fs.closeSync(jsonFd);
      fs.closeSync(csvFd);
      closed = true;
    },
  };
}

function writeSearchOutputs(records, sampleSuffix = "", generatedAt = new Date().toISOString()) {
  const writers = openSearchOutputWriters(sampleSuffix, generatedAt);
  for (const record of records) writers.write(record);
  return writers.close();
}

function writeIdentifierSearchOutputs(identifierRows) {
  const parcelRows = identifierRows.filter((row) => compact(row.PARCEL_TYPE) === "0");
  const searchRecords = parcelRows.map((row) => {
    const lrsn = compact(row.LRSN);
    const parcelId = compact(row.PARCELID);
    return {
      countyParcelId: lrsn ? `${adapter.id}:${lrsn}` : "",
      sourceCountyId: adapter.id,
      accountNum: parcelId,
      parcelId,
      gisParcelId: lrsn,
      lrsn,
      parcelType: compact(row.PARCEL_TYPE),
      shapeArea: row["SHAPE.AREA"] ?? "",
      shapeLength: row["SHAPE.LEN"] ?? "",
      searchText: [parcelId, lrsn, lrsn ? `${adapter.id}:${lrsn}` : ""].filter(Boolean).join(" "),
      centroid: null,
    };
  });
  const jsonFile = path.join(outputDir, "jefferson-county-ky-parcel-search-index.json");
  const csvFile = path.join(outputDir, "jefferson-county-ky-parcel-search-index.csv");
  const fields = ["countyParcelId", "sourceCountyId", "accountNum", "parcelId", "gisParcelId", "lrsn", "parcelType", "shapeArea", "shapeLength", "searchText", "centroid"];
  fs.writeFileSync(jsonFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    county_id: adapter.id,
    source: localCsvPath && fs.existsSync(localCsvPath) ? path.relative(root, localCsvPath).replace(/\\/g, "/") : sourceManifest.arcgis_rest_url,
    fields,
    searchFields: ["PARCELID", "LRSN", "countyParcelId"],
    geometryStatus: "identifier-only search export; centroids are generated by the GeoJSON geometry build",
    parcels: searchRecords.map((record) => fields.map((field) => record[field] ?? "")),
  }));
  const headers = ["countyParcelId", "PARCELID", "LRSN", "PARCEL_TYPE", "SHAPEAREA", "SHAPELEN", "searchText"];
  const lines = [
    headers.join(","),
    ...searchRecords.map((record) =>
      [
        record.countyParcelId,
        record.parcelId,
        record.lrsn,
        record.parcelType,
        record.shapeArea,
        record.shapeLength,
        record.searchText,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  fs.writeFileSync(csvFile, lines.join("\n"));
  return { jsonFile, csvFile, searchRecordCount: searchRecords.length };
}

function writeQaReport(report) {
  const jsonFile = path.join(outputDir, "qa-report.json");
  const mdFile = path.join(outputDir, "qa-report.md");
  writeJson(jsonFile, report);
  const lines = [
    "# Jefferson County KY / Louisville LOJIC QA Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Counts",
    "",
    `- Parcel count, PARCEL_TYPE = 0: ${report.counts.parcelCount}`,
    `- Missing geometry: ${report.counts.missingGeometry}`,
    `- Identifier rows scanned: ${report.counts.identifierRowsScanned}`,
    `- Identifier source mode: ${report.identifier_source_mode}`,
    `- Identifier source file: ${report.identifier_source_file}`,
    `- Local CSV rows: ${report.counts.localCsvTotalRows ?? "n/a"}`,
    `- Local CSV PARCEL_TYPE = 0 rows: ${report.counts.localCsvParcelType0Rows ?? "n/a"}`,
    `- Local CSV parcel delta vs current REST count: ${report.counts.localCsvParcelDeltaVsRest ?? "n/a"}`,
    `- Local GeoJSON features: ${report.counts.localGeoJsonTotalFeatures ?? "n/a"}`,
    `- Local GeoJSON PARCEL_TYPE = 0 features: ${report.counts.localGeoJsonParcelType0Features ?? "n/a"}`,
    `- Local GeoJSON exportable polygon features: ${report.counts.localGeoJsonExportablePolygonFeatures ?? "n/a"}`,
    `- Local GeoJSON invalid polygon ring features: ${report.counts.localGeoJsonInvalidPolygonRingFeatures ?? "n/a"}`,
    `- Local KML placemarks: ${report.counts.localKmlTotalPlacemarks ?? "n/a"}`,
    `- Local KML PARCEL_TYPE = 0 placemarks: ${report.counts.localKmlParcelType0Placemarks ?? "n/a"}`,
    `- Local KML exportable polygon placemarks: ${report.counts.localKmlExportablePolygonPlacemarks ?? "n/a"}`,
    `- Local KML invalid polygon ring placemarks: ${report.counts.localKmlInvalidPolygonRingPlacemarks ?? "n/a"}`,
    `- Local shapefile rows: ${report.counts.localShapefileTotalRows ?? "n/a"}`,
    `- Local shapefile PARCEL_TYPE = 0 rows: ${report.counts.localShapefileParcelType0Rows ?? "n/a"}`,
    `- Local shapefile exportable polygon rows: ${report.counts.localShapefileExportablePolygonRows ?? "n/a"}`,
    `- Local shapefile invalid polygon ring rows: ${report.counts.localShapefileInvalidPolygonRingRows ?? "n/a"}`,
    "",
    "## Duplicate Keys",
    "",
    `- Duplicate LRSN groups: ${report.duplicates.LRSN.duplicateGroupCount}`,
    `- Duplicate LRSN feature memberships: ${report.duplicates.LRSN.duplicateFeatureCount}`,
    `- Duplicate PARCELID groups: ${report.duplicates.PARCELID.duplicateGroupCount}`,
    `- Duplicate PARCELID feature memberships: ${report.duplicates.PARCELID.duplicateFeatureCount}`,
    "",
    "## Notes",
    "",
    `- Identifier search JSON: ${report.searchOutputs.json}`,
    `- Identifier search CSV: ${report.searchOutputs.csv}`,
    "- LRSN is used as the unique GIS parcel identifier, but duplicate groups are reported so the PVA join hook can handle source exceptions deliberately.",
    "- PARCELID is the parcel identification number and search key.",
    "- The local GeoJSON has WGS84 parcel coordinates and matches the LOJIC parcel foundation counts.",
    "- The local KML has WGS84 parcel coordinates and matching parcel ID counts; it is recorded as source intel, not the preferred production export format.",
    "- The local shapefile has one invalid polygon ring (OBJECTID 631976 / LRSN 8201759) that is excluded from GeoJSON export instead of forcing malformed geometry.",
    "- The public LOJIC GIS layer is not treated as owner phone/email or full assessment data.",
    `- Jefferson County PVA owner/appraisal index status: ${report.ownerAppraisalIndex.status}; records: ${report.ownerAppraisalIndex.records}.`,
  ];
  fs.writeFileSync(mdFile, `${lines.join("\n")}\n`);
  return { jsonFile, mdFile };
}

async function buildQaReport() {
  ensureDir(outputDir);
  const identifierSource = await loadIdentifierRows();
  const localParcelRows = identifierSource.rows.filter((row) => compact(row.PARCEL_TYPE) === "0");
  const restCounts = await Promise.all([
    fetchCount(sourceManifest.query.primary_where).catch(() => null),
    fetchCount("1=1").catch(() => null),
    fetchCount(`${sourceManifest.query.primary_where} AND SHAPE IS NULL`).catch(() => null),
  ]);
  const [parcelCount, allFeatureCount, missingGeometry] = restCounts;
  const duplicateRows = localParcelRows.length ? localParcelRows : identifierSource.rows;
  const identifierSearchOutputs = writeIdentifierSearchOutputs(identifierSource.rows);
  const report = {
    generatedAt: new Date().toISOString(),
    county_id: adapter.id,
    county_name: adapter.countyName,
    market_name: adapter.marketName,
    cad_name: adapter.cadName,
    gis_source: adapter.gisSource,
    source_url: sourceManifest.arcgis_rest_url,
    identifier_source_mode: identifierSource.sourceMode,
    identifier_source_file: identifierSource.sourceFile,
    source_spatial_reference: sourceManifest.source_spatial_reference.label,
    geometry_type: adapter.geometryType,
    unique_gis_key: adapter.uniqueGisKey,
    parcel_id_field: adapter.parcelIdField,
    counts: {
      allLayerFeatures: allFeatureCount ?? identifierSource.rows.length,
      parcelCount: parcelCount ?? localParcelRows.length,
      missingGeometry,
      identifierRowsScanned: duplicateRows.length,
      localCsvTotalRows: identifierSource.sourceMode === "local-csv" ? identifierSource.rows.length : null,
      localCsvParcelType0Rows: identifierSource.sourceMode === "local-csv" ? localParcelRows.length : null,
      localCsvParcelDeltaVsRest: identifierSource.sourceMode === "local-csv" && parcelCount !== null ? localParcelRows.length - parcelCount : null,
      localGeoJsonTotalFeatures: sourceManifest.local_geojson_snapshot?.total_features ?? null,
      localGeoJsonParcelType0Features: sourceManifest.local_geojson_snapshot?.parcel_type_0_features ?? null,
      localGeoJsonExportablePolygonFeatures: sourceManifest.local_geojson_snapshot?.exportable_parcel_polygon_features ?? null,
      localGeoJsonInvalidPolygonRingFeatures: sourceManifest.local_geojson_snapshot?.invalid_polygon_ring_features ?? null,
      localKmlTotalPlacemarks: sourceManifest.local_kml_snapshot?.total_placemarks ?? null,
      localKmlParcelType0Placemarks: sourceManifest.local_kml_snapshot?.parcel_type_0_placemarks ?? null,
      localKmlExportablePolygonPlacemarks: sourceManifest.local_kml_snapshot?.exportable_parcel_polygon_placemarks ?? null,
      localKmlInvalidPolygonRingPlacemarks: sourceManifest.local_kml_snapshot?.invalid_polygon_ring_placemarks ?? null,
      localShapefileTotalRows: sourceManifest.local_shapefile_snapshot?.record_count ?? null,
      localShapefileParcelType0Rows: sourceManifest.local_shapefile_snapshot?.parcel_type_0_records ?? null,
      localShapefileExportablePolygonRows: sourceManifest.local_shapefile_snapshot?.exportable_parcel_polygon_records ?? null,
      localShapefileInvalidPolygonRingRows: sourceManifest.local_shapefile_snapshot?.invalid_polygon_ring_records ?? null,
    },
    duplicates: {
      LRSN: duplicateSummary(duplicateRows, "LRSN"),
      PARCELID: duplicateSummary(duplicateRows, "PARCELID"),
    },
    searchOutputs: {
      json: path.relative(root, identifierSearchOutputs.jsonFile).replace(/\\/g, "/"),
      csv: path.relative(root, identifierSearchOutputs.csvFile).replace(/\\/g, "/"),
      searchRecordCount: identifierSearchOutputs.searchRecordCount,
    },
    ownerAppraisalHook: fieldMap.owner_appraisal_placeholder_hook,
    ownerAppraisalIndex: {
      status: pvaOwnerAppraisalIndex.status,
      sourceFile: pvaOwnerAppraisalIndex.sourceFile,
      records: pvaOwnerAppraisalIndex.records,
      joinKeys: ["PARCELID", "LRSN", "PIN"],
    },
  };
  return writeQaReport(report);
}

async function buildGeometryOutputs() {
  if (!fullBuild && !sampleBuild) return null;
  ensureDir(outputDir);
  const maxFeatures = fullBuild ? Number.POSITIVE_INFINITY : limit;
  const sampleSuffix = fullBuild ? "" : "-sample";
  const outputFile = path.join(outputDir, `jefferson-county-ky-parcels${sampleSuffix}.geojson`);
  const generatedAt = new Date().toISOString();
  const metadataBase = { generatedAt, buildMode: fullBuild ? "full" : "sample" };

  if (fullBuild && (useRestGeometry || useShapefileGeometry || useLocalGeoJsonGeometry)) {
    const geoJsonWriter = openGeoJsonFeatureCollectionWriter(outputFile, metadataBase);
    const searchWriters = openSearchOutputWriters(sampleSuffix, generatedAt);
    try {
      const streamRecords = useRestGeometry
        ? streamRestUniversalRecords
        : useLocalGeoJsonGeometry
          ? streamLocalGeoJsonUniversalRecords
          : streamShapefileUniversalRecords;
      const recordCount = await streamRecords((record) => {
        geoJsonWriter.write(record);
        searchWriters.write(record);
      }, maxFeatures);
      geoJsonWriter.close();
      const searchOutputs = searchWriters.close();
      return { outputFile, records: recordCount, ...searchOutputs };
    } catch (error) {
      geoJsonWriter.abort();
      searchWriters.abort();
      throw error;
    }
  }

  const features = useLocalGeoJsonGeometry ? await fetchLocalGeoJsonFeatures(maxFeatures) : useShapefileGeometry ? await fetchShapefileFeatures(maxFeatures) : await fetchGeoJsonFeatures(maxFeatures);
  const records = features.map(mapFeatureToUniversal).filter(Boolean);
  writeGeoJsonFeatureCollection(outputFile, records, metadataBase);
  const searchOutputs = writeSearchOutputs(records, sampleSuffix, generatedAt);
  return { outputFile, records: records.length, ...searchOutputs };
}

async function main() {
  if (adapter.id !== "jefferson-ky") throw new Error("Louisville adapter must use county_id jefferson-ky");
  console.log("Building Jefferson County KY / Louisville LOJIC parcel plumbing...");
  const qaOutputs = await buildQaReport();
  console.log(`Wrote ${path.relative(root, qaOutputs.jsonFile)}`);
  console.log(`Wrote ${path.relative(root, qaOutputs.mdFile)}`);
  const geometryOutputs = await buildGeometryOutputs();
  if (geometryOutputs) {
    console.log(`Wrote ${path.relative(root, geometryOutputs.outputFile)}`);
    console.log(`Search records: ${geometryOutputs.searchRecordCount}`);
  } else if (!qaOnly) {
    console.log("Geometry build skipped. Pass --limit=<n> for a sample or --full for the full LOJIC parcel build.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
