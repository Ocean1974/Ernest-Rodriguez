const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const countyId = "collin-county-tx";
const datasetId = "82ee-gbj5";
const metadataUrl = `https://data.texas.gov/api/views/${datasetId}`;
const resourceUrl = `https://data.texas.gov/resource/${datasetId}.json`;
const intelligenceRoot = path.join(root, "public/data/counties", countyId, "intelligence");
const outputRoot = path.join(root, "public/data/counties", countyId, "permits-refresh");
const reportRoot = path.join(root, "output", countyId);

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function clearDir(dir) { ensureDir(dir); for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); }
function clean(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return clean(value) && Number.isFinite(parsed) ? parsed : null; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function writeJson(file, value, pretty = false) { ensureDir(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`); }
async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return { value: JSON.parse(text), text };
}

function loadPropertyBridge() {
  const manifest = JSON.parse(fs.readFileSync(path.join(intelligenceRoot, "manifest.json"), "utf8"));
  const byPropertyId = new Map(); const ambiguous = new Set();
  for (const shard of Object.values(manifest.delivery.shards || {})) {
    const lines = fs.readFileSync(path.join(intelligenceRoot, shard.file), "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line); const propertyId = clean(record.propertyId); const globalId = clean(record.globalId).toLowerCase();
      if (!propertyId || !globalId) continue;
      const existing = byPropertyId.get(propertyId);
      if (existing && existing !== globalId) ambiguous.add(propertyId);
      else byPropertyId.set(propertyId, globalId);
    }
  }
  for (const propertyId of ambiguous) byPropertyId.delete(propertyId);
  return { byPropertyId, ambiguous, manifest };
}

function normalizePermit(row, globalId, sourceRecordOrdinal) {
  return {
    schemaVersion: "wr-collin-ccad-permit-v1",
    sourceCountyId: countyId,
    sourceDatasetId: datasetId,
    sourceRecordOrdinal,
    permitId: clean(row.permitid),
    permitNumber: clean(row.permitnum),
    permitTypeCode: clean(row.permittypecode),
    permitType: clean(row.permittypedescr),
    permitSubtypeCode: clean(row.permitsubtypecode),
    permitSubtype: clean(row.permitsubtypedescr),
    issuedDate: clean(row.permitissueddate),
    issuedBy: clean(row.permitissuedby),
    issuedTo: clean(row.permitissuedto),
    value: number(row.permitvalue),
    buildingAreaSqFt: number(row.permitbldgarea),
    comments: clean(row.permitcomments),
    builderName: clean(row.permitbuildername),
    propertyId: clean(row.propid),
    globalId,
    countyParcelId: `${countyId}:${globalId}`,
    propertyClass: clean(row.proprescom),
    legalDescription: clean(row.proplegaldescr),
    address: clean(row.situsconcat),
    shortAddress: clean(row.situsconcatshort),
    city: clean(row.situscity),
    zip: clean(row.situszip),
    dataDate: clean(row.datadate),
  };
}

async function main() {
  const { byPropertyId, ambiguous, manifest: intelligenceManifest } = loadPropertyBridge();
  const [metadataResponse, countResponse] = await Promise.all([
    request(metadataUrl),
    request(`${resourceUrl}?$select=count(*)`),
  ]);
  const expectedCount = Number(countResponse.value[0]?.count || 0);
  const rows = []; const pageHashes = [];
  for (let offset = 0; offset < expectedCount; offset += 50000) {
    const url = `${resourceUrl}?$limit=50000&$offset=${offset}&$order=permitid`;
    const response = await request(url); rows.push(...response.value); pageHashes.push(sha256(response.text));
    console.log(`CCAD permits: ${rows.length.toLocaleString()}/${expectedCount.toLocaleString()}`);
  }
  if (rows.length !== expectedCount) throw new Error(`Permit source count mismatch ${rows.length}/${expectedCount}`);

  const permitIds = new Set(); let duplicatePermitIds = 0; let futureIssuedDateCount = 0; let missingPropertyId = 0; let ambiguousPropertyId = 0; let unmatchedPropertyId = 0;
  const shards = new Map(); const parcels = new Set(); let latestDataDate = ""; let latestIssuedDate = "";
  const buildDate = new Date().toISOString().slice(0, 10);
  for (let sourceIndex = 0; sourceIndex < rows.length; sourceIndex += 1) {
    const row = rows[sourceIndex];
    const permitId = clean(row.permitid); if (permitIds.has(permitId)) duplicatePermitIds += 1; permitIds.add(permitId);
    const issuedDate = clean(row.permitissueddate);
    if (issuedDate.slice(0, 10) > buildDate) { futureIssuedDateCount += 1; continue; }
    const propertyId = clean(row.propid);
    if (!propertyId) { missingPropertyId += 1; continue; }
    if (ambiguous.has(propertyId)) { ambiguousPropertyId += 1; continue; }
    const globalId = byPropertyId.get(propertyId);
    if (!globalId) { unmatchedPropertyId += 1; continue; }
    const record = normalizePermit(row, globalId, sourceIndex + 1); const key = globalId.slice(0, 2);
    if (!shards.has(key)) shards.set(key, []); shards.get(key).push(record); parcels.add(globalId);
    if (record.dataDate > latestDataDate) latestDataDate = record.dataDate;
    if (record.issuedDate > latestIssuedDate) latestIssuedDate = record.issuedDate;
  }

  clearDir(outputRoot); const files = {}; const counts = {};
  for (const [key, records] of [...shards].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `shards/${key}.json`; writeJson(path.join(outputRoot, relative), { schemaVersion: "wr-collin-ccad-permit-shard-v1", records });
    files[key] = relative; counts[key] = records.length;
  }
  const joinedCount = [...shards.values()].reduce((sum, records) => sum + records.length, 0);
  const generatedAt = new Date().toISOString();
  const output = {
    schemaVersion: "wr-collin-ccad-permit-manifest-v1", sourceCountyId: countyId, generatedAt,
    status: "official-ccad-permits-joined-to-refresh", activationAuthorized: false,
    source: {
      publisher: "Collin Central Appraisal District via Texas Open Data Portal", datasetId, datasetName: metadataResponse.value.name,
      description: metadataResponse.value.description, metadataUrl, resourceUrl, sourceRecordCount: expectedCount,
      metadataSha256: sha256(metadataResponse.text), countResponseSha256: sha256(countResponse.text), pageHashes,
      sourceRowsUpdatedAt: metadataResponse.value.rowsUpdatedAt, sourceViewLastModified: metadataResponse.value.viewLastModified,
    },
    join: {
      method: "exact permit propID to unique CCAD refresh propertyId, then refresh GlobalID", intelligenceManifest: "public/data/counties/collin-county-tx/intelligence/manifest.json",
      sourceRecordCount: expectedCount, joinedRecordCount: joinedCount, distinctParcelsWithPermits: parcels.size,
      missingPropertyId, ambiguousPropertyId, unmatchedPropertyId, refreshPropertyBridgeCount: byPropertyId.size, ambiguousRefreshPropertyIdCount: ambiguous.size,
    },
    identity: {
      permitIdStatus: "non-unique source field; preserve every source row with sourceRecordOrdinal",
      distinctPermitIdCount: permitIds.size,
      duplicatePermitIdCount: duplicatePermitIds,
    },
    quality: { futureIssuedDateCount, futureDatePolicy: `rows dated after ${buildDate} are quarantined from parcel evidence` },
    freshness: { latestDataDate, latestIssuedDate },
    delivery: { format: "json-shards", key: "first two characters of lowercase refresh GlobalID", shardCount: shards.size, files, counts },
    truthBoundary: [
      "Permit records are evidence of issued permits, not proof of construction, completion, ownership intent, or listing status.",
      "CCAD permitID is not unique; every source row is preserved with an ingestion ordinal and duplicates are not collapsed.",
      "Future-dated issue records are quarantined and are not delivered as current parcel evidence.",
      "Permit issued-to and builder fields are not treated as owner contact information.",
      "This refresh-scoped permit index remains invisible until the replacement parcel service and county QC pass.",
    ],
  };
  writeJson(path.join(outputRoot, "manifest.json"), output, true);
  writeJson(path.join(reportRoot, "ccad-permit-intelligence-report.json"), output, true);
  fs.writeFileSync(path.join(reportRoot, "ccad-permit-intelligence-report.md"), `# Collin County CCAD permit intelligence\n\n- Official source records: **${expectedCount.toLocaleString()}**\n- Exact parcel joins delivered: **${joinedCount.toLocaleString()}**\n- Distinct parcels with permits: **${parcels.size.toLocaleString()}**\n- Repeated permitID rows: **${duplicatePermitIds.toLocaleString()}**\n- Future-dated records quarantined: **${futureIssuedDateCount.toLocaleString()}**\n- Missing propID: **${missingPropertyId.toLocaleString()}**\n- Ambiguous propID: **${ambiguousPropertyId.toLocaleString()}**\n- Unmatched propID: **${unmatchedPropertyId.toLocaleString()}**\n- Latest source data date: **${latestDataDate || "not supplied"}**\n\nPermit evidence does not prove construction, completion, ownership intent, or listing status.\n`);
  console.log(JSON.stringify({ sourceRecords: expectedCount, joinedRecords: joinedCount, parcelsWithPermits: parcels.size, duplicatePermitIds, futureIssuedDateCount, unmatchedPropertyId }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
