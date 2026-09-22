const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const { clean, developmentCategory } = require("./tarrant-intelligence-utils.cjs");

const root = path.resolve(__dirname, "..");
const countyId = "denton-county-tx";
const sourceUrl = "https://data.cityofdenton.com/dataset/ee4933a5-3348-4894-a3b1-584d44b9bafa/resource/71a5f6cc-7cb9-4ecb-9482-70b2c1f3ab48/download/2026_all_permits_issued.csv";
const datasetId = "ee4933a5-3348-4894-a3b1-584d44b9bafa";
const resourceId = "71a5f6cc-7cb9-4ecb-9482-70b2c1f3ab48";
const sourceFile = path.join(root, "data/raw/denton-county-tx/permits/2026_all_permits_issued.csv");
const parcelRoot = path.join(root, "public/data/counties/denton-county-tx/parcels");
const publicRoot = path.join(root, "public/data/counties/denton-county-tx");
const reportRoot = path.join(root, "output/denton-county-tx");
const adapterFile = path.join(root, "data/county-adapters/denton-county-tx/adapter.json");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) { ensureDir(dir); for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); }
function writeJson(file, value, pretty = false) { ensureDir(path.dirname(file)); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`); fs.renameSync(temp, file); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalizeApn(value) { return clean(value).replace(/\.0$/, "").replace(/[^A-Za-z0-9]/g, "").replace(/^0+(?=\d)/, ""); }
function number(value) { const result = Number(String(value ?? "").replace(/[$,]/g, "")); return Number.isFinite(result) ? result : 0; }
function shardKey(value) { return sha256(value).slice(0, 2); }

function loadParcelAccounts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(parcelRoot, "manifest.json"), "utf8")); const accounts = new Map(); let scanned = 0;
  for (const chunk of manifest.chunks || []) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      scanned += 1; const accountNum = clean(parcel.accountNum || parcel.accountNumber); const key = normalizeApn(accountNum); if (!key) continue;
      if (!accounts.has(key)) accounts.set(key, []); accounts.get(key).push({ accountNum, countyParcelId: clean(parcel.countyParcelId), gisParcelId: clean(parcel.gisParcelId), parcelChunkId: clean(chunk.id || payload.chunkId), address: clean(parcel.address || parcel.propertyAddress) });
    }
  }
  if (scanned !== Number(manifest.featureCount || 0)) throw new Error(`Parcel count mismatch ${scanned}/${manifest.featureCount}`);
  return { manifest, accounts, scanned };
}

function main() {
  if (!fs.existsSync(sourceFile)) throw new Error(`Missing official Denton permit CSV: ${sourceFile}`);
  const csv = fs.readFileSync(sourceFile); const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true });
  const { manifest: parcelManifest, accounts, scanned } = loadParcelAccounts(); const joined = []; const unmatched = []; const ambiguous = [];
  let minDate = ""; let maxDate = "";
  for (const row of rows) {
    const date = clean(row.ISSUED_DATE); if (date && (!minDate || date < minDate)) minDate = date; if (date && (!maxDate || date > maxDate)) maxDate = date;
    const apn = normalizeApn(row.SITE_APN); const candidates = accounts.get(apn) || [];
    const permit = { schemaVersion: "wr-denton-permit-record-v1", sourceCountyId: countyId, sourceDatasetId: datasetId, sourceResourceId: resourceId, coverageJurisdiction: "City of Denton", permitNumber: clean(row.PERMIT_NO), issueDate: date, permitCategory: clean(row.PERMIT_CATEGORY), permitSubtype: clean(row.PERMIT_SUBTYPE), status: clean(row.STATUS), address: clean(row.SITE_ADDR), sourceApn: clean(row.SITE_APN), permitName: clean(row.PERMIT_NAME), jobValue: number(row.JOB_VALUE), feesCharged: number(row.FEES_CHARGED), feesPaid: number(row.FEES_PAID) };
    if (candidates.length === 1) joined.push({ ...permit, ...candidates[0], joinMethod: "exact-normalized-SITE_APN-to-Denton-CAD-accountNum" });
    else if (candidates.length > 1) ambiguous.push({ ...permit, candidateParcelIds: candidates.map((item) => item.countyParcelId) });
    else unmatched.push(permit);
  }

  const permitRoot = path.join(publicRoot, "permits"); clearDir(permitRoot); const permitGroups = new Map();
  for (const record of joined) { const key = shardKey(record.accountNum); if (!permitGroups.has(key)) permitGroups.set(key, []); permitGroups.get(key).push(record); }
  const chunks = []; for (const [key, records] of [...permitGroups].sort(([a], [b]) => a.localeCompare(b))) { const file = `chunks/${key}.json`; writeJson(path.join(permitRoot, file), { schemaVersion: "wr-denton-permit-chunk-v1", sourceCountyId: countyId, chunkId: key, records }); chunks.push({ id: key, file, count: records.length }); }
  const generatedAt = new Date().toISOString(); const permitManifest = { schemaVersion: "wr-denton-permit-manifest-v1", generatedAt, sourceCountyId: countyId, status: "parcel-index-ready-current-partial-municipal-coverage", coverageJurisdiction: "City of Denton", permitCount: rows.length, joinedPermitCount: joined.length, unmatchedPermitCount: unmatched.length, ambiguousPermitCount: ambiguous.length, parcelsWithPermits: new Set(joined.map((row) => row.countyParcelId)).size, sourceDateMin: minDate, sourceDateMax: maxDate, joinMethod: "exact normalized SITE_APN to official Denton CAD accountNum; duplicate APNs quarantined", chunkCount: chunks.length, chunks, source: { title: "City of Denton Building Safety Yearly Permit Report (updated nightly)", url: sourceUrl, datasetId, resourceId, localFile: path.relative(root, sourceFile).replace(/\\/g, "/"), bytes: csv.length, sha256: sha256(csv) }, caveat: "Municipal coverage only; permit issuance or final status is evidence from the source record, not proof of completed construction or countywide coverage." };
  writeJson(path.join(permitRoot, "manifest.json"), permitManifest, true); writeJson(path.join(reportRoot, "denton-permits-unmatched.json"), unmatched); writeJson(path.join(reportRoot, "denton-permits-ambiguous.json"), ambiguous);

  const developmentRoot = path.join(publicRoot, "developments"); clearDir(developmentRoot); const byParcel = new Map();
  for (const permit of joined) {
    if (!byParcel.has(permit.countyParcelId)) byParcel.set(permit.countyParcelId, { countyParcelId: permit.countyParcelId, accountNum: permit.accountNum, gisParcelId: permit.gisParcelId, parcelChunkId: permit.parcelChunkId, address: permit.address, permitCount: 0, latestPermitDate: "", totalJobValue: 0, signalTypes: new Set(), permitNumbers: [] });
    const item = byParcel.get(permit.countyParcelId); item.permitCount += 1; item.totalJobValue += permit.jobValue; if (permit.issueDate > item.latestPermitDate) item.latestPermitDate = permit.issueDate; item.signalTypes.add(developmentCategory({ permitType: permit.permitCategory, permitSubtype: permit.permitSubtype, description: permit.permitName })); item.permitNumbers.push(permit.permitNumber);
  }
  const developmentRecords = [...byParcel.values()].map((item) => ({ ...item, signalTypes: [...item.signalTypes].sort(), permitNumbers: item.permitNumbers.sort() }));
  const developmentIndex = { schemaVersion: "wr-denton-development-index-v1", generatedAt, sourceCountyId: countyId, status: "parcel-index-ready-current-partial-municipal-coverage", coverageJurisdiction: "City of Denton", parcelCount: developmentRecords.length, sourcePermitCount: rows.length, joinedPermitCount: joined.length, records: developmentRecords, caveat: "Derived from issued/finaled/closed permit records exactly joined by APN; this is an activity signal, not proof of construction completion." };
  writeJson(path.join(developmentRoot, "parcel-development-index.json"), developmentIndex, true);
  const report = { schemaVersion: "wr-denton-permit-intelligence-report-v1", generatedAt, sourceCountyId: countyId, parcelRecordsScanned: scanned, sourceParcelRecords: parcelManifest.featureCount, permitManifest, developmentParcelCount: developmentRecords.length };
  writeJson(path.join(reportRoot, "denton-permit-intelligence-report.json"), report, true);
  fs.writeFileSync(path.join(reportRoot, "denton-permit-intelligence-report.md"), `# Denton permit and development intelligence\n\n- Official 2026 permit rows: **${rows.length.toLocaleString()}**\n- Exact APN joins: **${joined.length.toLocaleString()}**\n- Unmatched: **${unmatched.length.toLocaleString()}**\n- Ambiguous/quarantined: **${ambiguous.length.toLocaleString()}**\n- Parcels with permit/development signals: **${developmentRecords.length.toLocaleString()}**\n- Source date range: **${minDate} through ${maxDate}**\n- Parcel records scanned: **${scanned.toLocaleString()}**\n\nCoverage is limited to the City of Denton and does not represent all Denton County jurisdictions.\n`);

  const adapter = JSON.parse(fs.readFileSync(adapterFile, "utf8")); const permitLayer = adapter.optionalLayers.find((item) => item.id === "permits"); const developmentLayer = adapter.optionalLayers.find((item) => item.id === "development-signals");
  Object.assign(permitLayer, { source: "City of Denton Building Safety Yearly Permit Report (updated nightly), 2026 CSV", status: "parcel-index-ready-current-partial-municipal-coverage", joinBehavior: "exact normalized SITE_APN to Denton CAD accountNum; duplicates and unmatched rows quarantined", reportPath: "output/denton-county-tx/denton-permit-intelligence-report.md" });
  Object.assign(developmentLayer, { source: "City of Denton 2026 permit activity joined by SITE_APN", status: "parcel-index-ready-current-partial-municipal-coverage", joinBehavior: "joined permit evidence aggregated by countyParcelId; municipal coverage only; no construction-completion claim" });
  adapter.sourceFiles.permitsRaw = sourceUrl; adapter.sourceFiles.permitsProcessed = "public/data/counties/denton-county-tx/permits/manifest.json"; adapter.sourceFiles.developmentRaw = sourceUrl;
  adapter.joinKeys.permits = "City of Denton SITE_APN -> normalized Denton CAD accountNum; unique exact matches only"; adapter.joinKeys.developmentSignals = "joined permit records -> countyParcelId aggregation";
  Object.assign(adapter.verifiedCounts, { sourcePermitRecords: rows.length, permitRowsJoined: joined.length, permitRowsUnmatched: unmatched.length, permitRowsAmbiguous: ambiguous.length, parcelsWithDevelopmentSignals: developmentRecords.length });
  fs.writeFileSync(adapterFile, `${JSON.stringify(adapter, null, 2)}\n`); console.log(JSON.stringify({ sourcePermitRecords: rows.length, permitRowsJoined: joined.length, permitRowsUnmatched: unmatched.length, permitRowsAmbiguous: ambiguous.length, parcelsWithDevelopmentSignals: developmentRecords.length, minDate, maxDate }, null, 2));
}

try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
