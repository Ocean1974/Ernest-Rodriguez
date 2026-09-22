const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ringBounds, pointInPolygon, makeGrid, clean } = require("./tarrant-intelligence-utils.cjs");

const root = path.resolve(__dirname, "..");
const countyId = "collin-county-tx";
const bounds = { minLng: -96.95, minLat: 32.95, maxLng: -96.3, maxLat: 33.45 };
function pathArgument(name, fallback) { const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1); return path.resolve(root, raw || fallback); }
const parcelRoot = pathArgument("--parcel-root", path.join("public/data/counties", countyId, "parcels"));
const outputRoot = pathArgument("--output-root", path.join("public/data/counties", countyId, "zoning"));
const rawRoot = path.join(root, "data/raw", countyId, "development-controls");
const reportRoot = path.join(root, "output", countyId);
const adapterFile = path.join(root, "data/county-adapters", countyId, "adapter.json");
const sources = [
  { id: "collin-cities", kind: "city-limits", title: "Collin County GIS Cities", url: "https://services1.arcgis.com/fdWXd5OobWR1E3er/arcgis/rest/services/Cities/FeatureServer/0", fields: "OBJECTID,CITY_NAME,COUNTY,STATE,EFFECTIVE_DATE,DATE_MODIFIED" },
  { id: "collin-etjs", kind: "etj", title: "Collin County GIS ETJs", url: "https://services1.arcgis.com/fdWXd5OobWR1E3er/arcgis/rest/services/ETJs/FeatureServer/0", fields: "OBJECTID,CITY,GlobalID" },
];

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) { ensureDir(dir); for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); }
function writeJson(file, value, pretty = false) { ensureDir(path.dirname(file)); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`); fs.renameSync(temp, file); }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
async function fetchJson(url) { const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { accept: "application/json" } }); const text = await response.text(); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); const payload = JSON.parse(text); if (payload.error) throw new Error(`${url}: ${payload.error.message}`); return { payload, text }; }

async function captureSource(source) {
  const metadata = await fetchJson(`${source.url}?f=json`);
  const query = new URLSearchParams({ where: "1=1", outFields: source.fields, returnGeometry: "true", outSR: "4326", geometryPrecision: "7", f: "json" });
  const response = await fetchJson(`${source.url}/query?${query}`); const features = response.payload.features || [];
  const snapshot = { sourceId: source.id, sourceKind: source.kind, title: source.title, sourceUrl: source.url, observedAt: new Date().toISOString(), featureCount: features.length, fields: source.fields.split(","), metadataSha256: hash(metadata.text), responseSha256: hash(response.text), ownerOrganization: "Collin County GIS", rightsStatus: "official-public-gis-derived-index" };
  writeJson(path.join(rawRoot, source.id, "snapshot.json"), snapshot, true); writeJson(path.join(rawRoot, source.id, "features.json"), response.payload);
  return { ...source, features, snapshot };
}

function polygonGrid(captures) {
  const grid = makeGrid(bounds, 180, 140); const polygons = [];
  for (const capture of captures) for (const feature of capture.features) {
    const rings = feature.geometry?.rings || []; const polygonBounds = ringBounds(rings); if (!polygonBounds) continue;
    const polygon = { capture, feature, rings, bounds: polygonBounds }; polygons.push(polygon); grid.add(polygon, polygonBounds);
  }
  return { grid, polygons };
}

function loadManifest() { return JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8")); }
function matchName(item) { const a = item.feature.attributes || {}; return clean(a.CITY_NAME || a.CITY); }

async function main() {
  const captures = []; for (const source of sources) captures.push(await captureSource(source));
  const { grid, polygons } = polygonGrid(captures); const manifest = loadManifest(); clearDir(outputRoot); ensureDir(reportRoot);
  const fields = ["countyParcelId", "accountNum", "gisParcelId", "parcelChunkId", "controlContext", "jurisdictionName", "cityName", "etjName", "label", "sourceLayerIds", "sourceObjectIds"];
  const shards = new Map(); let scanned = 0; let cityCount = 0; let etjCount = 0; let unincorporatedCount = 0;
  for (const chunk of manifest.chunks || []) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      scanned += 1; const point = parcel.liveGeometry?.center; if (!Array.isArray(point) || !point.every(Number.isFinite)) continue;
      const hits = grid.at(point).filter((item) => pointInPolygon(point, item.rings));
      const cityHits = hits.filter((item) => item.capture.kind === "city-limits"); const etjHits = hits.filter((item) => item.capture.kind === "etj");
      const cityName = cityHits.map(matchName).find(Boolean) || ""; const etjName = etjHits.map(matchName).find(Boolean) || "";
      let controlContext = "unincorporated-county"; let jurisdictionName = "Collin County";
      if (cityName) { controlContext = "incorporated-city"; jurisdictionName = cityName; cityCount += 1; }
      else if (etjName) { controlContext = "extraterritorial-jurisdiction"; jurisdictionName = etjName; etjCount += 1; }
      else unincorporatedCount += 1;
      const record = { countyParcelId: clean(parcel.countyParcelId), accountNum: clean(parcel.accountNum || parcel.accountNumber), gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), controlContext, jurisdictionName, cityName, etjName, label: cityName ? `${cityName} city development-control jurisdiction` : etjName ? `${etjName} ETJ development-control context` : "Unincorporated Collin County development-control context", sourceLayerIds: hits.map((item) => item.capture.id), sourceObjectIds: hits.map((item) => item.feature.attributes?.OBJECTID).filter((value) => value !== undefined) };
      const key = hash(record.accountNum || record.countyParcelId).slice(0, 2); if (!shards.has(key)) shards.set(key, []); shards.get(key).push(fields.map((field) => record[field] ?? ""));
    }
  }
  if (scanned !== Number(manifest.featureCount || 0)) throw new Error(`Parcel scan mismatch ${scanned}/${manifest.featureCount}`);
  const shardDir = path.join(outputRoot, "parcel-index"); ensureDir(shardDir); const files = {}; const counts = {};
  for (const [key, records] of [...shards].sort(([a], [b]) => a.localeCompare(b))) { const relative = `parcel-index/${key}.json`; writeJson(path.join(outputRoot, relative), { schemaVersion: "wr-collin-development-control-shard-v1", fields, records }); files[key] = relative; counts[key] = records.length; }
  const generatedAt = new Date().toISOString(); const countsSummary = { parcelRecordsScanned: scanned, parcelIndexCount: scanned, parcelsInCityLimits: cityCount, parcelsInEtj: etjCount, parcelsInUnincorporatedCounty: unincorporatedCount, citySourceFeatures: captures[0].features.length, etjSourceFeatures: captures[1].features.length };
  const index = { schemaVersion: "wr-collin-development-control-index-v1", sourceCountyId: countyId, generatedAt, status: "ready-official-jurisdiction-control-context", joinMethod: "parcel liveGeometry centroid inside official Collin County GIS city and ETJ polygons; city takes precedence over ETJ", caveat: "This identifies the controlling jurisdiction context. It is not a municipal zoning-district designation and does not replace city zoning verification.", ...countsSummary, keyLength: 2, fields, files, counts };
  const publicManifest = { ...index, parcelServiceManifest: path.relative(root, path.join(parcelRoot, "manifest.json")).replace(/\\/g, "/"), sources: captures.map((capture) => capture.snapshot), parcelIndex: "parcel-zoning-index.json", defaultVisible: false, renderDirectlyInBrowser: false, maxFeaturesPerViewport: 750 };
  writeJson(path.join(outputRoot, "parcel-zoning-index.json"), index, true); writeJson(path.join(outputRoot, "manifest.json"), publicManifest, true); writeJson(path.join(reportRoot, "development-control-context-report.json"), publicManifest, true);
  fs.writeFileSync(path.join(reportRoot, "development-control-context-report.md"), `# Collin County development-control context\n\n- Official city polygons: **${captures[0].features.length}**\n- Official ETJ polygons: **${captures[1].features.length}**\n- Parcel records scanned/classified: **${scanned.toLocaleString()}**\n- Incorporated city parcels: **${cityCount.toLocaleString()}**\n- ETJ parcels: **${etjCount.toLocaleString()}**\n- Unincorporated parcels: **${unincorporatedCount.toLocaleString()}**\n\nThis is jurisdiction/control context, not a municipal zoning-district designation.\n`);

  const adapter = JSON.parse(fs.readFileSync(adapterFile, "utf8")); const layer = adapter.optionalLayers.find((item) => item.id === "zoning-intelligence");
  Object.assign(layer, { source: "Official Collin County GIS Cities and ETJs FeatureServers", status: "ready-official-jurisdiction-control-context", joinBehavior: "parcel liveGeometry centroid inside official city/ETJ polygons; city precedence; no invented municipal zoning district", reportPath: `output/${countyId}/development-control-context-report.md` });
  adapter.sourceFiles.zoningRaw = sources.map((source) => source.url); adapter.joinKeys.zoning = "parcel liveGeometry centroid -> official Collin County GIS Cities/ETJs polygon -> county parcel/account ID; jurisdiction context only";
  Object.assign(adapter.verifiedCounts, countsSummary); fs.writeFileSync(adapterFile, `${JSON.stringify(adapter, null, 2)}\n`);
  console.log(JSON.stringify(countsSummary, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
