const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const manifest = readJson("public/data/counties/harris-county-tx/permits/manifest.json");
const report = readJson("output/harris-county-tx/harris-permit-report.json");
const adapter = readJson("data/county-adapters/harris-county-tx/adapter.json");
const unmatched = readJson("output/harris-county-tx/harris-permits-unmatched.json");
const ambiguous = readJson("output/harris-county-tx/harris-permits-ambiguous.json");
const permitLayer = adapter.optionalLayers.find((layer) => layer.id === "permits");

assert(manifest.schemaVersion === "wr-harris-permit-index-v1", "Harris permit index must use the stable schema");
assert(manifest.status === "ready-historical-2024-refresh-required", "Harris permits must retain the historical freshness warning");
assert(manifest.counts.sourcePermitRecords === 8706, "Harris permit source count must reconcile all three official workbooks");
assert(manifest.counts.permitRowsJoined === 6574, "Harris exact unique-address join count must remain locked");
assert(manifest.counts.permitRowsUnmatched === 1656, "Harris unmatched permit count must remain visible");
assert(manifest.counts.permitRowsAmbiguous === 476, "Harris ambiguous permit count must remain quarantined");
assert(manifest.counts.parcelsWithPermits === 5608, "Harris parcel coverage count must remain locked");
assert(manifest.counts.parcelRecordsScanned === 1535522, "Harris permit join must scan the full emitted parcel service");
assert(unmatched.length === manifest.counts.permitRowsUnmatched, "Unmatched QA rows must reconcile");
assert(ambiguous.length === manifest.counts.permitRowsAmbiguous, "Ambiguous QA rows must reconcile");
assert(manifest.shards.reduce((sum, shard) => sum + shard.permitCount, 0) === manifest.counts.permitRowsJoined, "Permit shards must reconcile to joined rows");
assert(manifest.shards.reduce((sum, shard) => sum + shard.parcelCount, 0) === manifest.counts.parcelsWithPermits, "Permit shards must reconcile to covered parcels");
assert(manifest.sourceFiles.every((source) => source.sha256 && source.rows > 0), "Every official workbook must retain a checksum and row count");
assert(manifest.joinKey.includes("unique exact normalized situs address"), "Permit join must disclose its exact conservative key");
assert(manifest.freshnessWarning.includes("2025") && manifest.freshnessWarning.includes("404"), "Permit freshness limitation must remain explicit");
assert(permitLayer.status === "ready-historical-2024-refresh-required", "Adapter must expose historical permit readiness without claiming current coverage");
assert(adapter.verifiedCounts.permitRowsJoined === report.counts.permitRowsJoined, "Adapter and report join counts must reconcile");
assert(!adapter.activation.excludedUntilCertified.includes("permits-certificates") || permitLayer.status.includes("refresh-required"), "Any activation exclusion must remain compatible with the refresh gate");

console.log("White Rabbit Harris permit intelligence tests passed.");
