const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.join(__dirname, "..");
const countyId = "travis-county-tx";
const serviceUrl = "https://maps.austintexas.gov/gis/rest/Shared/Permits/MapServer/0";
const rawRoot = path.join(root, "data", "raw", countyId, "permits");
const rawFile = path.join(rawRoot, "austin-issued-building-permits.ndjson");
const parcelRoot = path.join(root, "public", "data", "counties", countyId, "parcels");
const outputRoot = path.join(root, "public", "data", "counties", countyId);
const reportRoot = path.join(root, "output", countyId);
const pageSize = 10000;
const mapBounds = { minLng: -98.25, minLat: 29.95, maxLng: -97.25, maxLat: 30.75 };

function requestJson(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/geo+json, application/json" }, timeout: 120000 }, (response) => {
      const parts = [];
      response.on("data", (part) => parts.push(part));
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        try {
          const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
          if (payload.error) throw new Error(`${payload.error.code || "ArcGIS"}: ${payload.error.message || "query failed"}`);
          resolve(payload);
        } catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Timeout for ${url}`)));
    request.on("error", (error) => {
      if (attempt < 4) return setTimeout(() => requestJson(url, attempt + 1).then(resolve, reject), attempt * 1000);
      reject(error);
    });
  });
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function clean(value) { return String(value ?? "").trim(); }
function cleanDir(target) { fs.mkdirSync(target, { recursive: true }); for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true }); }
function dateIso(value) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) return ""; return new Date(number).toISOString().slice(0, 10); }

function normalizeAddress(value) {
  return clean(value).toUpperCase()
    .replace(/\b(?:UNIT|APT|APARTMENT|SUITE|STE|BLDG|BUILDING)\b.*$/i, "")
    .replace(/#.*$/, "")
    .replace(/\bAUSTIN\b|\bTEXAS\b|\bTX\b/g, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
    .replace(/\bNORTH\b/g, "N").replace(/\bSOUTH\b/g, "S").replace(/\bEAST\b/g, "E").replace(/\bWEST\b/g, "W")
    .replace(/\bSTREET\b/g, "ST").replace(/\bROAD\b/g, "RD").replace(/\bAVENUE\b/g, "AVE").replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR").replace(/\bLANE\b/g, "LN").replace(/\bCOURT\b/g, "CT").replace(/\bCIRCLE\b/g, "CIR")
    .replace(/\bPARKWAY\b/g, "PKWY").replace(/\bHIGHWAY\b/g, "HWY").replace(/\bPLACE\b/g, "PL").replace(/\bTRAIL\b/g, "TRL")
    .replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

async function capture() {
  fs.mkdirSync(rawRoot, { recursive: true });
  const metadata = await requestJson(`${serviceUrl}?f=json`);
  const sourceFeatureCount = Number((await requestJson(`${serviceUrl}/query?where=1%3D1&returnCountOnly=true&f=json`)).count || 0);
  const temporary = `${rawFile}.partial`; const handle = fs.openSync(temporary, "w"); const hash = crypto.createHash("sha256");
  let emittedFeatureCount = 0;
  try {
    for (let offset = 0; offset < sourceFeatureCount; offset += pageSize) {
      const query = new URLSearchParams({ where: "1=1", outFields: "*", returnGeometry: "true", outSR: "4326", geometryPrecision: "7", resultOffset: String(offset), resultRecordCount: String(pageSize), orderByFields: "OBJECTID ASC", f: "geojson" });
      const page = await requestJson(`${serviceUrl}/query?${query}`);
      for (const feature of page.features || []) { const line = `${JSON.stringify(feature)}\n`; fs.writeSync(handle, line); hash.update(line); emittedFeatureCount += 1; }
      console.log(`Austin permits captured: ${emittedFeatureCount.toLocaleString()} / ${sourceFeatureCount.toLocaleString()}`);
    }
  } finally { fs.closeSync(handle); }
  if (emittedFeatureCount !== sourceFeatureCount) throw new Error(`Permit capture count mismatch: ${emittedFeatureCount} != ${sourceFeatureCount}`);
  fs.renameSync(temporary, rawFile);
  const manifest = { schemaVersion: "wr-official-arcgis-capture-v1", generatedAt: new Date().toISOString(), sourceCountyId: countyId, sourceDatasetId: "city-of-austin-issued-building-permits-mapserver-0", sourceUrl: serviceUrl, sourceDescription: metadata.description || "", sourceFeatureCount, emittedFeatureCount, objectIdField: "OBJECTID", outputSpatialReference: 4326, file: path.relative(root, rawFile).replace(/\\/g, "/"), bytes: fs.statSync(rawFile).size, sha256: hash.digest("hex") };
  writeJson(path.join(rawRoot, "source-manifest.json"), manifest);
  return manifest;
}

function loadParcels() {
  const manifest = readJson(path.join(parcelRoot, "manifest.json")); const parcels = []; const byAddress = new Map();
  for (const chunk of manifest.chunks || []) {
    const payload = readJson(path.join(parcelRoot, chunk.file));
    for (const parcel of payload.parcels || []) {
      const record = { countyParcelId: clean(parcel.countyParcelId), accountNum: clean(parcel.accountNum || parcel.accountNumber), gisParcelId: clean(parcel.gisParcelId), address: clean(parcel.address || parcel.propertyAddress), propertyName: clean(parcel.propertyName), chunkId: clean(chunk.id || payload.chunkId), center: parcel.liveGeometry?.center };
      if (!record.accountNum) continue; parcels.push(record);
      const key = normalizeAddress(record.address); if (!key) continue; if (!byAddress.has(key)) byAddress.set(key, []); byAddress.get(key).push(record);
    }
  }
  return { manifest, parcels, byAddress };
}

function permitRecord(feature) {
  const a = feature.properties || {}; const point = feature.geometry?.type === "Point" ? feature.geometry.coordinates : [];
  const longitude = Number(point?.[0]); const latitude = Number(point?.[1]);
  return { schemaVersion: "wr-travis-permit-record-v1", sourceCountyId: countyId, sourceDataset: "city-of-austin-issued-building-permits-mapserver-0", permitRecordId: `austin-permit:${a.OBJECTID}`, permitNumber: clean(a.PERMIT_NUMBER), permitType: clean(a.PERMIT_TYPE), permitSubtype: clean(a.SUB_TYPE || a.WORK_TYPE), permitStatus: clean(a.STATUS), address: clean(a.PERMIT_LOCATION), description: clean(a.WORK_DESCRIPTION), issueDate: dateIso(a.ISSUE_DATE), finalDate: dateIso(a.FINAL_DATE), expiryDate: dateIso(a.EXPIRY_DATE), certificateOfOccupancy: clean(a.CERTIFICATE_OF_OCCUPANCY), valuation: Number(a.TOTAL_JOB_VALUATION || a.BUILDING_VALUATION || 0), numberOfUnits: Number(a.NUMBER_OF_UNITS || 0), newSquareFeet: Number(a.TOTAL_NEW_ADD_FOOTAGE || 0), sourceUrl: clean(a.LINK) || serviceUrl, longitude: Number.isFinite(longitude) ? longitude : null, latitude: Number.isFinite(latitude) ? latitude : null };
}

function distanceSquared(parcel, record) {
  if (!Array.isArray(parcel.center) || !Number.isFinite(record.longitude) || !Number.isFinite(record.latitude)) return Infinity;
  return (parcel.center[0] - record.longitude) ** 2 + (parcel.center[1] - record.latitude) ** 2;
}

function joinPermit(record, byAddress) {
  let candidates = byAddress.get(normalizeAddress(record.address)) || [];
  if (candidates.length === 1) return { parcel: candidates[0], method: "exactNormalizedAddress" };
  if (candidates.length > 1 && Number.isFinite(record.longitude) && Number.isFinite(record.latitude)) {
    const ordered = candidates.map((parcel) => ({ parcel, distance: distanceSquared(parcel, record) })).sort((a, b) => a.distance - b.distance);
    if (ordered[0].distance < 0.000004 && (!ordered[1] || ordered[0].distance * 1.2 < ordered[1].distance)) return { parcel: ordered[0].parcel, method: "addressPointDisambiguation" };
    return { parcel: null, method: "ambiguousAddress" };
  }
  return { parcel: null, method: candidates.length ? "ambiguousAddress" : "unmatched" };
}

function developmentCategory(record) {
  const text = `${record.permitType} ${record.permitSubtype} ${record.description}`.toLowerCase();
  if (/demolit|wreck/.test(text)) return "demolition";
  if (record.certificateOfOccupancy || /certificate of occupancy|\bco\b/.test(text)) return "occupancy";
  if (/new construction|new building|new residence|new commercial/.test(text)) return "new-construction";
  if (/addition|remodel|renovation|alteration/.test(text)) return "alteration";
  return "permit-activity";
}

function buildOutputs(source, parcelData) {
  const permitDir = path.join(outputRoot, "permits"); cleanDir(permitDir); fs.mkdirSync(path.join(permitDir, "chunks"), { recursive: true });
  const features = fs.readFileSync(rawFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const records = []; const joinMethodCounts = { exactNormalizedAddress: 0, addressPointDisambiguation: 0, ambiguousAddress: 0, unmatched: 0 };
  const developmentGroups = new Map();
  for (const feature of features) {
    const record = permitRecord(feature); const join = joinPermit(record, parcelData.byAddress); record.joinMethod = join.method; joinMethodCounts[join.method] += 1;
    if (join.parcel) {
      Object.assign(record, { countyParcelId: join.parcel.countyParcelId, parcelAccountNum: join.parcel.accountNum, parcelGisId: join.parcel.gisParcelId, parcelChunkId: join.parcel.chunkId });
      if (!developmentGroups.has(join.parcel.accountNum)) developmentGroups.set(join.parcel.accountNum, { parcel: join.parcel, permits: [] });
      developmentGroups.get(join.parcel.accountNum).permits.push(record);
    }
    record.searchText = [record.permitNumber, record.permitType, record.permitSubtype, record.permitStatus, record.address, record.parcelAccountNum, record.parcelGisId, record.certificateOfOccupancy].filter(Boolean).join(" ").toLowerCase();
    records.push(record);
  }
  const chunkGroups = new Map();
  for (const record of records) {
    const located = Number.isFinite(record.longitude) && Number.isFinite(record.latitude) && record.longitude >= mapBounds.minLng && record.longitude <= mapBounds.maxLng && record.latitude >= mapBounds.minLat && record.latitude <= mapBounds.maxLat;
    const id = located ? `${Math.floor((record.longitude - mapBounds.minLng) / 0.025)}-${Math.floor((record.latitude - mapBounds.minLat) / 0.025)}` : "unlocated";
    record.chunkId = id; if (!chunkGroups.has(id)) chunkGroups.set(id, []); chunkGroups.get(id).push(record);
  }
  const chunks = [];
  for (const [id, values] of chunkGroups) {
    const located = values.filter((record) => Number.isFinite(record.longitude) && Number.isFinite(record.latitude));
    const chunkBounds = id !== "unlocated" && located.length ? { minLng: Math.min(...located.map((record) => record.longitude)), minLat: Math.min(...located.map((record) => record.latitude)), maxLng: Math.max(...located.map((record) => record.longitude)), maxLat: Math.max(...located.map((record) => record.latitude)) } : null;
    const file = `chunks/${id}.json`; writeJson(path.join(permitDir, file), { permits: values }); chunks.push({ id, file, count: values.length, bounds: chunkBounds });
  }
  const compact = records.map((record) => ({ permitRecordId: record.permitRecordId, sourceDataset: record.sourceDataset, permitNumber: record.permitNumber, permitType: record.permitType, permitSubtype: record.permitSubtype, permitStatus: record.permitStatus, address: record.address, issueDate: record.issueDate, finalDate: record.finalDate, certificateOfOccupancy: record.certificateOfOccupancy, parcelAccountNum: record.parcelAccountNum || "", parcelGisId: record.parcelGisId || "", countyParcelId: record.countyParcelId || "", joinMethod: record.joinMethod, longitude: record.longitude, latitude: record.latitude, chunkId: record.chunkId, searchText: record.searchText }));
  writeJson(path.join(permitDir, "search-index.json"), { permits: compact });
  const joinedPermitCount = records.filter((record) => record.parcelAccountNum).length;
  const permitManifest = { schemaVersion: "wr-travis-permit-manifest-v1", generatedAt: source.generatedAt, sourceCountyId: countyId, status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdiction: "City of Austin full/limited-purpose permit service coverage", permitCount: records.length, locatedPermitCount: records.filter((record) => Number.isFinite(record.longitude) && Number.isFinite(record.latitude)).length, joinedPermitCount, unmatchedPermitCount: records.length - joinedPermitCount, joinMethodCounts, chunkCount: chunks.length, chunks, searchIndex: "search-index.json", searchIndexCount: compact.length, sources: [source], joinPolicy: "Exact normalized address; duplicate addresses require a uniquely nearest permit point. Ambiguous and unmatched records remain unassigned." };
  writeJson(path.join(permitDir, "manifest.json"), permitManifest);

  const developments = [];
  for (const { parcel, permits } of developmentGroups.values()) {
    const categories = [...new Set(permits.map(developmentCategory))]; const dates = permits.map((record) => record.issueDate).filter(Boolean).sort();
    const evidence = permits.slice().sort((a, b) => clean(b.issueDate).localeCompare(clean(a.issueDate)));
    developments.push({ parcelId: parcel.accountNum, parcelGisId: parcel.gisParcelId, parcelAddress: parcel.address, parcelPropertyName: parcel.propertyName, signalCount: permits.length, score: Math.min(100, 20 + Math.min(35, permits.length * 2) + (categories.includes("new-construction") ? 25 : 0) + (categories.includes("demolition") ? 20 : 0) + (categories.includes("occupancy") ? 15 : 0)), latestActivityDate: dates.at(-1) || "", signalTypes: categories, stages: categories.map((category) => category === "occupancy" ? "occupancy-evidence" : category === "new-construction" ? "permitted-construction" : category === "demolition" ? "demolition-evidence" : "permit-evidence"), evidenceRecordIds: evidence.slice(0, 25).map((record) => record.permitRecordId), classificationPolicy: "Evidence only. Issued permits do not prove construction or completion; certificate-of-occupancy fields are preserved separately." });
  }
  const developmentDir = path.join(outputRoot, "developments"); cleanDir(developmentDir);
  const developmentIndex = { schemaVersion: "wr-travis-development-index-v1", generatedAt: source.generatedAt, sourceCountyId: countyId, source: `/data/counties/${countyId}/permits/manifest.json`, status: "parcel-index-ready-partial-municipal-coverage", coverageJurisdiction: "City of Austin permit service coverage", parcelCount: developments.length, records: developments };
  writeJson(path.join(developmentDir, "parcel-development-index.json"), developmentIndex);
  writeJson(path.join(developmentDir, "manifest.json"), { ...developmentIndex, records: undefined, parcelIndex: "parcel-development-index.json" });
  return { permitManifest, developmentIndex };
}

async function main() {
  const source = await capture();
  console.log("Loading Travis parcel addresses..."); const parcelData = loadParcels();
  console.log("Joining Austin permits and deriving evidence-bound development signals..."); const outputs = buildOutputs(source, parcelData);
  const report = { schemaVersion: "wr-travis-permit-intelligence-report-v1", generatedAt: source.generatedAt, sourceCountyId: countyId, parcelCount: parcelData.parcels.length, permits: { sourceRecordCount: outputs.permitManifest.permitCount, joinedRecordCount: outputs.permitManifest.joinedPermitCount, unmatchedRecordCount: outputs.permitManifest.unmatchedPermitCount, joinMethodCounts: outputs.permitManifest.joinMethodCounts }, developmentSignals: { parcelCount: outputs.developmentIndex.parcelCount }, coverage: "City of Austin permit service jurisdiction; other Travis County municipalities are not represented." };
  writeJson(path.join(reportRoot, "austin-permit-intelligence-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
