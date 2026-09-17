const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
const artifact = JSON.parse(fs.readFileSync(path.join(root, "output", "dallas-city-building-supply-intelligence.json"), "utf8"));

assert.equal(artifact.schemaVersion, "wr-dallas-city-building-supply-intelligence-v1");
assert.equal(artifact.sourceAuthority, "City of Dallas Planning and Development");
assert.equal(artifact.sourceSystem, "DallasNow (Accela Citizen Access)");
assert.deepEqual(artifact.query.startDate, "2026-08-01");
assert.deepEqual(artifact.query.endDate, "2026-08-24");
assert.equal(artifact.query.selectedRecordTypes.length, 19);
assert.deepEqual(artifact.jurisdictionBoundary, { geographyLevel: "place", geographyId: "16000US4819000", coverage: "city-of-dallas-building-module-selected-record-types", includesAllDallasCountyMunicipalities: false, includesAllBuildingRecordTypes: false });
assert.deepEqual(artifact.exactSummary, { recordCount: 1746, uniqueRecordNumberCount: 1746, duplicateRecordNumberCount: 0, sourcePageCount: 193, sourceResponseBytes: 90160851, sourceStoredBytes: 37470564, partitionCount: 35, queryCount: 51, cappedQueryCount: 16 });
assert.equal(artifact.combinedSnapshotSha256, "c1c8169a4647d3369cc1b9be3c8e3e937f4826b50f7219e3919d7bc1e3c05ef7");
assert.equal(artifact.records.length, 1746);
assert.equal(new Set(artifact.records.map((record) => record.recordNumber)).size, 1746);
assert.equal(artifact.partitions.reduce((sum, partition) => sum + partition.exactRecordCount, 0), 1746);
assert(artifact.partitions.every((partition) => partition.exactRecordCount < 100));
assert.equal(artifact.typeCounts["Certificate of Occupancy"], 529);
assert.equal(artifact.typeCounts["Commercial New Construction Permit"], 27);
assert.equal(artifact.typeCounts["Residential New Construction Permit"], 142);
assert.equal(artifact.typeCounts["Commercial Alteration Addition Permit"], 195);
assert.equal(artifact.typeCounts["Residential Alteration Addition Permit"], 162);
assert.equal(artifact.typeCounts["Commercial Demolition Permit"] + artifact.typeCounts["Residential Demolition Permit"], 109);
assert.equal(artifact.typeCounts["Commercial Pool/Spa Permit"] || 0, 0);
assert(artifact.records.every((record) => record.recordDate >= "2026-08-01" && record.recordDate <= "2026-08-24"));
assert(artifact.records.every((record) => !String(record.status).includes("Renewal:")));
assert.equal(artifact.sourcePages.length, 193);
assert.equal(new Set(artifact.sourcePages.map((page) => page.path)).size, 193);
for (const page of artifact.sourcePages) {
  const compressed = fs.readFileSync(path.join(root, page.path));
  assert.equal(compressed.length, page.storedBytes);
  const raw = zlib.gunzipSync(compressed);
  assert.equal(raw.length, page.responseBytes);
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), page.responseSha256);
}
assert.equal(artifact.activation.sourceContentPersisted, true);
assert.equal(artifact.activation.sourceIdentityUnique, true);
assert.equal(artifact.activation.rightsReviewCertified, false);
assert.equal(artifact.activation.parcelAddressJoinCertified, false);
assert.equal(artifact.activation.visibleUiActivated, false);
assert(artifact.blockers.some((blocker) => /not be described as permit issuance dates/i.test(blocker)));
console.log("White Rabbit City of Dallas DallasNow exact partition, raw lineage, place scope, and no-issuance-overclaim tests passed.");
require("./dallasnow-parcel-linkage.test.cjs");
