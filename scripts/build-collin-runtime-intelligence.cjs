const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const countyRoot = path.join(root, "public", "data", "counties", "collin-county-tx");
const parcelRoot = path.join(countyRoot, "parcels");
const sourceRoot = path.join(countyRoot, "permits-refresh");
const permitRoot = path.join(countyRoot, "permits");
const developmentRoot = path.join(countyRoot, "developments");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value)}\n`); }
function clean(value) { return String(value ?? "").trim(); }
function key(value, length = 2) { return clean(value).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, length) || "__"; }
function boundsFor(records) {
  const points = records.filter((record) => Number.isFinite(record.longitude) && Number.isFinite(record.latitude));
  if (!points.length) return null;
  return { minLng: Math.min(...points.map((r) => r.longitude)), minLat: Math.min(...points.map((r) => r.latitude)), maxLng: Math.max(...points.map((r) => r.longitude)), maxLat: Math.max(...points.map((r) => r.latitude)) };
}

function main() {
  const generatedAt = new Date().toISOString();
  const parcelManifest = readJson(path.join(parcelRoot, "manifest.json"));
  const parcelByGlobalId = new Map();
  const parcelByAccount = new Map();
  for (const chunk of parcelManifest.chunks || []) {
    const payload = readJson(path.join(parcelRoot, chunk.file));
    for (const parcel of payload.parcels || []) {
      const accountNum = clean(parcel.accountNum || parcel.sourceParcelId);
      const globalId = clean(parcel.realGeometry?.properties?.globalId).toLowerCase();
      const center = parcel.liveGeometry?.center || [];
      const bridge = { accountNum, globalId, chunkId: clean(chunk.id), longitude: Number(center[0]), latitude: Number(center[1]), address: clean(parcel.address), propertyName: clean(parcel.propertyName), gisParcelId: clean(parcel.gisParcelId) };
      if (globalId) parcelByGlobalId.set(globalId, bridge);
      if (accountNum) parcelByAccount.set(accountNum, bridge);
    }
  }

  const sourceManifest = readJson(path.join(sourceRoot, "manifest.json"));
  const runtimePermits = [];
  const developmentByParcel = new Map();
  for (const relative of Object.values(sourceManifest.delivery.files || {})) {
    for (const source of readJson(path.join(sourceRoot, relative)).records || []) {
      const bridge = parcelByGlobalId.get(clean(source.globalId).toLowerCase()) || parcelByAccount.get(clean(source.propertyId));
      if (!bridge) continue;
      const permitRecordId = `ccad:${clean(source.permitId) || "permit"}:${source.sourceRecordOrdinal}`;
      const permit = {
        permitRecordId,
        sourceDataset: "Texas Open Data 82ee-gbj5 / CCAD Building Permits",
        permitNumber: clean(source.permitNumber || source.permitId),
        permitType: clean(source.permitType), permitSubtype: clean(source.permitSubtype),
        permitStatus: "issued", address: clean(source.address || bridge.address), description: clean(source.comments), contractor: clean(source.builderName),
        parcelAccountNum: bridge.accountNum, parcelGisId: bridge.gisParcelId,
        latitude: Number.isFinite(bridge.latitude) ? bridge.latitude : null, longitude: Number.isFinite(bridge.longitude) ? bridge.longitude : null,
        issueDate: clean(source.issuedDate), chunkId: bridge.chunkId,
        searchText: [bridge.accountNum, bridge.gisParcelId, source.permitNumber, source.permitId, source.permitType, source.address, source.builderName].map(clean).join(" ").toLowerCase(),
      };
      runtimePermits.push(permit);
      const existing = developmentByParcel.get(bridge.accountNum) || { parcelId: bridge.accountNum, parcelGisId: bridge.gisParcelId, parcelAddress: bridge.address, parcelPropertyName: bridge.propertyName, signalCount: 0, score: 0, latestActivityDate: "", signalTypes: [], stages: [], evidenceRecordIds: [] };
      existing.signalCount += 1;
      existing.score = Math.min(100, 45 + Math.min(35, existing.signalCount * 5) + (/new construction/i.test(source.permitType) ? 20 : 0));
      existing.latestActivityDate = [existing.latestActivityDate, clean(source.issuedDate).slice(0, 10)].sort().at(-1);
      if (!existing.signalTypes.includes("building-permit")) existing.signalTypes.push("building-permit");
      if (!existing.stages.includes("issued")) existing.stages.push("issued");
      existing.evidenceRecordIds.push(permitRecordId);
      existing.classificationPolicy = "evidence-only; a permit is an activity signal, not proof of construction, completion, entitlement, or listing status";
      developmentByParcel.set(bridge.accountNum, existing);
    }
  }

  const byChunk = new Map();
  for (const permit of runtimePermits) {
    if (!byChunk.has(permit.chunkId)) byChunk.set(permit.chunkId, []);
    byChunk.get(permit.chunkId).push(permit);
  }
  fs.mkdirSync(path.join(permitRoot, "chunks"), { recursive: true });
  const chunks = [];
  for (const [chunkId, records] of [...byChunk].sort()) {
    const file = `chunks/${chunkId}.json`;
    writeJson(path.join(permitRoot, file), { permits: records });
    chunks.push({ id: chunkId, file, count: records.length, bounds: boundsFor(records) });
  }
  const searchRecords = runtimePermits.map(({ searchText, ...record }) => ({ ...record, searchText }));
  writeJson(path.join(permitRoot, "search-index.json"), { permits: searchRecords });
  const accountGroups = new Map();
  for (const permit of searchRecords) { const k = key(permit.parcelAccountNum); if (!accountGroups.has(k)) accountGroups.set(k, []); accountGroups.get(k).push(permit); }
  const accountFiles = {};
  for (const [k, records] of accountGroups) { const file = `account-index/${k}.json`; writeJson(path.join(permitRoot, file), { permits: records }); accountFiles[k] = file; }
  writeJson(path.join(permitRoot, "manifest.json"), {
    schemaVersion: "wr-permit-service-v1", generatedAt, sourceCountyId: "collin-county-tx", status: "ready-official-ccad-three-year-permits",
    permitCount: runtimePermits.length, locatedPermitCount: runtimePermits.filter((r) => r.latitude !== null).length,
    joinedPermitCount: runtimePermits.length, unmatchedPermitCount: Number(sourceManifest.join?.sourceRecordCount || 0) - runtimePermits.length,
    chunkCount: chunks.length, chunks, searchIndex: "search-index.json", searchIndexCount: searchRecords.length,
    parcelSearchShards: { keyLength: 2, files: accountFiles },
    sourceDatasetId: "82ee-gbj5", sourceManifest: "../permits-refresh/manifest.json",
  });

  const developmentRecords = [...developmentByParcel.values()].sort((a, b) => b.score - a.score || b.latestActivityDate.localeCompare(a.latestActivityDate) || a.parcelId.localeCompare(b.parcelId));
  writeJson(path.join(developmentRoot, "parcel-development-index.json"), { schemaVersion: "wr-collin-parcel-development-index-v1", generatedAt, sourceCountyId: "collin-county-tx", recordCount: developmentRecords.length, records: developmentRecords });
  const recordGroups = new Map();
  for (const record of developmentRecords) { const k = key(record.parcelId); if (!recordGroups.has(k)) recordGroups.set(k, []); recordGroups.get(k).push(record); }
  const recordShards = {}; const searchShards = {};
  for (const [k, records] of recordGroups) {
    const file = `records/${k}.json`; writeJson(path.join(developmentRoot, file), { records });
    recordShards[k] = { count: records.length, files: [file] };
    searchShards[k] = { count: records.length, files: [file] };
  }
  writeJson(path.join(developmentRoot, "manifest.json"), { schemaVersion: "wr-development-parcel-service-v1", generatedAt, sourceCountyId: "collin-county-tx", status: "ready-official-permit-signals", parcelCount: developmentRecords.length, shardKeyLength: 2, maxRecordsPerFile: 2000, maxShardBytes: 5000000, recordShards, searchShards, sourcePermitCount: runtimePermits.length });
  console.log(JSON.stringify({ parcelCount: parcelByAccount.size, permitCount: runtimePermits.length, developmentParcelCount: developmentRecords.length, chunkCount: chunks.length }, null, 2));
}

main();
