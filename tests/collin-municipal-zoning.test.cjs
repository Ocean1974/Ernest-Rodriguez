const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const manifest = readJson("public/data/counties/collin-county-tx/zoning/manifest.json");
const parcelManifest = readJson("public/data/counties/collin-county-tx/parcels/manifest.json");
const appSource = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");

assert(manifest.status === "parcel-index-ready-partial-municipal-coverage", "Collin zoning must disclose partial municipal coverage");
assert(manifest.parcelServiceCount === parcelManifest.featureCount, "Zoning build must reconcile to the live parcel refresh");
assert(manifest.parcelIndexCount > 0 && manifest.parcelIndexCount <= manifest.parcelServiceCount, "Zoning matches must be bounded by the parcel service");
assert(manifest.sources.length >= 11, "Expected at least eleven official municipal zoning sources");
assert(manifest.sources.every((source) => source.rightsStatus === "official-public-municipal-gis-derived-index"), "Every zoning source must retain official lineage");
assert(Object.values(manifest.parcelIndexShards.counts).reduce((sum, value) => sum + value, 0) === manifest.parcelIndexCount, "Zoning shards must reconcile");
assert(manifest.uncoveredJurisdictions.includes("Celina"), "Unverified municipal coverage must remain explicit");
assert(appSource.includes("const parcelLookupId = parcelStableAccountId(selectedParcel || {}) || selectedParcelAccount;"), "Focused parcel zoning must query the appraisal account before the county-aware geometry UUID");

const account = "1722354";
const key = account.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, manifest.parcelIndexShards.keyLength);
const shard = readJson(`public/data/counties/collin-county-tx/zoning/${manifest.parcelIndexShards.files[key]}`);
const accountIndex = shard.fields.indexOf("accountNum");
const labelIndex = shard.fields.indexOf("label");
const sourceIdsIndex = shard.fields.indexOf("sourceLayerIds");
const record = shard.records.find((row) => String(row[accountIndex]) === account);
assert(record, "Known Plano parcel 1722354 must have a municipal zoning match");
assert(String(record[labelIndex] || "").trim(), "Known Plano parcel must have a zoning district label");
assert((record[sourceIdsIndex] || []).includes("plano-zoning"), "Known Plano parcel must retain Plano source lineage");

console.log("White Rabbit Collin municipal zoning tests passed.");
