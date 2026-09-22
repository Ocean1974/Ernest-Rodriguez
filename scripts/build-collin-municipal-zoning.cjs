const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ringBounds, pointInPolygon, makeGrid, clean, first } = require("./tarrant-intelligence-utils.cjs");

const root = path.resolve(__dirname, "..");
const countyId = "collin-county-tx";
const countyBounds = { minLng: -96.95, minLat: 32.95, maxLng: -96.3, maxLat: 33.45 };
const parcelRoot = path.join(root, "public/data/counties", countyId, "parcels");
const outputRoot = path.join(root, "public/data/counties", countyId, "zoning");
const rawRoot = path.join(root, "data/raw", countyId, "municipal-zoning");
const reportRoot = path.join(root, "output", countyId);
const useCached = process.argv.includes("--use-cached");

const sources = [
  { id: "plano-zoning", jurisdiction: "Plano", owner: "City of Plano", url: "https://maps.planogis.org/arcgiswad/rest/services/OpenData/Zoning/FeatureServer/0", zone: ["ZN", "IMS_ZONE"], description: ["IMS_ZONE"], pd: ["PD", "PD_Subarea"], caseNumber: ["ZONE_CASE"], ordinance: ["ORDINANCENUM"] },
  { id: "mckinney-zoning", jurisdiction: "McKinney", owner: "City of McKinney", url: "https://maps.mckinneytexas.org/mckinney/rest/services/OpenData/Planning_and_Zoning/MapServer/4", zone: ["Zone"], description: ["ZoningType"], ordinance: ["ORD1", "ORD2", "ORD3", "ORD4"] },
  { id: "frisco-zoning", jurisdiction: "Frisco", owner: "City of Frisco", url: "https://services6.arcgis.com/OGXLcOSnuy0GwFwi/ArcGIS/rest/services/FriscoZoning_ODH/FeatureServer/1", zone: ["ZONING"], pd: ["PD"], sup: ["SUP"], ordinance: ["ORD1", "ORD2"] },
  { id: "allen-zoning", jurisdiction: "Allen", owner: "City of Allen", url: "https://gismaps.cityofallen.org/arcgis/rest/services/Current_Zoning/MapServer/0", zone: ["Zoning"], description: ["DescLandUse", "LandUse"], ordinance: ["ORDINANCE"] },
  { id: "wylie-zoning", jurisdiction: "Wylie", owner: "City of Wylie", url: "https://gisapp.wylietexas.gov/portalserver/rest/services/Planning/ZoningDistricts/FeatureServer/81", zone: ["ZONECLASS"], description: ["ZONEDESC"] },
  { id: "princeton-zoning", jurisdiction: "Princeton", owner: "City of Princeton", url: "https://services6.arcgis.com/KL1aiRJt0tw3BM7h/arcgis/rest/services/City_of_Princeton_Updated20220815_WFL2/FeatureServer/1", zone: ["Zone", "Layer"], description: ["PD_Name", "PD_Label"], pd: ["PD_Num", "PD_Label"], sup: ["SUP", "SUP_ORD"], ordinance: ["ORD"] },
  { id: "anna-zoning", jurisdiction: "Anna", owner: "City of Anna", url: "https://services5.arcgis.com/DvFgDXTY4DS4ZXFx/ArcGIS/rest/services/Anna_Base_Data_Viewer/FeatureServer/6", zone: ["Zoning"], ordinance: ["ORDINANCE", "ORD2"] },
  { id: "prosper-zoning", jurisdiction: "Prosper", owner: "Town of Prosper", url: "https://services8.arcgis.com/8ofMLzOrtxGP9wVQ/ArcGIS/rest/services/Planning/FeatureServer/0", zone: ["ZONE_", "Zoning_Class"], description: ["Zoning_Class"], pd: ["PD"], sup: ["SUP"], ordinance: ["ORD1", "ORD2"] },
  { id: "dallas-base-zoning", jurisdiction: "Dallas", owner: "City of Dallas", url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/15", zone: ["ZONE_DIST", "ZONE_DISTRICT", "ZONING", "ZONE", "DISTRICT"], description: ["LONG_ZONE_DIST", "LONG_ZONE_DISTRICT", "ZONING_DESC", "DESCRIPTION"], pd: ["PD_NUM", "PD_NUMBER"], caseNumber: ["CASE_NUMBER"], ordinance: ["ORD_NUM"] },
  { id: "richardson-zoning", jurisdiction: "Richardson", owner: "City of Richardson", url: "https://maps.cor.gov/arcgis/rest/services/DevelopmentServices/ZoningDistricts/MapServer/1", zone: ["ZONECLASS"], description: ["ZONEDESC"], ordinance: ["ORD", "AmendingOrdinance"] },
  { id: "murphy-zoning", jurisdiction: "Murphy", owner: "City of Murphy", url: "https://services5.arcgis.com/lt8CbgYaNuFrQ7kB/arcgis/rest/services/Murphy_Zoning/FeatureServer/4", zone: ["Zone", "MurphyZone", "ZONING", "ZONE", "ZONECLASS", "DISTRICT"], description: ["Description", "ZONEDESC", "DESCRIPTION", "LANDUSE"], pd: ["PD", "PD_NUM"], sup: ["SUP"], ordinance: ["Ordinance"] },
];

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) { ensureDir(dir); for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); }
function writeJson(file, value, pretty = false) { ensureDir(path.dirname(file)); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`); fs.renameSync(temp, file); }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function normalize(value) { return clean(value).replace(/[^a-z0-9]/gi, "").toLowerCase(); }
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function firstMany(attributes, fields) { return unique((fields || []).map((field) => attributes?.[field])); }

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(`${url}: ${payload.error.message}`);
  return { payload, text };
}

async function captureSource(source) {
  const snapshotFile = path.join(rawRoot, source.id, "snapshot.json");
  const featuresFile = path.join(rawRoot, source.id, "features.json");
  if (useCached && fs.existsSync(snapshotFile) && fs.existsSync(featuresFile)) {
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
    const features = JSON.parse(fs.readFileSync(featuresFile, "utf8")).features || [];
    if (features.length !== Number(snapshot.featureCount)) throw new Error(`${source.id}: cached capture count mismatch`);
    return { ...source, snapshot, features };
  }
  const metadataResponse = await fetchJson(`${source.url}?f=pjson`);
  const metadata = metadataResponse.payload;
  if (metadata.geometryType !== "esriGeometryPolygon") throw new Error(`${source.id}: expected polygon layer`);
  const idsQuery = new URLSearchParams({ where: "1=1", returnIdsOnly: "true", f: "json" });
  const idsResponse = await fetchJson(`${source.url}/query?${idsQuery}`);
  const ids = idsResponse.payload.objectIds || [];
  const objectIdField = metadata.objectIdField || metadata.objectIdFieldName || metadata.fields?.find((field) => field.type === "esriFieldTypeOID")?.name || "OBJECTID";
  const features = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const query = new URLSearchParams({ objectIds: ids.slice(offset, offset + 100).join(","), outFields: "*", returnGeometry: "true", outSR: "4326", geometryPrecision: "7", f: "json" });
    const page = await fetchJson(`${source.url}/query?${query}`);
    features.push(...(page.payload.features || []));
  }
  if (features.length !== ids.length) throw new Error(`${source.id}: capture count mismatch ${features.length}/${ids.length}`);
  const observedAt = new Date().toISOString();
  const snapshot = { sourceId: source.id, jurisdiction: source.jurisdiction, title: metadata.name || source.id, sourceUrl: source.url, ownerOrganization: source.owner, observedAt, featureCount: features.length, objectIdField, fields: (metadata.fields || []).map((field) => field.name), metadataSha256: sha256(metadataResponse.text), objectIdsSha256: sha256(idsResponse.text), rightsStatus: "official-public-municipal-gis-derived-index" };
  writeJson(path.join(rawRoot, source.id, "snapshot.json"), snapshot, true);
  writeJson(path.join(rawRoot, source.id, "features.json"), { features });
  return { ...source, metadata, snapshot, features };
}

function loadParcels() {
  const manifest = JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8"));
  const parcels = [];
  let scanned = 0;
  for (const chunk of manifest.chunks || []) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      scanned += 1;
      const center = parcel.liveGeometry?.center;
      if (!Array.isArray(center) || !center.every(Number.isFinite)) continue;
      parcels.push({ countyParcelId: clean(parcel.countyParcelId), accountNum: clean(parcel.accountNum || parcel.accountNumber), gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), city: clean(parcel.city), center });
    }
  }
  return { manifest, parcels, scanned, advertised: Number(manifest.featureCount) };
}

function buildPolygonIndex(captures) {
  const grid = makeGrid(countyBounds, 240, 190);
  const polygons = [];
  for (const capture of captures) for (const feature of capture.features) {
    const rings = feature.geometry?.rings || [];
    const bounds = ringBounds(rings);
    if (!bounds) continue;
    const a = feature.attributes || {};
    const zoneValues = firstMany(a, capture.zone);
    const descriptionValues = firstMany(a, capture.description);
    const zoneDistrict = zoneValues[0] || "";
    if (!zoneDistrict) continue;
    const polygon = { capture, rings, bounds, objectId: clean(a[capture.snapshot.objectIdField]), zoneDistrict, longZoneDistrict: descriptionValues[0] || "", pdNumbers: firstMany(a, capture.pd), supNumbers: firstMany(a, capture.sup), caseNumbers: firstMany(a, capture.caseNumber), ordinances: firstMany(a, capture.ordinance) };
    polygons.push(polygon);
    grid.add(polygon, bounds);
  }
  return { grid, polygons };
}

function writeShards(records, fields, sourceHitFields) {
  const groups = new Map();
  for (const record of records) {
    const key = normalize(record.accountNum || record.countyParcelId).slice(0, 2) || "__";
    if (!groups.has(key)) groups.set(key, []);
    const packed = { ...record, sourceLayerHits: record.sourceLayerHits.map((hit) => sourceHitFields.map((field) => hit[field] ?? "")) };
    groups.get(key).push(fields.map((field) => packed[field] ?? ""));
  }
  const files = {}; const counts = {};
  const shardRoot = path.join(outputRoot, "parcel-index"); ensureDir(shardRoot);
  for (const [key, values] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const relative = `parcel-index/${key}.json`;
    writeJson(path.join(outputRoot, relative), { schemaVersion: "wr-collin-municipal-zoning-shard-v1", sourceCountyId: countyId, fields, sourceHitFields, records: values });
    files[key] = relative; counts[key] = values.length;
  }
  return { keyLength: 2, fields, sourceHitFields, files, counts };
}

async function main() {
  const captures = [];
  for (const source of sources) { console.log(`Capturing ${source.jurisdiction}...`); captures.push(await captureSource(source)); }
  const { manifest: parcelManifest, parcels, scanned, advertised } = loadParcels();
  const { grid, polygons } = buildPolygonIndex(captures);
  clearDir(outputRoot);
  const records = [];
  const matchesByJurisdiction = Object.fromEntries(sources.map((source) => [source.jurisdiction, 0]));
  for (const parcel of parcels) {
    let hits = grid.at(parcel.center).filter((polygon) => pointInPolygon(parcel.center, polygon.rings));
    const sameCity = hits.filter((hit) => normalize(hit.capture.jurisdiction) === normalize(parcel.city));
    if (sameCity.length) hits = sameCity;
    if (!hits.length) continue;
    const sourceLayerHits = hits.map((hit) => ({ sourceLayerId: hit.capture.id, sourceLayerTitle: `${hit.capture.jurisdiction} ${hit.capture.snapshot.title}`, sourceUrl: hit.capture.url, recordType: "base-zoning", joinMethod: "parcel-centroid-spatial", zoneDistrict: hit.zoneDistrict, longZoneDistrict: hit.longZoneDistrict, pdNumber: hit.pdNumbers.join(" / "), supNumber: hit.supNumbers.join(" / "), caseNumber: hit.caseNumbers.join(" / "), ordinance: hit.ordinances.join(" / "), objectId: hit.objectId, coverageJurisdiction: hit.capture.jurisdiction, sourceObservedAt: hit.capture.snapshot.observedAt }));
    const baseDistricts = unique(sourceLayerHits.map((hit) => hit.zoneDistrict));
    const longZoneDistricts = unique(sourceLayerHits.map((hit) => hit.longZoneDistrict));
    const pdNumbers = unique(sourceLayerHits.map((hit) => hit.pdNumber));
    const supNumbers = unique(sourceLayerHits.map((hit) => hit.supNumber));
    const caseNumbers = unique(sourceLayerHits.map((hit) => hit.caseNumber));
    const sourceLayerIds = unique(sourceLayerHits.map((hit) => hit.sourceLayerId));
    sourceLayerHits.forEach((hit) => { matchesByJurisdiction[hit.coverageJurisdiction] = (matchesByJurisdiction[hit.coverageJurisdiction] || 0) + 1; });
    records.push({ countyParcelId: parcel.countyParcelId, accountNum: parcel.accountNum, gisParcelId: parcel.gisParcelId, parcelChunkId: parcel.parcelChunkId, existingParcelZoning: "", label: baseDistricts.join(" / "), baseDistricts, longZoneDistricts, pdNumbers, pdsNumbers: [], supNumbers, cdNumbers: [], subdistricts: [], overlays: [], caseNumbers, sourceLayerIds, sourceLayerHits, searchText: [parcel.accountNum, parcel.gisParcelId, parcel.city, ...baseDistricts, ...longZoneDistricts, ...pdNumbers, ...supNumbers].join(" ").toLowerCase() });
  }

  const fields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "existingParcelZoning", "label", "baseDistricts", "longZoneDistricts", "pdNumbers", "pdsNumbers", "supNumbers", "cdNumbers", "subdistricts", "overlays", "caseNumbers", "sourceLayerIds", "sourceLayerHits", "searchText"];
  const sourceHitFields = ["sourceLayerId", "sourceLayerTitle", "sourceUrl", "recordType", "joinMethod", "zoneDistrict", "longZoneDistrict", "pdNumber", "supNumber", "caseNumber", "ordinance", "objectId", "coverageJurisdiction", "sourceObservedAt"];
  const parcelIndexShards = writeShards(records, fields, sourceHitFields);
  const searchRecords = polygons.map((polygon) => ({ zoningRecordId: `${polygon.capture.id}:${polygon.objectId}`, sourceCountyId: countyId, sourceLayerId: polygon.capture.id, sourceLayerTitle: `${polygon.capture.jurisdiction} ${polygon.capture.snapshot.title}`, sourceUrl: polygon.capture.url, recordType: "base-zoning", zoneDistrict: polygon.zoneDistrict, longZoneDistrict: polygon.longZoneDistrict, pdNumber: polygon.pdNumbers.join(" / "), supNumber: polygon.supNumbers.join(" / "), caseNumber: polygon.caseNumbers.join(" / "), bounds: polygon.bounds, coverageJurisdiction: polygon.capture.jurisdiction }));
  writeJson(path.join(outputRoot, "search-index.json"), { schemaVersion: "wr-collin-municipal-zoning-search-v1", sourceCountyId: countyId, records: searchRecords });
  const generatedAt = new Date().toISOString();
  const manifest = { schemaVersion: "wr-collin-municipal-zoning-manifest-v1", recordSchemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt, status: "parcel-index-ready-partial-municipal-coverage", coverageScope: "Verified official machine-readable zoning polygons from eleven Collin County municipalities", coverageJurisdictions: sources.map((source) => source.jurisdiction), uncoveredJurisdictions: ["Celina", "Melissa", "Lavon", "Lucas", "Sachse", "Royse City", "Parker", "Farmersville", "Josephine", "Lowry Crossing", "Blue Ridge", "Weston", "Nevada", "Saint Paul", "New Hope", "Garland", "Fairview"], defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750, chunkCount: 0, chunks: [], searchIndex: "search-index.json", searchIndexCount: searchRecords.length, parcelIndex: "parcel-index/", parcelIndexCount: records.length, parcelServiceCount: advertised, emittedParcelRecordCount: scanned, missingParcelRecordsFromChunks: Math.max(0, advertised - scanned), centroidEligibleParcelCount: parcels.length, parcelsWithoutCentroid: scanned - parcels.length, parcelCoveragePercent: Number(((records.length / advertised) * 100).toFixed(4)), parcelIndexShards, matchesByJurisdiction, sources: captures.map((capture) => capture.snapshot), parcelZoningJoin: { method: "parcel liveGeometry centroid inside official municipal zoning polygon", stableId: "CCAD accountNum/countyParcelId", precedence: "parcel city-matched municipal source first", limitation: "Unmatched parcels remain unknown. District labels are planning intelligence and must be verified with the controlling municipality before reliance." } };
  writeJson(path.join(outputRoot, "manifest.json"), manifest, true);
  writeJson(path.join(outputRoot, "parcel-zoning-index.json"), { schemaVersion: "wr-collin-municipal-zoning-index-v1", sourceCountyId: countyId, generatedAt, parcelIndexCount: records.length, parcelIndexShards }, true);
  ensureDir(reportRoot);
  writeJson(path.join(reportRoot, "municipal-zoning-report.json"), manifest, true);
  const sourceRows = captures.map((capture) => `| ${capture.jurisdiction} | ${capture.snapshot.featureCount.toLocaleString()} | ${(matchesByJurisdiction[capture.jurisdiction] || 0).toLocaleString()} | ${capture.url} |`).join("\n");
  fs.writeFileSync(path.join(reportRoot, "municipal-zoning-report.md"), `# Collin County municipal zoning intelligence\n\n- Advertised parcel service records: **${advertised.toLocaleString()}**\n- Parcel records emitted by chunks: **${scanned.toLocaleString()}**\n- Manifest/chunk discrepancy: **${Math.max(0, advertised - scanned).toLocaleString()}** records\n- Parcels with usable centroids: **${parcels.length.toLocaleString()}**\n- Parcels without usable centroids: **${(scanned - parcels.length).toLocaleString()}**\n- Parcels with verified municipal zoning matches: **${records.length.toLocaleString()}**\n- Parcel coverage: **${manifest.parcelCoveragePercent}%**\n- Official municipal sources: **${captures.length}**\n- Source zoning polygons: **${searchRecords.length.toLocaleString()}**\n\n| Jurisdiction | Source polygons | Parcel matches | Official GIS service |\n|---|---:|---:|---|\n${sourceRows}\n\n## Limitations\n\nUnmatched parcels remain unknown; no district is inferred from land use, jurisdiction, appraisal, or neighboring parcels. Municipal zoning must be verified with the controlling jurisdiction before legal, entitlement, acquisition, or development reliance.\n`);
  if (Number(parcelManifest.featureCount) !== advertised) throw new Error("Parcel manifest reconciliation failed");
  console.log(JSON.stringify({ parcelServiceCount: advertised, emittedParcelRecordCount: scanned, missingParcelRecordsFromChunks: Math.max(0, advertised - scanned), centroidEligibleParcelCount: parcels.length, parcelsWithoutCentroid: scanned - parcels.length, parcelIndexCount: records.length, parcelCoveragePercent: manifest.parcelCoveragePercent, sourceFeatureCount: searchRecords.length, matchesByJurisdiction }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
