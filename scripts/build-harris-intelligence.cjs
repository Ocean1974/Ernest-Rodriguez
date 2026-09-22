const fs = require("fs");
const https = require("https");
const path = require("path");
const { unzipSync } = require("fflate");

const root = path.join(__dirname, "..");
const countyId = "harris-county-tx";
const parcelRoot = path.join(root, "public", "data", "counties", countyId, "parcels");
const publicRoot = path.join(root, "public", "data", "counties", countyId);
const outputRoot = path.join(root, "output", countyId);
const platFile = path.join(outputRoot, "source-cache", "Plat-Current-Agenda-Spreadsheet-09-14-2026.xlsx");
const cityUrl = "https://geogimstest.houstontx.gov/arcgis/rest/services/HPC/FloodManagement/MapServer/8";
const floodUrl = "https://geogimstest.houstontx.gov/arcgis/rest/services/HPC/FloodManagement/MapServer/12";
const platUrl = "https://www.houstontx.gov/planning/DevelopRegs/docs_pdfs/Plat_report/2026/Plat-Current-Agenda-Spreadsheet-09-14-2026.xlsx";
const shardKeyLength = 4;
const bounds = { minLng: -96.05, minLat: 29.35, maxLng: -94.75, maxLat: 30.25 };

const zoningFields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "existingParcelZoning", "label", "baseDistricts", "longZoneDistricts", "pdNumbers", "pdsNumbers", "supNumbers", "cdNumbers", "subdistricts", "overlays", "caseNumbers", "sourceLayerIds", "sourceLayerHits", "searchText"];
const zoningHitFields = ["sourceLayerId", "sourceLayerTitle", "recordType", "objectId", "zoneDistrict", "longZoneDistrict", "pdNumber", "pdsNumber", "supNumber", "cdNumber", "subdistrict", "caseNumber", "overlayName", "ordNumber"];
const floodFields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "label", "floodZones", "zoneSubtypes", "sfha", "baseFloodElevations", "verticalDatums", "depths", "velocities", "sourceCitations", "sourceLayerIds", "sourceLayerHits", "searchText"];
const floodHitFields = ["sourceLayerId", "sourceLayerTitle", "objectId", "floodZone", "zoneSubtype", "sfha", "staticBfe", "verticalDatum", "depth", "lengthUnit", "velocity", "velocityUnit", "sourceCitation", "gfid"];

function assertWorkspace(target) {
  if (!path.resolve(target).startsWith(path.resolve(root))) throw new Error(`Refusing to write outside workspace: ${target}`);
}

function cleanDir(target) {
  assertWorkspace(target);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
}

function requestBuffer(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: "application/json" }, timeout: 120000 }, (res) => {
      const parts = [];
      res.on("data", (part) => parts.push(part));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        resolve(Buffer.concat(parts));
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout for ${url}`)));
    req.on("error", (error) => {
      if (attempt < 3) return setTimeout(() => requestBuffer(url, attempt + 1).then(resolve, reject), attempt * 1000);
      reject(error);
    });
  });
}

async function requestJson(url) {
  const payload = JSON.parse((await requestBuffer(url)).toString("utf8"));
  if (payload.error) throw new Error(`${payload.error.code || "ArcGIS"}: ${payload.error.message || "query failed"}`);
  return payload;
}

async function fetchLayer(url, fields) {
  const metadata = await requestJson(`${url}?f=json`);
  const count = Number((await requestJson(`${url}/query?where=1%3D1&returnCountOnly=true&f=json`)).count || 0);
  const pageSize = Math.min(Number(metadata.maxRecordCount || 1000), 1000);
  const features = [];
  for (let offset = 0; offset < count; offset += pageSize) {
    const query = new URLSearchParams({
      where: "1=1",
      outFields: fields.join(","),
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "6",
      maxAllowableOffset: "0.00002",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      orderByFields: `${metadata.objectIdField || "OBJECTID"} ASC`,
      f: "json",
    });
    const page = await requestJson(`${url}/query?${query}`);
    features.push(...(page.features || []));
  }
  return { metadata, count, features };
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text === "null" || text === "undefined" ? "" : text;
}

function ringBounds(rings) {
  const result = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  for (const ring of rings || []) for (const point of ring || []) {
    result.minLng = Math.min(result.minLng, Number(point[0]));
    result.minLat = Math.min(result.minLat, Number(point[1]));
    result.maxLng = Math.max(result.maxLng, Number(point[0]));
    result.maxLat = Math.max(result.maxLat, Number(point[1]));
  }
  return Number.isFinite(result.minLng) ? result : null;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  let inside = false;
  for (const ring of rings || []) if (ring.length >= 3 && pointInRing(point, ring)) inside = !inside;
  return inside;
}

function gridCell(point, columns = 180, rows = 140) {
  const x = Math.max(0, Math.min(columns - 1, Math.floor(((point[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * columns)));
  const y = Math.max(0, Math.min(rows - 1, Math.floor(((point[1] - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * rows)));
  return `${x}:${y}`;
}

function featureIndex(features) {
  const cells = new Map();
  for (const feature of features) {
    const fb = ringBounds(feature.geometry?.rings);
    if (!fb) continue;
    feature._bounds = fb;
    const min = gridCell([fb.minLng, fb.minLat]).split(":").map(Number);
    const max = gridCell([fb.maxLng, fb.maxLat]).split(":").map(Number);
    for (let x = min[0]; x <= max[0]; x += 1) for (let y = min[1]; y <= max[1]; y += 1) {
      const key = `${x}:${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(feature);
    }
  }
  return cells;
}

function hitsAt(index, point) {
  return (index.get(gridCell(point)) || []).filter((feature) => {
    const b = feature._bounds;
    return point[0] >= b.minLng && point[0] <= b.maxLng && point[1] >= b.minLat && point[1] <= b.maxLat && pointInPolygon(point, feature.geometry.rings);
  });
}

function normalizeId(value) {
  return clean(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function packed(fields, record) {
  return fields.map((field) => record[field] ?? "");
}

function createShardWriter(directory, fields, hitFields) {
  cleanDir(directory);
  const states = new Map();
  return {
    add(record) {
      const key = normalizeId(record.accountNum).slice(0, shardKeyLength) || "none";
      if (!states.has(key)) {
        const file = path.join(directory, `${key}.json`);
        const fd = fs.openSync(file, "w");
        fs.writeSync(fd, JSON.stringify({ fields, sourceHitFields: hitFields }).slice(0, -1) + ',"records":[');
        states.set(key, { fd, file: `parcel-index/${key}.json`, count: 0, first: true });
      }
      const state = states.get(key);
      fs.writeSync(state.fd, `${state.first ? "" : ","}${JSON.stringify(packed(fields, record))}`);
      state.first = false;
      state.count += 1;
    },
    close() {
      const files = {};
      const counts = {};
      for (const [key, state] of states) {
        fs.writeSync(state.fd, "]}");
        fs.closeSync(state.fd);
        files[key] = state.file;
        counts[key] = state.count;
      }
      return { files, counts };
    },
  };
}

function parcelCenter(parcel) {
  const center = parcel.liveGeometry?.center;
  if (Array.isArray(center) && center.every(Number.isFinite)) return center;
  const ring = parcel.realGeometry?.geometry?.coordinates?.[0] || [];
  if (!ring.length) return null;
  return [ring.reduce((sum, point) => sum + Number(point[0]), 0) / ring.length, ring.reduce((sum, point) => sum + Number(point[1]), 0) / ring.length];
}

function xmlText(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function excelDate(serial) {
  const value = Number(serial);
  if (!Number.isFinite(value)) return "";
  return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
}

function parsePlatWorkbook(file) {
  const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const xml = Buffer.from(files["xl/worksheets/sheet.xml"]).toString("utf8");
  const rows = [...xml.matchAll(/<x:row\b[^>]*>([\s\S]*?)<\/x:row>/g)].map((match) => {
    const row = {};
    for (const cell of match[1].matchAll(/<x:c\b[^>]*r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/x:c>/g)) {
      const inline = cell[2].match(/<x:t[^>]*>([\s\S]*?)<\/x:t>/)?.[1];
      const numeric = cell[2].match(/<x:v>([\s\S]*?)<\/x:v>/)?.[1];
      row[cell[1]] = xmlText(inline ?? numeric ?? "");
    }
    return row;
  });
  return rows.slice(1).map((row) => ({
    subdivisionName: row.A || "",
    applicationNumber: row.B || "",
    planningCommissionDate: excelDate(row.C),
    dateSubmitted: excelDate(row.D),
    applicationType: row.E || "",
    appLocation: row.G || "",
    councilDistrict: row.H || "",
    jurisdiction: row.I || "",
    county: row.J || "",
    keyMap: clean(row.L),
    zipcode: row.N || "",
    landUse: row.W || "",
    acreage: row.X || "",
    lotsCreated: row.Y || "",
    accountNum: normalizeId(row.Z),
    developer: row.AA || "",
    organization: row.AB || "",
    platPdf: row.AE || "",
  }));
}

function developmentSearchKeys(record) {
  const values = [record.parcelId, record.parcelGisId, record.parcelAddress, record.parcelPropertyName, record.subdivisionName, record.applicationNumber, record.applicationType, record.developer, ...(record.signalTypes || []), ...(record.stages || [])];
  const keys = new Set();
  for (const value of values) {
    const text = clean(value).toLowerCase();
    for (const token of [text, ...text.split(/[^a-z0-9]+/)]) {
      const key = normalizeId(token).slice(0, 2);
      if (key.length === 2) keys.add(key);
    }
  }
  return [...keys];
}

function writeDevelopmentRuntime(developmentDir, joined, generatedAt, sourceRecordCount, unmatchedRecordCount) {
  const recordsDir = path.join(developmentDir, "records");
  const searchDir = path.join(developmentDir, "search");
  cleanDir(recordsDir);
  cleanDir(searchDir);
  const recordGroups = new Map();
  const searchGroups = new Map();
  for (const record of joined) {
    const recordKey = normalizeId(record.parcelId).slice(0, 2) || "__";
    if (!recordGroups.has(recordKey)) recordGroups.set(recordKey, []);
    recordGroups.get(recordKey).push(record);
    for (const key of developmentSearchKeys(record)) {
      if (!searchGroups.has(key)) searchGroups.set(key, []);
      searchGroups.get(key).push(record);
    }
  }
  const writeGroups = (groups, subdir) => {
    const shards = {};
    for (const [key, records] of groups) {
      const file = `${subdir}/${key}.json`;
      fs.writeFileSync(path.join(developmentDir, file), JSON.stringify({ records }));
      shards[key] = { count: records.length, files: [file] };
    }
    return shards;
  };
  const recordShards = writeGroups(recordGroups, "records");
  const searchShards = writeGroups(searchGroups, "search");
  const maxRecordsPerFile = Math.max(1, ...[...recordGroups.values(), ...searchGroups.values()].map((records) => records.length));
  fs.writeFileSync(path.join(developmentDir, "manifest.json"), JSON.stringify({ schemaVersion: "wr-development-parcel-service-v1", generatedAt, sourceCountyId: countyId, source: platUrl, status: "parcel-index-ready-current-plat-agenda", parcelCount: joined.length, sourceRecordCount, unmatchedRecordCount, shardKeyLength: 2, maxRecordsPerFile, maxShardBytes: 1048576, recordShards, searchShards, classificationPolicy: "Plat applications are planning-stage development signals only." }, null, 2));
}

async function ensurePlatFile() {
  if (fs.existsSync(platFile)) return;
  fs.mkdirSync(path.dirname(platFile), { recursive: true });
  fs.writeFileSync(platFile, await requestBuffer(platUrl));
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const [city, flood] = await Promise.all([
    fetchLayer(cityUrl, ["OBJECTID", "SERVICE_TY", "ENTITY_NAM", "EFF_DATE", "LEGAL_DOC", "COMMENTS"]),
    fetchLayer(floodUrl, ["OBJECTID", "DFIRM_ID", "FLD_AR_ID", "FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "V_DATUM", "DEPTH", "LEN_UNIT", "VELOCITY", "VEL_UNIT", "SOURCE_CIT"]),
  ]);
  const cityGrid = featureIndex(city.features);
  const floodGrid = featureIndex(flood.features);
  const zoningDir = path.join(publicRoot, "zoning");
  const floodDir = path.join(publicRoot, "floodplain");
  fs.mkdirSync(zoningDir, { recursive: true });
  fs.mkdirSync(floodDir, { recursive: true });
  const zoningWriter = createShardWriter(path.join(zoningDir, "parcel-index"), zoningFields, zoningHitFields);
  const floodWriter = createShardWriter(path.join(floodDir, "parcel-index"), floodFields, floodHitFields);
  const parcelManifest = JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8"));
  let parcelCount = 0;
  let cityJoined = 0;
  let floodJoined = 0;
  let sfhaCount = 0;
  const parcelByAccount = new Map();
  for (const chunk of parcelManifest.chunks || []) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      parcelCount += 1;
      const center = parcelCenter(parcel);
      const accountNum = clean(parcel.accountNum || parcel.accountNumber);
      if (accountNum) parcelByAccount.set(normalizeId(accountNum), { parcelId: accountNum, parcelGisId: clean(parcel.gisParcelId), parcelAddress: clean(parcel.address || parcel.propertyAddress), parcelPropertyName: clean(parcel.propertyName) });
      if (!center || !accountNum) continue;
      const cityHits = hitsAt(cityGrid, center);
      if (cityHits.length) {
        const serviceTypes = [...new Set(cityHits.map((hit) => clean(hit.attributes?.SERVICE_TY)).filter(Boolean))];
        const limited = serviceTypes.includes("LIMITED") && !serviceTypes.includes("FULL");
        const label = limited ? "Houston limited-purpose development controls (no conventional zoning)" : "Houston development controls (no conventional zoning)";
        const sourceHits = cityHits.map((hit) => ({ sourceLayerId: "houston-city-limits", sourceLayerTitle: "City of Houston City Limits", recordType: "overlay", objectId: hit.attributes?.OBJECTID, zoneDistrict: "NO CONVENTIONAL ZONING", longZoneDistrict: "Houston development regulations, including Chapter 42 subdivision and development controls", overlayName: clean(hit.attributes?.SERVICE_TY), ordNumber: clean(hit.attributes?.LEGAL_DOC) }));
        zoningWriter.add({ countyParcelId: clean(parcel.countyParcelId), accountNum, gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), existingParcelZoning: "", label, baseDistricts: ["NO CONVENTIONAL ZONING"], longZoneDistricts: ["Houston development regulations / Chapter 42"], pdNumbers: [], pdsNumbers: [], supNumbers: [], cdNumbers: [], subdistricts: [], overlays: serviceTypes.map((value) => `Houston ${value.toLowerCase()}-purpose jurisdiction`), caseNumbers: [], sourceLayerIds: ["houston-city-limits"], sourceLayerHits: sourceHits.map((hit) => packed(zoningHitFields, hit)), searchText: `${accountNum} ${label} Chapter 42 ${serviceTypes.join(" ")}` });
        cityJoined += 1;
      }
      const floodHits = hitsAt(floodGrid, center);
      if (floodHits.length) {
        const normalized = floodHits.map((hit) => ({ sourceLayerId: "houston-flood-hazard-area", sourceLayerTitle: "City of Houston Flood Hazard Area", objectId: hit.attributes?.OBJECTID, floodZone: clean(hit.attributes?.FLD_ZONE), zoneSubtype: clean(hit.attributes?.ZONE_SUBTY), sfha: clean(hit.attributes?.SFHA_TF), staticBfe: clean(hit.attributes?.STATIC_BFE), verticalDatum: clean(hit.attributes?.V_DATUM), depth: clean(hit.attributes?.DEPTH), lengthUnit: clean(hit.attributes?.LEN_UNIT), velocity: clean(hit.attributes?.VELOCITY), velocityUnit: clean(hit.attributes?.VEL_UNIT), sourceCitation: clean(hit.attributes?.SOURCE_CIT), gfid: clean(hit.attributes?.FLD_AR_ID) }));
        const values = (field) => [...new Set(normalized.map((hit) => clean(hit[field])).filter(Boolean))];
        const zones = values("floodZone");
        const subtypes = values("zoneSubtype");
        const sfha = values("sfha");
        if (sfha.some((value) => /^(t|true|y|yes|1)$/i.test(value)) || zones.some((value) => /^[AV]/i.test(value))) sfhaCount += 1;
        const label = [zones.length ? `Zone ${zones.join(" / ")}` : "Flood hazard area", subtypes.join(" / ")].filter(Boolean).join(" — ");
        floodWriter.add({ countyParcelId: clean(parcel.countyParcelId), accountNum, gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), label, floodZones: zones, zoneSubtypes: subtypes, sfha, baseFloodElevations: values("staticBfe"), verticalDatums: values("verticalDatum"), depths: values("depth"), velocities: values("velocity"), sourceCitations: values("sourceCitation"), sourceLayerIds: ["houston-flood-hazard-area"], sourceLayerHits: normalized.map((hit) => packed(floodHitFields, hit)), searchText: `${accountNum} ${label} ${sfha.join(" ")}` });
        floodJoined += 1;
      }
    }
  }
  const zoningShards = zoningWriter.close();
  const floodShards = floodWriter.close();
  fs.writeFileSync(path.join(zoningDir, "search-index.json"), JSON.stringify({ records: [] }));
  const zoningIndex = { schemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt, recordCount: cityJoined, sourceFeatureCount: city.count, joinMethod: "parcel centroid inside official City of Houston limits polygon", scopeNote: "This is a jurisdiction/development-controls layer. Houston has no conventional citywide zoning.", ...zoningShards };
  fs.writeFileSync(path.join(zoningDir, "parcel-zoning-index.json"), JSON.stringify(zoningIndex, null, 2));
  fs.writeFileSync(path.join(zoningDir, "manifest.json"), JSON.stringify({ schemaVersion: "wr-harris-development-controls-manifest-v1", recordSchemaVersion: "wr-parcel-zoning-index-v1", sourceCountyId: countyId, generatedAt, status: "parcel-index-ready-partial-jurisdiction-coverage", defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750, chunkCount: 0, chunks: [], searchIndex: "search-index.json", searchIndexCount: 0, parcelIndex: "parcel-zoning-index.json", parcelIndexCount: cityJoined, sourceLayers: [{ id: "houston-city-limits", title: "City of Houston City Limits", url: cityUrl, sourceFeatureCount: city.count }], parcelIndexShards: { keyLength: shardKeyLength, fields: zoningFields, sourceHitFields: zoningHitFields, ...zoningShards }, parcelZoningJoin: { method: "parcel centroid spatial join", stableId: "HCAD_NUM/acct_num", scope: "City of Houston full/limited-purpose jurisdiction only", noZoningDisclosure: "Houston has no conventional citywide zoning; blank parcels may be outside Houston or outside this source coverage." } }, null, 2));
  const floodIndex = { schemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt, parcelFloodplainRecordCount: floodJoined, parcelsInSfhaCount: sfhaCount, sourceFeatureCount: flood.count, joinMethod: "parcel centroid inside official flood-hazard polygon", ...floodShards };
  fs.writeFileSync(path.join(floodDir, "parcel-floodplain-index.json"), JSON.stringify(floodIndex, null, 2));
  fs.writeFileSync(path.join(floodDir, "manifest.json"), JSON.stringify({ schemaVersion: "wr-harris-floodplain-manifest-v1", recordSchemaVersion: "wr-parcel-floodplain-index-v1", sourceCountyId: countyId, generatedAt, status: "parcel-index-ready", defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750, chunkCount: 0, chunks: [], searchIndex: "", searchIndexCount: 0, parcelIndex: "parcel-floodplain-index.json", parcelIndexCount: floodJoined, sourceService: { id: "houston-flood-hazard-area", title: "City of Houston Flood Hazard Area", url: floodUrl, sourceFeatureCount: flood.count }, sourceLayerCount: 1, parcelIndexShards: { keyLength: shardKeyLength, fields: floodFields, sourceHitFields: floodHitFields, ...floodShards }, parcelFloodplainJoin: { method: "parcel centroid spatial join", stableId: "HCAD_NUM/acct_num", includedFloodplain: ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "V_DATUM", "DEPTH", "VELOCITY", "SOURCE_CIT", "FLD_AR_ID"] } }, null, 2));

  await ensurePlatFile();
  const platRows = parsePlatWorkbook(platFile).filter((row) => /^harris$/i.test(row.county));
  const joined = [];
  const unmatched = [];
  for (const row of platRows) {
    const parcel = parcelByAccount.get(row.accountNum);
    if (!row.accountNum || !parcel) {
      unmatched.push(row);
      continue;
    }
    joined.push({ ...parcel, signalCount: 1, score: 65, latestActivityDate: row.dateSubmitted, signalTypes: ["plat-application"], stages: ["planning-review"], applicationNumber: row.applicationNumber, applicationType: row.applicationType, subdivisionName: row.subdivisionName, jurisdiction: row.jurisdiction, landUse: row.landUse, acreage: row.acreage, lotsCreated: row.lotsCreated, developer: row.developer, evidenceRecordIds: [`houston-plat-agenda:${row.applicationNumber}`], classificationPolicy: "evidence-only; a plat application is a planning signal, not proof of permitting, construction, approval, or completion" });
  }
  const developmentDir = path.join(publicRoot, "developments");
  fs.writeFileSync(path.join(developmentDir, "parcel-development-index.json"), JSON.stringify({ schemaVersion: "wr-harris-development-index-v1", generatedAt, sourceCountyId: countyId, source: platUrl, status: "parcel-index-ready-current-plat-agenda", parcelCount: joined.length, sourceRecordCount: platRows.length, unmatchedRecordCount: unmatched.length, records: joined }, null, 2));
  fs.writeFileSync(path.join(developmentDir, "unmatched-plat-applications.json"), JSON.stringify({ source: platUrl, records: unmatched }, null, 2));
  writeDevelopmentRuntime(developmentDir, joined, generatedAt, platRows.length, unmatched.length);

  const report = { schemaVersion: "wr-harris-intelligence-report-v1", generatedAt, sourceCountyId: countyId, parcelCount, developmentControls: { sourceFeatureCount: city.count, joinedParcelCount: cityJoined, sourceUrl: cityUrl, noZoningDisclosure: "Houston has no conventional citywide zoning." }, floodplain: { sourceFeatureCount: flood.count, joinedParcelCount: floodJoined, parcelsInSfhaCount: sfhaCount, sourceUrl: floodUrl }, developmentSignals: { sourceRecordCount: platRows.length, joinedRecordCount: joined.length, unmatchedRecordCount: unmatched.length, directAccountJoinKey: "Appraisal District No (County Tax ID) -> HCAD_NUM/acct_num", sourceUrl: platUrl } };
  fs.writeFileSync(path.join(outputRoot, "houston-intelligence-report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputRoot, "houston-intelligence-report.md"), `# Houston / Harris County intelligence build\n\nGenerated: ${generatedAt}\n\n## Development controls\n\n- Official City Limits features: ${city.count.toLocaleString()}\n- Parcels joined by centroid: ${cityJoined.toLocaleString()}\n- Disclosure: Houston has no conventional citywide zoning. This layer reports Houston jurisdiction and development controls, including Chapter 42 context.\n\n## Floodplain\n\n- Official flood-hazard polygons: ${flood.count.toLocaleString()}\n- Parcels joined by centroid: ${floodJoined.toLocaleString()}\n- Parcels in SFHA: ${sfhaCount.toLocaleString()}\n\n## Development signals\n\n- Current Harris County plat-agenda rows: ${platRows.length.toLocaleString()}\n- Direct HCAD account joins: ${joined.length.toLocaleString()}\n- Unmatched rows: ${unmatched.length.toLocaleString()}\n- Join key: Appraisal District No (County Tax ID) -> HCAD_NUM/acct_num\n- Policy: plat applications are planning signals, not proof of permits, construction, approval, or completion.\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function refreshDevelopmentRuntime() {
  const developmentDir = path.join(publicRoot, "developments");
  const index = JSON.parse(fs.readFileSync(path.join(developmentDir, "parcel-development-index.json"), "utf8"));
  writeDevelopmentRuntime(developmentDir, index.records || [], new Date().toISOString(), Number(index.sourceRecordCount || 0), Number(index.unmatchedRecordCount || 0));
  console.log(`Refreshed ${index.records?.length || 0} Harris development records into account and search shards.`);
}

(process.argv.includes("--refresh-development-runtime") ? refreshDevelopmentRuntime() : main()).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
