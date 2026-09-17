const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const root = path.join(__dirname, "..");
const sourceDir = path.join(root, "data/raw/travis-county-tx/TCAD_2026_SUPP_333");
const appraisalZip = path.join(sourceDir, "AppraisalExport.zip");
const layoutZip = path.join(sourceDir, "ExportLayouts.zip");
const parcelRoot = path.join(root, "public/data/counties/travis-county-tx/parcels");
const serviceManifestPath = path.join(parcelRoot, "manifest.json");
const sidecarRoot = path.join(parcelRoot, "intelligence/tcad-2026-supp-333");
const sidecarChunkRoot = path.join(sidecarRoot, "chunks");
const outputRoot = path.join(root, "output/travis-county-tx");
const FIELDS = [
  "countyParcelId", "ownerName", "ownerMailingAddress", "ownerMailingAddress2", "ownerCity", "ownerState", "ownerZip",
  "propertyAddress", "address", "city", "propertyZip", "legalDescription", "landAreaSize", "landAreaUnit", "landValue",
  "improvementValue", "totalValue", "appraisedValue", "assessedValue", "yearBuilt", "buildingClass", "grossBuildingArea",
  "tcadCertified",
];

function compact(value) { return String(value ?? "").trim(); }
function normalizePropId(value) {
  const text = compact(value);
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : text;
}
function slice(line, start, end) { return compact(line.slice(start - 1, end)); }
function integer(value) { const parsed = Number.parseInt(compact(value), 10); return Number.isFinite(parsed) ? parsed : 0; }
function numeric(value) { const text = compact(value); return text && Number.isFinite(Number(text)) ? String(Number(text)) : ""; }
function sumNumeric(...values) {
  const numbers = values.filter((value) => compact(value) !== "").map(Number).filter(Number.isFinite);
  return numbers.length ? String(numbers.reduce((sum, value) => sum + value, 0)) : "";
}
function writeJson(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}
async function streamZipEntry(zip, entry, onLine) {
  const child = spawn("tar", ["-xOf", zip, entry], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let count = 0;
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) { count += 1; onLine(line, count); }
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  if (exitCode !== 0) throw new Error(`Unable to stream ${entry}: ${stderr.trim()}`);
  return count;
}

function propertyRecord(line) {
  const confidential = slice(line, 990, 990).toUpperCase() === "T";
  const suppressAddress = slice(line, 991, 991).toUpperCase() === "T";
  const ownerAddressAllowed = !confidential && !suppressAddress;
  const ownerZip = `${slice(line, 979, 983)}${slice(line, 984, 987)}`;
  const situs = [slice(line, 4460, 4474), slice(line, 4475, 4479), slice(line, 1040, 1049), slice(line, 1050, 1099), slice(line, 1100, 1109)].filter(Boolean).join(" ");
  const legalDescription = [slice(line, 1150, 1404), slice(line, 1405, 1659)].filter(Boolean).join(" ");
  const landValue = sumNumeric(slice(line, 1796, 1810), slice(line, 1811, 1825));
  const improvementValue = sumNumeric(slice(line, 1826, 1840), slice(line, 1841, 1855));
  return {
    propId: normalizePropId(slice(line, 1, 12)),
    propertyType: slice(line, 13, 17),
    propValYear: integer(slice(line, 18, 22)),
    supNum: integer(slice(line, 23, 34)),
    supAction: slice(line, 35, 36),
    geoId: slice(line, 547, 596),
    ownerId: slice(line, 597, 608),
    ownerName: confidential ? "" : slice(line, 609, 678),
    ownerMailingAddress: ownerAddressAllowed ? slice(line, 694, 753) : "",
    ownerMailingAddress2: ownerAddressAllowed ? [slice(line, 754, 813), slice(line, 814, 873)].filter(Boolean).join(" ") : "",
    ownerCity: ownerAddressAllowed ? slice(line, 874, 923) : "",
    ownerState: ownerAddressAllowed ? slice(line, 924, 973) : "",
    ownerZip: ownerAddressAllowed ? ownerZip : "",
    ownerAddressDeliverable: slice(line, 1012, 1012),
    confidential,
    suppressAddress,
    situs,
    situsCity: slice(line, 1110, 1139),
    situsZip: slice(line, 1140, 1149),
    legalDescription,
    subdivisionCode: slice(line, 1676, 1685),
    landValue,
    improvementValue,
    marketValue: numeric(slice(line, 4214, 4227)),
    appraisedValue: numeric(slice(line, 1916, 1930)),
    assessedValue: numeric(slice(line, 1946, 1960)),
    landAcres: numeric(slice(line, 2772, 2791)),
    deedBook: slice(line, 1994, 2013),
    deedPage: slice(line, 2014, 2033),
    deedDate: slice(line, 2034, 2058),
    deedNumber: slice(line, 5358, 5407),
    improvement: { detailCount: 0, buildingDetailCount: 0, yearBuilt: "", largestArea: "", classCode: "", description: "" },
  };
}

function isBuildingDetail(description) {
  const text = compact(description).toUpperCase();
  if (!text || /(PAVED|PARK|PATIO|PORCH|DECK|POOL|FENCE|CANOPY|CARPORT|SHED|SPORT|TENNIS|SIGN|SITE)/.test(text)) return false;
  return /(AREA|FLOOR|LIVING|BUILDING|DWELLING|OFFICE|WAREHOUSE|RETAIL|APARTMENT|ENCLOSED|FINISHED|GARAGE)/.test(text);
}

function enrichmentValues(countyParcelId, record) {
  const improvement = record.improvement;
  const attached = {
    snapshot: "TCAD 2026 supplemental appraisal roll 333",
    propId: record.propId,
    geoId: record.geoId,
    propValYear: record.propValYear,
    supplementNumber: record.supNum,
    supplementAction: record.supAction,
    propertyType: record.propertyType,
    ownerId: record.ownerId,
    confidentialOwner: record.confidential,
    ownerAddressSuppressed: record.suppressAddress,
    ownerAddressDeliverable: record.ownerAddressDeliverable,
    subdivisionCode: record.subdivisionCode,
    deedNumber: record.deedNumber,
    deedBook: record.deedBook,
    deedPage: record.deedPage,
    deedDate: record.deedDate,
    improvementDetailCount: improvement.detailCount,
    buildingDetailCount: improvement.buildingDetailCount,
    buildingDetailDescription: improvement.description,
  };
  return [countyParcelId, record.ownerName, record.ownerMailingAddress, record.ownerMailingAddress2, record.ownerCity, record.ownerState,
    record.ownerZip, record.situs, record.situs, record.situsCity, record.situsZip, record.legalDescription, record.landAcres,
    record.landAcres ? "acres" : "", record.landValue, record.improvementValue, record.marketValue, record.appraisedValue,
    record.assessedValue, improvement.yearBuilt, improvement.classCode, improvement.largestArea, attached];
}

async function main() {
  for (const file of [appraisalZip, layoutZip, serviceManifestPath]) if (!fs.existsSync(file)) throw new Error(`Missing required input: ${file}`);
  const generatedAt = new Date().toISOString();
  const serviceManifest = JSON.parse(fs.readFileSync(serviceManifestPath, "utf8"));
  const workDbPath = path.join(outputRoot, ".tcad-certified-intelligence-work.sqlite");
  if (fs.existsSync(workDbPath)) fs.rmSync(workDbPath, { force: true });
  const db = new DatabaseSync(workDbPath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE targets(prop_id TEXT NOT NULL,county_parcel_id TEXT NOT NULL,chunk_id TEXT NOT NULL,PRIMARY KEY(prop_id,county_parcel_id)); CREATE INDEX targets_chunk_idx ON targets(chunk_id); CREATE TABLE properties(prop_id TEXT PRIMARY KEY,sup_num INTEGER NOT NULL,prop_val_year INTEGER NOT NULL,sup_action TEXT NOT NULL,record_json TEXT NOT NULL); CREATE TABLE improvements(prop_id TEXT PRIMARY KEY,detail_count INTEGER NOT NULL,building_count INTEGER NOT NULL,year_built INTEGER,largest_area REAL NOT NULL,class_code TEXT,description TEXT);");
  const targetPropIds = new Set();
  const insertTarget = db.prepare("INSERT OR IGNORE INTO targets VALUES(?,?,?)");
  let serviceMissingPropId = 0;
  db.exec("BEGIN");
  for (const [position, chunk] of serviceManifest.chunks.entries()) {
    const payload = JSON.parse(fs.readFileSync(path.join(parcelRoot, chunk.file), "utf8"));
    for (const parcel of payload.parcels || []) {
      const propId = normalizePropId(parcel.accountNum || parcel.sourceParcelId);
      if (!propId) { serviceMissingPropId += 1; continue; }
      targetPropIds.add(propId);
      insertTarget.run(propId, compact(parcel.countyParcelId), chunk.id);
    }
    if ((position + 1) % 100 === 0) db.exec("COMMIT; BEGIN");
    if ((position + 1) % 200 === 0) console.log(`Indexed ${(position + 1).toLocaleString()} viewport chunks...`);
  }
  db.exec("COMMIT");

  const sourcePropIds = new Set();
  const upsertProperty = db.prepare("INSERT INTO properties VALUES(?,?,?,?,?) ON CONFLICT(prop_id) DO UPDATE SET sup_num=excluded.sup_num,prop_val_year=excluded.prop_val_year,sup_action=excluded.sup_action,record_json=excluded.record_json WHERE excluded.sup_num>properties.sup_num OR (excluded.sup_num=properties.sup_num AND excluded.prop_val_year>properties.prop_val_year)");
  let propertyShortRows = 0, matchedSourceRows = 0, confidentialRows = 0, suppressedAddressRows = 0, deleteRows = 0;
  db.exec("BEGIN");
  const propertyRows = await streamZipEntry(appraisalZip, "PROP.TXT", (line, row) => {
    if (line.length < 9922) { propertyShortRows += 1; return; }
    const propId = normalizePropId(slice(line, 1, 12));
    if (!propId) return;
    sourcePropIds.add(propId);
    if (!targetPropIds.has(propId)) return;
    matchedSourceRows += 1;
    const record = propertyRecord(line);
    if (record.confidential) confidentialRows += 1;
    if (record.suppressAddress) suppressedAddressRows += 1;
    if (record.supAction.toUpperCase() === "D") deleteRows += 1;
    upsertProperty.run(propId, record.supNum, record.propValYear, record.supAction, JSON.stringify(record));
    if (matchedSourceRows % 25000 === 0) db.exec("COMMIT; BEGIN");
    if (row % 100000 === 0) console.log(`Scanned ${row.toLocaleString()} TCAD property rows...`);
  });
  db.exec("COMMIT");
  const selectedPropIds = new Set();
  const selectPropertyIds = db.prepare("SELECT prop_id FROM properties");
  for (const row of selectPropertyIds.all()) selectedPropIds.add(row.prop_id);

  const detailDescriptions = new Map();
  const incrementDetail = db.prepare("INSERT INTO improvements VALUES(?,1,0,NULL,0,'','') ON CONFLICT(prop_id) DO UPDATE SET detail_count=improvements.detail_count+1");
  const incrementBuilding = db.prepare("INSERT INTO improvements VALUES(?,1,1,?,?,?,?) ON CONFLICT(prop_id) DO UPDATE SET detail_count=improvements.detail_count+1,building_count=improvements.building_count+1,year_built=CASE WHEN excluded.year_built IS NULL THEN improvements.year_built WHEN improvements.year_built IS NULL OR excluded.year_built<improvements.year_built THEN excluded.year_built ELSE improvements.year_built END,largest_area=CASE WHEN excluded.largest_area>improvements.largest_area THEN excluded.largest_area ELSE improvements.largest_area END,class_code=CASE WHEN excluded.largest_area>improvements.largest_area THEN excluded.class_code ELSE improvements.class_code END,description=CASE WHEN excluded.largest_area>improvements.largest_area THEN excluded.description ELSE improvements.description END");
  let matchedDetailRows = 0;
  db.exec("BEGIN");
  const improvementDetailRows = await streamZipEntry(appraisalZip, "IMP_DET.TXT", (line, row) => {
    if (line.length < 122) return;
    const propId = normalizePropId(slice(line, 1, 12));
    if (!selectedPropIds.has(propId)) return;
    matchedDetailRows += 1;
    const description = slice(line, 51, 75);
    detailDescriptions.set(description, (detailDescriptions.get(description) || 0) + 1);
    const area = Number(numeric(slice(line, 94, 108)) || 0);
    const year = integer(slice(line, 86, 89));
    if (isBuildingDetail(description)) incrementBuilding.run(propId, year >= 1700 && year <= new Date().getUTCFullYear() ? year : null, area, slice(line, 76, 85), description);
    else incrementDetail.run(propId);
    if (matchedDetailRows % 50000 === 0) db.exec("COMMIT; BEGIN");
    if (row % 500000 === 0) console.log(`Scanned ${row.toLocaleString()} TCAD improvement-detail rows...`);
  });
  db.exec("COMMIT");

  if (fs.existsSync(sidecarRoot)) fs.rmSync(sidecarRoot, { recursive: true, force: true });
  fs.mkdirSync(sidecarChunkRoot, { recursive: true });
  const files = {}, counts = {};
  let enrichedParcels = 0;
  const joinedForChunk = db.prepare("SELECT t.county_parcel_id,p.record_json,i.detail_count,i.building_count,i.year_built,i.largest_area,i.class_code,i.description FROM targets t JOIN properties p ON p.prop_id=t.prop_id LEFT JOIN improvements i ON i.prop_id=t.prop_id WHERE t.chunk_id=? AND upper(trim(p.sup_action))<>'D' ORDER BY t.county_parcel_id");
  for (const [position, chunk] of serviceManifest.chunks.entries()) {
    const parcels = joinedForChunk.all(chunk.id).map((row) => {
      const record = JSON.parse(row.record_json);
      record.improvement = { detailCount: Number(row.detail_count || 0), buildingDetailCount: Number(row.building_count || 0), yearBuilt: row.year_built ? String(row.year_built) : "", largestArea: row.largest_area ? String(row.largest_area) : "", classCode: compact(row.class_code), description: compact(row.description) };
      return enrichmentValues(row.county_parcel_id, record);
    });
    if (!parcels.length) continue;
    const relative = `intelligence/tcad-2026-supp-333/chunks/${chunk.id}.json`;
    writeJson(path.join(sidecarChunkRoot, `${chunk.id}.json`), { fields: FIELDS, parcels });
    files[chunk.id] = relative; counts[chunk.id] = parcels.length; enrichedParcels += parcels.length;
    if ((position + 1) % 200 === 0) console.log(`Published ${(position + 1).toLocaleString()} TCAD intelligence chunks...`);
  }
  const countProperties = db.prepare("SELECT count(*) count FROM properties");
  const countMatched = db.prepare("SELECT count(DISTINCT t.prop_id) count FROM targets t JOIN properties p ON p.prop_id=t.prop_id WHERE upper(trim(p.sup_action))<>'D'");
  const countDeleted = db.prepare("SELECT count(*) count FROM targets t JOIN properties p ON p.prop_id=t.prop_id WHERE upper(trim(p.sup_action))='D'");
  const selectedMatchedPropIds = Number(countProperties.get().count);
  const matchedDistinctServicePropIds = Number(countMatched.get().count);
  const deletedLatestRecords = Number(countDeleted.get().count);
  const [appraisalSha256, layoutSha256] = await Promise.all([sha256(appraisalZip), sha256(layoutZip)]);
  const topDetailDescriptions = [...detailDescriptions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([description, count]) => ({ description, count }));
  const audit = {
    schemaVersion: "wr-tcad-certified-intelligence-audit-v1", generatedAt, countyId: "travis-county-tx",
    source: { archive: "data/raw/travis-county-tx/TCAD_2026_SUPP_333/AppraisalExport.zip", archiveSha256: appraisalSha256, layoutArchive: "data/raw/travis-county-tx/TCAD_2026_SUPP_333/ExportLayouts.zip", layoutArchiveSha256: layoutSha256, appraisalYear: 2026, supplementNumber: 333, sourcePage: "https://traviscad.org/publicinformation", propertyEntry: "PROP.TXT", improvementDetailEntry: "IMP_DET.TXT" },
    keyAudit: { propertyRows, distinctSourcePropIds: sourcePropIds.size, matchedSourceRows, selectedMatchedPropIds, propertyShortRows, deleteRows, joinKey: "normalized zero-padded prop_id -> parcel accountNum/PROP_ID", serviceDistinctPropIds: targetPropIds.size, serviceMissingPropId },
    privacyAudit: { confidentialMatchedRows: confidentialRows, suppressedAddressMatchedRows: suppressedAddressRows, policy: "Owner names are not exported from confidential rows; mailing fields are not exported when confidential or address-suppressed." },
    improvementAudit: { improvementDetailRows, matchedDetailRows, topDetailDescriptions, policy: "Only building-like detail descriptions contribute fallback year, class, and largest-area fields; non-building site improvements are excluded." },
    distribution: { existingServiceParcels: serviceManifest.featureCount, enrichedParcels, unmatchedServiceParcels: serviceManifest.featureCount - enrichedParcels, matchedDistinctServicePropIds, deletedLatestRecords, sidecarChunkCount: Object.keys(files).length },
    activation: { authorized: false, reason: "Monthly identity stability, optional intelligence layers, production tiles, and final activation review remain open." },
  };
  const intelligenceManifest = { schemaVersion: "wr-parcel-intelligence-sidecar-v1", generatedAt, sourceCountyId: "travis-county-tx", sourceSnapshot: audit.source, joinKey: "PROP_ID / normalized prop_id", fields: FIELDS, featureCount: enrichedParcels, chunkCount: Object.keys(files).length, files, counts, auditReport: "/data/counties/travis-county-tx/parcels/intelligence/tcad-2026-supp-333/audit.json", activationStatus: "joined-needs-refresh-stability-and-optional-layer-qa" };
  writeJson(path.join(sidecarRoot, "manifest.json"), intelligenceManifest, true); writeJson(path.join(sidecarRoot, "audit.json"), audit, true); writeJson(path.join(outputRoot, "tcad-certified-intelligence-audit.json"), audit, true);
  const markdown = ["# Travis County TCAD certified-intelligence audit", "", `- TCAD property rows streamed: ${propertyRows.toLocaleString()}`, `- Distinct TCAD prop_id values: ${sourcePropIds.size.toLocaleString()}`, `- Existing parcel-service features: ${serviceManifest.featureCount.toLocaleString()}`, `- Enriched parcel-service features: ${enrichedParcels.toLocaleString()}`, `- Unmatched parcel-service features: ${(serviceManifest.featureCount - enrichedParcels).toLocaleString()}`, `- Confidential matched rows protected: ${confidentialRows.toLocaleString()}`, `- Address-suppressed matched rows protected: ${suppressedAddressRows.toLocaleString()}`, `- Improvement-detail rows streamed: ${improvementDetailRows.toLocaleString()}`, `- Matched improvement-detail rows: ${matchedDetailRows.toLocaleString()}`, `- Viewport-aligned sidecar chunks: ${Object.keys(files).length.toLocaleString()}`, "", "## Join policy", "", "The official zero-padded fixed-width `prop_id` is normalized to the integer-form parcel service `PROP_ID`/`accountNum`. Confidential owner names and suppressed mailing addresses are never copied into runtime sidecars.", "", "## Activation gate", "", audit.activation.reason, ""].join("\n");
  fs.writeFileSync(path.join(outputRoot, "tcad-certified-intelligence-audit.md"), markdown);
  serviceManifest.intelligenceSidecars = { version: intelligenceManifest.schemaVersion, manifest: "intelligence/tcad-2026-supp-333/manifest.json", joinKey: "PROP_ID / normalized prop_id", featureCount: enrichedParcels, chunkCount: Object.keys(files).length, files, counts, activationStatus: intelligenceManifest.activationStatus };
  writeJson(serviceManifestPath, serviceManifest);
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(`${workDbPath}${suffix}`)) fs.rmSync(`${workDbPath}${suffix}`, { force: true });
  console.log(JSON.stringify(audit.distribution, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
