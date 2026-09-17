const fs = require("fs");
const path = require("path");
const readline = require("readline");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "county-importer-registry.json"), "utf8"));
const ADDRESS_FIELDS = ["sourceCountyId", "countyParcelId", "accountNum", "accountNumber", "gisParcelId", "address", "propertyAddress", "ownerName", "chunkId", "centroid"];
const KEY_LENGTH = 3;
const MAX_RECORDS_PER_FILE = 25000;

function parseArgs(argv) {
  const args = { batch: "pilot-eight", county: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--batch") args.batch = String(argv[index + 1] || args.batch);
    if (argv[index] === "--county") args.county = String(argv[index + 1] || "");
  }
  return args;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function shardKeys(record) {
  const keys = new Set();
  const add = (value) => {
    const token = normalize(value);
    if (token.length >= KEY_LENGTH) keys.add(token.slice(0, KEY_LENGTH));
  };
  const address = String(record.address || record.propertyAddress || "").trim();
  add(address);
  add(record.accountNum || record.accountNumber);
  add(record.gisParcelId);
  return [...keys];
}

function pack(record, chunkId) {
  const values = { ...record, chunkId };
  return ADDRESS_FIELDS.map((field) => values[field] ?? "");
}

async function writeJsonParts(ndjsonPath, outputDir, shardKey) {
  const input = readline.createInterface({ input: fs.createReadStream(ndjsonPath), crlfDelay: Infinity });
  const files = [];
  let records = [];
  let part = 0;
  const flush = () => {
    if (!records.length) return;
    part += 1;
    const name = `${shardKey}-${String(part).padStart(3, "0")}.json`;
    fs.writeFileSync(path.join(outputDir, name), JSON.stringify({ fields: ADDRESS_FIELDS, parcels: records }));
    files.push(`address-search/${name}`);
    records = [];
  };
  for await (const line of input) {
    if (!line) continue;
    records.push(JSON.parse(line));
    if (records.length >= MAX_RECORDS_PER_FILE) flush();
  }
  flush();
  return files;
}

async function buildCounty(entry) {
  const manifestPath = path.join(root, entry.manifestPath);
  if (!fs.existsSync(manifestPath)) throw new Error(`${entry.countyId}: parcel manifest missing`);
  const serviceDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outputDir = path.join(serviceDir, "address-search");
  const tempDir = path.join(outputDir, ".build");
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const counts = new Map();
  let indexedParcelCount = 0;
  let sourceRecordCount = 0;

  for (const chunk of manifest.chunks || []) {
    const payload = JSON.parse(fs.readFileSync(path.join(serviceDir, chunk.file), "utf8"));
    const grouped = new Map();
    for (const record of payload.parcels || []) {
      sourceRecordCount += 1;
      const address = String(record.address || record.propertyAddress || "").trim();
      if (!address) continue;
      indexedParcelCount += 1;
      const packed = pack(record, chunk.id);
      for (const key of shardKeys(record)) {
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(packed);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    for (const [key, records] of grouped) {
      fs.appendFileSync(path.join(tempDir, `${key}.ndjson`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    }
  }

  const files = {};
  for (const name of fs.readdirSync(tempDir).sort()) {
    if (!name.endsWith(".ndjson")) continue;
    const key = name.slice(0, -7);
    const parts = await writeJsonParts(path.join(tempDir, name), outputDir, key);
    files[key] = parts.length === 1 ? parts[0] : parts;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  manifest.addressSearchIndexShards = {
    schemaVersion: "wr-address-search-shards-v1",
    keyLength: KEY_LENGTH,
    fields: ADDRESS_FIELDS,
    files,
    counts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    sourceRecordCount,
    indexedParcelCount,
    missingAddressCount: sourceRecordCount - indexedParcelCount,
    maximumRecordsPerFile: MAX_RECORDS_PER_FILE,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { countyId: entry.countyId, sourceRecordCount, indexedParcelCount, missingAddressCount: sourceRecordCount - indexedParcelCount, shardCount: Object.keys(files).length, fileCount: Object.values(files).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 1), 0) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.county ? [args.county] : registry.batches[args.batch];
  if (!ids) throw new Error(`Unknown county batch: ${args.batch}`);
  const byId = new Map(registry.counties.map((entry) => [entry.countyId, entry]));
  const results = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) throw new Error(`County is not registered: ${id}`);
    console.log(`Building compact address index for ${id}...`);
    results.push(await buildCounty(entry));
  }
  const outputDir = path.join(root, "output", "fast-parcel-delivery");
  fs.mkdirSync(outputDir, { recursive: true });
  const report = { schemaVersion: "wr-fast-address-index-report-v1", generatedAt: new Date().toISOString(), batch: args.county || args.batch, results };
  fs.writeFileSync(path.join(outputDir, `${args.county || args.batch}-address-index.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
