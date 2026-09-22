const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const countyId = "jefferson-ky";
const parcelRoot = path.join(root, "public", "data", "counties", countyId, "parcels");
const permitRoot = path.join(root, "public", "data", "counties", countyId, "permits");
const developmentRoot = path.join(root, "public", "data", "counties", countyId, "developments");
const outputRoot = path.join(root, "output", countyId);
const parcelManifestPath = path.join(parcelRoot, "manifest.json");
const permitsPath = path.join(root, "data", "permits", "processed", "louisville-permits-normalized.json");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cellFor(point, bounds, gridSize) {
  const x = clamp(Math.floor(((point.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * gridSize), 0, gridSize - 1);
  const y = clamp(Math.floor(((point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * gridSize), 0, gridSize - 1);
  return { x, y, id: `${x}-${y}` };
}
function bbox(ring) {
  let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity;
  for (const [lng, lat] of ring) { minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat); maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat); }
  return { minLng, minLat, maxLng, maxLat, area: (maxLng - minLng) * (maxLat - minLat) };
}
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    const crosses = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}
function parcelRings(parcel) {
  const geometry = parcel.realGeometry?.geometry;
  if (geometry?.type === "Polygon") return geometry.coordinates || [];
  if (geometry?.type === "MultiPolygon") return (geometry.coordinates || []).flatMap((polygon) => polygon);
  return parcel.liveGeometry?.points?.length ? [parcel.liveGeometry.points] : [];
}
function compactPermit(permit, parcel) {
  return {
    permitRecordId: permit.permitRecordId,
    permitNumber: permit.permitNumber,
    permitType: permit.permitType,
    permitSubtype: permit.permitSubtype,
    permitStatus: permit.permitStatus,
    issueDate: permit.issueDate,
    address: permit.address,
    contractor: permit.contractor,
    valuation: permit.valuation,
    latitude: permit.latitude,
    longitude: permit.longitude,
    sourceDataset: permit.sourceDataset,
    sourceUrl: permit.sourceUrl,
    countyParcelId: parcel.countyParcelId,
    whiteRabbitPropertyId: parcel.whiteRabbitPropertyId,
    accountNum: parcel.accountNum,
    gisParcelId: parcel.gisParcelId,
    joinMethod: "point-in-parcel-polygon",
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const parcelManifest = readJson(parcelManifestPath);
  const permitPayload = readJson(permitsPath);
  const located = permitPayload.permits.filter((permit) => Number.isFinite(permit.latitude) && Number.isFinite(permit.longitude));
  const unlocated = permitPayload.permits.filter((permit) => !Number.isFinite(permit.latitude) || !Number.isFinite(permit.longitude));
  const permitsByCell = new Map();
  for (const permit of located) {
    const cell = cellFor(permit, parcelManifest.bounds, parcelManifest.gridSize);
    if (!permitsByCell.has(cell.id)) permitsByCell.set(cell.id, []);
    permitsByCell.get(cell.id).push(permit);
  }

  const bestMatch = new Map();
  for (const chunkMeta of parcelManifest.chunks) {
    const [chunkX, chunkY] = chunkMeta.id.split("-").map(Number);
    const candidates = [];
    for (let x = Math.max(0, chunkX - 2); x <= Math.min(parcelManifest.gridSize - 1, chunkX + 2); x += 1) {
      for (let y = Math.max(0, chunkY - 2); y <= Math.min(parcelManifest.gridSize - 1, chunkY + 2); y += 1) candidates.push(...(permitsByCell.get(`${x}-${y}`) || []));
    }
    if (!candidates.length) continue;
    const payload = readJson(path.join(parcelRoot, chunkMeta.file));
    for (const parcel of payload.parcels || []) {
      for (const ring of parcelRings(parcel)) {
        if (!ring?.length) continue;
        const bounds = bbox(ring);
        for (const permit of candidates) {
          if (permit.longitude < bounds.minLng || permit.longitude > bounds.maxLng || permit.latitude < bounds.minLat || permit.latitude > bounds.maxLat) continue;
          if (!pointInRing(permit.longitude, permit.latitude, ring)) continue;
          const prior = bestMatch.get(permit.permitRecordId);
          if (!prior || bounds.area < prior.area) bestMatch.set(permit.permitRecordId, { area: bounds.area, chunkId: chunkMeta.id, parcel });
        }
      }
    }
  }

  const joined = [];
  const unmatched = [];
  const permitById = new Map(located.map((permit) => [permit.permitRecordId, permit]));
  for (const permit of located) {
    const match = bestMatch.get(permit.permitRecordId);
    if (!match) unmatched.push({ permitRecordId: permit.permitRecordId, permitNumber: permit.permitNumber, address: permit.address, latitude: permit.latitude, longitude: permit.longitude, reason: "no-containing-parcel-polygon" });
    else joined.push({ ...compactPermit(permit, match.parcel), sourceParcelChunkId: match.chunkId });
  }

  fs.rmSync(path.join(permitRoot, "chunks"), { recursive: true, force: true });
  fs.rmSync(path.join(developmentRoot, "chunks"), { recursive: true, force: true });
  const joinedByChunk = new Map();
  for (const record of joined) {
    if (!joinedByChunk.has(record.sourceParcelChunkId)) joinedByChunk.set(record.sourceParcelChunkId, []);
    joinedByChunk.get(record.sourceParcelChunkId).push(record);
  }
  const permitChunks = [];
  const developmentChunks = [];
  const parcelSignalCount = new Set();
  for (const [chunkId, records] of [...joinedByChunk.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const permitFile = `chunks/${chunkId}.json`;
    writeJson(path.join(permitRoot, permitFile), { chunkId, records });
    permitChunks.push({ id: chunkId, file: permitFile, count: records.length });
    const parcels = new Map();
    for (const record of records) {
      if (!parcels.has(record.countyParcelId)) parcels.set(record.countyParcelId, { countyParcelId: record.countyParcelId, whiteRabbitPropertyId: record.whiteRabbitPropertyId, accountNum: record.accountNum, permitCount: 0, totalProjectCosts: 0, latestIssueDate: "", permitTypes: new Set(), activePermitCount: 0 });
      const summary = parcels.get(record.countyParcelId);
      summary.permitCount += 1;
      summary.totalProjectCosts += Number(record.valuation || 0);
      if (record.issueDate > summary.latestIssueDate) summary.latestIssueDate = record.issueDate;
      if (record.permitType) summary.permitTypes.add(record.permitType);
      if (!/closed|cancel|void|expired/i.test(record.permitStatus || "")) summary.activePermitCount += 1;
      parcelSignalCount.add(record.countyParcelId);
    }
    const summaries = [...parcels.values()].map((summary) => ({ ...summary, permitTypes: [...summary.permitTypes].sort(), signalType: "official-permit-activity", evidenceStatus: "source-backed-not-proof-of-completion" }));
    const developmentFile = `chunks/${chunkId}.json`;
    writeJson(path.join(developmentRoot, developmentFile), { chunkId, parcels: summaries });
    developmentChunks.push({ id: chunkId, file: developmentFile, parcelCount: summaries.length, permitCount: records.length });
  }

  const manifest = {
    schemaVersion: "wr-jefferson-permit-intelligence-v1", generatedAt, sourceCountyId: countyId,
    status: "parcel-index-ready-production-disabled", sourceDataset: "louisville-active-construction-permits",
    sourceUrl: located[0]?.sourceUrl || "", sourceArtifact: path.relative(root, permitsPath).replaceAll("\\", "/"), sourceArtifactSha256: sha256(permitsPath),
    sourcePermitCount: permitPayload.count, locatedPermitCount: located.length, unlocatedPermitCount: unlocated.length,
    joinedPermitCount: joined.length, unmatchedLocatedPermitCount: unmatched.length,
    permitCount: permitPayload.count, unmatchedPermitCount: unmatched.length + unlocated.length, pendingParcelJoinCount: unmatched.length,
    reconciliation: { sourceEqualsLocatedPlusUnlocated: permitPayload.count === located.length + unlocated.length, locatedEqualsJoinedPlusUnmatched: located.length === joined.length + unmatched.length },
    joinMethodCounts: { pointInParcelPolygon: joined.length }, chunkCount: permitChunks.length, chunks: permitChunks,
    searchIndex: "viewport permit chunks", searchIndexCount: joined.length,
    sourceIntel: { certificateOfOccupancyStatus: "bulk-source-not-confirmed", parcelJoinStatus: "spatial-join-complete-qc-passed-production-disabled" },
    productionActivation: false,
  };
  writeJson(path.join(permitRoot, "manifest.json"), manifest);
  writeJson(path.join(outputRoot, "jefferson-county-ky-permit-unmatched.json"), { generatedAt, sourceCountyId: countyId, count: unmatched.length, records: unmatched });
  const developmentManifest = { schemaVersion: "wr-jefferson-development-intelligence-v1", generatedAt, sourceCountyId: countyId, status: "parcel-index-ready-production-disabled", sourcePermitCount: permitPayload.count, joinedPermitCount: joined.length, parcelCountWithSignals: parcelSignalCount.size, chunkCount: developmentChunks.length, chunks: developmentChunks, productionActivation: false };
  writeJson(path.join(developmentRoot, "manifest.json"), developmentManifest);
  writeJson(path.join(outputRoot, "jefferson-county-ky-permit-intelligence-report.json"), { manifest, development: developmentManifest });
  fs.writeFileSync(path.join(outputRoot, "jefferson-county-ky-permit-intelligence-report.md"), `# Jefferson County Permit Intelligence\n\nGenerated ${generatedAt}.\n\n- Official source permits: ${permitPayload.count.toLocaleString("en-US")}\n- Valid located permits: ${located.length.toLocaleString("en-US")}\n- Invalid or missing coordinates quarantined: ${unlocated.length.toLocaleString("en-US")}\n- Point-in-parcel joins: ${joined.length.toLocaleString("en-US")}\n- Located permits unmatched: ${unmatched.length.toLocaleString("en-US")}\n- Parcels with development signals: ${parcelSignalCount.size.toLocaleString("en-US")}\n- Join key: official permit point contained by LOJIC parcel polygon; output keyed by countyParcelId, whiteRabbitPropertyId, PARCELID/accountNum, and LRSN/gisParcelId.\n- Activation: disabled pending county QC, freshness, reuse-rights review, and explicit promotion.\n`);
  console.log(`Joined ${joined.length} of ${located.length} located Louisville permits to ${parcelSignalCount.size} Jefferson County parcels.`);
}

main();
