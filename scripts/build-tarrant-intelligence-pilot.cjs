const fs = require("fs");
const path = require("path");
const {
  clean, normalizeAddress, normalizeId, sha256, ringBounds, pointInPolygon,
  makeGrid, first, dateIso, developmentCategory,
} = require("./tarrant-intelligence-utils.cjs");

const root = path.resolve(__dirname, "..");
const countyId = "tarrant-county-tad";
const parcelRoot = path.join(root, "public/data/counties/tarrant/parcels");
const outputRoot = path.join(root, "public/data/counties/tarrant");
const rawRoot = path.join(root, "data/raw/tarrant/pilot-intelligence");
const reportRoot = path.join(root, "output/tarrant/intelligence-pilot");
const bounds = { minLng: -97.65, minLat: 32.52, maxLng: -97.02, maxLat: 33.05 };

const sources = {
  zoning: [
    { id: "fort-worth-current-zoning", jurisdiction: "fort-worth", url: "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/CIVIC_ZONING/MapServer/0", geometry: true, fields: ["OBJECTID", "ZONING", "BASE_ZONING", "ORD_EFF_DATE"] },
    { id: "arlington-current-zoning", jurisdiction: "arlington", url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/3", geometry: true, fields: ["OBJECTID", "ZONINGDETAIL", "DISTRICT", "EFFECTIVEDATE"] },
  ],
  floodplain: [
    { id: "tarrant-fema-flood-hazards-2025", jurisdiction: "tarrant-county", url: "https://mapit.tarrantcounty.com/arcgis/rest/services/Transportation/FEMA_FloodHazards_2025/MapServer/0", geometry: true, fields: ["OBJECTID", "FLD_AR_ID", "FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "V_DATUM", "DEPTH", "LEN_UNIT", "VELOCITY", "VEL_UNIT", "SOURCE_CIT", "VERSION_ID"] },
  ],
  permits: [
    { id: "fort-worth-accela-permits", jurisdiction: "fort-worth", url: "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/FeatureServer/0", geometry: true, fields: ["OBJECTID", "Unique_ID", "Permit_No", "Permit_Type", "Current_Status", "Address", "Latitude", "Longitude", "Issue_Date", "Issued_Date", "IssuedDate", "Work_Description", "Description", "Contractor"] },
    { id: "arlington-issued-permits-three-year", jurisdiction: "arlington", url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1", geometry: true, fields: ["OBJECTID", "FOLDERSEQUENCE", "FOLDERTYPE", "STATUSDESC", "ISSUEDATE", "FINALDATE", "SUBDESC", "WORKDESC", "FOLDERNAME", "ConstructionValuationDeclared", "MainUse", "LandUseDescription", "Structure", "NameofBusiness", "PROPGISID1"] },
  ],
};

function assertWorkspace(target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${resolved}`);
}
function ensureDir(dir) { assertWorkspace(dir); fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) {
  assertWorkspace(dir);
  ensureDir(dir);
  for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
}
function writeJson(file, value) {
  assertWorkspace(file); ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, file);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function requestJson(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000), headers: { accept: "application/json", ...(options.headers || {}) } });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(`ArcGIS ${payload.error.code || ""}: ${payload.error.message || "query error"}`);
    return { payload, text };
  } catch (error) {
    if (attempt >= 4) throw new Error(`${url}: ${error.message}`);
    await sleep(attempt * 1000);
    return requestJson(url, options, attempt + 1);
  }
}

async function fetchSource(spec) {
  const sourceDir = path.join(rawRoot, spec.id);
  const pagesDir = path.join(sourceDir, "pages");
  ensureDir(pagesDir);
  const metadataResponse = await requestJson(`${spec.url}?f=json`);
  const metadata = metadataResponse.payload;
  const names = new Set((metadata.fields || []).map((field) => field.name));
  const fields = spec.fields.filter((field) => names.has(field));
  const objectIdField = metadata.objectIdField || (metadata.fields || []).find((field) => field.type === "esriFieldTypeOID")?.name || "OBJECTID";
  if (!fields.includes(objectIdField)) fields.unshift(objectIdField);
  const count = (await requestJson(`${spec.url}/query?where=1%3D1&returnCountOnly=true&f=json`)).payload.count;
  const pageSize = Math.max(1, Math.min(Number(metadata.maxRecordCount || 1000), 2000));
  const offsets = [];
  for (let offset = 0; offset < count; offset += pageSize) offsets.push(offset);
  let cursor = 0;
  const worker = async () => {
    while (cursor < offsets.length) {
      const offset = offsets[cursor++];
      const pageFile = path.join(pagesDir, `${String(offset).padStart(9, "0")}.json`);
      if (fs.existsSync(pageFile)) continue;
      const params = new URLSearchParams({
        where: "1=1", outFields: fields.join(","), returnGeometry: spec.geometry ? "true" : "false",
        outSR: "4326", geometryPrecision: "7", resultOffset: String(offset), resultRecordCount: String(pageSize),
        orderByFields: objectIdField, returnTrueCurves: "false", f: "json",
      });
      const response = await requestJson(`${spec.url}/query?${params}`);
      writeJson(pageFile, response.payload);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, offsets.length || 1) }, worker));
  const features = [];
  for (const offset of offsets) {
    const pageFile = path.join(pagesDir, `${String(offset).padStart(9, "0")}.json`);
    const page = JSON.parse(fs.readFileSync(pageFile, "utf8"));
    features.push(...(page.features || []));
  }
  const snapshot = { sourceId: spec.id, sourceUrl: spec.url, observedAt: new Date().toISOString(), featureCount: features.length, expectedFeatureCount: count, objectIdField, fields, metadataSha256: sha256(metadataResponse.text), rightsStatus: "official-public-endpoint-development-pilot-production-review-pending" };
  writeJson(path.join(sourceDir, "snapshot.json"), snapshot);
  if (features.length !== Number(count)) throw new Error(`${spec.id} count mismatch ${features.length}/${count}`);
  return { ...spec, metadata, snapshot, features };
}

function loadParcels() {
  const manifest = JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8"));
  const parcels = [];
  for (const chunk of manifest.chunks) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      const center = parcel.liveGeometry?.center || parcel.realGeometry?.geometry?.coordinates?.[0]?.[0] || null;
      if (!Array.isArray(center) || center.length < 2) continue;
      parcels.push({
        countyParcelId: parcel.countyParcelId, accountNum: parcel.accountNum, gisParcelId: parcel.gisParcelId,
        address: parcel.address, city: parcel.city, propertyName: parcel.propertyName, chunkId: chunk.id,
        center: [Number(center[0]), Number(center[1])],
      });
    }
  }
  if (parcels.length !== manifest.featureCount) throw new Error(`Parcel service count mismatch ${parcels.length}/${manifest.featureCount}`);
  return { manifest, parcels };
}

function sourceRings(feature) {
  if (Array.isArray(feature.geometry?.rings)) return feature.geometry.rings;
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  return feature.geometry.type === "MultiPolygon" ? coordinates.flat() : coordinates;
}
function pointOf(feature) {
  if (Number.isFinite(feature.geometry?.x) && Number.isFinite(feature.geometry?.y)) return [feature.geometry.x, feature.geometry.y];
  if (feature.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)) return feature.geometry.coordinates;
  return null;
}
function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function shardKey(value) { return normalizeId(value).slice(0, 2) || "__"; }

function writeParcelShards(directory, records, kind) {
  const shardDir = path.join(directory, "parcel-index"); clearDir(shardDir);
  const groups = new Map();
  for (const record of records) {
    const key = shardKey(record.accountNum || record.countyParcelId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const files = {}; const counts = {};
  for (const [key, values] of groups) {
    const file = `parcel-index/${key}.json`;
    writeJson(path.join(directory, file), { schemaVersion: `wr-tarrant-${kind}-shard-v1`, sourceCountyId: countyId, records: values });
    files[key] = file; counts[key] = values.length;
  }
  return { keyLength: 2, fields: [], sourceHitFields: [], files, counts };
}

function polygonIndex(sourceLayers, normalize) {
  const grid = makeGrid(bounds, 150, 125);
  const polygons = [];
  for (const source of sourceLayers) for (const feature of source.features) {
    const rings = sourceRings(feature); const featureBounds = ringBounds(rings);
    if (!featureBounds) continue;
    const polygon = normalize(source, feature, rings, featureBounds);
    polygons.push(polygon); grid.add(polygon, featureBounds);
  }
  return { grid, polygons };
}

function buildZoning(parcels, layers) {
  const directory = path.join(outputRoot, "zoning"); clearDir(directory);
  const { grid, polygons } = polygonIndex(layers, (source, feature, rings, featureBounds) => {
    const a = feature.attributes || {};
    return { rings, bounds: featureBounds, sourceId: source.id, jurisdiction: source.jurisdiction, objectId: first(a, [source.snapshot.objectIdField, "OBJECTID"]), zoneDistrict: first(a, ["ZONING", "ZONINGDETAIL", "DISTRICT"]), longZoneDistrict: first(a, ["BASE_ZONING", "DISTRICT"]), effectiveDate: dateIso(first(a, ["ORD_EFF_DATE", "EFFECTIVEDATE"])) };
  });
  const records = [];
  for (const parcel of parcels) {
    const hits = grid.at(parcel.center).filter((polygon) => pointInPolygon(parcel.center, polygon.rings));
    if (!hits.length) continue;
    const sourceLayerHits = hits.map((hit) => ({ sourceLayerId: hit.sourceId, sourceLayerTitle: hit.sourceId, recordType: "base-zoning", objectId: hit.objectId, zoneDistrict: hit.zoneDistrict, longZoneDistrict: hit.longZoneDistrict, effectiveDate: hit.effectiveDate, coverageJurisdiction: hit.jurisdiction }));
    const baseDistricts = unique(sourceLayerHits.map((hit) => hit.zoneDistrict));
    const longZoneDistricts = unique(sourceLayerHits.map((hit) => hit.longZoneDistrict));
    records.push({ schemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, ...parcel, zoningSummary: { label: baseDistricts.join(" / "), baseDistricts, longZoneDistricts, pdNumbers: [], pdsNumbers: [], supNumbers: [], cdNumbers: [], subdistricts: [], overlays: [], caseNumbers: [] }, sourceLayerIds: unique(sourceLayerHits.map((hit) => hit.sourceLayerId)), sourceLayerHits, searchText: [parcel.accountNum, parcel.gisParcelId, ...baseDistricts].join(" ").toLowerCase() });
  }
  const shards = writeParcelShards(directory, records, "zoning");
  writeJson(path.join(directory, "search-index.json"), { zoningRecords: polygons.map((item) => ({ zoningRecordId: `${item.sourceId}:${item.objectId}`, sourceCountyId: countyId, sourceLayerId: item.sourceId, recordType: "base-zoning", zoneDistrict: item.zoneDistrict, longZoneDistrict: item.longZoneDistrict, bounds: item.bounds, coverageJurisdiction: item.jurisdiction })) });
  const manifest = { schemaVersion: "wr-tarrant-zoning-manifest-v1", recordSchemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdictions: ["fort-worth", "arlington"], uncoveredJurisdictionCount: 40, defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750, chunkCount: 0, chunks: [], searchIndex: "search-index.json", searchIndexCount: polygons.length, parcelIndex: "parcel-index/", parcelIndexCount: records.length, parcelIndexShards: shards, sources: layers.map((item) => item.snapshot) };
  writeJson(path.join(directory, "manifest.json"), manifest);
  return { manifest, records };
}

function buildFloodplain(parcels, layers) {
  const directory = path.join(outputRoot, "floodplain"); clearDir(directory);
  const { grid, polygons } = polygonIndex(layers, (source, feature, rings, featureBounds) => {
    const a = feature.attributes || {};
    return { rings, bounds: featureBounds, sourceId: source.id, objectId: first(a, [source.snapshot.objectIdField, "OBJECTID"]), floodZone: first(a, ["FLD_ZONE"]), zoneSubtype: first(a, ["ZONE_SUBTY"]), sfha: first(a, ["SFHA_TF"]), staticBfe: first(a, ["STATIC_BFE"]), verticalDatum: first(a, ["V_DATUM"]), depth: first(a, ["DEPTH"]), velocity: first(a, ["VELOCITY"]), sourceCitation: first(a, ["SOURCE_CIT"]), gfid: first(a, ["FLD_AR_ID"]) };
  });
  const records = [];
  for (const parcel of parcels) {
    const hits = grid.at(parcel.center).filter((polygon) => pointInPolygon(parcel.center, polygon.rings));
    if (!hits.length) continue;
    const sourceLayerHits = hits.map((hit) => ({ sourceLayerId: hit.sourceId, sourceLayerTitle: "Tarrant FEMA Flood Hazards 2025 (regulatory candidate)", objectId: hit.objectId, floodZone: hit.floodZone, zoneSubtype: hit.zoneSubtype, sfha: hit.sfha, staticBfe: hit.staticBfe, verticalDatum: hit.verticalDatum, depth: hit.depth, velocity: hit.velocity, sourceCitation: hit.sourceCitation, gfid: hit.gfid, regulatoryStatus: "candidate-not-insurance-determination" }));
    const floodZones = unique(sourceLayerHits.map((hit) => hit.floodZone));
    records.push({ schemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, ...parcel, floodplainSummary: { label: floodZones.join(" / "), floodZones, zoneSubtypes: unique(sourceLayerHits.map((hit) => hit.zoneSubtype)), sfha: unique(sourceLayerHits.map((hit) => hit.sfha)), baseFloodElevations: unique(sourceLayerHits.map((hit) => hit.staticBfe)), verticalDatums: unique(sourceLayerHits.map((hit) => hit.verticalDatum)), depths: unique(sourceLayerHits.map((hit) => hit.depth)), velocities: unique(sourceLayerHits.map((hit) => hit.velocity)), sourceCitations: unique(sourceLayerHits.map((hit) => hit.sourceCitation)) }, sourceLayerIds: unique(sourceLayerHits.map((hit) => hit.sourceLayerId)), sourceLayerHits, searchText: [parcel.accountNum, parcel.gisParcelId, ...floodZones].join(" ").toLowerCase() });
  }
  const shards = writeParcelShards(directory, records, "floodplain");
  const manifest = { schemaVersion: "wr-tarrant-floodplain-manifest-v1", recordSchemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, status: "parcel-index-ready-regulatory-candidate", defaultVisible: false, renderDirectlyInBrowser: false, publicDataRoot: "/data/counties/tarrant/floodplain/", maxFeaturesPerViewport: 750, parcelIndex: "parcel-index/", parcelIndexCount: records.length, parcelIndexShards: shards, regulatoryDisclaimer: "Planning intelligence only; not a FEMA insurance determination.", sources: layers.map((item) => item.snapshot) };
  writeJson(path.join(directory, "manifest.json"), manifest);
  return { manifest, records };
}

function buildPermitRecord(source, feature) {
  const a = feature.attributes || {}; const point = pointOf(feature);
  const isArlington = source.id.startsWith("arlington");
  const permitNumber = first(a, isArlington ? ["FOLDERSEQUENCE"] : ["Permit_No", "PERMIT_NO", "Unique_ID"]);
  const permitType = first(a, isArlington ? ["FOLDERTYPE"] : ["Permit_Type", "PERMIT_TYPE"]);
  const permitSubtype = first(a, isArlington ? ["SUBDESC", "WORKDESC"] : ["Work_Description", "Description"]);
  const address = first(a, isArlington ? ["FOLDERNAME"] : ["Address", "ADDRESS"]);
  const longitude = Number(first(a, ["Longitude", "LONGITUDE"])) || Number(point?.[0]);
  const latitude = Number(first(a, ["Latitude", "LATITUDE"])) || Number(point?.[1]);
  return { schemaVersion: "wr-tarrant-permit-record-v1", sourceCountyId: countyId, sourceDataset: source.id, coverageJurisdiction: source.jurisdiction, permitRecordId: `${source.id}:${first(a, [source.snapshot.objectIdField, "OBJECTID", "Unique_ID", "FOLDERSEQUENCE"])}`, permitNumber, permitType, permitSubtype, permitStatus: first(a, isArlington ? ["STATUSDESC"] : ["Current_Status", "STATUS"]), address, description: first(a, isArlington ? ["WORKDESC", "SUBDESC", "MainUse"] : ["Work_Description", "Description"]), contractor: first(a, ["Contractor", "NameofBusiness"]), issueDate: dateIso(first(a, isArlington ? ["ISSUEDATE"] : ["Issue_Date", "Issued_Date", "IssuedDate"])), sourceParcelKey: first(a, ["PROPGISID1"]), longitude: Number.isFinite(longitude) ? longitude : null, latitude: Number.isFinite(latitude) ? latitude : null };
}

function buildPermits(parcels, layers) {
  const directory = path.join(outputRoot, "permits"); clearDir(directory); ensureDir(path.join(directory, "chunks"));
  const byAddress = new Map(); const byGis = new Map();
  const parcelGrid = makeGrid(bounds, 220, 180);
  for (const parcel of parcels) {
    const address = normalizeAddress(parcel.address);
    if (address) { if (!byAddress.has(address)) byAddress.set(address, []); byAddress.get(address).push(parcel); }
    const gis = normalizeId(parcel.gisParcelId); if (gis) { if (!byGis.has(gis)) byGis.set(gis, []); byGis.get(gis).push(parcel); }
    parcelGrid.add(parcel, { minLng: parcel.center[0], maxLng: parcel.center[0], minLat: parcel.center[1], maxLat: parcel.center[1] });
  }
  const records = [];
  const joinMethodCounts = { sourceParcelKey: 0, addressMatch: 0, spatialNearestCentroid: 0, unmatched: 0, ambiguous: 0 };
  for (const source of layers) for (const feature of source.features) {
    const record = buildPermitRecord(source, feature); let candidates = [];
    if (record.sourceParcelKey) candidates = byGis.get(normalizeId(record.sourceParcelKey)) || [];
    if (candidates.length === 1) record.joinMethod = "sourceParcelKey";
    if (!candidates.length) {
      candidates = byAddress.get(normalizeAddress(record.address)) || [];
      if (candidates.length === 1) record.joinMethod = "addressMatch";
    }
    if (candidates.length > 1 && Number.isFinite(record.longitude) && Number.isFinite(record.latitude)) {
      candidates.sort((a, b) => ((a.center[0] - record.longitude) ** 2 + (a.center[1] - record.latitude) ** 2) - ((b.center[0] - record.longitude) ** 2 + (b.center[1] - record.latitude) ** 2));
      if (((candidates[0].center[0] - record.longitude) ** 2 + (candidates[0].center[1] - record.latitude) ** 2) < 0.000004) { candidates = [candidates[0]]; record.joinMethod = "addressMatch"; }
    }
    if (!candidates.length && Number.isFinite(record.longitude) && Number.isFinite(record.latitude)) {
      const nearby = parcelGrid.at([record.longitude, record.latitude]).map((parcel) => ({ parcel, distance: (parcel.center[0] - record.longitude) ** 2 + (parcel.center[1] - record.latitude) ** 2 })).sort((a, b) => a.distance - b.distance);
      if (nearby[0]?.distance < 0.0000005) { candidates = [nearby[0].parcel]; record.joinMethod = "spatialNearestCentroid"; }
    }
    if (candidates.length === 1) {
      const parcel = candidates[0]; Object.assign(record, { countyParcelId: parcel.countyParcelId, parcelAccountNum: parcel.accountNum, parcelGisId: parcel.gisParcelId, parcelChunkId: parcel.chunkId });
      joinMethodCounts[record.joinMethod] += 1;
    } else if (candidates.length > 1) { record.joinMethod = "ambiguous"; joinMethodCounts.ambiguous += 1; }
    else { record.joinMethod = "unmatched"; joinMethodCounts.unmatched += 1; }
    record.searchText = [record.permitNumber, record.permitType, record.address, record.parcelAccountNum, record.parcelGisId].filter(Boolean).join(" ").toLowerCase();
    records.push(record);
  }
  const chunkGroups = new Map();
  for (const record of records) {
    const id = Number.isFinite(record.longitude) && Number.isFinite(record.latitude) ? `${Math.floor((record.longitude - bounds.minLng) / 0.025)}-${Math.floor((record.latitude - bounds.minLat) / 0.025)}` : "unlocated";
    if (!chunkGroups.has(id)) chunkGroups.set(id, []); chunkGroups.get(id).push(record); record.chunkId = id;
  }
  const chunks = [];
  for (const [id, values] of chunkGroups) {
    const located = values.filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude));
    const chunkBounds = located.length ? { minLng: Math.min(...located.map((item) => item.longitude)), minLat: Math.min(...located.map((item) => item.latitude)), maxLng: Math.max(...located.map((item) => item.longitude)), maxLat: Math.max(...located.map((item) => item.latitude)) } : null;
    const file = `chunks/${id}.json`; writeJson(path.join(directory, file), { permits: values }); chunks.push({ id, file, count: values.length, bounds: chunkBounds });
  }
  const compact = records.map((record) => ({ permitRecordId: record.permitRecordId, sourceDataset: record.sourceDataset, permitNumber: record.permitNumber, permitType: record.permitType, permitSubtype: record.permitSubtype, permitStatus: record.permitStatus, address: record.address, issueDate: record.issueDate, parcelAccountNum: record.parcelAccountNum || "", parcelGisId: record.parcelGisId || "", countyParcelId: record.countyParcelId || "", joinMethod: record.joinMethod, longitude: record.longitude, latitude: record.latitude, chunkId: record.chunkId, searchText: record.searchText }));
  writeJson(path.join(directory, "search-index.json"), { permits: compact });
  const joined = records.filter((item) => item.parcelAccountNum);
  const manifest = { schemaVersion: "wr-tarrant-permit-manifest-v1", sourceCountyId: countyId, status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdictions: ["fort-worth", "arlington"], uncoveredJurisdictionCount: 40, permitCount: records.length, locatedPermitCount: records.filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude)).length, joinedPermitCount: joined.length, unmatchedPermitCount: records.length - joined.length, joinMethodCounts, chunkCount: chunks.length, chunks, searchIndex: "search-index.json", searchIndexCount: compact.length, sources: layers.map((item) => item.snapshot) };
  writeJson(path.join(directory, "manifest.json"), manifest);
  return { manifest, records: joined };
}

function buildDevelopments(parcels, joinedPermits) {
  const directory = path.join(outputRoot, "developments"); clearDir(directory);
  const parcelMap = new Map(parcels.map((parcel) => [parcel.accountNum, parcel])); const groups = new Map();
  for (const permit of joinedPermits) { const key = permit.parcelAccountNum; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(permit); }
  const records = [];
  for (const [accountNum, permits] of groups) {
    const parcel = parcelMap.get(accountNum); const categories = unique(permits.map(developmentCategory)); const dates = permits.map((item) => item.issueDate).filter(Boolean).sort();
    const weighted = categories.reduce((score, item) => score + ({ "new-construction": 35, demolition: 30, occupancy: 25, alteration: 15, "permit-activity": 5 }[item] || 0), 0);
    records.push({ parcelId: accountNum, parcelGisId: parcel?.gisParcelId || "", parcelAddress: parcel?.address || "", parcelPropertyName: parcel?.propertyName || "", signalCount: permits.length, score: Math.min(100, 20 + weighted + Math.min(30, permits.length)), latestActivityDate: dates.at(-1) || "", signalTypes: categories, stages: unique(categories.map((item) => item === "occupancy" ? "occupancy-evidence" : item === "new-construction" ? "permitted-construction" : item === "demolition" ? "demolition-evidence" : "permit-evidence")), coverageJurisdictions: unique(permits.map((item) => item.coverageJurisdiction)), evidenceRecordIds: permits.slice(0, 25).map((item) => item.permitRecordId), classificationPolicy: "evidence-only; permit activity is not proof of project completion" });
  }
  const index = { schemaVersion: "wr-tarrant-development-index-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, source: "public/data/counties/tarrant/permits/manifest.json", status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdictions: ["fort-worth", "arlington"], parcelCount: records.length, records };
  writeJson(path.join(directory, "parcel-development-index.json"), index);
  writeJson(path.join(directory, "manifest.json"), { ...index, records: undefined, parcelIndex: "parcel-development-index.json" });
  return index;
}

function updateAdapter(results) {
  const file = path.join(root, "data/county-adapters/tarrant/adapter.json"); const adapter = JSON.parse(fs.readFileSync(file, "utf8"));
  const statusById = { permits: "parcel-index-ready-partial-municipal-coverage", "zoning-intelligence": "parcel-index-ready-partial-municipal-coverage", "floodplain-intelligence": "parcel-index-ready-regulatory-candidate", "development-signals": "parcel-index-ready-partial-municipal-coverage" };
  adapter.optionalLayers = adapter.optionalLayers.map((layer) => statusById[layer.id] ? { ...layer, status: statusById[layer.id] } : layer);
  adapter.verifiedCounts = { ...adapter.verifiedCounts, sourcePermitRecords: results.permits.manifest.permitCount, permitRowsJoined: results.permits.manifest.joinedPermitCount, permitRowsUnmatched: results.permits.manifest.unmatchedPermitCount, parcelsWithZoning: results.zoning.manifest.parcelIndexCount, parcelsWithFloodplain: results.floodplain.manifest.parcelIndexCount, parcelsWithDevelopmentSignals: results.developments.parcelCount };
  adapter.productionGap = "Tarrant has 13/14 pilot intelligence groups when partial Fort Worth/Arlington permit, zoning, and development coverage plus the 2025 regulatory-candidate flood layer are included. Migration-demand and production activation remain blocked; uncovered jurisdictions stay explicit.";
  writeJson(file, adapter);
}

async function main() {
  ensureDir(rawRoot); ensureDir(reportRoot);
  console.log("Loading 758,633 Tarrant parcel summaries..."); const { parcels } = loadParcels();
  console.log("Capturing official zoning sources..."); const zoningLayers = await Promise.all(sources.zoning.map(fetchSource));
  console.log("Capturing official flood source..."); const floodLayers = await Promise.all(sources.floodplain.map(fetchSource));
  console.log("Capturing official permit sources..."); const permitLayers = await Promise.all(sources.permits.map(fetchSource));
  console.log("Joining zoning to parcel centroids..."); const zoning = buildZoning(parcels, zoningLayers);
  console.log("Joining flood intelligence to parcel centroids..."); const floodplain = buildFloodplain(parcels, floodLayers);
  console.log("Normalizing and joining permit records..."); const permits = buildPermits(parcels, permitLayers);
  console.log("Deriving evidence-bound development summaries..."); const developments = buildDevelopments(parcels, permits.records);
  const results = { zoning, floodplain, permits, developments }; updateAdapter(results);
  const report = { schemaVersion: "wr-tarrant-intelligence-pilot-report-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, status: "13-of-14-pilot-groups-built-production-disabled", parityTarget: { readyGroups: 13, totalGroups: 14, percent: 92.9, remainingGroup: "migration-demand" }, coverage: { coveredJurisdictions: ["fort-worth", "arlington"], uncoveredJurisdictionCount: 40, countywideFloodCandidate: true }, counts: { parcels: parcels.length, zoningParcels: zoning.records.length, floodplainParcels: floodplain.records.length, permits: permits.manifest.permitCount, joinedPermits: permits.manifest.joinedPermitCount, developmentParcels: developments.parcelCount }, caveats: ["Production activation remains disabled.", "Permit, zoning, and development coverage is limited to Fort Worth and Arlington.", "Flood classifications use a regulatory-candidate layer and are not insurance determinations.", "Source reuse and independent release approvals remain required for production."] };
  writeJson(path.join(reportRoot, "tarrant-intelligence-pilot-report.json"), report);
  fs.writeFileSync(path.join(reportRoot, "tarrant-intelligence-pilot-report.md"), `# Tarrant Intelligence Pilot\n\nGenerated: ${report.generatedAt}\n\n- Status: ${report.status}\n- Capability parity: 13/14 (92.9%)\n- Parcel base: ${parcels.length.toLocaleString()}\n- Parcels with zoning: ${zoning.records.length.toLocaleString()}\n- Parcels with flood intelligence: ${floodplain.records.length.toLocaleString()}\n- Permit records: ${permits.manifest.permitCount.toLocaleString()}\n- Joined permits: ${permits.manifest.joinedPermitCount.toLocaleString()}\n- Parcels with development evidence: ${developments.parcelCount.toLocaleString()}\n\nCoverage is explicit: Fort Worth and Arlington for zoning, permits, and development; Tarrant-wide regulatory-candidate flood coverage. Production activation remains disabled.\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
