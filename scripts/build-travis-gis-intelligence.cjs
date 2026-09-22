const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const countyId = "travis-county-tx";
const rawRoot = path.join(root, "data", "raw", countyId, "gis");
const parcelRoot = path.join(root, "public", "data", "counties", countyId, "parcels");
const publicRoot = path.join(root, "public", "data", "counties", countyId);
const outputRoot = path.join(root, "output", countyId);
const bounds = { minLng: -98.25, minLat: 29.95, maxLng: -97.25, maxLat: 30.75 };
const shardKeyLength = 4;

const zoningFields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "existingParcelZoning", "label", "baseDistricts", "longZoneDistricts", "pdNumbers", "pdsNumbers", "supNumbers", "cdNumbers", "subdistricts", "overlays", "caseNumbers", "sourceLayerIds", "sourceLayerHits", "searchText"];
const zoningHitFields = ["sourceLayerId", "sourceLayerTitle", "recordType", "objectId", "zoneDistrict", "longZoneDistrict"];
const floodFields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "label", "floodZones", "zoneSubtypes", "sfha", "baseFloodElevations", "verticalDatums", "depths", "velocities", "sourceCitations", "sourceLayerIds", "sourceLayerHits", "searchText"];
const floodHitFields = ["sourceLayerId", "sourceLayerTitle", "objectId", "floodZone", "zoneSubtype", "sfha", "sourceCitation"];

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function clean(value) { return String(value ?? "").trim(); }
function normalize(value) { return clean(value).replace(/[^a-z0-9]/gi, "").toLowerCase(); }
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function packed(fields, record) { return fields.map((field) => record[field] ?? ""); }

function readNdjson(file, source) {
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => ({ ...JSON.parse(line), _source: source }));
}

function visitPoints(coordinates, visit) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") return visit(coordinates);
  for (const child of coordinates) visitPoints(child, visit);
}

function featureBounds(feature) {
  const result = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  visitPoints(feature.geometry?.coordinates, ([lng, lat]) => {
    result.minLng = Math.min(result.minLng, lng); result.minLat = Math.min(result.minLat, lat);
    result.maxLng = Math.max(result.maxLng, lng); result.maxLat = Math.max(result.maxLat, lat);
  });
  return Number.isFinite(result.minLng) ? result : null;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  let inside = false;
  for (const ring of rings || []) if (ring.length >= 3 && pointInRing(point, ring)) inside = !inside;
  return inside;
}

function pointInFeature(point, feature) {
  if (feature.geometry?.type === "Polygon") return pointInPolygon(point, feature.geometry.coordinates);
  if (feature.geometry?.type === "MultiPolygon") return feature.geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  return false;
}

function gridCell(point, columns = 180, rows = 150) {
  const x = Math.max(0, Math.min(columns - 1, Math.floor(((point[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * columns)));
  const y = Math.max(0, Math.min(rows - 1, Math.floor(((point[1] - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * rows)));
  return [x, y];
}

function featureIndex(features) {
  const cells = new Map();
  for (const feature of features) {
    const fb = featureBounds(feature); if (!fb) continue; feature._bounds = fb;
    const min = gridCell([fb.minLng, fb.minLat]); const max = gridCell([fb.maxLng, fb.maxLat]);
    for (let x = min[0]; x <= max[0]; x += 1) for (let y = min[1]; y <= max[1]; y += 1) {
      const key = `${x}:${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(feature);
    }
  }
  return cells;
}

function hitsAt(index, point) {
  const [x, y] = gridCell(point);
  return (index.get(`${x}:${y}`) || []).filter((feature) => {
    const b = feature._bounds;
    return point[0] >= b.minLng && point[0] <= b.maxLng && point[1] >= b.minLat && point[1] <= b.maxLat && pointInFeature(point, feature);
  });
}

function cleanDir(target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
}

function createShardWriter(directory, fields, hitFields) {
  cleanDir(directory);
  const states = new Map();
  return {
    add(record) {
      const key = normalize(record.accountNum).slice(0, shardKeyLength) || "none";
      if (!states.has(key)) {
        const file = path.join(directory, `${key}.json`); const fd = fs.openSync(file, "w");
        fs.writeSync(fd, JSON.stringify({ fields, sourceHitFields: hitFields }).slice(0, -1) + ',"records":[');
        states.set(key, { fd, file: `parcel-index/${key}.json`, count: 0, first: true });
      }
      const state = states.get(key); fs.writeSync(state.fd, `${state.first ? "" : ","}${JSON.stringify(packed(fields, record))}`);
      state.first = false; state.count += 1;
    },
    close() {
      const files = {}; const counts = {};
      for (const [key, state] of states) { fs.writeSync(state.fd, "]}"); fs.closeSync(state.fd); files[key] = state.file; counts[key] = state.count; }
      return { files, counts };
    },
  };
}

function parcelCenter(parcel) {
  if (Array.isArray(parcel.liveGeometry?.center) && parcel.liveGeometry.center.every(Number.isFinite)) return parcel.liveGeometry.center;
  return null;
}

function floodHit(feature) {
  const attributes = feature.properties || {};
  const zone = clean(attributes.FLOOD_ZONE);
  const sourceId = feature._source.id;
  const federalSfha = sourceId === "austin-fema-floodplain" && /^[AV]/i.test(zone);
  const localRegulatory = sourceId === "austin-fully-developed-floodplain" && /100-Year/i.test(zone);
  return {
    sourceLayerId: sourceId,
    sourceLayerTitle: feature._source.title,
    objectId: attributes.OBJECTID,
    floodZone: zone,
    zoneSubtype: sourceId === "austin-fully-developed-floodplain" ? "City of Austin fully developed floodplain" : "FEMA effective floodplain",
    sfha: federalSfha ? "true" : localRegulatory ? "local-regulatory-100-year" : "false",
    sourceCitation: feature._source.url,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const sourceManifest = readJson(path.join(rawRoot, "source-manifest.json"));
  const sources = Object.fromEntries(sourceManifest.sources.map((source) => [source.id, source]));
  const zoningFeatures = readNdjson(path.join(root, sources["austin-zoning"].file), sources["austin-zoning"]);
  const fullyDeveloped = readNdjson(path.join(root, sources["austin-fully-developed-floodplain"].file), sources["austin-fully-developed-floodplain"]);
  const fema = readNdjson(path.join(root, sources["austin-fema-floodplain"].file), sources["austin-fema-floodplain"]);
  const zoningGrid = featureIndex(zoningFeatures); const floodGrid = featureIndex([...fullyDeveloped, ...fema]);
  const zoningDir = path.join(publicRoot, "zoning"); const floodDir = path.join(publicRoot, "floodplain");
  const zoningWriter = createShardWriter(path.join(zoningDir, "parcel-index"), zoningFields, zoningHitFields);
  const floodWriter = createShardWriter(path.join(floodDir, "parcel-index"), floodFields, floodHitFields);
  const parcelManifest = readJson(path.join(parcelRoot, "manifest.json"));
  let parcelCount = 0; let zoningJoined = 0; let floodJoined = 0; let federalSfhaCount = 0; let localRegulatoryCount = 0;
  for (const chunk of parcelManifest.chunks || []) {
    const payload = readJson(path.join(parcelRoot, chunk.file));
    for (const parcel of payload.parcels || []) {
      parcelCount += 1;
      const center = parcelCenter(parcel); const accountNum = clean(parcel.accountNum || parcel.accountNumber);
      if (!center || !accountNum) continue;
      const zoningHits = hitsAt(zoningGrid, center);
      if (zoningHits.length) {
        const normalized = zoningHits.map((feature) => ({ sourceLayerId: "austin-zoning", sourceLayerTitle: "City of Austin Zoning", recordType: "base-zoning", objectId: feature.properties?.OBJECTID, zoneDistrict: clean(feature.properties?.ZONING_ZTYPE), longZoneDistrict: clean(feature.properties?.ZONING_BASE) }));
        const districts = unique(normalized.map((hit) => hit.zoneDistrict)); const bases = unique(normalized.map((hit) => hit.longZoneDistrict));
        zoningWriter.add({ countyParcelId: clean(parcel.countyParcelId), accountNum, gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), existingParcelZoning: districts.join(" / "), label: districts.join(" / ") || bases.join(" / ") || "Austin zoning", baseDistricts: bases, longZoneDistricts: districts, pdNumbers: [], pdsNumbers: [], supNumbers: [], cdNumbers: [], subdistricts: [], overlays: [], caseNumbers: [], sourceLayerIds: ["austin-zoning"], sourceLayerHits: normalized.map((hit) => packed(zoningHitFields, hit)), searchText: `${accountNum} ${districts.join(" ")} ${bases.join(" ")} Austin zoning` });
        zoningJoined += 1;
      }
      const floodHits = hitsAt(floodGrid, center).map(floodHit);
      if (floodHits.length) {
        const zones = unique(floodHits.map((hit) => hit.floodZone)); const subtypes = unique(floodHits.map((hit) => hit.zoneSubtype)); const sfha = unique(floodHits.map((hit) => hit.sfha));
        if (sfha.includes("true")) federalSfhaCount += 1; if (sfha.includes("local-regulatory-100-year")) localRegulatoryCount += 1;
        const label = unique(floodHits.map((hit) => `${hit.sourceLayerTitle}: ${hit.floodZone}`)).join("; ");
        floodWriter.add({ countyParcelId: clean(parcel.countyParcelId), accountNum, gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), label, floodZones: zones, zoneSubtypes: subtypes, sfha, baseFloodElevations: [], verticalDatums: [], depths: [], velocities: [], sourceCitations: unique(floodHits.map((hit) => hit.sourceCitation)), sourceLayerIds: unique(floodHits.map((hit) => hit.sourceLayerId)), sourceLayerHits: floodHits.map((hit) => packed(floodHitFields, hit)), searchText: `${accountNum} ${label} ${zones.join(" ")}` });
        floodJoined += 1;
      }
    }
  }
  const zoningShards = zoningWriter.close(); const floodShards = floodWriter.close();
  writeJson(path.join(zoningDir, "search-index.json"), { records: [] });
  writeJson(path.join(zoningDir, "parcel-zoning-index.json"), { schemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt, recordCount: zoningJoined, sourceFeatureCount: zoningFeatures.length, joinMethod: "parcel centroid inside official City of Austin zoning polygon", ...zoningShards });
  writeJson(path.join(zoningDir, "manifest.json"), { schemaVersion: "wr-travis-zoning-manifest-v1", recordSchemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt, status: "parcel-index-ready-partial-municipal-coverage", defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750, chunkCount: 0, chunks: [], searchIndex: "search-index.json", searchIndexCount: 0, parcelIndex: "parcel-zoning-index.json", parcelIndexCount: zoningJoined, sourceLayers: [{ id: "austin-zoning", title: "City of Austin Zoning", url: sources["austin-zoning"].url, sourceFeatureCount: zoningFeatures.length }], parcelIndexShards: { keyLength: shardKeyLength, fields: zoningFields, sourceHitFields: zoningHitFields, ...zoningShards }, parcelZoningJoin: { method: "parcel centroid spatial join", stableId: "PROP_ID/accountNum", scope: "Official City of Austin zoning coverage; blank records may be outside municipal coverage." } });
  writeJson(path.join(floodDir, "parcel-floodplain-index.json"), { schemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt, parcelFloodplainRecordCount: floodJoined, parcelsInFederalSfhaCount: federalSfhaCount, parcelsInLocalRegulatory100YearCount: localRegulatoryCount, sourceFeatureCount: fullyDeveloped.length + fema.length, joinMethod: "parcel centroid inside official Austin floodplain polygon", ...floodShards });
  writeJson(path.join(floodDir, "manifest.json"), { schemaVersion: "wr-travis-floodplain-manifest-v1", recordSchemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt, status: "parcel-index-ready-partial-municipal-coverage", defaultVisible: false, renderDirectlyInBrowser: false, publicDataRoot: `/data/counties/${countyId}/floodplain/`, maxFeaturesPerViewport: 750, parcelIndex: "parcel-floodplain-index.json", parcelIndexCount: floodJoined, sourceLayers: [{ id: "austin-fully-developed-floodplain", title: sources["austin-fully-developed-floodplain"].title, url: sources["austin-fully-developed-floodplain"].url, sourceFeatureCount: fullyDeveloped.length }, { id: "austin-fema-floodplain", title: sources["austin-fema-floodplain"].title, url: sources["austin-fema-floodplain"].url, sourceFeatureCount: fema.length }], parcelIndexShards: { keyLength: shardKeyLength, fields: floodFields, sourceHitFields: floodHitFields, ...floodShards }, parcelFloodplainJoin: { method: "parcel centroid spatial join", stableId: "PROP_ID/accountNum", scope: "Official City of Austin service coverage; local fully-developed floodplain is distinct from federal SFHA." } });
  parcelManifest.joinedParcelDimensionCount = parcelCount;
  parcelManifest.joinedBlockGridCount = parcelCount;
  writeJson(path.join(parcelRoot, "manifest.json"), parcelManifest);
  const report = { schemaVersion: "wr-travis-gis-intelligence-report-v1", generatedAt, sourceCountyId: countyId, parcelCount, dimensionsAndBlockContext: { parcelCount, source: "Direct TCAD parcel fields: dimensions, LOTS, subdivision code/description, and legal description" }, zoning: { sourceFeatureCount: zoningFeatures.length, joinedParcelCount: zoningJoined }, floodplain: { sourceFeatureCount: fullyDeveloped.length + fema.length, fullyDevelopedSourceFeatureCount: fullyDeveloped.length, femaSourceFeatureCount: fema.length, joinedParcelCount: floodJoined, parcelsInFederalSfhaCount: federalSfhaCount, parcelsInLocalRegulatory100YearCount: localRegulatoryCount } };
  writeJson(path.join(outputRoot, "austin-gis-intelligence-report.json"), report);
  fs.writeFileSync(path.join(outputRoot, "zoning-source-report.md"), `# Austin zoning source report\n\n- Official polygons: ${zoningFeatures.length.toLocaleString()}\n- Parcel centroid joins: ${zoningJoined.toLocaleString()}\n- Scope: City of Austin zoning coverage; blank parcels may be outside municipal coverage.\n`);
  fs.writeFileSync(path.join(outputRoot, "floodplain-source-report.md"), `# Austin floodplain source report\n\n- Fully developed polygons: ${fullyDeveloped.length.toLocaleString()}\n- FEMA polygons: ${fema.length.toLocaleString()}\n- Parcel centroid joins: ${floodJoined.toLocaleString()}\n- Federal SFHA parcels: ${federalSfhaCount.toLocaleString()}\n- Local regulatory 100-year parcels: ${localRegulatoryCount.toLocaleString()}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
