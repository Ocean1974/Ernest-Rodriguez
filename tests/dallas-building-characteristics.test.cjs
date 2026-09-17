const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifestFile = path.join(root, "public", "data", "building-characteristics", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

assert.equal(manifest.schemaVersion, "wr-dcad-building-characteristics-service-v1");
assert.equal(manifest.sourceCountyId, "dallas-county-dcad");
assert.equal(manifest.sourceVersion, "DCAD2026_CURRENT");
assert.equal(manifest.status, "verified-staged-default-off");
assert.equal(manifest.keyField, "ACCOUNT_NUM");
assert.equal(manifest.sourceIdentityField, "TAX_OBJ_ID");
assert.match(manifest.conservativeYearBuiltRule, /newest valid construction year/);
assert.deepEqual(manifest.exactSummary, {
  sourceRowCount: 775216,
  validSourceIdentityCount: 775216,
  duplicateSourceIdentityCount: 0,
  uniqueAccountCount: 759193,
  accountWithYearCount: 690462,
  accountWithoutYearCount: 68731,
  multiBuildingAccountCount: 9661,
  multiYearAccountCount: 6023,
  residentialAccountCount: 682954,
  commercialAccountCount: 76239,
  mixedSourceAccountCount: 0,
  shardKeyCount: 36,
  pageCount: 402,
  maximumPageBytes: 758552,
});
assert.deepEqual(manifest.sources.map((source) => ({ file: source.file, rowCount: source.rowCount, validYearCount: source.validYearCount, duplicateIdentityCount: source.duplicateIdentityCount, sha256: source.sha256 })), [
  { file: "data/extracted/DCAD2026_CURRENT/RES_DETAIL.CSV", rowCount: 683070, validYearCount: 648310, duplicateIdentityCount: 0, sha256: "44068142cd6056f6294dc7b925d8c2a897e331e24c7b826f157ddf61afe9133c" },
  { file: "data/extracted/DCAD2026_CURRENT/COM_DETAIL.CSV", rowCount: 92146, validYearCount: 58127, duplicateIdentityCount: 0, sha256: "c0f2db326df76d771899b0086634f6d1eb6826d8fd224cd5c7432454f875f0d8" },
]);
for (const source of manifest.sources) {
  const bytes = fs.readFileSync(path.join(root, source.file));
  assert.equal(bytes.length, source.bytes);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), source.sha256);
  assert.equal(source.identityUnique, true);
}

const accounts = new Set();
let recordCount = 0;
let accountWithYearCount = 0;
let multiBuildingAccountCount = 0;
let multiYearAccountCount = 0;
let pageCount = 0;
for (const shard of Object.values(manifest.shards)) {
  assert.equal(shard.count, shard.pages.reduce((sum, page) => sum + page.count, 0));
  for (const page of shard.pages) {
    pageCount += 1;
    const file = path.join(root, "public", "data", "building-characteristics", page.file);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, page.bytes);
    assert(page.bytes <= manifest.maximumPageBytes);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), page.sha256);
    const payload = JSON.parse(bytes.toString("utf8"));
    assert.equal(payload.schemaVersion, "wr-dcad-building-characteristics-page-v1");
    assert.equal(payload.records.length, page.count);
    for (const record of payload.records) {
      assert(!accounts.has(record.accountNum), `Duplicate building-characteristics account ${record.accountNum}`);
      accounts.add(record.accountNum);
      recordCount += 1;
      assert.equal(record.conservativeYearBuilt, record.newestYearBuilt);
      if (record.conservativeYearBuilt !== null) {
        accountWithYearCount += 1;
        assert(record.oldestYearBuilt <= record.newestYearBuilt);
        assert(record.oldestYearBuilt >= 1800 && record.newestYearBuilt <= 2026);
      }
      if (record.buildingRecordCount > 1) multiBuildingAccountCount += 1;
      if (record.distinctYearCount > 1) multiYearAccountCount += 1;
      assert.equal(record.buildingRecordCount, record.residentialRecordCount + record.commercialRecordCount);
    }
  }
}
assert.equal(pageCount, manifest.pageCount);
assert.equal(recordCount, manifest.recordCount);
assert.equal(accounts.size, manifest.exactSummary.uniqueAccountCount);
assert.equal(accountWithYearCount, manifest.exactSummary.accountWithYearCount);
assert.equal(multiBuildingAccountCount, manifest.exactSummary.multiBuildingAccountCount);
assert.equal(multiYearAccountCount, manifest.exactSummary.multiYearAccountCount);
assert.equal(manifest.activation.defaultVisible, false);
assert.equal(manifest.activation.publicRuntimeActivated, false);
assert.equal(manifest.activation.pageDesignChanged, false);
assert.equal(manifest.activation.earthImageryChanged, false);

console.log("White Rabbit DCAD building-characteristics source identity, conservative construction-year, sharding, and activation tests passed.");
