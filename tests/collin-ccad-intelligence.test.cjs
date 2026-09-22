const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "public", "data", "counties", "collin-county-tx", "intelligence", "manifest.json");
const reportPath = path.join(root, "output", "collin-county-tx", "ccad-intelligence-report.json");
const adapterPath = path.join(root, "data", "county-adapters", "collin-county-tx", "adapter.json");
const pipelinePath = path.join(root, "data", "county-adapters", "collin-county-tx", "pipeline.json");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(fs.existsSync(manifestPath), "Collin CCAD intelligence manifest must exist");
assert(fs.existsSync(reportPath), "Collin CCAD intelligence report must exist");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const adapter = JSON.parse(fs.readFileSync(adapterPath, "utf8"));
const pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf8"));
assert(manifest.schemaVersion === "wr-collin-ccad-intelligence-v1", "Collin intelligence schema version must be locked");
assert(manifest.sourceCountyId === "collin-county-tx", "Collin intelligence county scope must be explicit");
assert(manifest.status === "verified-refresh-candidate-not-activated", "Refresh must remain activation gated");
assert(manifest.activationAuthorized === false, "Local CCAD refresh must not silently activate the UI");
assert(manifest.identity.joinKey === "GlobalID", "GlobalID must remain the parcel-intelligence join key");
assert(manifest.identity.scope.includes("not stable across CCAD republish"), "GlobalID must be documented as refresh-scoped");
assert(manifest.identity.recordCount === 441278, "CCAD refresh record count must remain exact");
assert(manifest.identity.globalIdNonblank === 441278, "Every CCAD refresh row must have GlobalID");
assert(manifest.identity.globalIdDuplicates === 0 && manifest.identity.globalIdUnique === true, "GlobalID must remain duplicate-safe");
assert(manifest.source.fieldCount === 114, "CCAD refresh field count must remain exact");
assert(manifest.source.workbookEvidence?.headerMatchesCsv === true, "XLSX and CSV schemas must match");
assert(manifest.delivery.recordCount === manifest.identity.recordCount, "Every source row must be delivered to an intelligence shard");
assert(manifest.delivery.shardCount === 256, "GlobalID intelligence delivery must contain all 256 hexadecimal shards");
assert(manifest.coverage.ownerName.count > 400000, "Owner coverage must be measured from source values");
assert(manifest.coverage.situsAddress.count > 400000, "Situs coverage must be measured from source values");
assert(manifest.truthBoundary.some((item) => item.includes("does not replace")), "Refresh must retain the no-activation truth boundary");
assert(manifest.existingParcelServiceComparison.matchedGlobalIdCount === 0, "Current CCAD GlobalIDs must not be falsely joined to the previous parcel-service refresh");
assert(manifest.existingParcelServiceComparison.activationBlocker === true, "Zero cross-refresh GlobalID overlap must block activation");
assert(JSON.stringify(report) === JSON.stringify(manifest), "Output report and public manifest must reconcile exactly");
const adapterLayer = adapter.optionalLayers.find((layer) => layer.id === "ccad-local-intelligence-refresh");
assert(adapterLayer?.status === "geometry-and-intelligence-aligned-awaiting-service-rebuild-and-qc", "County adapter must register the reconciled but gated CCAD refresh");
assert(adapterLayer?.defaultVisible === false, "CCAD refresh must remain invisible until activation gates pass");
const pipelineStep = pipeline.steps.find((step) => step.id === "build-ccad-local-intelligence");
assert(pipelineStep?.command === "npm.cmd run collin:ccad:intelligence", "County pipeline must reproduce the local CCAD intelligence build");
assert(pipelineStep?.activationGate?.includes("zero overlap"), "County pipeline must preserve the cross-refresh identity blocker");

let shardTotal = 0;
for (const [key, shard] of Object.entries(manifest.delivery.shards)) {
  assert(/^[0-9a-f]{2}$/.test(key), `Invalid shard key ${key}`);
  const shardPath = path.join(root, "public", "data", "counties", "collin-county-tx", "intelligence", shard.file);
  assert(fs.existsSync(shardPath), `Missing shard ${shard.file}`);
  const lines = fs.readFileSync(shardPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert(lines.length === shard.count, `Shard ${key} count must match its manifest`);
  for (const line of lines.slice(0, 3)) {
    const record = JSON.parse(line);
    assert(record.globalId?.startsWith(key), `Shard ${key} contains a record with the wrong GlobalID prefix`);
    assert(!("ownerPhone" in (record.owner || {})) && !("ownerEmail" in (record.owner || {})), "Unverified owner contacts must not be inferred");
  }
  shardTotal += lines.length;
}
assert(shardTotal === manifest.delivery.recordCount, "Shard record counts must reconcile to the manifest");

console.log("Collin CCAD local parcel-intelligence tests passed.");
