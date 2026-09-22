const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const sourceUrl = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataAddresses/MapServer/0";
const termsUrl = "https://www.lojic.org/data/liability-statement";
const parcelSearchPath = path.join(root, "output", "jefferson-ky", "jefferson-county-ky-parcel-search-index.json");
const publicDir = path.join(root, "public", "data", "counties", "jefferson-ky", "addresses");
const shardDir = path.join(publicDir, "index-shards");
const reportDir = path.join(root, "output", "jefferson-ky");
const sourceManifestPath = path.join(root, "data", "county-adapters", "louisville", "lojic-address-source-manifest.json");
const pageSize = 2000;
const concurrency = 6;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

async function requestJson(endpoint, params, attempt = 1) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return requestJson(endpoint, params, attempt + 1);
    }
    throw new Error(`LOJIC address request failed ${response.status}: ${text.slice(0, 400)}`);
  }
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(`LOJIC address query error: ${JSON.stringify(payload.error)}`);
  return payload;
}

function normalized(value) {
  return String(value ?? "").trim().toUpperCase();
}

function shardId(parcelId) {
  return crypto.createHash("sha256").update(parcelId).digest("hex").slice(0, 2);
}

async function main() {
  if (!fs.existsSync(parcelSearchPath)) throw new Error(`Required parcel search index missing: ${path.relative(root, parcelSearchPath)}`);
  const parcelSearch = readJson(parcelSearchPath);
  const parcelById = new Map();
  const parcelByLrsn = new Map();
  for (const row of parcelSearch.parcels || []) {
    const [countyParcelId, , accountNum, , gisParcelId, , parcelType] = row;
    if (String(parcelType) !== "0") continue;
    const parcel = { countyParcelId, parcelId: normalized(accountNum), lrsn: normalized(gisParcelId) };
    if (parcel.parcelId && !parcelById.has(parcel.parcelId)) parcelById.set(parcel.parcelId, parcel);
    if (parcel.lrsn && !parcelByLrsn.has(parcel.lrsn)) parcelByLrsn.set(parcel.lrsn, parcel);
  }

  const queryUrl = `${sourceUrl}/query`;
  const countPayload = await requestJson(queryUrl, { where: "1=1", returnCountOnly: true, f: "json" });
  const sourceCount = Number(countPayload.count || 0);
  if (!sourceCount) throw new Error("LOJIC address source returned zero records.");

  const byParcel = new Map();
  let fetchedCount = 0;
  let matchedAddressPointCount = 0;
  let unmatchedAddressPointCount = 0;
  let parcelIdJoinCount = 0;
  let lrsnFallbackJoinCount = 0;
  const offsets = Array.from({ length: Math.ceil(sourceCount / pageSize) }, (_, index) => index * pageSize);
  let cursor = 0;

  async function worker() {
    while (cursor < offsets.length) {
      const offset = offsets[cursor++];
      const payload = await requestJson(queryUrl, {
        where: "1=1",
        outFields: "OBJECTID,FULL_ADDRESS,PARCELID,LRSN,ZONING_CODE,ZONE_NAME,LONGITUDE,LATITUDE",
        returnGeometry: false,
        orderByFields: "OBJECTID",
        resultOffset: offset,
        resultRecordCount: pageSize,
        f: "json",
      });
      const features = payload.features || [];
      fetchedCount += features.length;
      for (const feature of features) {
        const attributes = feature.attributes || {};
        const parcelId = normalized(attributes.PARCELID);
        const lrsn = normalized(attributes.LRSN);
        let parcel = parcelById.get(parcelId);
        if (parcel) parcelIdJoinCount += 1;
        else if (lrsn) {
          parcel = parcelByLrsn.get(lrsn);
          if (parcel) lrsnFallbackJoinCount += 1;
        }
        if (!parcel) {
          unmatchedAddressPointCount += 1;
          continue;
        }
        matchedAddressPointCount += 1;
        const address = String(attributes.FULL_ADDRESS || "").trim();
        let record = byParcel.get(parcel.countyParcelId);
        if (!record) {
          record = {
            countyParcelId: parcel.countyParcelId,
            parcelId: parcel.parcelId,
            lrsn: parcel.lrsn,
            primaryAddress: address,
            addresses: [],
            zoningCode: String(attributes.ZONING_CODE || "").trim(),
            zoneName: String(attributes.ZONE_NAME || "").trim(),
            longitude: Number(attributes.LONGITUDE) || null,
            latitude: Number(attributes.LATITUDE) || null,
          };
          byParcel.set(parcel.countyParcelId, record);
        }
        if (address && !record.addresses.includes(address)) record.addresses.push(address);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (fetchedCount !== sourceCount) throw new Error(`LOJIC address count mismatch: expected ${sourceCount}, fetched ${fetchedCount}.`);

  fs.rmSync(shardDir, { recursive: true, force: true });
  fs.mkdirSync(shardDir, { recursive: true });
  const shards = new Map();
  for (const record of byParcel.values()) {
    record.addresses.sort();
    if (!record.primaryAddress) record.primaryAddress = record.addresses[0] || "";
    const id = shardId(record.parcelId || record.countyParcelId);
    if (!shards.has(id)) shards.set(id, []);
    shards.get(id).push(record);
  }
  const shardFiles = [];
  for (const [id, records] of [...shards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    records.sort((a, b) => a.countyParcelId.localeCompare(b.countyParcelId));
    const relative = `index-shards/${id}.json`;
    writeJson(path.join(publicDir, relative), { schemaVersion: "wr-lojic-address-shard-v1", records });
    shardFiles.push({ id, file: relative, parcelCount: records.length });
  }

  const generatedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: "wr-lojic-address-index-v1",
    generatedAt,
    countyId: "jefferson-ky",
    status: "parcel-index-ready-production-disabled",
    sourceUrl,
    sourceAddressPointCount: sourceCount,
    fetchedAddressPointCount: fetchedCount,
    matchedAddressPointCount,
    unmatchedAddressPointCount,
    parcelIdJoinCount,
    lrsnFallbackJoinCount,
    parcelCountWithAddress: byParcel.size,
    joinKeys: { primary: "LOJIC address PARCELID -> parcel accountNum", fallback: "LOJIC address LRSN -> parcel gisParcelId" },
    shardCount: shardFiles.length,
    shards: shardFiles,
    attribution: "Mapping Data Source: LOJIC",
    productionActivation: false,
  };
  writeJson(path.join(publicDir, "manifest.json"), manifest);

  const sourceManifest = {
    schemaVersion: "wr-lojic-address-source-v1",
    generatedAt,
    countyId: "jefferson-ky",
    sourceName: "Jefferson County KY Address Points",
    sourceUrl,
    termsUrl,
    rightsStatus: "open-data-pddl-terms-verified",
    permittedUses: ["copy", "distribute", "store", "create derivative works", "display", "make available to end users"],
    attribution: "Mapping Data Source: LOJIC",
    fieldsUsed: ["FULL_ADDRESS", "PARCELID", "LRSN", "ZONING_CODE", "ZONE_NAME", "LONGITUDE", "LATITUDE"],
    exactCounts: manifest,
    disclaimer: "LOJIC data is provided as-is; parcel-level use must preserve source lineage and independent verification guidance.",
  };
  writeJson(sourceManifestPath, sourceManifest);

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "address-source-report.md"), `# Jefferson County LOJIC Address Intelligence\n\nGenerated ${generatedAt}.\n\n- Official address points: ${sourceCount.toLocaleString("en-US")}\n- Fetched: ${fetchedCount.toLocaleString("en-US")}\n- Joined address points: ${matchedAddressPointCount.toLocaleString("en-US")}\n- Unmatched address points: ${unmatchedAddressPointCount.toLocaleString("en-US")}\n- Parcels with address intelligence: ${byParcel.size.toLocaleString("en-US")}\n- Primary join: PARCELID -> accountNum\n- Fallback join: LRSN -> gisParcelId\n- Rights: LOJIC open-data PDDL terms verified; attribution preserved.\n- Activation: disabled pending county QC and explicit promotion.\n`);
  writeJson(path.join(reportDir, "address-source-report.json"), manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
