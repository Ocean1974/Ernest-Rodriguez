const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const GRID_SIZE = 48;
const SEARCH_SHARD_KEY_LENGTH = 2;
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

const SUPPORTED_COUNTIES = {
  "maricopa-county-az": {
    adapterPath: "data/county-adapters/maricopa-county-az/adapter.json",
    sampleGeojsonPath: "output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson",
    reportTitle: "Maricopa County AZ / Parcel Sample Service Report",
    fullBuildScriptNeeded: "Add a full Maricopa parcel service builder before app activation.",
  },
  "king-county-wa": {
    adapterPath: "data/county-adapters/king-county-wa/adapter.json",
    sampleGeojsonPath: "output/king-county-wa/king-county-wa-parcel-sample.geojson",
    reportTitle: "King County WA / Parcel Sample Service Report",
    fullBuildScriptNeeded: "Add a full King County parcel service builder before app activation.",
  },
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
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

function addSearchField(output, key, value) {
  if (value === null || value === undefined || value === "") return;
  output[key] = value;
}

function sameText(a, b) {
  return compact(a).toLowerCase() === compact(b).toLowerCase();
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

function mergeBounds(current, centroid) {
  if (!current) return { minX: centroid[0], minY: centroid[1], maxX: centroid[0], maxY: centroid[1] };
  return {
    minX: Math.min(current.minX, centroid[0]),
    minY: Math.min(current.minY, centroid[1]),
    maxX: Math.max(current.maxX, centroid[0]),
    maxY: Math.max(current.maxY, centroid[1]),
  };
}

function chunkIdFor(centroid) {
  const [x, y] = Array.isArray(centroid) ? centroid : [50, 50];
  const chunkX = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((Number(x) / 100) * GRID_SIZE)));
  const chunkY = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((Number(y) / 100) * GRID_SIZE)));
  return `${chunkX}-${chunkY}`;
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

function searchRecordFor(record, chunkId) {
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

function searchShardKeysFor(record, adapter) {
  const keys = new Set();
  [
    record.accountNum,
    record.accountNumber,
    record.sourceParcelId,
    record.gisParcelId,
    record.displayParcelId,
    record.countyParcelId,
    record.sourceCountyId,
    record.totalValue,
    adapter.countyName,
    adapter.marketName,
    adapter.appraisalDistrictName,
    adapter.appraisalDistrictAcronym,
  ].forEach((value) => addShardKey(keys, value, { allowShort: true }));
  [
    record.address,
    record.ownerName,
    record.propertyName,
    record.ownerName2,
    record.businessName,
    record.blockId,
    record.zoning,
    record.landUseCode,
    record.landUseDescription,
    adapter.countyName,
    adapter.marketName,
  ].forEach((value) => {
    addShardKey(keys, value);
    String(value || "")
      .split(/[^a-z0-9]+/i)
      .forEach((part) => addShardKey(keys, part));
  });
  return keys;
}

function buildSampleService(countyId) {
  const config = SUPPORTED_COUNTIES[countyId];
  if (!config) throw new Error(`Unsupported sample county: ${countyId}`);
  const adapter = readJson(config.adapterPath);
  const sample = readJson(config.sampleGeojsonPath);
  if (adapter.id !== countyId) throw new Error(`${countyId} adapter id mismatch`);
  if (sample.sourceCountyId !== countyId) throw new Error(`${countyId} sample source county mismatch`);

  const serviceDir = path.join(root, String(adapter.publicDataRoots?.parcels || `/data/counties/${countyId}/parcels/`).replace(/^\/data\//, "public/data/"));
  const chunksDir = path.join(serviceDir, "chunks");
  const searchDir = path.join(serviceDir, "search");
  const manifestFile = path.join(serviceDir, "manifest.json");
  const searchFile = path.join(serviceDir, "search-index.json");
  const outputDir = path.join(root, "output", countyId);

  ensureCleanDir(chunksDir);
  ensureCleanDir(searchDir);
  ensureDir(outputDir);

  const generatedAt = new Date().toISOString();
  const chunks = new Map();
  const searchShards = new Map();
  let skipped = 0;
  let searchIndexCount = 0;
  let recordMembershipCount = 0;
  let joinedAppraisalCount = 0;
  let joinedParcelDimensionCount = 0;

  for (const feature of sample.features || []) {
    const record = recordWithGeometry(feature, adapter);
    if (!Array.isArray(record.centroid)) {
      skipped += 1;
      continue;
    }
    const chunkId = chunkIdFor(record.centroid);
    if (!chunks.has(chunkId)) chunks.set(chunkId, { records: [], bounds: null });
    const chunk = chunks.get(chunkId);
    chunk.records.push(record);
    chunk.bounds = mergeBounds(chunk.bounds, record.centroid);

    if (record.joins?.ownerAppraisal || record.joins?.appraisal) joinedAppraisalCount += 1;
    if (record.joins?.parcelDimension || record.dimensions) joinedParcelDimensionCount += 1;

    const searchRecord = searchRecordFor(record, chunkId);
    const packedSearchRecord = packSearchRecord(searchRecord);
    for (const shardKey of searchShardKeysFor(searchRecord, adapter)) {
      if (!searchShards.has(shardKey)) searchShards.set(shardKey, []);
      searchShards.get(shardKey).push(packedSearchRecord);
      recordMembershipCount += 1;
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
  for (const [shardKey, records] of [...searchShards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = `${shardKey}.json`;
    writeJson(path.join(searchDir, fileName), { fields: SEARCH_INDEX_FIELDS, parcels: records });
    searchShardFiles[shardKey] = `search/${fileName}`;
    searchShardCounts[shardKey] = records.length;
  }

  const sourceVerifiedFeatureCount = Number(sample.sourceVerifiedFeatureCount || adapter.verifiedCounts?.parcelGeometryFeatures || 0);
  const manifest = {
    generatedAt,
    source: config.sampleGeojsonPath,
    sourceCountyId: countyId,
    mode: "sample",
    activationStatus: "pilot-sample-not-for-production-activation",
    sourceVerifiedFeatureCount,
    featureCount: searchIndexCount,
    skipped,
    sampleLimit: (sample.features || []).length,
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
      recordMembershipCount,
    },
    joinedAppraisalCount,
    joinedParcelDimensionCount,
    missingLayers: ["permits-co", "zoning", "floodplain", "development-signals", "migration-demand"],
    productionGates: [config.fullBuildScriptNeeded, "Do not activate in the app until a full service build and county QC pass."],
    uiConstraint: "Do not redesign any White Rabbit pages. This is sample plumbing only.",
  };

  writeJson(manifestFile, manifest);
  writeJson(searchFile, {
    generatedAt,
    fields: SEARCH_INDEX_FIELDS,
    shardKeyLength: SEARCH_SHARD_KEY_LENGTH,
    shardCount: Object.keys(searchShardFiles).length,
    recordMembershipCount,
    mode: manifest.mode,
    sourceCountyId: countyId,
  });

  const report = {
    generatedAt,
    county_id: countyId,
    mode: manifest.mode,
    activationStatus: manifest.activationStatus,
    sourceVerifiedFeatureCount,
    builtFeatureCount: manifest.featureCount,
    skipped,
    chunkCount: manifest.chunkCount,
    searchIndexCount: manifest.searchIndexCount,
    searchShardCount: Object.keys(searchShardFiles).length,
    serviceManifest: path.relative(root, manifestFile).replace(/\\/g, "/"),
    productionGates: manifest.productionGates,
    uiConstraint: manifest.uiConstraint,
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
      `- Source-verified feature count: ${sourceVerifiedFeatureCount.toLocaleString()}`,
      `- Built feature count: ${manifest.featureCount.toLocaleString()}`,
      `- Skipped features: ${skipped}`,
      `- Viewport chunks: ${manifest.chunkCount}`,
      `- Search records: ${manifest.searchIndexCount}`,
      `- Search shards: ${Object.keys(searchShardFiles).length}`,
      "",
      "## Output",
      "",
      `- Manifest: \`${report.serviceManifest}\``,
      `- Chunks: \`${path.relative(root, chunksDir).replace(/\\/g, "/")}/\``,
      `- Search shards: \`${path.relative(root, searchDir).replace(/\\/g, "/")}/\``,
      "",
      "## Production Gate",
      "",
      "- This is a pilot/sample service build.",
      `- ${config.fullBuildScriptNeeded}`,
      "- Do not activate this county in the app until a full service build and county QC pass.",
      "",
      "No White Rabbit page design changed in this step.",
      "",
    ].join("\n"),
  );

  return {
    countyId,
    featureCount: manifest.featureCount,
    chunkCount: manifest.chunkCount,
    searchShardCount: Object.keys(searchShardFiles).length,
    manifest: path.relative(root, manifestFile).replace(/\\/g, "/"),
  };
}

function requestedCounties() {
  const countyArg = process.argv.find((arg) => arg.startsWith("--county="));
  if (!countyArg || countyArg.endsWith("=all")) return Object.keys(SUPPORTED_COUNTIES);
  return countyArg.split("=")[1].split(",").map((value) => value.trim()).filter(Boolean);
}

const results = requestedCounties().map(buildSampleService);
console.log(JSON.stringify({ built: results }, null, 2));
