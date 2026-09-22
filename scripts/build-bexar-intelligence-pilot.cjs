const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { parse } = require("csv-parse/sync");
const proj4 = require("proj4");
const {
  clean, normalizeAddress, normalizeId, sha256, ringBounds, pointInPolygon,
  makeGrid, first, dateIso, developmentCategory,
} = require("./tarrant-intelligence-utils.cjs");

const root = path.resolve(__dirname, "..");
const countyId = "bexar-county-tx";
const parcelRoot = path.join(root, "public/data/counties/bexar-county-tx/parcels");
const publicRoot = path.join(root, "public/data/counties/bexar-county-tx");
const rawRoot = path.join(root, "data/raw/bexar-county-tx/intelligence");
const reportRoot = path.join(root, "output/bexar-county-tx");
const adapterFile = path.join(root, "data/county-adapters/bexar-county-tx/adapter.json");
const bounds = { minLng: -99.0, minLat: 29.0, maxLng: -98.0, maxLat: 29.8 };
const shardKeyLength = 4;
const texasSouthCentralFeet = "+proj=lcc +lat_1=28.38333333333333 +lat_2=30.28333333333333 +lat_0=27.83333333333333 +lon_0=-99 +x_0=600000 +y_0=4000000 +datum=NAD83 +units=us-ft +no_defs";

const sources = {
  zoning: {
    id: "san-antonio-cosa-zoning",
    title: "City of San Antonio CoSA Zoning",
    url: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12",
    itemId: "5cdc1086f57541e892154eb8e6e86782",
    ckanDatasetId: "7f78829f-a8bf-458e-826b-9fcdb17368b1",
    fields: ["OBJECTID", "ZoneKey", "CaseNo", "Base", "SpecDistrict", "SpecCondition", "SpecConditionDetail", "Zoning", "OrdinanceKey", "ZoningDetail", "BaseDescription", "SpecDistrictDescription", "EntryDate", "ModifiedDate"],
    returnGeometry: false,
    returnCentroid: true,
  },
  floodplain: {
    id: "fema-nfhl-bexar-flood-hazard-zones",
    title: "FEMA National Flood Hazard Layer - Bexar County window",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
    fields: ["OBJECTID", "FLD_AR_ID", "FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "V_DATUM", "DEPTH", "LEN_UNIT", "VELOCITY", "VEL_UNIT", "SOURCE_CIT", "VERSION_ID"],
    returnGeometry: true,
    maxAllowableOffset: 0.00002,
    query: { geometry: "-99,29,-98,29.8", geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" },
  },
  preliminaryPlat: {
    id: "san-antonio-preliminary-plat",
    title: "City of San Antonio Preliminary Plat",
    url: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/PreliminaryPlat/FeatureServer/2",
    itemId: "35884ac9a5d2407b8a19511eba3e8264",
    ckanDatasetId: "93f4b5bd-5fd1-4cf3-831d-9cc67f4188f5",
    fields: ["OBJECTID", "PlatNumber", "PlatName", "created_date", "last_edited_date"],
    returnGeometry: true,
  },
  recordedPlat: {
    id: "san-antonio-recorded-plat",
    title: "City of San Antonio Recorded Plat",
    url: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/RecordedPlat/FeatureServer/1",
    itemId: "de8507d8f4ab45949b69e70b13d6c006",
    ckanDatasetId: "d7db679b-6b51-42e5-a918-76d294a8d8ab",
    fields: ["OBJECTID", "PlatNumber", "PlatName", "RecordationDate", "Engineer", "created_date", "last_edited_date"],
    returnGeometry: true,
  },
  permits: {
    id: "san-antonio-issued-building-permits",
    title: "City of San Antonio Permits Issued",
    url: "https://data.sanantonio.gov/dataset/05012dcb-ba1b-4ade-b5f3-7403bc7f52eb/resource/c21106f9-3ef5-4f3a-8604-f992b4db7512/download/permits_issued.csv",
    ckanDatasetId: "05012dcb-ba1b-4ade-b5f3-7403bc7f52eb",
    ckanResourceId: "c21106f9-3ef5-4f3a-8604-f992b4db7512",
  },
};

function assertWorkspace(target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${resolved}`);
}
function ensureDir(dir) { assertWorkspace(dir); fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) {
  assertWorkspace(dir); ensureDir(dir);
  for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
}
function writeJson(file, value, pretty = false) {
  assertWorkspace(file); ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
  fs.renameSync(temporary, file);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function request(url, attempt = 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(`ArcGIS ${payload.error.code || ""}: ${payload.error.message || "query error"}`);
    return { payload, text };
  } catch (error) {
    if (attempt >= 5) throw new Error(`${url}: ${error.message}`);
    await sleep(attempt * 1500);
    return request(url, attempt + 1);
  }
}

async function requestForm(url, values, attempt = 1) {
  try {
    const response = await fetch(url, {
      method: "POST",
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(120000),
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(`ArcGIS ${payload.error.code || ""}: ${payload.error.message || "query error"}`);
    return { payload, text };
  } catch (error) {
    if (attempt >= 5) throw new Error(`${url}: ${error.message}`);
    await sleep(attempt * 1500);
    return requestForm(url, values, attempt + 1);
  }
}

async function captureArcGis(spec) {
  const sourceDir = path.join(rawRoot, spec.id);
  ensureDir(sourceDir);
  const metadataResponse = await request(`${spec.url}?f=json`);
  const metadata = metadataResponse.payload;
  const availableFields = new Set((metadata.fields || []).map((field) => field.name));
  const fields = spec.fields.filter((field) => availableFields.has(field));
  const objectIdField = metadata.objectIdField || (metadata.fields || []).find((field) => field.type === "esriFieldTypeOID")?.name || "OBJECTID";
  if (!fields.includes(objectIdField)) fields.unshift(objectIdField);
  const baseQuery = { where: "1=1", ...(spec.query || {}) };
  const countParams = new URLSearchParams({ ...baseQuery, returnCountOnly: "true", f: "json" });
  const count = Number((await request(`${spec.url}/query?${countParams}`)).payload.count || 0);
  const pageSize = Math.max(1, Math.min(Number(metadata.maxRecordCount || 1000), spec.returnGeometry ? 250 : 2000));
  const useObjectIdBatches = count > 3000;
  const pageVariant = spec.maxAllowableOffset ? `-generalized-${String(spec.maxAllowableOffset).replace(/\W/g, "_")}` : "";
  const pagesDir = path.join(sourceDir, `${useObjectIdBatches ? "id-pages" : "pages"}${pageVariant}`);
  ensureDir(pagesDir);
  let objectIds = [];
  if (useObjectIdBatches) {
    const edgeObjectId = async (direction) => {
      const params = new URLSearchParams({ ...baseQuery, outFields: objectIdField, returnGeometry: "false", resultRecordCount: "1", orderByFields: `${objectIdField} ${direction}`, f: "json" });
      return Number((await request(`${spec.url}/query?${params}`)).payload.features?.[0]?.attributes?.[objectIdField]);
    };
    const minimumObjectId = await edgeObjectId("ASC");
    const maximumObjectId = await edgeObjectId("DESC");
    if (!Number.isFinite(minimumObjectId) || !Number.isFinite(maximumObjectId)) throw new Error(`${spec.id} object ID bounds unavailable`);
    const collectRange = async (minimum, maximum) => {
      const rangeWhere = `(${baseQuery.where || "1=1"}) AND ${objectIdField} >= ${minimum} AND ${objectIdField} <= ${maximum}`;
      const rangeBase = { ...baseQuery, where: rangeWhere };
      const rangeCount = Number((await request(`${spec.url}/query?${new URLSearchParams({ ...rangeBase, returnCountOnly: "true", f: "json" })}`)).payload.count || 0);
      if (!rangeCount) return [];
      if (rangeCount > 390000) {
        const midpoint = Math.floor((minimum + maximum) / 2);
        const [left, right] = await Promise.all([collectRange(minimum, midpoint), collectRange(midpoint + 1, maximum)]);
        return left.concat(right);
      }
      const idParams = new URLSearchParams({ ...rangeBase, returnIdsOnly: "true", f: "json" });
      const rangeIds = ((await request(`${spec.url}/query?${idParams}`)).payload.objectIds || []).map(Number).filter(Number.isFinite);
      if (rangeIds.length !== rangeCount) throw new Error(`${spec.id} object ID range mismatch ${minimum}-${maximum}: ${rangeIds.length}/${rangeCount}`);
      return rangeIds;
    };
    objectIds = await collectRange(minimumObjectId, maximumObjectId);
    objectIds = [...new Set(objectIds)].sort((a, b) => a - b);
    if (objectIds.length !== count) throw new Error(`${spec.id} object ID count mismatch: ${objectIds.length}/${count}`);
    writeJson(path.join(sourceDir, "object-ids.json"), { objectIdField, count, objectIds });
  }
  const offsets = [];
  for (let offset = 0; offset < count; offset += pageSize) offsets.push(offset);
  let cursor = 0;
  const requestObjectIdFeatures = async (params, ids) => {
    try {
      return await requestForm(`${spec.url}/query`, { ...params, where: `${objectIdField} IN (${ids.join(",")})` });
    } catch (error) {
      if (ids.length <= 1) throw error;
      const midpoint = Math.ceil(ids.length / 2);
      const [left, right] = await Promise.all([
        requestObjectIdFeatures(params, ids.slice(0, midpoint)),
        requestObjectIdFeatures(params, ids.slice(midpoint)),
      ]);
      return { payload: { ...left.payload, features: [...(left.payload.features || []), ...(right.payload.features || [])] }, text: "" };
    }
  };
  const worker = async () => {
    while (cursor < offsets.length) {
      const offset = offsets[cursor++];
      const pageFile = path.join(pagesDir, `${String(offset).padStart(9, "0")}.json`);
      if (fs.existsSync(pageFile)) continue;
      const params = {
        ...baseQuery,
        outFields: fields.join(","),
        returnGeometry: spec.returnGeometry ? "true" : "false",
        returnCentroid: spec.returnCentroid ? "true" : "false",
        outSR: "4326",
        geometryPrecision: "7",
        ...(spec.maxAllowableOffset ? { maxAllowableOffset: String(spec.maxAllowableOffset) } : {}),
        returnTrueCurves: "false",
        f: "json",
      };
      if (useObjectIdBatches) {
        params.where = `${objectIdField} IN (${objectIds.slice(offset, offset + pageSize).join(",")})`;
      } else {
        params.resultOffset = String(offset);
        params.resultRecordCount = String(pageSize);
        params.orderByFields = objectIdField;
      }
      const response = useObjectIdBatches
        ? await requestObjectIdFeatures(params, objectIds.slice(offset, offset + pageSize))
        : await request(`${spec.url}/query?${new URLSearchParams(params)}`);
      writeJson(pageFile, response.payload);
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, offsets.length || 1) }, worker));
  let capturedCount = 0;
  for (const offset of offsets) capturedCount += (JSON.parse(fs.readFileSync(path.join(pagesDir, `${String(offset).padStart(9, "0")}.json`), "utf8")).features || []).length;
  if (capturedCount !== count) throw new Error(`${spec.id} count mismatch: ${capturedCount}/${count}`);
  const snapshot = {
    sourceId: spec.id, title: spec.title, sourceUrl: spec.url, itemId: spec.itemId || "",
    ckanDatasetId: spec.ckanDatasetId || "", observedAt: new Date().toISOString(), featureCount: capturedCount,
    objectIdField, fields, captureStrategy: useObjectIdBatches ? "stable-object-id-batches" : "result-offset-pages", maxAllowableOffset: spec.maxAllowableOffset || null, metadataSha256: sha256(metadataResponse.text),
    rightsStatus: "official-public-endpoint-pilot-derived-output-production-review-pending",
  };
  writeJson(path.join(sourceDir, "snapshot.json"), snapshot, true);
  return { ...spec, sourceDir, pagesDir, offsets, snapshot };
}

async function capturePermitCsv() {
  const sourceDir = path.join(rawRoot, sources.permits.id);
  const file = path.join(sourceDir, "permits-issued.csv");
  ensureDir(sourceDir);
  const response = await fetch(sources.permits.url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw new Error(`Permit CSV download failed: HTTP ${response.status}`);
  const temporary = `${file}.${process.pid}.tmp`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
  fs.renameSync(temporary, file);
  const bytes = fs.statSync(file).size;
  writeJson(path.join(sourceDir, "snapshot.json"), {
    sourceId: sources.permits.id, title: sources.permits.title, sourceUrl: sources.permits.url,
    ckanDatasetId: sources.permits.ckanDatasetId, ckanResourceId: sources.permits.ckanResourceId,
    observedAt: new Date().toISOString(), bytes, sha256: sha256(fs.readFileSync(file)),
    rightsStatus: "official-public-download-pilot-derived-output-production-review-pending",
  }, true);
  return { file, bytes };
}

function forEachArcFeature(capture, callback) {
  for (const offset of capture.offsets) {
    const file = path.join(capture.pagesDir, `${String(offset).padStart(9, "0")}.json`);
    for (const feature of JSON.parse(fs.readFileSync(file, "utf8")).features || []) callback(feature);
  }
}

function loadParcels() {
  const manifest = JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8"));
  const parcels = [];
  for (const chunk of manifest.chunks || []) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      const center = parcel.liveGeometry?.center;
      if (!Array.isArray(center) || !center.every(Number.isFinite)) continue;
      parcels.push({
        countyParcelId: clean(parcel.countyParcelId), accountNum: clean(parcel.accountNum || parcel.accountNumber),
        gisParcelId: clean(parcel.gisParcelId), address: clean(parcel.address || parcel.propertyAddress),
        propertyName: clean(parcel.propertyName), chunkId: clean(chunk.id || payload.chunkId),
        center: [Number(center[0]), Number(center[1])], legalDescription: clean(parcel.legalDescription),
        neighborhood: clean(parcel.blockId), dimensions: parcel.dimensions || {},
      });
    }
  }
  if (parcels.length !== Number(manifest.featureCount || 0)) throw new Error(`Parcel count mismatch: ${parcels.length}/${manifest.featureCount}`);
  return { manifest, parcels };
}

function sourceRings(feature) {
  if (Array.isArray(feature.geometry?.rings)) return feature.geometry.rings;
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  return feature.geometry.type === "MultiPolygon" ? coordinates.flat() : coordinates;
}
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function shardKey(value) { return normalizeId(value).slice(0, shardKeyLength) || "none"; }
function pack(fields, record) { return fields.map((field) => record[field] ?? ""); }

function writePackedShards(directory, records, fields, hitFields, schemaVersion) {
  const shardDir = path.join(directory, "parcel-index"); clearDir(shardDir);
  const groups = new Map();
  for (const record of records) {
    const key = shardKey(record.accountNum || record.countyParcelId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pack(fields, record));
  }
  const files = {}; const counts = {};
  for (const [key, values] of groups) {
    const relative = `parcel-index/${key}.json`;
    writeJson(path.join(directory, relative), { schemaVersion, fields, sourceHitFields: hitFields, records: values });
    files[key] = relative; counts[key] = values.length;
  }
  return { keyLength: shardKeyLength, fields, sourceHitFields: hitFields, files, counts };
}

function parcelGrid(parcels) {
  const grid = makeGrid(bounds, 260, 210);
  for (const parcel of parcels) grid.add(parcel, { minLng: parcel.center[0], maxLng: parcel.center[0], minLat: parcel.center[1], maxLat: parcel.center[1] });
  return grid;
}

function buildZoning(parcels, capture, parcelsGrid) {
  const directory = path.join(publicRoot, "zoning"); clearDir(directory);
  const closestByParcel = new Map();
  forEachArcFeature(capture, (feature) => {
    const point = feature.centroid ? [Number(feature.centroid.x), Number(feature.centroid.y)] : null;
    if (!point || !point.every(Number.isFinite)) return;
    const nearest = parcelsGrid.at(point).map((parcel) => ({ parcel, distance: (parcel.center[0] - point[0]) ** 2 + (parcel.center[1] - point[1]) ** 2 })).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance > 0.0000015) return;
    const existing = closestByParcel.get(nearest.parcel.countyParcelId);
    if (!existing || nearest.distance < existing.distance) closestByParcel.set(nearest.parcel.countyParcelId, { distance: nearest.distance, parcel: nearest.parcel, feature });
  });
  const fields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "existingParcelZoning", "label", "baseDistricts", "longZoneDistricts", "pdNumbers", "pdsNumbers", "supNumbers", "cdNumbers", "subdistricts", "overlays", "caseNumbers", "sourceLayerIds", "sourceLayerHits", "searchText"];
  const hitFields = ["sourceLayerId", "sourceLayerTitle", "recordType", "objectId", "zoneKey", "zoneDistrict", "longZoneDistrict", "caseNumber", "joinDistanceDegrees"];
  const records = [];
  for (const { parcel, feature, distance } of closestByParcel.values()) {
    const a = feature.attributes || {};
    const district = first(a, ["Zoning", "Base"]); const base = first(a, ["Base"]); const detail = first(a, ["ZoningDetail", "SpecDistrictDescription", "BaseDescription"]); const caseNumber = first(a, ["CaseNo"]);
    const hit = { sourceLayerId: sources.zoning.id, sourceLayerTitle: sources.zoning.title, recordType: "base-zoning", objectId: a.OBJECTID, zoneKey: a.ZoneKey, zoneDistrict: district, longZoneDistrict: detail || base, caseNumber, joinDistanceDegrees: Math.sqrt(distance) };
    records.push({ countyParcelId: parcel.countyParcelId, accountNum: parcel.accountNum, gisParcelId: parcel.gisParcelId, parcelChunkId: parcel.chunkId, existingParcelZoning: district, label: district || base || "San Antonio zoning", baseDistricts: unique([base]), longZoneDistricts: unique([detail || district]), pdNumbers: [], pdsNumbers: [], supNumbers: [], cdNumbers: [], subdistricts: [], overlays: unique([a.SpecDistrict, a.SpecCondition]), caseNumbers: unique([caseNumber]), sourceLayerIds: [sources.zoning.id], sourceLayerHits: [pack(hitFields, hit)], searchText: `${parcel.accountNum} ${district} ${base} ${detail} San Antonio zoning` });
  }
  const shards = writePackedShards(directory, records, fields, hitFields, "wr-bexar-zoning-shard-v1");
  writeJson(path.join(directory, "search-index.json"), { records: [] });
  writeJson(path.join(directory, "parcel-zoning-index.json"), { schemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt: new Date().toISOString(), recordCount: records.length, sourceFeatureCount: capture.snapshot.featureCount, joinMethod: "nearest parcel centroid to official CoSA zoning polygon centroid within conservative threshold", ...shards }, true);
  const manifest = { schemaVersion: "wr-bexar-zoning-manifest-v1", recordSchemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt: new Date().toISOString(), status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdiction: "City of San Antonio zoning footprint", defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750, parcelIndex: "parcel-zoning-index.json", parcelIndexCount: records.length, sourceFeatureCount: capture.snapshot.featureCount, parcelIndexShards: shards, sources: [capture.snapshot], joinCaveat: "Conservative centroid-nearest pilot join; production release requires sampled spatial validation." };
  writeJson(path.join(directory, "manifest.json"), manifest, true);
  return { manifest, records };
}

function polygonGrid(captures, columns = 180, rows = 150) {
  const grid = makeGrid(bounds, columns, rows); const polygons = [];
  for (const capture of captures) forEachArcFeature(capture, (feature) => {
    const rings = sourceRings(feature); const featureBounds = ringBounds(rings); if (!featureBounds) return;
    const polygon = { capture, feature, rings, bounds: featureBounds }; polygons.push(polygon); grid.add(polygon, featureBounds);
  });
  return { grid, polygons };
}

function buildFloodplain(parcels, capture) {
  const directory = path.join(publicRoot, "floodplain"); clearDir(directory);
  const { grid, polygons } = polygonGrid([capture], 180, 150);
  const fields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "label", "floodZones", "zoneSubtypes", "sfha", "baseFloodElevations", "verticalDatums", "depths", "velocities", "sourceCitations", "sourceLayerIds", "sourceLayerHits", "searchText"];
  const hitFields = ["sourceLayerId", "sourceLayerTitle", "objectId", "floodZone", "zoneSubtype", "sfha", "staticBfe", "verticalDatum", "depth", "velocity", "sourceCitation"];
  const records = []; let sfhaCount = 0;
  for (const parcel of parcels) {
    const hits = grid.at(parcel.center).filter((item) => pointInPolygon(parcel.center, item.rings));
    if (!hits.length) continue;
    const normalized = hits.map((item) => { const a = item.feature.attributes || {}; return { sourceLayerId: sources.floodplain.id, sourceLayerTitle: sources.floodplain.title, objectId: a.OBJECTID, floodZone: a.FLD_ZONE, zoneSubtype: a.ZONE_SUBTY, sfha: a.SFHA_TF, staticBfe: a.STATIC_BFE, verticalDatum: a.V_DATUM, depth: a.DEPTH, velocity: a.VELOCITY, sourceCitation: a.SOURCE_CIT || sources.floodplain.url }; });
    const zones = unique(normalized.map((hit) => hit.floodZone)); const sfha = unique(normalized.map((hit) => hit.sfha)); if (sfha.some((value) => /^t|y|1$/i.test(value))) sfhaCount += 1;
    const label = zones.length ? `FEMA NFHL: ${zones.join(" / ")}` : "FEMA NFHL flood-hazard polygon";
    records.push({ countyParcelId: parcel.countyParcelId, accountNum: parcel.accountNum, gisParcelId: parcel.gisParcelId, parcelChunkId: parcel.chunkId, label, floodZones: zones, zoneSubtypes: unique(normalized.map((hit) => hit.zoneSubtype)), sfha, baseFloodElevations: unique(normalized.map((hit) => hit.staticBfe)), verticalDatums: unique(normalized.map((hit) => hit.verticalDatum)), depths: unique(normalized.map((hit) => hit.depth)), velocities: unique(normalized.map((hit) => hit.velocity)), sourceCitations: unique(normalized.map((hit) => hit.sourceCitation)), sourceLayerIds: [sources.floodplain.id], sourceLayerHits: normalized.map((hit) => pack(hitFields, hit)), searchText: `${parcel.accountNum} ${label} ${zones.join(" ")}` });
  }
  const shards = writePackedShards(directory, records, fields, hitFields, "wr-bexar-floodplain-shard-v1");
  writeJson(path.join(directory, "parcel-floodplain-index.json"), { schemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt: new Date().toISOString(), parcelFloodplainRecordCount: records.length, parcelsInFederalSfhaCount: sfhaCount, sourceFeatureCount: polygons.length, joinMethod: "parcel centroid inside FEMA NFHL flood-hazard polygon", ...shards }, true);
  const manifest = { schemaVersion: "wr-bexar-floodplain-manifest-v1", recordSchemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt: new Date().toISOString(), status: "parcel-index-ready-official-fema-coverage", defaultVisible: false, renderDirectlyInBrowser: false, publicDataRoot: "/data/counties/bexar-county-tx/floodplain/", maxFeaturesPerViewport: 750, parcelIndex: "parcel-floodplain-index.json", parcelIndexCount: records.length, sourceFeatureCount: polygons.length, parcelsInFederalSfhaCount: sfhaCount, parcelIndexShards: shards, sources: [capture.snapshot], regulatoryDisclaimer: "Planning intelligence only; not a FEMA insurance determination." };
  writeJson(path.join(directory, "manifest.json"), manifest, true);
  return { manifest, records };
}

function canonicalAddress(value) { return normalizeAddress(clean(value).split(",")[0]); }
function permitPoint(row) {
  const x = Number(row.X_COORD); const y = Number(row.Y_COORD);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return [x, y];
  try { const result = proj4(texasSouthCentralFeet, "EPSG:4326", [x, y]); return result.every(Number.isFinite) ? result : null; } catch { return null; }
}

function buildPermits(parcels, csvFile, parcelsGrid) {
  const directory = path.join(publicRoot, "permits"); clearDir(directory); ensureDir(path.join(directory, "chunks"));
  const rows = parse(fs.readFileSync(csvFile), { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  const byAddress = new Map();
  for (const parcel of parcels) { const key = canonicalAddress(parcel.address); if (!key) continue; if (!byAddress.has(key)) byAddress.set(key, []); byAddress.get(key).push(parcel); }
  const records = []; const joins = { exactNormalizedAddress: 0, addressPointDisambiguation: 0, spatialNearestCentroid: 0, ambiguousAddress: 0, unmatched: 0 };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]; const point = permitPoint(row); const address = clean(row.ADDRESS); const key = canonicalAddress(address); let candidates = byAddress.get(key) || []; let joinMethod = "";
    if (candidates.length === 1) joinMethod = "exactNormalizedAddress";
    else if (candidates.length > 1 && point) {
      const ordered = candidates.map((parcel) => ({ parcel, distance: (parcel.center[0] - point[0]) ** 2 + (parcel.center[1] - point[1]) ** 2 })).sort((a, b) => a.distance - b.distance);
      if (ordered[0] && ordered[0].distance < 0.000002) { candidates = [ordered[0].parcel]; joinMethod = "addressPointDisambiguation"; }
    }
    if (!candidates.length && point) {
      const ordered = parcelsGrid.at(point).map((parcel) => ({ parcel, distance: (parcel.center[0] - point[0]) ** 2 + (parcel.center[1] - point[1]) ** 2 })).sort((a, b) => a.distance - b.distance);
      if (ordered[0] && ordered[0].distance < 0.0000005) { candidates = [ordered[0].parcel]; joinMethod = "spatialNearestCentroid"; }
    }
    let parcel = null;
    if (candidates.length === 1) { parcel = candidates[0]; joins[joinMethod] += 1; }
    else if (candidates.length > 1) { joinMethod = "ambiguousAddress"; joins.ambiguousAddress += 1; }
    else { joinMethod = "unmatched"; joins.unmatched += 1; }
    const record = { schemaVersion: "wr-bexar-permit-record-v1", sourceCountyId: countyId, sourceDataset: sources.permits.id, coverageJurisdiction: "City of San Antonio", permitRecordId: `san-antonio-permit:${index + 1}`, permitNumber: clean(row["PERMIT #"]), permitType: clean(row["PERMIT TYPE"]), permitSubtype: clean(row["WORK TYPE"]), projectName: clean(row["PROJECT NAME"]), address, description: [row["PROJECT NAME"], row["WORK TYPE"]].map(clean).filter(Boolean).join(" - "), issueDate: clean(row["DATE ISSUED"]), applicationDate: clean(row["DATE SUBMITTED"]), valuation: Number(row["DECLARED VALUATION"] || 0) || 0, areaSqFt: Number(row["AREA (SF)"] || 0) || 0, longitude: point?.[0] ?? null, latitude: point?.[1] ?? null, joinMethod, countyParcelId: parcel?.countyParcelId || "", parcelAccountNum: parcel?.accountNum || "", parcelGisId: parcel?.gisParcelId || "", parcelChunkId: parcel?.chunkId || "", searchText: [row["PERMIT #"], row["PERMIT TYPE"], address, parcel?.accountNum].map(clean).filter(Boolean).join(" ").toLowerCase() };
    records.push(record);
  }
  const groups = new Map();
  for (const record of records) { const key = record.parcelChunkId || "unmatched"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(record); }
  const chunks = [];
  for (const [key, values] of groups) { const file = `chunks/${key}.json`; writeJson(path.join(directory, file), { schemaVersion: "wr-bexar-permit-chunk-v1", sourceCountyId: countyId, chunkId: key, records: values }); chunks.push({ id: key, file, count: values.length }); }
  writeJson(path.join(directory, "search-index.json"), { schemaVersion: "wr-bexar-permit-search-v1", sourceCountyId: countyId, records: records.map((record) => ({ permitRecordId: record.permitRecordId, permitNumber: record.permitNumber, address: record.address, parcelAccountNum: record.parcelAccountNum, parcelChunkId: record.parcelChunkId, searchText: record.searchText })) });
  const joinedPermitCount = records.filter((record) => record.countyParcelId).length;
  const manifest = { schemaVersion: "wr-bexar-permit-manifest-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdiction: "City of San Antonio issued-building-permit coverage", permitCount: records.length, locatedPermitCount: records.filter((record) => Number.isFinite(record.longitude) && Number.isFinite(record.latitude)).length, joinedPermitCount, unmatchedPermitCount: records.length - joinedPermitCount, joinMethodCounts: joins, chunkCount: chunks.length, chunks, searchIndex: "search-index.json", source: { ...sources.permits, localFile: path.relative(root, csvFile).replace(/\\/g, "/") }, caveat: "Issued permits are evidence of permitting activity, not proof of construction or completion; coverage is municipal, not countywide." };
  writeJson(path.join(directory, "manifest.json"), manifest, true);
  return { manifest, records };
}

function buildDevelopments(parcels, permits, platCaptures) {
  const directory = path.join(publicRoot, "developments"); clearDir(directory);
  const byParcel = new Map(); const parcelById = new Map(parcels.map((parcel) => [parcel.countyParcelId, parcel]));
  const add = (parcel, type, stage, evidenceId, date) => {
    if (!parcel) return; if (!byParcel.has(parcel.countyParcelId)) byParcel.set(parcel.countyParcelId, { parcel, evidence: [] });
    byParcel.get(parcel.countyParcelId).evidence.push({ type, stage, evidenceId, date });
  };
  for (const permit of permits) if (permit.countyParcelId) add(parcelById.get(permit.countyParcelId), developmentCategory(permit), "issued-permit-evidence", permit.permitRecordId, permit.issueDate);
  const { grid } = polygonGrid(platCaptures, 180, 150);
  for (const parcel of parcels) for (const item of grid.at(parcel.center)) if (pointInPolygon(parcel.center, item.rings)) {
    const a = item.feature.attributes || {}; const preliminary = item.capture.id === sources.preliminaryPlat.id;
    add(parcel, preliminary ? "preliminary-plat" : "recorded-plat", preliminary ? "planning-evidence" : "recorded-plat-evidence", `${item.capture.id}:${a.OBJECTID}`, dateIso(a.RecordationDate || a.last_edited_date || a.created_date));
  }
  const records = [];
  for (const { parcel, evidence } of byParcel.values()) {
    const signalTypes = unique(evidence.map((item) => item.type)); const stages = unique(evidence.map((item) => item.stage)); const dates = evidence.map((item) => item.date).filter(Boolean).sort();
    records.push({ countyParcelId: parcel.countyParcelId, parcelId: parcel.accountNum || parcel.gisParcelId, parcelGisId: parcel.gisParcelId, parcelAddress: parcel.address, parcelPropertyName: parcel.propertyName, signalCount: evidence.length, score: Math.min(100, 30 + signalTypes.length * 12 + Math.min(30, evidence.length * 2)), latestActivityDate: dates.at(-1) || "", signalTypes, stages, evidenceRecordIds: evidence.slice(0, 50).map((item) => item.evidenceId), classificationPolicy: "Evidence only. Permits and plats do not prove construction, completion, entitlement, ownership intent, or listing status." });
  }
  records.sort((a, b) => b.score - a.score || b.signalCount - a.signalCount || a.countyParcelId.localeCompare(b.countyParcelId));
  const index = { schemaVersion: "wr-bexar-development-index-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, status: "parcel-index-ready-partial-municipal-coverage", parcelCount: records.length, sourcePermitCount: permits.length, sourcePreliminaryPlatCount: platCaptures[0].snapshot.featureCount, sourceRecordedPlatCount: platCaptures[1].snapshot.featureCount, coverageJurisdiction: "City of San Antonio permit and plat footprints", records };
  writeJson(path.join(directory, "parcel-development-index.json"), index, true);
  writeJson(path.join(directory, "manifest.json"), { ...index, records: undefined }, true);
  return index;
}

function updateAdapter(results) {
  const adapter = JSON.parse(fs.readFileSync(adapterFile, "utf8"));
  const statusById = {
    "parcel-dimensions": { source: "Bexar parcel geometry measurements and direct acreage fields", status: "ready-verified-generated-and-direct-parcel-dimensions", joinBehavior: "Direct geometry area/perimeter plus Acres/LglAcres on each official parcel feature" },
    "block-grid": { source: "Bexar parcel viewport chunk, neighborhood, and legal-description context", status: "ready-verified-parcel-grid-neighborhood-legal-context", joinBehavior: "Parcel chunk ID provides map-grid context; Nbhd and legal description provide neighborhood/legal context when present" },
    permits: { source: sources.permits.title, status: "parcel-index-ready-partial-municipal-coverage", joinBehavior: "Exact normalized address, point disambiguation, then conservative nearest-centroid fallback; unmatched records preserved" },
    "zoning-intelligence": { source: sources.zoning.title, status: "parcel-index-ready-partial-municipal-coverage", joinBehavior: "Official zoning polygon centroid to nearest official parcel centroid within a conservative threshold; City of San Antonio footprint only" },
    "development-signals": { source: "City of San Antonio issued permits, preliminary plats, and recorded plats", status: "parcel-index-ready-partial-municipal-coverage", joinBehavior: "Evidence records aggregate only after a conservative parcel join; no construction or listing claim" },
    "floodplain-intelligence": { source: sources.floodplain.title, status: "parcel-index-ready-official-fema-coverage", joinBehavior: "Parcel centroid inside FEMA NFHL flood-hazard polygon; planning intelligence only" },
    "migration-demand": { source: "National 2024 ACS 5-year county/place context plus 2022-2023 IRS SOI county migration", status: "ready-aggregate-geography-context", joinBehavior: "County FIPS 48029 aggregate context only; zero parcel attribution and no individual-person data" },
  };
  adapter.optionalLayers = adapter.optionalLayers.map((layer) => statusById[layer.id] ? { ...layer, ...statusById[layer.id] } : layer);
  adapter.sourceFiles = { ...adapter.sourceFiles, permitsRaw: sources.permits.url, permitsProcessed: "public/data/counties/bexar-county-tx/permits/manifest.json", developmentRaw: `${sources.preliminaryPlat.url}; ${sources.recordedPlat.url}`, zoningRaw: sources.zoning.url, floodplainRaw: sources.floodplain.url, migrationDemandRaw: "public/data/national/migration-demand/manifest.json" };
  adapter.joinKeys = { ...adapter.joinKeys, blockLabels: "parcel chunk ID plus Nbhd/legal description context", dimensions: "same-feature geometry measurements plus Acres/LglAcres", permits: "unique normalized address; coordinate disambiguation; conservative spatial nearest-centroid fallback", zoning: "conservative nearest-centroid pilot join from official CoSA zoning polygons to official Bexar parcels", floodplain: "parcel centroid inside FEMA NFHL flood-hazard polygon", developmentSignals: "permit/plat evidence linked through countyParcelId after conservative source joins", migrationDemand: "county FIPS 48029 aggregate geography context; never a parcel attribution" };
  adapter.verifiedCounts = { ...adapter.verifiedCounts, parcelDimensionRows: results.parcels, blockGridRows: results.parcels, parcelsWithZoning: results.zoning.manifest.parcelIndexCount, parcelsWithFloodplain: results.floodplain.manifest.parcelIndexCount, sourcePermitRecords: results.permits.manifest.permitCount, permitRowsJoined: results.permits.manifest.joinedPermitCount, permitRowsUnmatched: results.permits.manifest.unmatchedPermitCount, parcelsWithDevelopmentSignals: results.developments.parcelCount, migrationDemandGeographies: 1, migrationDemandParcelJoins: 0 };
  adapter.productionGap = "Bexar has all 14 pilot intelligence groups after adding national aggregate county migration/demand context. Source freshness, rights review, sampled parcel joins, and production activation remain gated; county demand context is never a parcel fact.";
  writeJson(adapterFile, adapter, true);
}

async function main() {
  ensureDir(rawRoot); ensureDir(reportRoot);
  console.log("Loading Bexar parcels..."); const { manifest: parcelManifest, parcels } = loadParcels(); const grid = parcelGrid(parcels);
  console.log("Capturing official San Antonio zoning centroids..."); const zoningCapture = await captureArcGis(sources.zoning);
  console.log("Capturing FEMA NFHL flood-hazard polygons..."); const floodCapture = await captureArcGis(sources.floodplain);
  console.log("Capturing official preliminary and recorded plats..."); const preliminaryCapture = await captureArcGis(sources.preliminaryPlat); const recordedCapture = await captureArcGis(sources.recordedPlat);
  console.log("Downloading official issued permits..."); const permitCapture = await capturePermitCsv();
  console.log("Joining zoning..."); const zoning = buildZoning(parcels, zoningCapture, grid);
  console.log("Joining floodplain..."); const floodplain = buildFloodplain(parcels, floodCapture);
  console.log("Joining permits..."); const permits = buildPermits(parcels, permitCapture.file, grid);
  console.log("Building development signals..."); const developments = buildDevelopments(parcels, permits.records, [preliminaryCapture, recordedCapture]);
  parcelManifest.joinedParcelDimensionCount = parcels.length; parcelManifest.joinedBlockGridCount = parcels.length; parcelManifest.joinedPermitCount = permits.manifest.joinedPermitCount;
  parcelManifest.missingLayers = []; writeJson(path.join(parcelRoot, "manifest.json"), parcelManifest, true);
  const results = { parcels: parcels.length, zoning, floodplain, permits, developments }; updateAdapter(results);
  const sourceManifest = { schemaVersion: "wr-bexar-intelligence-source-manifest-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, sources: [zoningCapture.snapshot, floodCapture.snapshot, preliminaryCapture.snapshot, recordedCapture.snapshot, JSON.parse(fs.readFileSync(path.join(rawRoot, sources.permits.id, "snapshot.json"), "utf8"))] };
  writeJson(path.join(rawRoot, "source-manifest.json"), sourceManifest, true);
  const report = { schemaVersion: "wr-bexar-intelligence-pilot-report-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, status: "14-of-14-pilot-groups-built-production-disabled", parityTarget: { readyGroups: 14, totalGroups: 14, percent: 100, remainingGroup: null }, counts: { parcels: parcels.length, zoningSourceFeatures: zoningCapture.snapshot.featureCount, zoningParcels: zoning.records.length, floodSourceFeatures: floodCapture.snapshot.featureCount, floodplainParcels: floodplain.records.length, permitRecords: permits.manifest.permitCount, joinedPermits: permits.manifest.joinedPermitCount, unmatchedPermits: permits.manifest.unmatchedPermitCount, preliminaryPlats: preliminaryCapture.snapshot.featureCount, recordedPlats: recordedCapture.snapshot.featureCount, developmentParcels: developments.parcelCount }, caveats: ["Production activation remains disabled.", "Migration/demand is aggregate county/place context with zero parcel attribution.", "Zoning, permits, and plat coverage is limited to City of San Antonio source footprints.", "FEMA flood classifications are planning intelligence, not insurance determinations; the parcel join uses FEMA-supported 0.00002-degree generalized geometry while retaining the full raw capture for audit.", "Zoning centroid-nearest and permit joins require sampled validation before production.", "Current BCAD parcel freshness and independent release review remain blocked."] };
  writeJson(path.join(reportRoot, "bexar-intelligence-pilot-report.json"), report, true);
  fs.writeFileSync(path.join(reportRoot, "bexar-intelligence-pilot-report.md"), `# Bexar / San Antonio intelligence pilot\n\nGenerated: ${report.generatedAt}\n\n- Status: ${report.status}\n- Capability parity: 14/14 (100%)\n- Parcel base: ${parcels.length.toLocaleString()}\n- Parcels with zoning: ${zoning.records.length.toLocaleString()}\n- Parcels with FEMA flood intelligence: ${floodplain.records.length.toLocaleString()}\n- Permit records: ${permits.manifest.permitCount.toLocaleString()}\n- Joined permits: ${permits.manifest.joinedPermitCount.toLocaleString()}\n- Parcels with development evidence: ${developments.parcelCount.toLocaleString()}\n- Migration/demand: aggregate county/place context, zero parcel attribution\n\nCoverage remains explicit and production activation is disabled pending freshness, rights, and sampled join validation.\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
