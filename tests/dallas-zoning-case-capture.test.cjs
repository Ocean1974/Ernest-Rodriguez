const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const report = readJson("output/dallas-current-zoning-case-intelligence.json");
const manifest = readJson("public/data/entitlements/manifest.json");
const casesFile = path.join(root, "public/data/entitlements", manifest.cases.path);
const casesBytes = fs.readFileSync(casesFile);
const publishedCases = JSON.parse(casesBytes);

assert.equal(report.schemaVersion, "wr-dallas-current-zoning-case-intelligence-v1");
assert.equal(manifest.schemaVersion, "wr-dallas-current-zoning-case-service-v1");
assert.equal(report.sourceCountyId, "dallas-county-dcad");
assert.equal(report.sourceLayerObjectIdField, "OBJECTID");
assert.equal(report.sourceLayerGeometryType, "esriGeometryPolygon");
assert.equal(manifest.publicRuntimeActivated, false);
assert.equal(manifest.featureGateEnabled, false);
assert.deepEqual(manifest.exactSummary, report.exactSummary);

assert.equal(report.exactSummary.sourceRecordCount, report.cases.length);
assert.equal(report.exactSummary.uniqueObjectIdCount, new Set(report.cases.map((item) => item.objectId)).size);
assert.equal(report.exactSummary.uniqueCaseNumberCount, new Set(report.cases.map((item) => item.caseNumber)).size);
assert.equal(report.exactSummary.linkedCaseCount + report.exactSummary.unmatchedCaseCount, report.exactSummary.sourceRecordCount);
assert.equal(report.exactSummary.validGeometryCount + report.exactSummary.invalidGeometryCount, report.exactSummary.sourceRecordCount);
assert.equal(Object.values(report.categoryCounts).reduce((sum, count) => sum + count, 0), report.exactSummary.sourceRecordCount);

for (const snapshot of report.sourceSnapshots) {
  const bytes = fs.readFileSync(path.join(root, snapshot.path));
  assert.equal(bytes.length, snapshot.bytes, `${snapshot.role} snapshot byte count must reconcile`);
  assert.equal(sha256(bytes), snapshot.sha256, `${snapshot.role} snapshot hash must reconcile`);
}

const countSnapshot = readJson(report.sourceSnapshots.find((item) => item.role === "count").path);
const featureSnapshot = readJson(report.sourceSnapshots.find((item) => item.role === "features").path);
assert.equal(countSnapshot.count, report.exactSummary.sourceRecordCount);
assert.equal(featureSnapshot.features.length, report.exactSummary.sourceRecordCount);

assert.equal(casesBytes.length, manifest.cases.bytes);
assert.equal(sha256(casesBytes), manifest.cases.sha256);
assert.equal(publishedCases.records.length, manifest.cases.count);
assert.equal(publishedCases.records.reduce((sum, item) => sum + item.parcelLinkCount, 0), report.exactSummary.parcelMembershipCount);

const parcelRecords = [];
for (const shard of Object.values(manifest.parcelIndexShards)) {
  assert.equal(shard.pages.reduce((sum, page) => sum + page.count, 0), shard.count);
  for (const page of shard.pages) {
    const bytes = fs.readFileSync(path.join(root, "public/data/entitlements", page.file));
    assert.equal(bytes.length, page.bytes, `${page.file} byte count must reconcile`);
    assert.equal(sha256(bytes), page.sha256, `${page.file} hash must reconcile`);
    const payload = JSON.parse(bytes);
    assert.equal(payload.records.length, page.count);
    parcelRecords.push(...payload.records);
  }
}

assert.equal(parcelRecords.length, report.exactSummary.uniqueLinkedParcelCount);
assert.equal(new Set(parcelRecords.map((item) => item.accountNum)).size, report.exactSummary.uniqueLinkedParcelCount);
assert.equal(parcelRecords.reduce((sum, item) => sum + item.cases.length, 0), report.exactSummary.parcelMembershipCount);
assert(report.blockers.some((item) => /reuse-rights/i.test(item)));
assert.equal(report.activation.publicRuntimeActivated, false);

console.log("Dallas current zoning-case capture reconciliation tests passed.");
