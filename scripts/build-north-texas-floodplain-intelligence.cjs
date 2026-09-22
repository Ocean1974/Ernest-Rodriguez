const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ringBounds, pointInPolygon, makeGrid, clean } = require("./tarrant-intelligence-utils.cjs");

const root = path.resolve(__dirname, "..");
const FEMA_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";
const FIELDS = ["OBJECTID", "FLD_AR_ID", "FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "V_DATUM", "DEPTH", "LEN_UNIT", "VELOCITY", "VEL_UNIT", "SOURCE_CIT", "GlobalID"];
const CONFIG = {
  "collin-county-tx": { bounds: { minLng: -96.95, minLat: 32.95, maxLng: -96.3, maxLat: 33.45 } },
  "denton-county-tx": { bounds: { minLng: -97.55, minLat: 32.95, maxLng: -96.75, maxLat: 33.45 } },
};
function pathArgument(name, fallback) { const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1); return path.resolve(root, raw || fallback); }

function assertWorkspace(target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${resolved}`);
}
function ensureDir(dir) { assertWorkspace(dir); fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) { ensureDir(dir); for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); }
function writeJson(file, value, pretty = false) {
  ensureDir(path.dirname(file)); const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`); fs.renameSync(temporary, file);
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function envelope(bounds) { return `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`; }
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function sourceRings(feature) { return feature.geometry?.rings || []; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function request(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000), headers: { accept: "application/json", ...(options.headers || {}) } });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(`ArcGIS ${payload.error.code || ""}: ${payload.error.message || "query error"}`);
    return { payload, text };
  } catch (error) {
    if (attempt >= 5) throw new Error(`${url}: ${error.message}`);
    await sleep(attempt * 1000); return request(url, options, attempt + 1);
  }
}

async function captureFema(countyId, bounds) {
  const rawDir = path.join(root, "data", "raw", countyId, "fema-nfhl"); ensureDir(rawDir);
  const base = { where: "1=1", geometry: envelope(bounds), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" };
  const idsUrl = `${FEMA_URL}/query?${new URLSearchParams({ ...base, returnIdsOnly: "true", f: "json" })}`;
  const idsResponse = await request(idsUrl); const objectIds = (idsResponse.payload.objectIds || []).map(Number).sort((a, b) => a - b);
  const batches = []; for (let index = 0; index < objectIds.length; index += 200) batches.push(objectIds.slice(index, index + 200));
  const features = []; const pageHashes = [];
  const requestFeatures = async (ids) => {
    try {
      return await request(`${FEMA_URL}/query`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ ...base, where: `OBJECTID IN (${ids.join(",")})`, outFields: FIELDS.join(","), returnGeometry: "true", outSR: "4326", geometryPrecision: "7", maxAllowableOffset: "0.00002", returnTrueCurves: "false", f: "json" }),
      });
    } catch (error) {
      if (ids.length <= 1) throw error;
      const midpoint = Math.ceil(ids.length / 2);
      const [left, right] = await Promise.all([requestFeatures(ids.slice(0, midpoint)), requestFeatures(ids.slice(midpoint))]);
      return { payload: { features: [...(left.payload.features || []), ...(right.payload.features || [])] }, text: `${left.text}${right.text}` };
    }
  };
  for (let index = 0; index < batches.length; index += 6) {
    const group = batches.slice(index, index + 6);
    const results = await Promise.all(group.map(requestFeatures));
    for (const result of results) { features.push(...(result.payload.features || [])); pageHashes.push(sha256(result.text)); }
    console.log(`${countyId}: captured ${Math.min(index + group.length, batches.length)}/${batches.length} FEMA batches`);
  }
  const distinct = new Set(features.map((feature) => feature.attributes?.OBJECTID));
  if (distinct.size !== objectIds.length) throw new Error(`${countyId} FEMA capture mismatch: ${distinct.size}/${objectIds.length}`);
  const snapshot = { sourceId: "fema-nfhl-flood-hazard-areas", sourceTitle: "FEMA National Flood Hazard Layer - Flood Hazard Zones", sourceUrl: FEMA_URL, observedAt: new Date().toISOString(), queryEnvelope: envelope(bounds), sourceFeatureCount: features.length, distinctObjectIdCount: distinct.size, outSpatialReference: 4326, maxAllowableOffsetDegrees: 0.00002, fields: FIELDS, pageHashes, rightsStatus: "official-federal-public-source-derived-index" };
  writeJson(path.join(rawDir, "snapshot.json"), snapshot, true);
  return { features, snapshot };
}

function makePolygonGrid(features, bounds) {
  const grid = makeGrid(bounds, 220, 180); const polygons = [];
  for (const feature of features) {
    const rings = sourceRings(feature); const boundsForFeature = ringBounds(rings); if (!boundsForFeature) continue;
    const item = { feature, rings, bounds: boundsForFeature }; polygons.push(item); grid.add(item, boundsForFeature);
  }
  return { grid, polygons };
}

function parcelRows(parcelRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8"));
  return { manifest, *[Symbol.iterator]() {
    for (const chunk of manifest.chunks || []) {
      const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
      for (const parcel of payload.parcels || []) yield { parcel, chunkId: clean(chunk.id || payload.chunkId) };
    }
  } };
}

function buildCounty(countyId, config, capture) {
  const parcelRoot = pathArgument("--parcel-root", path.join("public", "data", "counties", countyId, "parcels"));
  const floodRoot = pathArgument("--output-root", path.join("public", "data", "counties", countyId, "floodplain"));
  const outputRoot = path.join(root, "output", countyId); const adapterFile = path.join(root, "data", "county-adapters", countyId, "adapter.json");
  clearDir(floodRoot); ensureDir(outputRoot);
  const { grid, polygons } = makePolygonGrid(capture.features, config.bounds);
  const rows = parcelRows(parcelRoot); const shards = new Map(); let scanned = 0; let classified = 0; let sfhaCount = 0;
  const fields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "label", "floodZones", "zoneSubtypes", "sfha", "baseFloodElevations", "verticalDatums", "depths", "velocities", "sourceCitations", "sourceObjectIds"];
  for (const { parcel, chunkId } of rows) {
    scanned += 1; const point = parcel.liveGeometry?.center;
    if (!Array.isArray(point) || !point.every(Number.isFinite)) continue;
    const hits = grid.at(point).filter((item) => pointInPolygon(point, item.rings)); if (!hits.length) continue;
    const attrs = hits.map((item) => item.feature.attributes || {}); const zones = unique(attrs.map((a) => a.FLD_ZONE)); const sfha = unique(attrs.map((a) => a.SFHA_TF));
    if (sfha.some((value) => /^(T|Y|1)$/i.test(value))) sfhaCount += 1;
    const record = {
      countyParcelId: clean(parcel.countyParcelId), accountNum: clean(parcel.accountNum || parcel.accountNumber), gisParcelId: clean(parcel.gisParcelId), parcelChunkId: chunkId,
      label: zones.length ? `FEMA NFHL: ${zones.join(" / ")}` : "FEMA NFHL flood-hazard polygon", floodZones: zones, zoneSubtypes: unique(attrs.map((a) => a.ZONE_SUBTY)), sfha,
      baseFloodElevations: unique(attrs.map((a) => a.STATIC_BFE)), verticalDatums: unique(attrs.map((a) => a.V_DATUM)), depths: unique(attrs.map((a) => a.DEPTH)), velocities: unique(attrs.map((a) => a.VELOCITY)),
      sourceCitations: unique(attrs.map((a) => a.SOURCE_CIT || FEMA_URL)), sourceObjectIds: unique(attrs.map((a) => a.OBJECTID)),
    };
    const key = sha256(record.accountNum || record.countyParcelId).slice(0, 2); if (!shards.has(key)) shards.set(key, []); shards.get(key).push(fields.map((field) => record[field] ?? "")); classified += 1;
  }
  if (scanned !== Number(rows.manifest.featureCount || 0)) throw new Error(`${countyId} parcel scan mismatch ${scanned}/${rows.manifest.featureCount}`);
  const shardDir = path.join(floodRoot, "parcel-index"); ensureDir(shardDir); const files = {}; const counts = {};
  for (const [key, records] of [...shards].sort(([a], [b]) => a.localeCompare(b))) { const relative = `parcel-index/${key}.json`; writeJson(path.join(floodRoot, relative), { schemaVersion: "wr-fema-parcel-floodplain-shard-v1", fields, records }); files[key] = relative; counts[key] = records.length; }
  const generatedAt = new Date().toISOString(); const index = { schemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt, parcelFloodplainRecordCount: classified, parcelsInFederalSfhaCount: sfhaCount, sourceFeatureCount: polygons.length, parcelRecordsScanned: scanned, joinMethod: "parcel liveGeometry centroid inside FEMA NFHL flood-hazard polygon", keyLength: 2, fields, files, counts };
  const manifest = { schemaVersion: "wr-fema-floodplain-manifest-v1", sourceCountyId: countyId, generatedAt, status: "parcel-index-ready-official-fema-coverage", parcelServiceManifest: path.relative(root, path.join(parcelRoot, "manifest.json")).replace(/\\/g, "/"), defaultVisible: false, renderDirectlyInBrowser: false, parcelIndex: "parcel-floodplain-index.json", parcelIndexCount: classified, sourceFeatureCount: polygons.length, parcelsInFederalSfhaCount: sfhaCount, parcelIndexShards: { keyLength: 2, fields, files, counts }, sources: [capture.snapshot], regulatoryDisclaimer: "Planning intelligence only; not a FEMA insurance, survey, or regulatory determination." };
  writeJson(path.join(floodRoot, "parcel-floodplain-index.json"), index, true); writeJson(path.join(floodRoot, "manifest.json"), manifest, true);
  writeJson(path.join(outputRoot, "floodplain-index-report.json"), { ...manifest, parcelRecordsScanned: scanned }, true);
  fs.writeFileSync(path.join(outputRoot, "floodplain-index-report.md"), `# ${countyId} floodplain parcel index\n\n- Official FEMA polygons: **${polygons.length.toLocaleString()}**\n- Parcel records scanned: **${scanned.toLocaleString()}**\n- Parcels classified: **${classified.toLocaleString()}**\n- Parcels in federal SFHA: **${sfhaCount.toLocaleString()}**\n- Join: parcel live-geometry centroid inside FEMA NFHL flood-hazard polygon\n\nPlanning intelligence only; not an insurance, survey, or regulatory determination.\n`);

  const adapter = JSON.parse(fs.readFileSync(adapterFile, "utf8"));
  adapter.sourceFiles.floodplainRaw = FEMA_URL;
  const layer = adapter.optionalLayers.find((item) => item.id === "floodplain-intelligence");
  Object.assign(layer, { source: "FEMA National Flood Hazard Layer Flood Hazard Zones (MapServer/28)", status: "parcel-index-ready-official-fema-coverage", joinBehavior: "parcel liveGeometry centroid inside FEMA NFHL flood-hazard polygon; planning intelligence only", reportPath: `output/${countyId}/floodplain-index-report.md` });
  adapter.joinKeys.floodplain = "parcel liveGeometry centroid -> FEMA NFHL Flood Hazard Zones polygon -> county parcel/account identifiers";
  adapter.verifiedCounts.floodHazardSourceFeatures = polygons.length; adapter.verifiedCounts.parcelsWithFloodplainClassification = classified; adapter.verifiedCounts.parcelsInSpecialFloodHazardArea = sfhaCount;
  fs.writeFileSync(adapterFile, `${JSON.stringify(adapter, null, 2)}\n`);
  return { countyId, sourceFeatures: polygons.length, scanned, classified, sfhaCount };
}

async function main() {
  const requested = process.argv.find((arg) => arg.startsWith("--county="))?.split("=")[1] || "all";
  const counties = requested === "all" ? Object.keys(CONFIG) : [requested];
  for (const countyId of counties) if (!CONFIG[countyId]) throw new Error(`Unsupported county: ${countyId}`);
  const results = [];
  for (const countyId of counties) { console.log(`${countyId}: capturing official FEMA source`); const capture = await captureFema(countyId, CONFIG[countyId].bounds); console.log(`${countyId}: joining ${capture.features.length} FEMA polygons to parcels`); results.push(buildCounty(countyId, CONFIG[countyId], capture)); }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
