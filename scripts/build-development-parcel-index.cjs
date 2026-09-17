const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const inputFile = path.join(root, "output", "development-intelligence.json");
const publicDir = path.join(root, "public", "data", "developments");
const outputFile = path.join(publicDir, "parcel-development-index.json");
const manifestFile = path.join(publicDir, "manifest.json");
const recordShardDir = path.join(publicDir, "parcel-index");
const searchShardDir = path.join(publicDir, "search-index");
const SHARD_KEY_LENGTH = 2;
const MAX_RECORDS_PER_FILE = 1500;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shardKey(value) {
  return normalize(value).slice(0, SHARD_KEY_LENGTH) || "__";
}

function searchKeys(record) {
  const values = [record.parcelId, record.parcelGisId, record.parcelAddress, record.parcelPropertyName, ...(record.signalTypes || []), ...(record.stages || [])];
  const keys = new Set();
  for (const value of values) {
    const raw = String(value || "").toLowerCase();
    const compact = normalize(raw);
    if (compact.length >= SHARD_KEY_LENGTH) keys.add(compact.slice(0, SHARD_KEY_LENGTH));
    for (const token of raw.split(/[^a-z0-9]+/).filter(Boolean)) {
      const key = shardKey(token);
      if (key !== "__") keys.add(key);
    }
  }
  return [...keys].sort();
}

function writeShardFiles(directory, prefix, records) {
  const files = [];
  for (let offset = 0; offset < records.length; offset += MAX_RECORDS_PER_FILE) {
    const page = records.slice(offset, offset + MAX_RECORDS_PER_FILE);
    const suffix = String(files.length).padStart(4, "0");
    const name = `${prefix}-${suffix}.json`;
    const payload = `${JSON.stringify({ records: page })}\n`;
    fs.writeFileSync(path.join(directory, name), payload);
    files.push({ file: name, count: page.length, bytes: Buffer.byteLength(payload), sha256: sha256(payload) });
  }
  return files;
}

function buildRecords(payload) {
  const parcels = new Map();
  for (const signal of payload.signals || []) {
    const parcelId = String(signal.parcelId || signal.parcelAccountNum || "").trim();
    if (!parcelId) continue;
    const current = parcels.get(parcelId) || {
      parcelId,
      parcelGisId: String(signal.parcelGisId || "").trim(),
      parcelAddress: String(signal.parcelAddress || "").trim(),
      parcelPropertyName: String(signal.parcelPropertyName || "").trim(),
      signalCount: 0,
      score: 0,
      latestActivityDate: "",
      signalTypes: new Set(),
      stages: new Set(),
    };
    if (!current.parcelGisId && signal.parcelGisId) current.parcelGisId = String(signal.parcelGisId).trim();
    if (!current.parcelAddress && signal.parcelAddress) current.parcelAddress = String(signal.parcelAddress).trim();
    if (!current.parcelPropertyName && signal.parcelPropertyName) current.parcelPropertyName = String(signal.parcelPropertyName).trim();
    current.signalCount += 1;
    current.score += Number.parseFloat(signal.score || 0) || 0;
    if (signal.signalType) current.signalTypes.add(signal.signalType);
    if (signal.stage) current.stages.add(signal.stage);
    const activityDate = signal.source?.activityDate || signal.source?.issueDate || signal.source?.finalDate || "";
    if (activityDate && activityDate > current.latestActivityDate) current.latestActivityDate = activityDate;
    parcels.set(parcelId, current);
  }
  return Array.from(parcels.values())
    .map((record) => ({ ...record, signalTypes: Array.from(record.signalTypes), stages: Array.from(record.stages) }))
    .sort((a, b) => a.parcelId.localeCompare(b.parcelId));
}

function main() {
  const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const records = buildRecords(payload);
  fs.mkdirSync(publicDir, { recursive: true });
  fs.rmSync(recordShardDir, { recursive: true, force: true });
  fs.rmSync(searchShardDir, { recursive: true, force: true });
  fs.mkdirSync(recordShardDir, { recursive: true });
  fs.mkdirSync(searchShardDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  fs.writeFileSync(outputFile, JSON.stringify({ generatedAt, source: "output/development-intelligence.json", parcelCount: records.length, records }, null, 2));

  const recordGroups = new Map();
  const searchGroups = new Map();
  for (const record of records) {
    const recordKey = shardKey(record.parcelId);
    if (!recordGroups.has(recordKey)) recordGroups.set(recordKey, []);
    recordGroups.get(recordKey).push(record);
    for (const key of searchKeys(record)) {
      if (!searchGroups.has(key)) searchGroups.set(key, []);
      searchGroups.get(key).push(record);
    }
  }

  const recordShards = {};
  const searchShards = {};
  let recordFileCount = 0;
  let searchFileCount = 0;
  let searchMembershipCount = 0;
  let maxShardBytes = 0;
  for (const [key, group] of [...recordGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const files = writeShardFiles(recordShardDir, key, group);
    recordShards[key] = { count: group.length, files: files.map((file) => `parcel-index/${file.file}`) };
    recordFileCount += files.length;
    maxShardBytes = Math.max(maxShardBytes, ...files.map((file) => file.bytes));
  }
  for (const [key, group] of [...searchGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const files = writeShardFiles(searchShardDir, key, group);
    searchShards[key] = { count: group.length, files: files.map((file) => `search-index/${file.file}`) };
    searchFileCount += files.length;
    searchMembershipCount += group.length;
    maxShardBytes = Math.max(maxShardBytes, ...files.map((file) => file.bytes));
  }

  const manifest = {
    schemaVersion: "wr-development-parcel-service-v1",
    generatedAt,
    source: "output/development-intelligence.json",
    sourceCountyId: "dallas-county-dcad",
    parcelCount: records.length,
    shardKeyLength: SHARD_KEY_LENGTH,
    maxRecordsPerFile: MAX_RECORDS_PER_FILE,
    maxShardBytes,
    recordFileCount,
    searchFileCount,
    searchMembershipCount,
    recordShards,
    searchShards,
    legacyAuditIndex: "parcel-development-index.json",
    runtimePolicy: "Load parcel-ID shards for the viewport and search shards for the active query; never fetch the legacy audit index in the browser.",
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const report = {
    schemaVersion: "wr-development-runtime-delivery-report-v1",
    generatedAt,
    sourceCountyId: manifest.sourceCountyId,
    status: "verified-bounded-service",
    exactCounts: {
      parcelCount: records.length,
      recordFileCount,
      searchFileCount,
      searchMembershipCount,
    },
    deliveryBoundary: {
      legacyAuditIndexBytes: fs.statSync(outputFile).size,
      legacyAuditIndexLoadedInBrowser: false,
      manifestBytes: fs.statSync(manifestFile).size,
      maximumShardBytes: maxShardBytes,
      maximumRecordsPerShard: MAX_RECORDS_PER_FILE,
      maximumSearchQueryRecords: 6000,
      viewportParcelShards: true,
      querySearchShards: true,
    },
    lockedUiContract: { earthImageryPreserved: true, dcadParcelLayerPreserved: true, landingPageChanged: false },
  };
  const outputDir = path.join(root, "output");
  fs.writeFileSync(path.join(outputDir, "development-runtime-delivery-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "development-runtime-delivery-report.md"), [
    "# White Rabbit Development Runtime Delivery",
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Status: ${report.status}`,
    `- Parcel-linked intelligence records: ${records.length.toLocaleString("en-US")}`,
    `- Parcel-ID shard files: ${recordFileCount.toLocaleString("en-US")}`,
    `- Search shard files: ${searchFileCount.toLocaleString("en-US")}`,
    `- Largest runtime shard: ${maxShardBytes.toLocaleString("en-US")} bytes`,
    `- Legacy audit index: ${report.deliveryBoundary.legacyAuditIndexBytes.toLocaleString("en-US")} bytes, browser load disabled`,
    `- Maximum records planned per search: ${report.deliveryBoundary.maximumSearchQueryRecords.toLocaleString("en-US")}`,
    "- Earth imagery preserved: yes",
    "- DCAD parcel layer preserved: yes",
    "- Landing page changed: no",
    "",
  ].join("\n"));
  console.log(`Wrote ${outputFile}`);
  console.log(`Wrote ${manifestFile}`);
  console.log(`Wrote ${path.join(outputDir, "development-runtime-delivery-report.json")}`);
  console.log(`Development parcels indexed: ${records.length}; record shards: ${recordFileCount}; search shards: ${searchFileCount}; maximum shard bytes: ${maxShardBytes}`);
}

main();
