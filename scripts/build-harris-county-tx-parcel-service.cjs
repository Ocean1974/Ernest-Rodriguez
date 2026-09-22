const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adapterPath = path.join(root, "data", "county-adapters", "harris-county-tx", "adapter.json");
const sourceManifestPath = path.join(root, "data", "county-adapters", "harris-county-tx", "harris-county-parcel-source-manifest.json");
const outputDir = path.join(root, "output", "harris-county-tx");

const adapter = readJson(adapterPath);
const sourceManifest = readJson(sourceManifestPath);

const args = new Set(process.argv.slice(2));
const sampleArg = process.argv.find((arg) => arg.startsWith("--sample=") || arg.startsWith("--limit="));
const fullBuild = args.has("--full");
const sampleLimit = fullBuild ? Number.POSITIVE_INFINITY : sampleArg ? Number(sampleArg.split("=")[1]) : 500;
const pageSize = Math.min(Number(sourceManifest.query?.page_size || 2000), Number.isFinite(sampleLimit) ? sampleLimit : Number(sourceManifest.query?.page_size || 2000));
const serviceDir = path.join(root, String(adapter.publicDataRoots?.parcels || "/data/counties/harris-county-tx/parcels/").replace(/^\/data\//, "public/data/"));
const chunksDir = path.join(serviceDir, "chunks");
const searchDir = path.join(serviceDir, "search");
const manifestFile = path.join(serviceDir, "manifest.json");
const searchFile = path.join(serviceDir, "search-index.json");

const GRID_SIZE = 48;
const SEARCH_SHARD_KEY_LENGTH = 2;
const COUNTY_BOUNDS = adapter.map.geoBounds;
const SEARCH_INDEX_FIELDS = [
  "schemaVersion",
  "sourceCountyId",
  "countyParcelId",
  "accountNum",
  "accountNumber",
  "sourceParcelId",
  "gisParcelId",
  "address",
  "ownerName",
  "propertyName",
  "ownerName2",
  "businessName",
  "blockId",
  "landUseCode",
  "landUseDescription",
  "totalValue",
  "chunkId",
  "centroid",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureCleanDir(dir) {
  ensureDir(dir);
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
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
  if (!response.ok) throw new Error(`Harris County parcel service request failed ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Harris County parcel service response was not JSON: ${text.slice(0, 500)}`);
  }
}

async function fetchGeoJsonPage(offset, count) {
  const payload = await requestJson(
    arcgisQueryUrl({
      where: sourceManifest.query.primary_where,
      outFields: sourceManifest.query.out_fields.join(","),
      returnGeometry: "true",
      outSR: String(sourceManifest.query.geometry_out_sr),
      orderByFields: sourceManifest.query.order_by || "OBJECTID",
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

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function flattenRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.filter(Array.isArray);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => (Array.isArray(polygon) ? polygon : []));
  return [];
}

function largestRing(geometry) {
  const rings = flattenRings(geometry).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  if (!rings.length) return [];
  return [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
}

function simplifyRing(points, maxPoints = 40) {
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
    pointCount: points.length,
  };
}

function toScreenPoint([lng, lat]) {
  const x = ((lng - COUNTY_BOUNDS.minLng) / (COUNTY_BOUNDS.maxLng - COUNTY_BOUNDS.minLng)) * 100;
  const y = (1 - (lat - COUNTY_BOUNDS.minLat) / (COUNTY_BOUNDS.maxLat - COUNTY_BOUNDS.minLat)) * 100;
  return [Number(Math.min(100, Math.max(0, x)).toFixed(4)), Number(Math.min(100, Math.max(0, y)).toFixed(4))];
}

function chunkIdFor(centerLng, centerLat) {
  const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(((centerLng - COUNTY_BOUNDS.minLng) / (COUNTY_BOUNDS.maxLng - COUNTY_BOUNDS.minLng)) * GRID_SIZE)));
  const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(((centerLat - COUNTY_BOUNDS.minLat) / (COUNTY_BOUNDS.maxLat - COUNTY_BOUNDS.minLat)) * GRID_SIZE)));
  return `${x}-${y}`;
}

function siteAddress(properties) {
  return [
    properties.site_str_pfx,
    properties.site_str_num,
    properties.site_str_num_sfx,
    properties.site_str_name,
    properties.site_str_sfx,
    properties.site_str_sfx_dir,
  ]
    .map(compact)
    .filter(Boolean)
    .join(" ");
}

function legalDescription(properties) {
  return [properties.legal_dscr_1, properties.legal_dscr_2, properties.legal_dscr_3, properties.legal_dscr_4]
    .map(compact)
    .filter(Boolean)
    .join(" ");
}

function mapFeatureToParcel(feature) {
  const properties = feature.properties || {};
  const bounds = geometryBounds(feature.geometry);
  if (!bounds) return null;
  const hcadNum = compact(properties.HCAD_NUM);
  const accountNum = firstNonEmpty(properties.acct_num, hcadNum);
  const globalId = firstNonEmpty(properties.GlobalID, properties.OBJECTID);
  const sourceParcelId = firstNonEmpty(hcadNum, properties.LOWPARCELID, accountNum);
  const countyParcelId = `${adapter.id}:${globalId || accountNum || sourceParcelId}`;
  const address = firstNonEmpty(siteAddress(properties), properties.LOWPARCELID);
  const ring = simplifyRing(largestRing(feature.geometry));
  const centroid = toScreenPoint([bounds.centerLng, bounds.centerLat]);
  const areaLabel = [
    compact(properties.land_sqft) ? `${compact(properties.land_sqft)} land sq ft` : "",
    compact(properties.acreage_1) ? `${compact(properties.acreage_1)} acres` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    schemaVersion: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    accountNum,
    accountNumber: accountNum,
    sourceParcelId,
    gisParcelId: globalId,
    address,
    propertyAddress: address,
    city: compact(properties.site_city),
    propertyZip: compact(properties.site_zip),
    propertyName: `HCAD Parcel ${sourceParcelId || accountNum}`,
    ownerName: compact(properties.owner_name_1),
    ownerName2: [properties.owner_name_2, properties.owner_name_3].map(compact).filter(Boolean).join(" "),
    businessName: "",
    ownerMailingAddress: compact(properties.mail_addr_1),
    ownerMailingAddress2: compact(properties.mail_addr_2),
    ownerCity: compact(properties.mail_city),
    ownerState: compact(properties.mail_state),
    ownerZip: compact(properties.mail_zip),
    ownerPhone: "",
    ownerEmail: "",
    landValue: compact(properties.land_value),
    improvementValue: firstNonEmpty(properties.impr_value, properties.bld_value),
    totalValue: firstNonEmpty(properties.total_appraised_val, properties.total_market_val, properties.tax_value),
    landUseCode: compact(properties.land_use),
    landUseDescription: compact(properties.dscr),
    landAreaSize: firstNonEmpty(properties.acreage_1, properties.Acreage),
    landAreaUnit: "acres",
    landAreaSqFt: firstNonEmpty(properties.land_sqft, properties.Shape__Area),
    areaLabel,
    perimeter: compact(properties.Shape__Length),
    blockId: [properties.BLK_NUM ? `BLK ${compact(properties.BLK_NUM)}` : "", properties.LOT_NUM ? `LOT ${compact(properties.LOT_NUM)}` : "", properties.map_facet ? `MAP ${compact(properties.map_facet)}` : ""]
      .filter(Boolean)
      .join(" "),
    centroid,
    points: ring.map(toScreenPoint),
    liveGeometry: {
      center: [Number(bounds.centerLng.toFixed(7)), Number(bounds.centerLat.toFixed(7))],
      points: ring.map(([lng, lat]) => [Number(lng.toFixed(7)), Number(lat.toFixed(7))]),
    },
    realGeometry: {
      type: "Feature",
      properties: { countyParcelId, accountNum, sourceParcelId, gisParcelId: globalId },
      geometry: feature.geometry,
    },
    dimensions: {
      perimeterFt: compact(properties.Shape__Length),
      areaSqFt: firstNonEmpty(properties.land_sqft, properties.Shape__Area),
      acreage: firstNonEmpty(properties.acreage_1, properties.Acreage),
      dimensionLabel: areaLabel,
      sourceLayer: "Harris County parcel/property FeatureServer",
      frontageFt: "",
      depthFt: "",
    },
    joins: {
      accountInfo: Boolean(accountNum),
      hcadOwnerAppraisal: true,
      appraisal: Boolean(properties.land_value || properties.impr_value || properties.total_appraised_val || properties.total_market_val),
      land: Boolean(properties.land_sqft || properties.land_use || properties.acreage_1 || properties.Acreage),
      parcelDimension: Boolean(properties.Shape__Area || properties.Shape__Length || properties.land_sqft),
      permits: false,
      zoning: false,
      floodplain: false,
      developmentSignals: false,
      migrationDemand: false,
    },
    sourceReferences: {
      harris: {
        OBJECTID: properties.OBJECTID ?? "",
        LOWPARCELID: properties.LOWPARCELID ?? "",
        HCAD_NUM: properties.HCAD_NUM ?? "",
        acct_num: properties.acct_num ?? "",
        GlobalID: properties.GlobalID ?? "",
        state_class: properties.state_class ?? "",
        legalDescription: legalDescription(properties),
        Shape__Area: properties.Shape__Area ?? "",
        Shape__Length: properties.Shape__Length ?? "",
        sourceSpatialReference: sourceManifest.source_spatial_reference.label,
      },
    },
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
  addSearchField(output, "countyParcelId", record.countyParcelId);
  addSearchField(output, "accountNumber", record.accountNumber);
  addSearchField(output, "sourceParcelId", record.sourceParcelId);
  if (!sameText(record.gisParcelId, record.accountNum)) addSearchField(output, "gisParcelId", record.gisParcelId);
  addSearchField(output, "address", record.address);
  addSearchField(output, "ownerName", record.ownerName);
  if (!sameText(record.propertyName, record.ownerName)) addSearchField(output, "propertyName", record.propertyName);
  if (!sameText(record.ownerName2, record.ownerName)) addSearchField(output, "ownerName2", record.ownerName2);
  addSearchField(output, "businessName", record.businessName);
  addSearchField(output, "blockId", record.blockId);
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
  [record.accountNum, record.accountNumber, record.sourceParcelId, record.gisParcelId, record.countyParcelId, record.sourceCountyId, record.totalValue].forEach((value) =>
    addShardKey(keys, value, { allowShort: true }),
  );
  [record.address, record.ownerName, record.propertyName, record.ownerName2, record.businessName, record.blockId, record.landUseCode, record.landUseDescription].forEach((value) => {
    addShardKey(keys, value);
    String(value || "")
      .split(/[^a-z0-9]+/i)
      .forEach((part) => addShardKey(keys, part));
  });
  return keys;
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

function writeReports(manifest, generatedAt) {
  const report = {
    generatedAt,
    county_id: adapter.id,
    mode: manifest.mode,
    activationStatus: manifest.activationStatus,
    sourceVerifiedFeatureCount: manifest.sourceVerifiedFeatureCount,
    builtFeatureCount: manifest.featureCount,
    skipped: manifest.skipped,
    chunkCount: manifest.chunkCount,
    searchIndexCount: manifest.searchIndexCount,
    searchShardCount: Object.keys(manifest.searchIndexShards.files).length,
    serviceManifest: "public/data/counties/harris-county-tx/parcels/manifest.json",
    productionGates: manifest.mode === "full" ? [] : ["Run the explicit full Harris service build before activating the county in the app."],
    uiConstraint: "No White Rabbit page design changed. Harris remains pilot until the full service is verified.",
  };
  writePrettyJson(path.join(outputDir, "parcel-service-report.json"), report);
  writeText(
    path.join(outputDir, "parcel-service-report.md"),
    [
      "# Harris County TX / Parcel Service Report",
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
      "- Manifest: `public/data/counties/harris-county-tx/parcels/manifest.json`",
      "- Chunks: `public/data/counties/harris-county-tx/parcels/chunks/`",
      "- Search shards: `public/data/counties/harris-county-tx/parcels/search/`",
      "",
      "## Production Gate",
      "",
      manifest.mode === "full"
        ? "This is a full service build. Keep Harris disabled until county QC confirms the manifest count, chunk count, search shards, and optional layers."
        : "This is a pilot/sample service build. Run the explicit full Harris service build before activating Harris in the app.",
      "",
      "No White Rabbit page design changed in this step.",
      "",
    ].join("\n"),
  );
}

async function main() {
  if (adapter.id !== "harris-county-tx") throw new Error("Harris parcel service builder must use county_id harris-county-tx");
  ensureDir(outputDir);
  ensureCleanDir(chunksDir);
  ensureCleanDir(searchDir);

  const generatedAt = new Date().toISOString();
  const chunks = new Map();
  const searchShards = new Map();
  let fetched = 0;
  let skipped = 0;
  let searchIndexCount = 0;
  let searchShardRecordCount = 0;
  let joinedAppraisalCount = 0;
  let joinedParcelDimensionCount = 0;

  while (fetched < sampleLimit) {
    const remaining = Number.isFinite(sampleLimit) ? sampleLimit - fetched : pageSize;
    const count = Math.min(pageSize, remaining || pageSize);
    const features = await fetchGeoJsonPage(fetched, count);
    if (!features.length) break;
    for (const feature of features) {
      const record = mapFeatureToParcel(feature);
      fetched += 1;
      if (!record) {
        skipped += 1;
        continue;
      }
      const chunkId = chunkIdFor(record.liveGeometry.center[0], record.liveGeometry.center[1]);
      if (!chunks.has(chunkId)) chunks.set(chunkId, { records: [], bounds: null });
      const chunk = chunks.get(chunkId);
      chunk.records.push(record);
      chunk.bounds = mergeBounds(chunk.bounds, record.centroid);

      if (record.joins?.appraisal) joinedAppraisalCount += 1;
      if (record.joins?.parcelDimension) joinedParcelDimensionCount += 1;

      const searchRecord = searchRecordFor(record, chunkId);
      const packedSearchRecord = packSearchRecord(searchRecord);
      for (const shardKey of searchShardKeysFor(searchRecord)) {
        if (!searchShards.has(shardKey)) searchShards.set(shardKey, []);
        searchShards.get(shardKey).push(packedSearchRecord);
        searchShardRecordCount += 1;
      }
      searchIndexCount += 1;
    }
    if (features.length < count) break;
    if (fetched % 50000 === 0) console.log(`Prepared ${fetched.toLocaleString()} Harris parcel service records...`);
  }

  const chunkManifest = [];
  for (const [chunkId, chunk] of chunks) {
    const fileName = `${chunkId}.json`;
    writeJson(path.join(chunksDir, fileName), { chunkId, parcels: chunk.records });
    chunkManifest.push({ id: chunkId, file: `chunks/${fileName}`, count: chunk.records.length, bounds: chunk.bounds });
  }

  const searchShardFiles = {};
  const searchShardCounts = {};
  for (const [shardKey, records] of [...searchShards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = `${shardKey}.json`;
    writeJson(path.join(searchDir, fileName), { fields: SEARCH_INDEX_FIELDS, parcels: records });
    searchShardFiles[shardKey] = `search/${fileName}`;
    searchShardCounts[shardKey] = records.length;
  }

  const manifest = {
    generatedAt,
    source: sourceManifest.arcgis_rest_url,
    sourceCountyId: adapter.id,
    mode: fullBuild ? "full" : "sample",
    activationStatus: fullBuild ? "map-search-pilot-active" : "pilot-sample-not-for-production-activation",
    sourceVerifiedFeatureCount: sourceManifest.verified_counts.all_layer_features,
    featureCount: fetched - skipped,
    skipped,
    sampleLimit: Number.isFinite(sampleLimit) ? sampleLimit : null,
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
    joinedParcelDimensionCount,
    missingLayers: ["permits-co", "zoning", "floodplain", "development-signals", "migration-demand"],
    uiConstraint: "Do not redesign any White Rabbit pages. Harris remains pilot until full QC passes.",
  };

  writeJson(manifestFile, manifest);
  writeJson(searchFile, {
    generatedAt,
    fields: SEARCH_INDEX_FIELDS,
    shardKeyLength: SEARCH_SHARD_KEY_LENGTH,
    shardCount: Object.keys(searchShardFiles).length,
    recordMembershipCount: searchShardRecordCount,
    mode: manifest.mode,
    sourceCountyId: adapter.id,
  });
  writeReports(manifest, generatedAt);

  console.log(`Wrote ${path.relative(root, manifestFile)}`);
  console.log(`Wrote ${path.relative(root, searchFile)}`);
  console.log(`Wrote output/harris-county-tx/parcel-service-report.json`);
  console.log(`Wrote output/harris-county-tx/parcel-service-report.md`);
  console.log(JSON.stringify({ mode: manifest.mode, featureCount: manifest.featureCount, chunkCount: manifest.chunkCount, searchShardCount: Object.keys(searchShardFiles).length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
