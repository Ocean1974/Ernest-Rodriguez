const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const GRID_SIZE = 48;
const SEARCH_SHARD_KEY_LENGTH = 2;
const FULL_BUILD_SEARCH_SHARD_RECORD_LIMIT = 50000;
const FULL_BUILD_ESTIMATED_BYTES_PER_FEATURE = 8500;
const FULL_BUILD_FREE_SPACE_RESERVE_BYTES = 1024 ** 3;
const SEARCH_INDEX_FIELDS = [
  "schemaVersion",
  "sourceCountyId",
  "countyParcelId",
  "accountNum",
  "accountNumber",
  "sourceParcelId",
  "gisParcelId",
  "displayParcelId",
  "address",
  "ownerName",
  "propertyName",
  "ownerName2",
  "businessName",
  "blockId",
  "zoning",
  "landUseCode",
  "landUseDescription",
  "totalValue",
  "chunkId",
  "centroid",
];
const FULL_BUILD_COMMON_SEARCH_TOKENS = new Set([
  "appraisal",
  "assessor",
  "ave",
  "avenue",
  "az",
  "co",
  "county",
  "department",
  "dr",
  "drive",
  "harris",
  "inc",
  "king",
  "llc",
  "maricopa",
  "parcel",
  "parcels",
  "phoenix",
  "property",
  "properties",
  "rd",
  "road",
  "seattle",
  "austin",
  "travis",
  "tcad",
  "st",
  "street",
  "the",
  "trust",
  "tx",
  "wa",
]);

const COUNTY_CONFIGS = {
  "tarrant-county-tad": {
    adapterPath: "data/county-adapters/tarrant/adapter.json",
    sourceManifestPath: "data/county-adapters/tarrant/tarrant-county-tad-source-manifest.json",
    localSamplePath: "output/tarrant/tarrant-county-tad-parcel-sample.geojson",
    outputDir: "output/tarrant",
    reportTitle: "Tarrant County TX / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.official_sources.parcel_map_service,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 10000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapTarrantFeature,
    streamFull: true,
  },
  "collin-county-tx": {
    adapterPath: "data/county-adapters/collin-county-tx/adapter.json",
    sourceManifestPath: "data/county-adapters/collin-county-tx/collin-county-tx-source-manifest.json",
    localSamplePath: "output/collin-county-tx/collin-county-tx-parcel-sample.geojson",
    reportTitle: "Collin County TX / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.official_sources.parcel_feature_service,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 2000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapCollinFeature,
    streamFull: true,
  },
  "denton-county-tx": {
    adapterPath: "data/county-adapters/denton-county-tx/adapter.json",
    sourceManifestPath: "data/county-adapters/denton-county-tx/denton-county-tx-source-manifest.json",
    localSamplePath: "output/denton-county-tx/denton-county-tx-parcel-sample.geojson",
    reportTitle: "Denton County TX / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.official_sources.parcels_appraisal_map_layer,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 2000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapDentonFeature,
    streamFull: true,
  },
  "travis-county-tx": {
    adapterPath: "data/county-adapters/travis-county-tx/adapter.json",
    sourceManifestPath: "data/county-adapters/travis-county-tx/travis-county-tx-source-manifest.json",
    localSamplePath: "output/travis-county-tx/travis-county-tx-parcel-sample.geojson",
    outputDir: "output/travis-county-tx",
    reportTitle: "Travis County TX / Austin Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.official_sources.parcel_map_service,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 1000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapTravisFeature,
    streamFull: true,
  },
  "maricopa-county-az": {
    adapterPath: "data/county-adapters/maricopa-county-az/adapter.json",
    sourceManifestPath: "data/county-adapters/maricopa-county-az/maricopa-county-parcel-source-manifest.json",
    localSamplePath: "output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson",
    reportTitle: "Maricopa County AZ / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.all_layer_features,
    sourceUrl: (sourceManifest) => sourceManifest.arcgis_rest_url,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 2000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapMaricopaFeature,
  },
  "king-county-wa": {
    adapterPath: "data/county-adapters/king-county-wa/adapter.json",
    sourceManifestPath: "data/county-adapters/king-county-wa/king-county-parcel-source-manifest.json",
    localSamplePath: "output/king-county-wa/king-county-wa-parcel-sample.geojson",
    reportTitle: "King County WA / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.query.sample_rest_url,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 1000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapKingFeature,
  },
  "fort-bend-county-tx": {
    adapterPath: "data/county-adapters/fort-bend-county-tx/adapter.json",
    sourceManifestPath: "data/county-adapters/fort-bend-county-tx/fort-bend-county-tx-source-manifest.json",
    localSamplePath: "output/fort-bend-county-tx/fort-bend-county-tx-parcel-sample.geojson",
    reportTitle: "Fort Bend County TX / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.official_sources.parcel_feature_service,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 2000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapFortBendFeature,
    streamFull: true,
  },
  "bexar-county-tx": {
    adapterPath: "data/county-adapters/bexar-county-tx/adapter.json",
    sourceManifestPath: "data/county-adapters/bexar-county-tx/bexar-county-tx-source-manifest.json",
    localSamplePath: "output/bexar-county-tx/bexar-county-tx-parcel-sample.geojson",
    reportTitle: "Bexar County TX / Parcel Service Report",
    sourceVerifiedCount: (sourceManifest) => sourceManifest.verified_counts.parcel_geometry_features,
    sourceUrl: (sourceManifest) => sourceManifest.official_sources.parcel_map_service,
    orderBy: (sourceManifest) => sourceManifest.query.order_by || "OBJECTID",
    pageSize: (sourceManifest) => sourceManifest.query.max_record_count || 1000,
    outFields: (sourceManifest) => sourceManifest.query.out_fields,
    mapRemoteFeature: mapBexarFeature,
    streamFull: true,
  },
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureCleanDir(dir) {
  ensureDir(dir);
  for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
}

function directorySize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? directorySize(file) : fs.statSync(file).size;
  }
  return bytes;
}

function ensureFullBuildCapacity(countyId, config, adapter, sourceManifest) {
  if (typeof fs.statfsSync !== "function") return;
  const stats = fs.statfsSync(root);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const serviceDir = serviceDirFor(adapter, countyId);
  const reclaimableBytes = directorySize(serviceDir);
  const sourceCount = config.sourceVerifiedCount(sourceManifest);
  const estimatedBuildBytes = sourceCount * FULL_BUILD_ESTIMATED_BYTES_PER_FEATURE;
  const requiredBytes = estimatedBuildBytes + FULL_BUILD_FREE_SPACE_RESERVE_BYTES;
  if (freeBytes + reclaimableBytes < requiredBytes) {
    const gb = (value) => (value / 1024 ** 3).toFixed(2);
    throw new Error(
      `${countyId} full build blocked by storage preflight: ${gb(freeBytes)} GB free + ${gb(reclaimableBytes)} GB reclaimable, ` +
      `${gb(requiredBytes)} GB required including reserve. Add storage or migrate to compact parcel/search artifacts before retrying.`,
    );
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value));
}

function writePrettyJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value);
}

function compact(value) {
  return String(value ?? "").trim();
}

function firstNonEmpty(...values) {
  return values.map(compact).find(Boolean) || "";
}

function normalizeSearchToken(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function addShardKey(keys, value, options = {}) {
  const token = normalizeSearchToken(value);
  if (!options.allowShort && token.length < 3) return;
  if (token.length < SEARCH_SHARD_KEY_LENGTH) return;
  keys.add(token.slice(0, SEARCH_SHARD_KEY_LENGTH));
}

function sameText(a, b) {
  return compact(a).toLowerCase() === compact(b).toLowerCase();
}

function addSearchField(output, key, value) {
  if (value === null || value === undefined || value === "") return;
  output[key] = value;
}

function arcgisQueryUrl(baseUrl, params) {
  const url = new URL(`${baseUrl}/query`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url);
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`County parcel service response was not JSON: ${text.slice(0, 500)}`);
      }
    }
    lastError = new Error(`County parcel service request failed ${response.status}: ${text.slice(0, 500)}`);
    const retryable = response.status === 400 || response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts) break;
    await wait(attempt * 2500);
  }
  throw lastError;
}

async function fetchGeoJsonPage(config, sourceManifest, offset, count) {
  const payload = await requestJson(
    arcgisQueryUrl(config.sourceUrl(sourceManifest), {
      where: sourceManifest.query.primary_where,
      outFields: config.outFields(sourceManifest).join(","),
      returnGeometry: "true",
      outSR: String(sourceManifest.query.geometry_out_sr),
      orderByFields: config.orderBy(sourceManifest),
      resultOffset: String(offset),
      resultRecordCount: String(count),
      f: "geojson",
    }),
  );
  return Array.isArray(payload.features) ? payload.features : [];
}

function flattenCoordinates(coordinates, output = []) {
  if (!Array.isArray(coordinates)) return output;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    output.push([coordinates[0], coordinates[1]]);
    return output;
  }
  coordinates.forEach((child) => flattenCoordinates(child, output));
  return output;
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

function largestRing(geometry) {
  const rings = flattenRings(geometry).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  if (!rings.length) return [];
  return [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
}

function simplifyRing(points, maxPoints = 48) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
  const stride = Math.ceil(points.length / maxPoints);
  const simplified = [];
  for (let index = 0; index < points.length; index += stride) simplified.push(points[index]);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) simplified.push(first);
  return simplified;
}

function geometryBounds(geometry) {
  const points = flattenCoordinates(geometry?.coordinates);
  if (!points.length) return null;
  const bounds = points.reduce(
    (acc, [lng, lat]) => ({
      minLng: Math.min(acc.minLng, lng),
      minLat: Math.min(acc.minLat, lat),
      maxLng: Math.max(acc.maxLng, lng),
      maxLat: Math.max(acc.maxLat, lat),
    }),
    { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
  );
  return {
    ...bounds,
    centerLng: (bounds.minLng + bounds.maxLng) / 2,
    centerLat: (bounds.minLat + bounds.maxLat) / 2,
  };
}

function roundLngLat(point) {
  return Array.isArray(point) ? point.map((value) => Number(Number(value).toFixed(7))) : point;
}

function toScreenPoint(point, adapter) {
  const [lng, lat] = point;
  const bounds = adapter.map.geoBounds;
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
  return [Number(Math.min(100, Math.max(0, x)).toFixed(4)), Number(Math.min(100, Math.max(0, y)).toFixed(4))];
}

function chunkIdFor(centroid) {
  const [x, y] = Array.isArray(centroid) ? centroid : [50, 50];
  const chunkX = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((Number(x) / 100) * GRID_SIZE)));
  const chunkY = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((Number(y) / 100) * GRID_SIZE)));
  return `${chunkX}-${chunkY}`;
}

function mergeBounds(current, centroid) {
  if (!current) return { minX: centroid[0], minY: centroid[1], maxX: centroid[0], maxY: centroid[1] };
  return {
    minX: Math.min(current.minX, centroid[0]),
    minY: Math.min(current.minY, centroid[1]),
    maxX: Math.max(current.maxX, centroid[0]),
    maxY: Math.max(current.maxY, centroid[1]),
  };
}

function physicalAddress(properties) {
  return firstNonEmpty(
    properties.PHYSICAL_ADDRESS,
    [
      properties.PHYSICAL_STREET_NUM,
      properties.PHYSICAL_STREET_DIR,
      properties.PHYSICAL_STREET_NAME,
      properties.PHYSICAL_STREET_TYPE,
      properties.PHYSICAL_STREET_POSTDIR,
      properties.PHYSICAL_SUITE,
      properties.PHYSICAL_CITY,
      properties.PHYSICAL_ZIP,
    ]
      .map(compact)
      .filter(Boolean)
      .join(" "),
  );
}

function mapMaricopaFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const apn = compact(properties.APN);
  const objectId = compact(properties.OBJECTID);
  const displayParcelId = firstNonEmpty(properties.APN_DASH, apn);
  const countyParcelId = `${adapter.id}:${apn || objectId}`;
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const address = physicalAddress(properties);
  const areaLabel = [
    compact(properties.LAND_SIZE) ? `${compact(properties.LAND_SIZE)} land sq ft` : "",
    compact(properties.Shape__Area) ? `${compact(properties.Shape__Area)} source area` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId: apn,
    accountNum: apn,
    accountNumber: apn,
    gisParcelId: objectId,
    displayParcelId,
    address,
    propertyAddress: address,
    city: compact(properties.PHYSICAL_CITY),
    propertyZip: compact(properties.PHYSICAL_ZIP),
    propertyName: displayParcelId ? `Maricopa Parcel ${displayParcelId}` : "Maricopa Parcel",
    ownerName: compact(properties.OWNER_NAME),
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: firstNonEmpty(properties.MAIL_ADDRESS, properties.MAIL_ADDR1),
    ownerMailingAddress2: compact(properties.MAIL_ADDR2),
    ownerCity: compact(properties.MAIL_CITY),
    ownerState: compact(properties.MAIL_STATE),
    ownerZip: compact(properties.MAIL_ZIP),
    ownerPhone: "",
    ownerEmail: "",
    zoning: compact(properties.CITY_ZONING),
    landUseCode: compact(properties.PUC),
    landUseDescription: "",
    landAreaSqFt: compact(properties.LAND_SIZE),
    landAreaUnit: compact(properties.LAND_SIZE) ? "sq ft" : "",
    yearBuilt: compact(properties.CONST_YEAR),
    grossBuildingArea: compact(properties.LIVING_SPACE),
    totalValue: compact(properties.FCV_CUR),
    limitedPropertyValue: compact(properties.LPV_CUR),
    previousTotalValue: compact(properties.FCV_PREV),
    cityJurisdiction: compact(properties.JURISDICTION),
    blockId: firstNonEmpty(properties.BLOCK, properties.MCRNUM, [properties.MCR_BOOK, properties.MCR_PAGE].map(compact).filter(Boolean).join("-")),
    areaLabel,
    perimeter: compact(properties.Shape__Length),
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: {
      center: roundLngLat(centroidLngLat),
      points: ring.map(roundLngLat),
    },
    realGeometry: {
      type: "Feature",
      geometry,
      properties: { countyParcelId, accountNum: apn, sourceParcelId: apn, gisParcelId: objectId },
    },
    dimensions: {
      perimeterFt: compact(properties.Shape__Length),
      areaSqFt: compact(properties.Shape__Area),
      dimensionLabel: areaLabel,
      sourceLayer: sourceManifest.gis_source,
    },
    joins: {
      accountInfo: Boolean(apn),
      ownerAppraisal: Boolean(apn),
      parcelGeometry: Boolean(geometry),
      zoning: Boolean(properties.CITY_ZONING),
      permits: false,
      floodplain: false,
      migrationDemand: false,
    },
    sourceReferences: {
      countyAdapter: "data/county-adapters/maricopa-county-az/adapter.json",
      sourceManifest: "data/county-adapters/maricopa-county-az/maricopa-county-parcel-source-manifest.json",
      gisSource: sourceManifest.gis_source,
      arcgisRestUrl: sourceManifest.arcgis_rest_url,
      uniqueGisKey: sourceManifest.unique_gis_key,
      parcelIdField: sourceManifest.parcel_id_field,
    },
  };
}

function mapKingFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const pin = compact(properties.PIN);
  const objectId = compact(properties.OBJECTID);
  const countyParcelId = `${adapter.id}:${objectId || pin}`;
  const ring = simplifyRing(largestRing(geometry));
  const landValue = Number(properties.APPRLNDVAL || 0);
  const improvementValue = Number(properties.APPR_IMPR || 0);
  const totalValue = landValue + improvementValue || "";
  const areaLabel = [
    compact(properties.LOTSQFT) ? `${compact(properties.LOTSQFT)} land sq ft` : "",
    compact(properties.KCA_ACRES) ? `${compact(properties.KCA_ACRES)} acres` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId: pin,
    accountNum: pin,
    accountNumber: pin,
    gisParcelId: objectId,
    address: compact(properties.ADDR_FULL),
    propertyAddress: compact(properties.ADDR_FULL),
    city: firstNonEmpty(properties.CTYNAME, properties.POSTALCTYNAME),
    propertyZip: compact(properties.ZIP5),
    propertyName: firstNonEmpty(properties.PROP_NAME, properties.PLAT_NAME, pin ? `King Parcel ${pin}` : "King Parcel"),
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
    zoning: compact(properties.KCA_ZONING),
    landUseCode: compact(properties.PREUSE_CODE),
    landUseDescription: compact(properties.PREUSE_DESC),
    landAreaSqFt: compact(properties.LOTSQFT),
    landAreaUnit: compact(properties.LOTSQFT) ? "sq ft" : "",
    landValue: compact(properties.APPRLNDVAL),
    improvementValue: compact(properties.APPR_IMPR),
    totalValue,
    cityJurisdiction: firstNonEmpty(properties.CTYNAME, properties.POSTALCTYNAME),
    blockId: firstNonEmpty(properties.PLAT_NAME, properties.MAJOR),
    areaLabel,
    perimeter: compact(properties["Shape.STLength()"]),
    centroid: toScreenPoint([bounds.centerLng, bounds.centerLat], adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: {
      center: roundLngLat([bounds.centerLng, bounds.centerLat]),
      points: ring.map(roundLngLat),
    },
    realGeometry: {
      type: "Feature",
      geometry,
      properties: { countyParcelId, accountNum: pin, sourceParcelId: pin, gisParcelId: objectId },
    },
    dimensions: {
      perimeterFt: compact(properties["Shape.STLength()"]),
      areaSqFt: compact(properties["Shape.STArea()"]),
      dimensionLabel: areaLabel,
      sourceLayer: sourceManifest.property_info_layer_name,
    },
    joins: {
      accountInfo: Boolean(pin),
      ownerAppraisal: false,
      propertyInfo: Boolean(pin),
      parcelGeometry: Boolean(geometry),
      zoning: Boolean(properties.KCA_ZONING),
      permits: false,
      floodplain: false,
      migrationDemand: false,
    },
    sourceReferences: {
      countyAdapter: "data/county-adapters/king-county-wa/adapter.json",
      sourceManifest: "data/county-adapters/king-county-wa/king-county-parcel-source-manifest.json",
      gisSource: sourceManifest.gis_source,
      parcelGeometryUrl: sourceManifest.arcgis_rest_url,
      propertyInfoUrl: sourceManifest.property_info_rest_url,
      uniqueGisKey: sourceManifest.unique_gis_key,
      parcelIdField: sourceManifest.parcel_id_field,
    },
  };
}

function mapTarrantFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const account = compact(properties.ACCOUNT);
  const taxPin = compact(properties.TAXPIN);
  if (!account) return null;
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const areaLabel = [
    compact(properties.LAND_ACRES) ? `${compact(properties.LAND_ACRES)} acres` : "",
    compact(properties.LAND_SQFT) ? `${compact(properties.LAND_SQFT)} land sq ft` : "",
  ].filter(Boolean).join(" / ");
  const ownerZip = [compact(properties.OWNER_ZIP), compact(properties.OWNER_ZIP_)].filter(Boolean).join("-");

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId: `${adapter.id}:${account}`,
    sourceParcelId: account,
    accountNum: account,
    accountNumber: account,
    gisParcelId: taxPin,
    displayParcelId: account,
    address: compact(properties.SITUS_ADDR),
    propertyAddress: compact(properties.SITUS_ADDR),
    city: compact(properties.CITY),
    propertyZip: compact(properties.ZIPCODE),
    propertyName: firstNonEmpty(properties.SubdivisionName, `Tarrant Parcel ${account}`),
    ownerName: compact(properties.OWNER_NAME),
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: compact(properties.OWNER_ADDR),
    ownerMailingAddress2: "",
    ownerCity: compact(properties.OWNER_CITY),
    ownerState: compact(properties.STATE),
    ownerZip,
    ownerPhone: "",
    ownerEmail: "",
    zoning: "",
    landUseCode: compact(properties.PARCELTYPE),
    landUseDescription: compact(properties.DESCR),
    landAreaSqFt: compact(properties.LAND_SQFT),
    landAreaUnit: compact(properties.LAND_SQFT) ? "sq ft" : "",
    landValue: compact(properties.LAND_VALUE),
    improvementValue: compact(properties.IMPR_VALUE),
    totalValue: compact(properties.TOTAL_VALU),
    appraisedValue: compact(properties.APPRAISEDV),
    yearBuilt: compact(properties.YEAR_BUILT),
    grossBuildingArea: compact(properties.LIVING_ARE),
    blockId: firstNonEmpty(properties.SubdivisionName, properties.TAD_MAP, properties.MAPSCO),
    legalDescription: [properties.LEGAL_1, properties.LEGAL_2, properties.LEGAL_3, properties.LEGAL_4].map(compact).filter(Boolean).join(" "),
    areaLabel,
    perimeter: compact(properties["Shape.STLength()"]),
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: { center: roundLngLat(centroidLngLat), points: ring.map(roundLngLat) },
    realGeometry: {
      type: "Feature",
      geometry,
      properties: { countyParcelId: `${adapter.id}:${account}`, accountNum: account, sourceParcelId: account, gisParcelId: taxPin },
    },
    dimensions: {
      perimeterFt: compact(properties["Shape.STLength()"]),
      areaSqFt: compact(properties.LAND_SQFT),
      dimensionLabel: areaLabel,
      sourceLayer: "TAD Parcel layer",
    },
    joins: {
      accountInfo: true,
      ownerAppraisal: true,
      parcelDimension: Boolean(properties.LAND_SQFT || properties.LAND_ACRES),
      parcelGeometry: true,
      zoning: false,
      permits: false,
      floodplain: false,
      migrationDemand: false,
    },
    sourceReferences: {
      countyAdapter: "data/county-adapters/tarrant/adapter.json",
      sourceManifest: "data/county-adapters/tarrant/tarrant-county-tad-source-manifest.json",
      parcelGeometryUrl: sourceManifest.official_sources.parcel_map_service,
      primaryParcelKey: "ACCOUNT",
      secondaryParcelKey: "TAXPIN",
    },
  };
}

function mapCollinFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const globalId = compact(properties.GlobalID).replace(/[{}]/g, "").toLowerCase();
  if (!globalId) return null;
  const propId = compact(properties.propID || properties.PROP_ID);
  const geoId = compact(properties.geoID);
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const areaLabel = [
    compact(properties.landSizeAcres) ? `${compact(properties.landSizeAcres)} acres` : "",
    compact(properties.landSizeSqft) ? `${compact(properties.landSizeSqft)} land sq ft` : "",
  ].filter(Boolean).join(" / ");

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId: `${adapter.id}:${globalId}`,
    sourceParcelId: propId,
    accountNum: propId,
    accountNumber: propId,
    gisParcelId: firstNonEmpty(geoId, properties.gisPropID),
    displayParcelId: firstNonEmpty(geoId, propId, globalId),
    address: compact(properties.situsConcat),
    propertyAddress: compact(properties.situsConcat),
    city: compact(properties.situsCity),
    propertyZip: compact(properties.situsZip),
    propertyName: firstNonEmpty(properties.legalAbsSubName, `Collin Parcel ${geoId || propId || globalId}`),
    ownerName: compact(properties.ownerName),
    ownerName2: compact(properties.ownerNameAddtl),
    businessName: "",
    ownerMailingAddress: compact(properties.ownerAddrLine1),
    ownerMailingAddress2: compact(properties.ownerAddrLine2),
    ownerCity: compact(properties.ownerAddrCity),
    ownerState: compact(properties.ownerAddrState),
    ownerZip: compact(properties.ownerAddrZip),
    ownerPhone: "",
    ownerEmail: "",
    zoning: "",
    landUseCode: compact(properties.propUseCode),
    landUseDescription: compact(properties.propType),
    landAreaSqFt: compact(properties.landSizeSqft),
    landAreaUnit: compact(properties.landSizeSqft) ? "sq ft" : "",
    landValue: compact(properties.currValLand),
    improvementValue: compact(properties.currValImprv),
    totalValue: compact(properties.currValMarket),
    appraisedValue: compact(properties.currValAppraised),
    yearBuilt: compact(properties.imprvYearBuilt),
    grossBuildingArea: compact(properties.imprvMainArea),
    blockId: firstNonEmpty(properties.legalAbsSubBlock, properties.legalAbsSubName, properties.mapID),
    legalDescription: compact(properties.legalDescription),
    areaLabel,
    perimeter: compact(properties.Shape__Length),
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: { center: roundLngLat(centroidLngLat), points: ring.map(roundLngLat) },
    realGeometry: {
      type: "Feature",
      geometry,
      properties: { countyParcelId: `${adapter.id}:${globalId}`, accountNum: propId, sourceParcelId: propId, gisParcelId: geoId, globalId },
    },
    dimensions: {
      perimeterFt: compact(properties.Shape__Length),
      areaSqFt: compact(properties.landSizeSqft),
      dimensionLabel: areaLabel,
      sourceLayer: "CCAD Parcels",
    },
    joins: {
      accountInfo: Boolean(propId),
      ownerAppraisal: true,
      parcelDimension: Boolean(properties.landSizeSqft || properties.landSizeAcres),
      parcelGeometry: true,
      zoning: false,
      permits: false,
      floodplain: false,
      migrationDemand: false,
    },
    sourceReferences: {
      countyAdapter: "data/county-adapters/collin-county-tx/adapter.json",
      sourceManifest: "data/county-adapters/collin-county-tx/collin-county-tx-source-manifest.json",
      parcelGeometryUrl: sourceManifest.official_sources.parcel_feature_service,
      primaryFeatureKey: "GlobalID",
      businessParcelCandidates: ["propID", "PROP_ID", "geoID"],
    },
  };
}

function mapDentonFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const globalId = compact(properties.GlobalID).replace(/[{}]/g, "").toLowerCase();
  if (!globalId) return null;
  const pid = compact(properties.pid);
  const geoId = compact(properties.geoID);
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const areaSqFt = firstNonEmpty(properties.landTotalSqft, properties.land_sqft);
  const areaLabel = [
    compact(properties.effectiveSizeAcres) ? `${compact(properties.effectiveSizeAcres)} acres` : "",
    areaSqFt ? `${areaSqFt} land sq ft` : "",
  ].filter(Boolean).join(" / ");
  const situs = firstNonEmpty(properties.situs_full_address, properties.situs_street_address);

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId: `${adapter.id}:${globalId}`,
    sourceParcelId: pid,
    accountNum: pid,
    accountNumber: pid,
    gisParcelId: geoId,
    displayParcelId: firstNonEmpty(geoId, pid, globalId),
    address: situs,
    propertyAddress: situs,
    city: compact(properties.situsCity),
    propertyZip: compact(properties.situsZip),
    propertyName: firstNonEmpty(properties.abstractSubdivisionDescription, `Denton Parcel ${geoId || pid || globalId}`),
    ownerName: compact(properties.name),
    ownerName2: compact(properties.nameSecondary),
    businessName: compact(properties.dba),
    ownerMailingAddress: compact(properties.addrDeliveryLine),
    ownerMailingAddress2: compact(properties.addrUnitDesignator),
    ownerCity: compact(properties.addrCity),
    ownerState: compact(properties.addrState),
    ownerZip: compact(properties.addrZip),
    ownerPhone: "",
    ownerEmail: "",
    zoning: compact(properties.cad_zoning),
    landUseCode: compact(properties.useCd),
    landUseDescription: compact(properties.propType),
    landAreaSqFt: areaSqFt,
    landAreaUnit: areaSqFt ? "sq ft" : "",
    landValue: firstNonEmpty(properties.landHSValue, properties.landNHSValue),
    improvementValue: compact(properties.improvementValue),
    totalValue: compact(properties.ownerMarketValue),
    appraisedValue: compact(properties.ownerAppraisedValue),
    yearBuilt: firstNonEmpty(properties.imprvActualYearBuilt, properties.imprvEffYearBuilt),
    grossBuildingArea: firstNonEmpty(properties.imprvMainArea, properties.imprvTotalArea),
    blockId: firstNonEmpty(properties.block, properties.tract, properties.abstractSubdivisionDescription),
    legalDescription: compact(properties.legalDescription),
    areaLabel,
    perimeter: compact(properties["Shape.STLength()"]),
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: { center: roundLngLat(centroidLngLat), points: ring.map(roundLngLat) },
    realGeometry: { type: "Feature", geometry, properties: { countyParcelId: `${adapter.id}:${globalId}`, accountNum: pid, sourceParcelId: pid, gisParcelId: geoId, globalId } },
    dimensions: { perimeterFt: compact(properties["Shape.STLength()"]), areaSqFt, dimensionLabel: areaLabel, sourceLayer: "Denton CAD Parcels_Appraisal" },
    joins: { accountInfo: Boolean(pid), ownerAppraisal: true, parcelDimension: Boolean(areaSqFt || properties.effectiveSizeAcres), parcelGeometry: true, zoning: Boolean(properties.cad_zoning), permits: false, floodplain: false, migrationDemand: false },
    sourceReferences: {
      countyAdapter: "data/county-adapters/denton-county-tx/adapter.json",
      sourceManifest: "data/county-adapters/denton-county-tx/denton-county-tx-source-manifest.json",
      parcelGeometryUrl: sourceManifest.official_sources.parcels_appraisal_map_layer,
      primaryFeatureKey: "GlobalID",
      businessParcelCandidates: ["pid", "geoID"],
    },
  };
}

function sumAvailableValues(...values) {
  const numbers = values.filter((value) => compact(value) !== "").map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return numbers.length ? String(numbers.reduce((sum, value) => sum + value, 0)) : "";
}

function mapTravisFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const objectId = compact(properties.OBJECTID);
  if (!objectId) return null;
  const propId = compact(properties.PROP_ID);
  const geoId = compact(properties.geo_id);
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const acreage = firstNonEmpty(properties.tcad_acres, properties.GIS_acres, properties.legal_acre);
  const shapeArea = compact(properties["Shape.STArea()"]);
  const shapeLength = compact(properties["Shape.STLength()"]);
  const situs = firstNonEmpty(properties.situs_address, properties.py_address, [properties.situs_num, properties.situs_street_prefx, properties.situs_street, properties.situs_street_suffix].map(compact).filter(Boolean).join(" "));
  const hasAppraisal = Boolean(propId);
  const improvementValue = sumAvailableValues(properties.imprv_homesite_val, properties.imprv_non_homesite_val);
  const landValue = sumAvailableValues(properties.land_homesite_val, properties.land_non_homesite_val);
  const areaLabel = [acreage ? `${acreage} acres` : "", shapeArea ? `${shapeArea} geometry sq ft` : ""].filter(Boolean).join(" / ");

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId: `${adapter.id}:${objectId}`,
    sourceParcelId: propId,
    accountNum: propId,
    accountNumber: propId,
    gisParcelId: geoId,
    displayParcelId: firstNonEmpty(geoId, propId, `OBJECTID-${objectId}`),
    address: situs,
    propertyAddress: situs,
    city: compact(properties.situs_city),
    propertyZip: compact(properties.situs_zip),
    propertyName: firstNonEmpty(properties.sub_dec, properties.legal_desc, `Travis Parcel ${geoId || propId || objectId}`),
    ownerName: compact(properties.py_owner_name),
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: "",
    ownerMailingAddress2: "",
    ownerCity: "",
    ownerState: "",
    ownerZip: "",
    ownerPhone: "",
    ownerEmail: "",
    zoning: "",
    landUseCode: compact(properties.land_state_cd),
    landUseDescription: compact(properties.land_type_desc),
    landAreaSqFt: shapeArea,
    landAreaUnit: shapeArea ? "sq ft" : "",
    landValue,
    improvementValue,
    totalValue: compact(properties.market_value),
    appraisedValue: compact(properties.appraised_val),
    assessedValue: compact(properties.assessed_val),
    yearBuilt: compact(properties.F1year_imprv),
    grossBuildingArea: "",
    blockId: firstNonEmpty(properties.LOTS, properties.abs_subdv_cd, properties.sub_dec),
    legalDescription: compact(properties.legal_desc),
    areaLabel,
    perimeter: shapeLength,
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: { center: roundLngLat(centroidLngLat), points: ring.map(roundLngLat) },
    realGeometry: {
      type: "Feature",
      geometry,
      properties: { countyParcelId: `${adapter.id}:${objectId}`, accountNum: propId, sourceParcelId: propId, gisParcelId: geoId, objectId },
    },
    dimensions: { perimeterFt: shapeLength, areaSqFt: shapeArea, acreage, dimensionLabel: areaLabel, sourceLayer: "Travis County TCAD Parcels" },
    joins: { accountInfo: hasAppraisal, ownerAppraisal: hasAppraisal, parcelDimension: true, parcelGeometry: true, zoning: false, permits: false, floodplain: false, migrationDemand: false },
    sourceReferences: {
      countyAdapter: "data/county-adapters/travis-county-tx/adapter.json",
      sourceManifest: "data/county-adapters/travis-county-tx/travis-county-tx-source-manifest.json",
      parcelGeometryUrl: sourceManifest.official_sources.parcel_map_service,
      snapshotFeatureKey: "OBJECTID",
      businessParcelCandidates: ["PROP_ID", "geo_id"],
      refreshStability: "unverified",
    },
  };
}

function mapFortBendFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const globalId = compact(properties.GlobalID);
  const objectId = compact(properties.OBJECTID);
  if (!globalId || !objectId) return null;
  const propertyNumber = compact(properties.Property_Number);
  const uid = compact(properties.UID);
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const acreage = compact(properties.Land_Size_AC);
  const areaSqFt = firstNonEmpty(properties.Land_Size_FT, properties.Shape__Area);
  const perimeter = compact(properties.Shape__Length);
  const areaLabel = [acreage ? `${acreage} acres` : "", areaSqFt ? `${areaSqFt} sq ft` : ""].filter(Boolean).join(" / ");
  const countyParcelId = `${adapter.id}:${globalId}`;

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId: propertyNumber,
    accountNum: propertyNumber,
    accountNumber: propertyNumber,
    gisParcelId: globalId,
    displayParcelId: firstNonEmpty(propertyNumber, uid, `OBJECTID-${objectId}`),
    address: compact(properties.Situs),
    propertyAddress: compact(properties.Situs),
    city: "",
    propertyZip: "",
    propertyName: firstNonEmpty(properties.Legal_Location, properties.Legal, `Fort Bend Parcel ${propertyNumber || objectId}`),
    ownerName: compact(properties.Owner_Name),
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: compact(properties.Owner_Address_1),
    ownerMailingAddress2: [properties.Owner_Address_2, properties.Owner_Address_3].map(compact).filter(Boolean).join(" "),
    ownerCity: compact(properties.Owner_City),
    ownerState: compact(properties.Owner_State),
    ownerZip: compact(properties.Owner_Zip),
    ownerPhone: "",
    ownerEmail: "",
    zoning: "",
    landUseCode: firstNonEmpty(properties.Land_State_Code, properties.Land_AG_Code),
    landUseDescription: firstNonEmpty(properties.Common_Land_Use_Type, properties.Land_Type),
    landAreaSqFt: areaSqFt,
    landAreaUnit: areaSqFt ? "sq ft" : "",
    landValue: compact(properties.Land_Value),
    improvementValue: compact(properties.Improvement_Value),
    totalValue: compact(properties.Total_Value),
    appraisedValue: compact(properties.Total_Value),
    assessedValue: "",
    yearBuilt: compact(properties.Year_Built),
    grossBuildingArea: compact(properties.Total_Living_Area_SqFT),
    blockId: firstNonEmpty(properties.Map_Number, properties.X_Reference_Of_Section),
    legalDescription: compact(properties.Legal),
    areaLabel,
    perimeter,
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: { center: roundLngLat(centroidLngLat), points: ring.map(roundLngLat) },
    realGeometry: { type: "Feature", geometry, properties: { countyParcelId, accountNum: propertyNumber, sourceParcelId: propertyNumber, gisParcelId: globalId, objectId, uid } },
    dimensions: { perimeterFt: perimeter, areaSqFt, acreage, dimensionLabel: areaLabel, sourceLayer: "Fort Bend County Parcels_Public" },
    joins: { accountInfo: Boolean(propertyNumber), ownerAppraisal: true, parcelDimension: Boolean(areaSqFt || perimeter), parcelGeometry: true, zoning: false, permits: false, floodplain: false, migrationDemand: false },
    sourceReferences: {
      countyAdapter: "data/county-adapters/fort-bend-county-tx/adapter.json",
      sourceManifest: "data/county-adapters/fort-bend-county-tx/fort-bend-county-tx-source-manifest.json",
      parcelGeometryUrl: sourceManifest.official_sources.parcel_feature_service,
      snapshotFeatureKey: "GlobalID",
      businessParcelCandidates: ["Property_Number", "CAD_Reference_Number", "UID"],
    },
  };
}

function mapBexarFeature(feature, adapter, sourceManifest) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const objectId = compact(properties.OBJECTID);
  if (!objectId) return null;
  const accountNumber = firstNonEmpty(properties.AcctNumb, properties.PropID);
  const ring = simplifyRing(largestRing(geometry));
  const centroidLngLat = [bounds.centerLng, bounds.centerLat];
  const acreage = firstNonEmpty(properties.Acres, properties.LglAcres);
  const areaSqFt = compact(properties["Shape.STArea()"]);
  const perimeter = compact(properties["Shape.STLength()"]);
  const areaLabel = [acreage ? `${acreage} acres` : "", areaSqFt ? `${areaSqFt} geometry sq ft` : ""].filter(Boolean).join(" / ");
  const countyParcelId = `${adapter.id}:${objectId}`;

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId: accountNumber,
    accountNum: accountNumber,
    accountNumber,
    gisParcelId: objectId,
    displayParcelId: firstNonEmpty(properties.AcctNumb, properties.PropID, `OBJECTID-${objectId}`),
    address: compact(properties.Situs),
    propertyAddress: compact(properties.Situs),
    city: "",
    propertyZip: "",
    propertyName: firstNonEmpty(properties.DBA, properties.LglDesc, `Bexar Parcel ${accountNumber || objectId}`),
    ownerName: compact(properties.Owner),
    ownerName2: "",
    businessName: compact(properties.DBA),
    ownerMailingAddress: compact(properties.AddrLn1),
    ownerMailingAddress2: [properties.AddrLn2, properties.AddrLn3].map(compact).filter(Boolean).join(" "),
    ownerCity: compact(properties.AddrCity),
    ownerState: compact(properties.AddrSt),
    ownerZip: [properties.Zip, properties.Zip4].map(compact).filter(Boolean).join("-"),
    ownerPhone: "",
    ownerEmail: "",
    zoning: "",
    landUseCode: firstNonEmpty(properties.State_cd, properties.PropUse),
    landUseDescription: compact(properties.PropUse),
    landAreaSqFt: areaSqFt,
    landAreaUnit: areaSqFt ? "sq ft" : "",
    landValue: compact(properties.LandVal),
    improvementValue: compact(properties.ImprVal),
    totalValue: compact(properties.TotVal),
    appraisedValue: compact(properties.TotVal),
    assessedValue: "",
    yearBuilt: compact(properties.YrBlt),
    grossBuildingArea: firstNonEmpty(properties.TOT_GBA, properties.GBA),
    blockId: compact(properties.Nbhd),
    legalDescription: compact(properties.LglDesc),
    areaLabel,
    perimeter,
    centroid: toScreenPoint(centroidLngLat, adapter),
    points: ring.map(roundLngLat).map((point) => toScreenPoint(point, adapter)),
    liveGeometry: { center: roundLngLat(centroidLngLat), points: ring.map(roundLngLat) },
    realGeometry: { type: "Feature", geometry, properties: { countyParcelId, accountNum: accountNumber, sourceParcelId: accountNumber, gisParcelId: objectId, objectId } },
    dimensions: { perimeterFt: perimeter, areaSqFt, acreage, dimensionLabel: areaLabel, sourceLayer: "Bexar County Parcels" },
    joins: { accountInfo: Boolean(accountNumber), ownerAppraisal: Boolean(accountNumber), parcelDimension: Boolean(areaSqFt || acreage), parcelGeometry: true, zoning: false, permits: false, floodplain: false, migrationDemand: false },
    sourceReferences: {
      countyAdapter: "data/county-adapters/bexar-county-tx/adapter.json",
      sourceManifest: "data/county-adapters/bexar-county-tx/bexar-county-tx-source-manifest.json",
      parcelGeometryUrl: sourceManifest.official_sources.parcel_map_service,
      snapshotFeatureKey: "OBJECTID",
      businessParcelCandidates: ["AcctNumb", "PropID"],
      freshnessStatus: "blocked-publisher-update-date-stale-or-unverified",
    },
  };
}

function recordWithGeometry(feature, adapter) {
  const properties = feature.properties || {};
  const countyParcelId = compact(properties.countyParcelId) || `${adapter.id}:${compact(properties.gisParcelId || properties.accountNum || properties.sourceParcelId)}`;
  return {
    ...properties,
    schemaVersion: compact(properties.schemaVersion) || adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: compact(properties.sourceCountyId) || adapter.id,
    countyParcelId,
    accountNum: compact(properties.accountNum || properties.accountNumber || properties.sourceParcelId),
    accountNumber: compact(properties.accountNumber || properties.accountNum || properties.sourceParcelId),
    realGeometry: properties.realGeometry || {
      type: "Feature",
      properties: {
        countyParcelId,
        accountNum: compact(properties.accountNum || properties.accountNumber || properties.sourceParcelId),
        sourceParcelId: compact(properties.sourceParcelId),
        gisParcelId: compact(properties.gisParcelId),
      },
      geometry: feature.geometry,
    },
  };
}

function searchRecordFor(record, adapter, chunkId) {
  const output = {};
  for (const field of SEARCH_INDEX_FIELDS) addSearchField(output, field, record[field]);
  output.chunkId = chunkId;
  output.centroid = record.centroid;
  if (sameText(output.gisParcelId, output.accountNum)) delete output.gisParcelId;
  if (sameText(output.propertyName, output.ownerName)) delete output.propertyName;
  if (sameText(output.ownerName2, output.ownerName)) delete output.ownerName2;
  return output;
}

function packSearchRecord(record) {
  const values = SEARCH_INDEX_FIELDS.map((field) => record[field] ?? "");
  while (values.length && values[values.length - 1] === "") values.pop();
  return values;
}

function addFullBuildTextKey(keys, value) {
  const token = normalizeSearchToken(value);
  if (token.length < 3 || FULL_BUILD_COMMON_SEARCH_TOKENS.has(token)) return;
  addShardKey(keys, token);
}

function searchShardKeysFor(record, adapter, options = {}) {
  const fullBuild = options.mode === "full";
  const keys = new Set();
  const identityValues = [
    record.accountNum,
    record.accountNumber,
    record.sourceParcelId,
    record.gisParcelId,
    record.displayParcelId,
    fullBuild ? "" : record.countyParcelId,
    fullBuild ? "" : record.sourceCountyId,
    fullBuild ? "" : record.totalValue,
    fullBuild ? "" : adapter.countyName,
    fullBuild ? "" : adapter.marketName,
    fullBuild ? "" : adapter.appraisalDistrictName,
    fullBuild ? "" : adapter.appraisalDistrictAcronym,
  ];
  identityValues.forEach((value) => addShardKey(keys, value, { allowShort: true }));
  const textValues = [
    record.address,
    record.ownerName,
    fullBuild ? "" : record.propertyName,
    record.ownerName2,
    record.businessName,
    record.blockId,
    record.zoning,
    record.landUseCode,
    record.landUseDescription,
    fullBuild ? "" : adapter.countyName,
    fullBuild ? "" : adapter.marketName,
  ];
  textValues.forEach((value) => {
    addShardKey(keys, value);
    String(value || "")
      .split(/[^a-z0-9]+/i)
      .forEach((part) => (fullBuild ? addFullBuildTextKey(keys, part) : addShardKey(keys, part)));
  });
  return keys;
}

function serviceDirFor(adapter, countyId) {
  return path.join(root, String(adapter.publicDataRoots?.parcels || `/data/counties/${countyId}/parcels/`).replace(/^\/data\//, "public/data/"));
}

async function collectRecords(config, countyId, adapter, sourceManifest, mode, sampleLimit) {
  if (mode === "sample" && fs.existsSync(path.join(root, config.localSamplePath))) {
    const sample = readJson(config.localSamplePath);
    return (sample.features || []).slice(0, sampleLimit).map((feature) => recordWithGeometry(feature, adapter)).filter((record) => Array.isArray(record.centroid));
  }

  const records = [];
  const targetCount = mode === "full" ? Number.POSITIVE_INFINITY : sampleLimit;
  const pageSize = Math.min(config.pageSize(sourceManifest), Number.isFinite(targetCount) ? targetCount : config.pageSize(sourceManifest));
  let fetched = 0;
  while (fetched < targetCount) {
    const remaining = Number.isFinite(targetCount) ? targetCount - fetched : pageSize;
    const count = Math.min(pageSize, remaining || pageSize);
    const features = await fetchGeoJsonPage(config, sourceManifest, fetched, count);
    if (!features.length) break;
    for (const feature of features) {
      fetched += 1;
      const record = config.mapRemoteFeature(feature, adapter, sourceManifest);
      if (record && Array.isArray(record.centroid)) records.push(record);
    }
    if (features.length < count) break;
    if (mode === "full" && fetched % 50000 === 0) console.log(`Prepared ${fetched.toLocaleString()} ${countyId} parcel service records...`);
  }
  return records;
}

function writeReports({ countyId, config, adapter, manifest, outputDir, manifestFile, generatedAt }) {
  const serviceManifest = path.relative(root, manifestFile).replace(/\\/g, "/");
  const report = {
    generatedAt,
    county_id: countyId,
    mode: manifest.mode,
    activationStatus: manifest.activationStatus,
    sourceVerifiedFeatureCount: manifest.sourceVerifiedFeatureCount,
    builtFeatureCount: manifest.featureCount,
    skipped: manifest.skipped,
    chunkCount: manifest.chunkCount,
    searchIndexCount: manifest.searchIndexCount,
    searchShardCount: Object.keys(manifest.searchIndexShards.files).length,
    serviceManifest,
    productionGates:
      manifest.mode === "full"
        ? ["County QC, optional layer joins, and explicit activation review are still required before visible app activation."]
        : [`Run npm run ${countyId.startsWith("maricopa") ? "maricopa" : countyId.startsWith("tarrant") ? "tarrant" : countyId.startsWith("collin") ? "collin" : countyId.startsWith("denton") ? "denton" : countyId.startsWith("travis") ? "travis" : "king"}:service:full after approving the full source pull.`],
    uiConstraint: "No White Rabbit page design changed. Pilot counties remain disabled until full QC and activation gates pass.",
  };
  writePrettyJson(path.join(outputDir, "parcel-service-report.json"), report);
  writeText(
    path.join(outputDir, "parcel-service-report.md"),
    [
      `# ${config.reportTitle}`,
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Mode: ${manifest.mode}`,
      `- Activation status: ${manifest.activationStatus}`,
      `- Source-verified feature count: ${manifest.sourceVerifiedFeatureCount.toLocaleString()}`,
      `- Built feature count: ${manifest.featureCount.toLocaleString()}`,
      `- Skipped features: ${manifest.skipped}`,
      `- Viewport chunks: ${manifest.chunkCount}`,
      `- Search records: ${manifest.searchIndexCount}`,
      `- Search shards: ${Object.keys(manifest.searchIndexShards.files).length}`,
      "",
      "## Output",
      "",
      `- Manifest: \`${serviceManifest}\``,
      `- Public root: \`${adapter.publicDataRoots?.parcels || ""}\``,
      "",
      "## Production Gate",
      "",
      manifest.mode === "full"
        ? "This is a full service build. Keep the county disabled until county QC and optional data joins are reviewed."
        : "This is a pilot/sample service build. It proves the viewport/search plumbing but cannot activate the county as DCAD-like.",
      "",
      "No White Rabbit page design changed in this step.",
      "",
    ].join("\n"),
  );
}

function appendNdjson(file, records) {
  if (!records.length) return;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function buildStreamingCountyService(countyId, config, adapter, sourceManifest) {
  const generatedAt = new Date().toISOString();
  const outputDir = path.join(root, config.outputDir || path.join("output", countyId));
  const serviceDir = serviceDirFor(adapter, countyId);
  const chunksDir = path.join(serviceDir, "chunks");
  const searchDir = path.join(serviceDir, "search");
  const manifestFile = path.join(serviceDir, "manifest.json");
  const searchFile = path.join(serviceDir, "search-index.json");
  const tempDir = path.join(outputDir, ".parcel-service-stream-temp");
  const tempChunksDir = path.join(tempDir, "chunks");
  const tempSearchDir = path.join(tempDir, "search");
  ensureCleanDir(chunksDir);
  ensureCleanDir(searchDir);
  ensureCleanDir(tempDir);
  ensureDir(tempChunksDir);
  ensureDir(tempSearchDir);
  ensureDir(outputDir);

  const chunks = new Map();
  const searchShardCounts = new Map();
  const searchPartFiles = new Map();
  let fetched = 0;
  let skipped = 0;
  let searchIndexCount = 0;
  let searchShardRecordCount = 0;
  let joinedAppraisalCount = 0;
  let joinedParcelDimensionCount = 0;
  const pageSize = config.pageSize(sourceManifest);

  while (true) {
    const features = await fetchGeoJsonPage(config, sourceManifest, fetched, pageSize);
    if (!features.length) break;
    const pageChunks = new Map();
    const pageSearchParts = new Map();

    for (const feature of features) {
      fetched += 1;
      const record = config.mapRemoteFeature(feature, adapter, sourceManifest);
      if (!record || !Array.isArray(record.centroid)) {
        skipped += 1;
        continue;
      }
      const chunkId = chunkIdFor(record.centroid);
      if (!pageChunks.has(chunkId)) pageChunks.set(chunkId, []);
      pageChunks.get(chunkId).push(record);
      const chunk = chunks.get(chunkId) || { count: 0, bounds: null };
      chunk.count += 1;
      chunk.bounds = mergeBounds(chunk.bounds, record.centroid);
      chunks.set(chunkId, chunk);

      if (record.joins?.ownerAppraisal || record.joins?.appraisal || record.joins?.hcadOwnerAppraisal) joinedAppraisalCount += 1;
      if (record.joins?.parcelDimension || record.dimensions) joinedParcelDimensionCount += 1;
      const searchRecord = searchRecordFor(record, adapter, chunkId);
      const packed = packSearchRecord(searchRecord);
      for (const shardKey of searchShardKeysFor(searchRecord, adapter, { mode: "full" })) {
        const previousCount = searchShardCounts.get(shardKey) || 0;
        const part = Math.floor(previousCount / FULL_BUILD_SEARCH_SHARD_RECORD_LIMIT);
        const partKey = `${shardKey}-${String(part + 1).padStart(3, "0")}`;
        if (!pageSearchParts.has(partKey)) pageSearchParts.set(partKey, []);
        pageSearchParts.get(partKey).push(packed);
        searchShardCounts.set(shardKey, previousCount + 1);
        if (!searchPartFiles.has(shardKey)) searchPartFiles.set(shardKey, new Set());
        searchPartFiles.get(shardKey).add(partKey);
        searchShardRecordCount += 1;
      }
      searchIndexCount += 1;
    }

    for (const [chunkId, records] of pageChunks) appendNdjson(path.join(tempChunksDir, `${chunkId}.ndjson`), records);
    for (const [partKey, records] of pageSearchParts) appendNdjson(path.join(tempSearchDir, `${partKey}.ndjson`), records);
    if (fetched % 50000 === 0 || features.length < pageSize) console.log(`Streamed ${fetched.toLocaleString()} ${countyId} source features...`);
    if (features.length < pageSize) break;
  }

  const chunkManifest = [];
  for (const [chunkId, chunk] of chunks) {
    const fileName = `${chunkId}.json`;
    const tempChunkFile = path.join(tempChunksDir, `${chunkId}.ndjson`);
    const parcels = readNdjson(tempChunkFile);
    writeJson(path.join(chunksDir, fileName), { chunkId, parcels });
    fs.rmSync(tempChunkFile, { force: true });
    chunkManifest.push({ id: chunkId, file: `chunks/${fileName}`, count: chunk.count, bounds: chunk.bounds });
  }

  const searchShardFiles = {};
  const searchShardCountObject = {};
  for (const [shardKey, partKeys] of [...searchPartFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const files = [];
    for (const partKey of [...partKeys].sort()) {
      const fileName = `${partKey}.json`;
      const tempSearchFile = path.join(tempSearchDir, `${partKey}.ndjson`);
      const parcels = readNdjson(tempSearchFile);
      writeJson(path.join(searchDir, fileName), { fields: SEARCH_INDEX_FIELDS, parcels });
      fs.rmSync(tempSearchFile, { force: true });
      files.push(`search/${fileName}`);
    }
    searchShardFiles[shardKey] = files.length === 1 ? files[0] : files;
    searchShardCountObject[shardKey] = searchShardCounts.get(shardKey) || 0;
  }

  const manifest = {
    generatedAt,
    source: config.sourceUrl(sourceManifest),
    sourceCountyId: countyId,
    mode: "full",
    activationStatus: "full-build-needs-qc-before-app-activation",
    sourceVerifiedFeatureCount: config.sourceVerifiedCount(sourceManifest),
    featureCount: searchIndexCount,
    skipped,
    sampleLimit: null,
    chunkCount: chunkManifest.length,
    gridSize: GRID_SIZE,
    bounds: adapter.map?.geoBounds,
    chunks: chunkManifest.sort((a, b) => a.id.localeCompare(b.id)),
    searchIndex: "search-index.json",
    searchIndexCount,
    searchIndexShards: {
      keyLength: SEARCH_SHARD_KEY_LENGTH,
      fields: SEARCH_INDEX_FIELDS,
      files: searchShardFiles,
      counts: searchShardCountObject,
      recordMembershipCount: searchShardRecordCount,
    },
    joinedAppraisalCount,
    joinedParcelDimensionCount,
    missingLayers: ["permits-co", "zoning-detail", "floodplain", "development-signals", "migration-demand"],
    productionGates: ["Run county QC before activation.", "Do not mark DCAD-like until optional intelligence layers pass their gates."],
    buildStrategy: "streamed-page-to-ndjson-to-viewport-service",
    uiConstraint: "Do not redesign any White Rabbit pages. This is county parcel plumbing only.",
  };
  writeJson(manifestFile, manifest);
  writeJson(searchFile, {
    generatedAt,
    fields: SEARCH_INDEX_FIELDS,
    shardKeyLength: SEARCH_SHARD_KEY_LENGTH,
    shardCount: Object.keys(searchShardFiles).length,
    recordMembershipCount: searchShardRecordCount,
    mode: manifest.mode,
    sourceCountyId: countyId,
  });
  writeReports({ countyId, config, adapter, manifest, outputDir, manifestFile, generatedAt });
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { countyId, mode: manifest.mode, featureCount: manifest.featureCount, chunkCount: manifest.chunkCount, searchShardCount: Object.keys(searchShardFiles).length, manifest: path.relative(root, manifestFile).replace(/\\/g, "/") };
}

async function buildCountyService(countyId, mode, sampleLimit) {
  const config = COUNTY_CONFIGS[countyId];
  if (!config) throw new Error(`Unsupported source-verified county: ${countyId}`);
  const adapter = readJson(config.adapterPath);
  const sourceManifest = readJson(config.sourceManifestPath);
  if (adapter.id !== countyId) throw new Error(`${countyId} adapter id mismatch`);
  if (mode === "full") ensureFullBuildCapacity(countyId, config, adapter, sourceManifest);
  if (mode === "full" && config.streamFull) return buildStreamingCountyService(countyId, config, adapter, sourceManifest);

  const generatedAt = new Date().toISOString();
  const outputDir = path.join(root, config.outputDir || path.join("output", countyId));
  const serviceDir = serviceDirFor(adapter, countyId);
  const chunksDir = path.join(serviceDir, "chunks");
  const searchDir = path.join(serviceDir, "search");
  const manifestFile = path.join(serviceDir, "manifest.json");
  const searchFile = path.join(serviceDir, "search-index.json");
  ensureCleanDir(chunksDir);
  ensureCleanDir(searchDir);
  ensureDir(outputDir);

  const records = await collectRecords(config, countyId, adapter, sourceManifest, mode, sampleLimit);
  const chunks = new Map();
  const searchShards = new Map();
  let searchIndexCount = 0;
  let searchShardRecordCount = 0;
  let joinedAppraisalCount = 0;
  let joinedParcelDimensionCount = 0;

  for (const record of records) {
    const chunkId = chunkIdFor(record.centroid);
    if (!chunks.has(chunkId)) chunks.set(chunkId, { records: [], bounds: null });
    const chunk = chunks.get(chunkId);
    chunk.records.push(record);
    chunk.bounds = mergeBounds(chunk.bounds, record.centroid);

    if (record.joins?.ownerAppraisal || record.joins?.appraisal || record.joins?.hcadOwnerAppraisal) joinedAppraisalCount += 1;
    if (record.joins?.parcelDimension || record.dimensions) joinedParcelDimensionCount += 1;

    const searchRecord = searchRecordFor(record, adapter, chunkId);
    const packedSearchRecord = packSearchRecord(searchRecord);
    for (const shardKey of searchShardKeysFor(searchRecord, adapter, { mode })) {
      if (!searchShards.has(shardKey)) searchShards.set(shardKey, []);
      searchShards.get(shardKey).push(packedSearchRecord);
      searchShardRecordCount += 1;
    }
    searchIndexCount += 1;
  }

  const chunkManifest = [];
  for (const [chunkId, chunk] of chunks) {
    const fileName = `${chunkId}.json`;
    writeJson(path.join(chunksDir, fileName), { chunkId, parcels: chunk.records });
    chunkManifest.push({ id: chunkId, file: `chunks/${fileName}`, count: chunk.records.length, bounds: chunk.bounds });
  }

  const searchShardFiles = {};
  const searchShardCounts = {};
  for (const [shardKey, shardRecords] of [...searchShards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const shardFileLimit = mode === "full" ? FULL_BUILD_SEARCH_SHARD_RECORD_LIMIT : Number.POSITIVE_INFINITY;
    const shardFiles = [];
    for (let start = 0, part = 0; start < shardRecords.length; start += shardFileLimit, part += 1) {
      const shardPartRecords = shardRecords.slice(start, start + shardFileLimit);
      const fileName = shardRecords.length > shardFileLimit ? `${shardKey}-${String(part + 1).padStart(3, "0")}.json` : `${shardKey}.json`;
      writeJson(path.join(searchDir, fileName), { fields: SEARCH_INDEX_FIELDS, parcels: shardPartRecords });
      shardFiles.push(`search/${fileName}`);
    }
    searchShardFiles[shardKey] = shardFiles.length === 1 ? shardFiles[0] : shardFiles;
    searchShardCounts[shardKey] = shardRecords.length;
  }

  const manifest = {
    generatedAt,
    source: mode === "sample" ? config.localSamplePath : config.sourceUrl(sourceManifest),
    sourceCountyId: countyId,
    mode,
    activationStatus: mode === "full" ? "full-build-needs-qc-before-app-activation" : "pilot-sample-not-for-production-activation",
    sourceVerifiedFeatureCount: config.sourceVerifiedCount(sourceManifest),
    featureCount: searchIndexCount,
    skipped: Math.max(0, records.length - searchIndexCount),
    sampleLimit: mode === "sample" ? sampleLimit : null,
    chunkCount: chunkManifest.length,
    gridSize: GRID_SIZE,
    bounds: adapter.map?.geoBounds,
    chunks: chunkManifest.sort((a, b) => a.id.localeCompare(b.id)),
    searchIndex: "search-index.json",
    searchIndexCount,
    searchIndexShards: {
      keyLength: SEARCH_SHARD_KEY_LENGTH,
      fields: SEARCH_INDEX_FIELDS,
      files: searchShardFiles,
      counts: searchShardCounts,
      recordMembershipCount: searchShardRecordCount,
    },
    joinedAppraisalCount,
    joinedParcelDimensionCount,
    missingLayers: ["permits-co", "zoning-detail", "floodplain", "development-signals", "migration-demand"],
    productionGates:
      mode === "full"
        ? ["Run county QC before activation.", "Do not mark DCAD-like until optional layers and owner/appraisal gates pass."]
        : ["Run the explicit full service build before map/search activation.", "Sample services cannot be treated as production activation."],
    uiConstraint: "Do not redesign any White Rabbit pages. This is county parcel plumbing only.",
  };

  writeJson(manifestFile, manifest);
  writeJson(searchFile, {
    generatedAt,
    fields: SEARCH_INDEX_FIELDS,
    shardKeyLength: SEARCH_SHARD_KEY_LENGTH,
    shardCount: Object.keys(searchShardFiles).length,
    recordMembershipCount: searchShardRecordCount,
    mode,
    sourceCountyId: countyId,
  });
  writeReports({ countyId, config, adapter, manifest, outputDir, manifestFile, generatedAt });

  return {
    countyId,
    mode,
    featureCount: manifest.featureCount,
    chunkCount: manifest.chunkCount,
    searchShardCount: Object.keys(searchShardFiles).length,
    manifest: path.relative(root, manifestFile).replace(/\\/g, "/"),
  };
}

function requestedCounties() {
  const countyArg = process.argv.find((arg) => arg.startsWith("--county="));
  if (!countyArg || countyArg.endsWith("=all")) return Object.keys(COUNTY_CONFIGS);
  return countyArg.split("=")[1].split(",").map((value) => value.trim()).filter(Boolean);
}

function requestedMode() {
  return process.argv.includes("--full") ? "full" : "sample";
}

function requestedSampleLimit() {
  const sampleArg = process.argv.find((arg) => arg.startsWith("--sample=") || arg.startsWith("--limit="));
  return sampleArg ? Number(sampleArg.split("=")[1]) : 25;
}

async function main() {
  const mode = requestedMode();
  const sampleLimit = requestedSampleLimit();
  const results = [];
  for (const countyId of requestedCounties()) results.push(await buildCountyService(countyId, mode, sampleLimit));
  console.log(JSON.stringify({ built: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
