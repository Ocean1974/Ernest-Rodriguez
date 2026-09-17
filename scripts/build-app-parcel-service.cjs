const fs = require("fs");
const path = require("path");
const { resolveCountyAdapter } = require("./county-adapter-utils.cjs");
const {
  WHITE_RABBIT_LINEAGE_VERSION,
  WHITE_RABBIT_PROPERTY_ID_VERSION,
  createDataLineage,
  createWhiteRabbitPropertyId,
} = require("./property-identity.cjs");

const root = path.join(__dirname, "..");
const { adapter } = resolveCountyAdapter();
const publicRoot = String(adapter.publicDataRoots?.parcels || "/data/parcels/").replace(/^\/data\//, "public/data/");
const inputFile = path.join(root, adapter.productionOutputs?.parcelGeojson || "output/white-rabbit-dallas-parcels.geojson");
const serviceDir = path.join(root, publicRoot);
const chunksDir = path.join(serviceDir, "chunks");
const searchDir = path.join(serviceDir, "search");
const manifestFile = path.join(serviceDir, "manifest.json");
const searchFile = path.join(serviceDir, "search-index.json");

const GRID_SIZE = 48;
const MAX_SEARCH_RECORDS = Number.POSITIVE_INFINITY;
const SEARCH_SHARD_KEY_LENGTH = 2;
const SERVICE_GENERATED_AT = new Date().toISOString();
const UNIVERSAL_PARCEL_SCHEMA_VERSION = adapter.universalParcelSchema?.version || "wr-universal-parcel-v1";
const SOURCE_COUNTY_ID = adapter.id;
const SEARCH_INDEX_FIELDS = [
  "schemaVersion",
  "sourceCountyId",
  "whiteRabbitPropertyId",
  "countyParcelId",
  "accountNum",
  "gisParcelId",
  "address",
  "ownerName",
  "propertyName",
  "ownerName2",
  "businessName",
  "blockId",
  "buildingClass",
  "zoning",
  "landUseCode",
  "landUseDescription",
  "totalValue",
  "chunkId",
  "centroid",
];
const COUNTY_BOUNDS = adapter.map?.geoBounds || {
  minLng: -97.1,
  minLat: 32.55,
  maxLng: -96.45,
  maxLat: 33.05,
};

function ensureCleanDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function flattenCoordinates(coordinates, points = []) {
  if (!Array.isArray(coordinates)) return points;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    points.push([coordinates[0], coordinates[1]]);
    return points;
  }
  coordinates.forEach((child) => flattenCoordinates(child, points));
  return points;
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
    pointCount: points.length,
  };
}

function toScreenPoint(lng, lat) {
  const x = ((lng - COUNTY_BOUNDS.minLng) / (COUNTY_BOUNDS.maxLng - COUNTY_BOUNDS.minLng)) * 100;
  const y = (1 - (lat - COUNTY_BOUNDS.minLat) / (COUNTY_BOUNDS.maxLat - COUNTY_BOUNDS.minLat)) * 100;
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

function simplifyRing(points, maxPoints = 24) {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const simplified = [];
  for (let index = 0; index < points.length; index += stride) simplified.push(points[index]);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) simplified.push(first);
  return simplified;
}

function screenPolygon(geometry) {
  const points = flattenCoordinates(geometry?.coordinates);
  return simplifyRing(points).map(([lng, lat]) => toScreenPoint(lng, lat));
}

function chunkIdFor(centerLng, centerLat) {
  const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(((centerLng - COUNTY_BOUNDS.minLng) / (COUNTY_BOUNDS.maxLng - COUNTY_BOUNDS.minLng)) * GRID_SIZE)));
  const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(((centerLat - COUNTY_BOUNDS.minLat) / (COUNTY_BOUNDS.maxLat - COUNTY_BOUNDS.minLat)) * GRID_SIZE)));
  return `${x}-${y}`;
}

function pickProperties(feature, bounds) {
  const properties = feature.properties || {};
  const accountNum = String(properties.accountNumber || properties.accountNum || properties.Acct || "").trim();
  const gisParcelId = String(properties.gisParcelId || properties.GIS_PARCEL_ID || accountNum || "").trim();
  const countyParcelId = `${SOURCE_COUNTY_ID}:${accountNum || gisParcelId}`;
  const whiteRabbitPropertyId = createWhiteRabbitPropertyId({ sourceCountyId: SOURCE_COUNTY_ID, sourceParcelId: accountNum || gisParcelId });
  const address = String(properties.propertyAddress || properties.address || "").trim();
  const propertyName = String(properties.ownerPropertyName || properties.propertyName || properties.ownerName || "").trim();
  const ownerName = String(properties.ownerName || properties.ownerPropertyName || propertyName || "").trim();
  const totalValue = properties.totalValue ?? "";
  const landValue = properties.landValue ?? "";
  const improvementValue = properties.improvementValue ?? "";
  const [screenX, screenY] = toScreenPoint(bounds.centerLng, bounds.centerLat);

  return {
    schemaVersion: UNIVERSAL_PARCEL_SCHEMA_VERSION,
    sourceCountyId: SOURCE_COUNTY_ID,
    whiteRabbitPropertyId,
    countyParcelId,
    accountNum,
    accountNumber: accountNum,
    gisParcelId,
    address,
    propertyAddress: address,
    propertyName,
    ownerName,
    ownerName2: properties.ownerName2 || "",
    businessName: properties.businessName || "",
    ownerMailingAddress: properties.ownerMailingAddress || "",
    ownerMailingAddress2: properties.ownerMailingAddress2 || "",
    ownerCity: properties.ownerCity || "",
    ownerState: properties.ownerState || "",
    ownerZip: properties.ownerZip || "",
    ownerCountry: properties.ownerCountry || "",
    ownerPhone: properties.ownerPhone || "",
    ownerEmail: properties.ownerEmail || "",
    city: properties.city || properties.propertyCity || "",
    propertyZip: properties.zip || properties.propertyZip || "",
    buildingClass: properties.buildingClass || "",
    zoning: properties.zoning || "",
    landUseCode: properties.landUseCode || "",
    landUseDescription: properties.landUseDescription || "",
    landSection: properties.landSection || "",
    landAreaSize: properties.landAreaSize ?? "",
    landAreaUnit: properties.landAreaUnit || "",
    landPricingMethod: properties.landPricingMethod || "",
    landCostPerUnit: properties.landCostPerUnit ?? "",
    landMarketAdjustmentPct: properties.landMarketAdjustmentPct ?? "",
    landValuationAmount: properties.landValuationAmount ?? "",
    yearBuilt: properties.yearBuilt || "",
    grossBuildingArea: properties.grossBuildingArea || "",
    landAreaSqFt: properties.landSquareFeet || properties.landAreaSqFt || "",
    landValue,
    improvementValue,
    totalValue,
    cityJurisdiction: properties.jurisdiction || properties.cityJurisdiction || "",
    isdJurisdiction: properties.isd || properties.ISD || properties.isdJurisdiction || "",
    quality: properties.quality || "",
    condition: properties.condition || "",
    blockId: properties.blockId || "",
    areaLabel: properties.parcelRecordedAcreage || properties.areaLabel || "",
    frontage: properties.frontage || "",
    depth: properties.depth || "",
    perimeter: properties.perimeter || "",
    centroid: [screenX, screenY],
    points: screenPolygon(feature.geometry),
    liveGeometry: {
      center: [Number(bounds.centerLng.toFixed(7)), Number(bounds.centerLat.toFixed(7))],
      points: simplifyRing(flattenCoordinates(feature.geometry?.coordinates), 40).map(([lng, lat]) => [Number(lng.toFixed(7)), Number(lat.toFixed(7))]),
    },
    realGeometry: {
      type: "Feature",
      properties: { accountNum },
      geometry: feature.geometry,
    },
    dimensions: {
      dimensionId: properties.parcelDimension ? `PDIM-${accountNum}` : "",
      frontageFt: properties.frontage || "",
      depthFt: properties.depth || "",
      perimeterFt: properties.perimeter || "",
      dimensionLabel: [properties.frontage, properties.depth].filter(Boolean).join(" x "),
      sourceLayer: properties.parcelDimension ? "ParcelDimension" : "",
    },
    joins: properties.joins || {},
    sourceReferences: properties.sourceReferences || properties.sources || {},
    dataLineage: createDataLineage({
      sourceCountyId: SOURCE_COUNTY_ID,
      sourceDataset: path.relative(root, inputFile).replace(/\\/g, "/"),
      sourceUpdatedAt: adapter.sourceUpdatedAt || "",
      generatedAt: SERVICE_GENERATED_AT,
      maxAgeDays: adapter.freshnessPolicy?.maxAgeDays || 120,
    }),
  };
}

function addSearchField(output, key, value) {
  if (value === null || value === undefined || value === "") return;
  output[key] = value;
}

function sameText(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function searchRecordFor(record, chunkId) {
  const output = {};
  addSearchField(output, "accountNum", record.accountNum);
  addSearchField(output, "schemaVersion", record.schemaVersion);
  addSearchField(output, "sourceCountyId", record.sourceCountyId);
  addSearchField(output, "whiteRabbitPropertyId", record.whiteRabbitPropertyId);
  addSearchField(output, "countyParcelId", record.countyParcelId);
  if (!sameText(record.gisParcelId, record.accountNum)) addSearchField(output, "gisParcelId", record.gisParcelId);
  addSearchField(output, "address", record.address);
  addSearchField(output, "ownerName", record.ownerName);
  if (!sameText(record.propertyName, record.ownerName)) addSearchField(output, "propertyName", record.propertyName);
  if (!sameText(record.ownerName2, record.ownerName)) addSearchField(output, "ownerName2", record.ownerName2);
  if (!sameText(record.businessName, record.ownerName) && !sameText(record.businessName, record.propertyName)) addSearchField(output, "businessName", record.businessName);
  addSearchField(output, "blockId", record.blockId);
  addSearchField(output, "buildingClass", record.buildingClass);
  addSearchField(output, "zoning", record.zoning);
  addSearchField(output, "landUseCode", record.landUseCode);
  addSearchField(output, "landUseDescription", record.landUseDescription);
  addSearchField(output, "totalValue", record.totalValue);
  output.chunkId = chunkId;
  output.centroid = record.centroid;
  return output;
}

function packSearchRecord(record) {
  const values = SEARCH_INDEX_FIELDS.map((field) => record[field] ?? "");
  while (values.length && values[values.length - 1] === "") values.pop();
  return values;
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

function searchShardKeysFor(record) {
  const keys = new Set();
  [record.accountNum, record.gisParcelId, record.countyParcelId, record.sourceCountyId, record.totalValue].forEach((value) => addShardKey(keys, value, { allowShort: true }));
  [record.address, record.ownerName, record.propertyName, record.ownerName2, record.businessName, record.blockId, record.buildingClass, record.zoning].forEach((value) => {
    addShardKey(keys, value);
    String(value || "")
      .split(/[^a-z0-9]+/i)
      .forEach((part) => addShardKey(keys, part));
  });
  return keys;
}

async function streamFeatureObjects(file, onFeature) {
  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let preamble = "";
  let started = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = "";
  let count = 0;

  for await (const chunk of stream) {
    let index = 0;
    if (!started) {
      preamble += chunk;
      const marker = preamble.indexOf('"features":[');
      if (marker < 0) {
        preamble = preamble.slice(-32);
        continue;
      }
      index = preamble.indexOf("[", marker) + 1;
      started = true;
      const pending = preamble.slice(index);
      preamble = "";
      for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
        const char = pending[pendingIndex];
        if (inString) {
          current += char;
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') {
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
            await onFeature(current, count);
            count += 1;
            current = "";
          }
        } else if (depth > 0) {
          current += char;
        } else if (char === "]") {
          return count;
        }
      }
      continue;
    }

    for (; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (inString) {
        current += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
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
          await onFeature(current, count);
          count += 1;
          current = "";
        }
      } else if (depth > 0) {
        current += char;
      } else if (char === "]") {
        return count;
      }
    }
  }
  return count;
}

async function main() {
  if (!fs.existsSync(inputFile)) throw new Error(`Missing ${inputFile}`);
  fs.mkdirSync(serviceDir, { recursive: true });
  ensureCleanDir(chunksDir);
  ensureCleanDir(searchDir);

  const chunks = new Map();
  const searchShards = new Map();
  let searchIndexCount = 0;
  let searchShardRecordCount = 0;
  let joinedAppraisalCount = 0;
  let joinedBlkIdCount = 0;
  let joinedParcelDimensionCount = 0;
  let skipped = 0;

  const featureCount = await streamFeatureObjects(inputFile, async (featureText, index) => {
    const feature = JSON.parse(featureText);
    const bounds = geometryBounds(feature.geometry);
    if (!bounds) {
      skipped += 1;
      return;
    }
    const record = pickProperties(feature, bounds);
    const chunkId = chunkIdFor(bounds.centerLng, bounds.centerLat);
    if (!chunks.has(chunkId)) chunks.set(chunkId, []);
    chunks.get(chunkId).push(record);
    if (record.joins?.appraisal) joinedAppraisalCount += 1;
    if (record.blockId) joinedBlkIdCount += 1;
    if (record.joins?.parcelDimension) joinedParcelDimensionCount += 1;
    if (
      searchIndexCount < MAX_SEARCH_RECORDS &&
      [
        record.address,
        record.accountNum,
        record.gisParcelId,
        record.propertyName,
        record.ownerName,
        record.ownerName2,
        record.businessName,
        record.ownerMailingAddress,
        record.blockId,
        record.buildingClass,
        record.zoning,
        record.landUseCode,
        record.landUseDescription,
        record.totalValue,
      ].some(Boolean)
    ) {
      const searchRecord = searchRecordFor(record, chunkId);
      const packedSearchRecord = packSearchRecord(searchRecord);
      for (const shardKey of searchShardKeysFor(searchRecord)) {
        if (!searchShards.has(shardKey)) searchShards.set(shardKey, []);
        searchShards.get(shardKey).push(packedSearchRecord);
        searchShardRecordCount += 1;
      }
      searchIndexCount += 1;
    }
    if ((index + 1) % 50000 === 0) console.log(`Prepared ${(index + 1).toLocaleString()} parcel records...`);
  });

  const chunkManifest = [];
  for (const [chunkId, records] of chunks) {
    const fileName = `${chunkId}.json`;
    fs.writeFileSync(path.join(chunksDir, fileName), JSON.stringify({ chunkId, parcels: records }));
    const bounds = records.reduce(
      (acc, record) => ({
        minX: Math.min(acc.minX, record.centroid[0]),
        minY: Math.min(acc.minY, record.centroid[1]),
        maxX: Math.max(acc.maxX, record.centroid[0]),
        maxY: Math.max(acc.maxY, record.centroid[1]),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    chunkManifest.push({ id: chunkId, file: `chunks/${fileName}`, count: records.length, bounds });
  }

  const searchShardFiles = {};
  const searchShardCounts = {};
  for (const [shardKey, records] of [...searchShards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = `${shardKey}.json`;
    fs.writeFileSync(path.join(searchDir, fileName), JSON.stringify({ fields: SEARCH_INDEX_FIELDS, parcels: records }));
    searchShardFiles[shardKey] = `search/${fileName}`;
    searchShardCounts[shardKey] = records.length;
  }

  const manifest = {
    generatedAt: SERVICE_GENERATED_AT,
    source: path.relative(root, inputFile).replace(/\\/g, "/"),
    sourceCountyId: SOURCE_COUNTY_ID,
    schemaVersion: UNIVERSAL_PARCEL_SCHEMA_VERSION,
    identityContract: {
      version: WHITE_RABBIT_PROPERTY_ID_VERSION,
      field: "whiteRabbitPropertyId",
      format: "wrp:v1:<sourceCountyId>:<encodedSourceParcelId>",
    },
    lineageContract: {
      version: WHITE_RABBIT_LINEAGE_VERSION,
      sourceUpdatedAt: adapter.sourceUpdatedAt || "",
      freshnessMaxAgeDays: adapter.freshnessPolicy?.maxAgeDays || 120,
    },
    featureCount: featureCount - skipped,
    skipped,
    chunkCount: chunkManifest.length,
    gridSize: GRID_SIZE,
    bounds: COUNTY_BOUNDS,
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
    joinedBlkIdCount,
    joinedParcelDimensionCount,
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(
    searchFile,
    JSON.stringify({
      generatedAt: manifest.generatedAt,
      fields: SEARCH_INDEX_FIELDS,
      shardKeyLength: SEARCH_SHARD_KEY_LENGTH,
      shardCount: Object.keys(searchShardFiles).length,
      recordMembershipCount: searchShardRecordCount,
    }),
  );
  console.log(`Wrote ${manifestFile}`);
  console.log(`Wrote ${searchFile}`);
  console.log(`Chunks: ${manifest.chunkCount}`);
  console.log(`Search shards: ${Object.keys(searchShardFiles).length}`);
  console.log(`Parcels: ${manifest.featureCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
