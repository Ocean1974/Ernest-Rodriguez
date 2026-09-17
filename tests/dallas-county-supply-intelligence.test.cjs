const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const artifact = JSON.parse(fs.readFileSync(path.join(root, "output", "dallas-county-supply-intelligence.json"), "utf8"));
const expectedFiles = [
  ["2026-01.pdf", 169373, "831af30ef1f1edbba747d561411fa711ba71ad5d2cabd751fb14961942030f16", 28],
  ["2026-02.pdf", 167472, "6e85ba18a1ea91db7217ed3f95a10eb2ef513d5be4d7f44f5f4a1e598bad988d", 27],
  ["2026-03.pdf", 171906, "b17470f45c98bdafeceebae7c89e3b7c259391548651153de4998f6e73a89722", 31],
  ["2026-04.pdf", 114716, "30f54dd189d5fababa385b1a74a5092bc5473dbb1f12b99233b61360aa68c2cc", 34],
  ["2026-05.pdf", 147192, "625e459f65c20eeaa58c9ca36a3675c459155b3f96e305d117c91d6b3d4bdd1d", 16],
  ["2026-06.pdf", 179402, "bc3aac269fc49ea11dbcf01b34b6e36b3289399dbff54d6f18f2b5849d833b0f", 42],
  ["2026-07.pdf", 150568, "c64e50fd021d3ee74d01dc95e1bb219507249b39470ff8f248072763661116b3", 13],
];

assert.equal(artifact.schemaVersion, "wr-dallas-county-supply-intelligence-v1");
assert.equal(artifact.sourceAuthority, "Dallas County Unincorporated Area Services");
assert.equal(artifact.jurisdictionBoundary.includesAllMunicipalPermits, false);
assert.match(artifact.jurisdictionBoundary.semantics, /do not represent all permits issued by the City of Dallas/i);
assert.equal(artifact.sourceFiles.length, 7);
for (let index = 0; index < expectedFiles.length; index += 1) {
  const [name, bytes, sha256, recordCount] = expectedFiles[index];
  const source = artifact.sourceFiles[index];
  assert(source.path.endsWith(name));
  assert.deepEqual({ bytes: source.bytes, sha256: source.sha256, recordCount: source.recordCount }, { bytes, sha256, recordCount });
  const raw = fs.readFileSync(path.join(root, source.path));
  assert.equal(raw.length, bytes);
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), sha256);
}
assert.deepEqual(artifact.extraction, {
  path: "data/raw/dallas-county-dcad/demand/supply/dallas-county-issued-permits-2026-ytd.extracted.json",
  bytes: 163336,
  sha256: "6de26d7b0ff51f77e958cb5c3e59f8d5ca98e8a7ea8b9b76ba6a8a8793602697",
  sourceFileCount: 7,
  recordCount: 191,
  uniquePermitNumberCount: 190,
  duplicatePermitNumberCount: 1,
  uniquePermitEventCount: 191,
  duplicatePermitEventCount: 0,
  rejectedRowCount: 0,
});
assert.deepEqual(artifact.exactSupplySummary, {
  issuedPermitEvents: 191,
  commercialPermitEvents: 110,
  residentialPermitEvents: 80,
  unclassifiedPermitEvents: 1,
  newCommercialBuildingPermitEvents: 23,
  residentialNoticeOfConstructionEvents: 73,
  firstIssuedDate: "2026-01-05",
  lastIssuedDate: "2026-07-30",
});
assert.deepEqual(artifact.monthlyCounts, { "2026-01": 28, "2026-02": 27, "2026-03": 31, "2026-04": 34, "2026-05": 16, "2026-06": 42, "2026-07": 13 });
assert.equal(artifact.records.length, 191);
assert(artifact.records.every((record) => record.sourceFile && record.sourcePage > 0 && record.sourceRow > 0));
assert.equal(new Set(artifact.records.map((record) => `${record.permitNumber}:${record.issuedDate}`)).size, 191);
assert.equal(artifact.activation.sourceContentPersisted, true);
assert.equal(artifact.activation.municipalCoverageComplete, false);
assert.equal(artifact.activation.parcelAttributionBuilt, false);
assert.equal(artifact.activation.visibleUiActivated, false);
console.log("White Rabbit Dallas County-issued permit PDF lineage, extraction, scope, and activation-boundary tests passed.");
