const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const captureRoot = path.join(root, "data", "raw", "aransas-county-tx", "official-2026-09-12");
const manifest = JSON.parse(fs.readFileSync(path.join(captureRoot, "capture-manifest.json"), "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

assert.equal(manifest.countyId, "aransas-county-tx");
assert.equal(manifest.activationAuthorized, false, "A source capture must not activate Aransas County");
assert.equal(manifest.counts.appraisalInfoRows, 29964, "Certified appraisal row count must remain exact");
assert.equal(manifest.counts.agentOwnerRows, 47608, "Certified owner/agent row count must remain exact");
assert.equal(manifest.geometry.status, "not-captured", "Parcel geometry must remain explicitly gated");
assert.deepEqual(manifest.extraction.zeroByteFiles, ["2026-07-20_000723_APPRAISAL_UDI.TXT"]);

for (const item of manifest.files) {
  const file = path.join(captureRoot, item.file);
  assert(fs.existsSync(file), `${item.file} must exist`);
  assert.equal(fs.statSync(file).size, item.bytes, `${item.file} byte count must match`);
  assert.equal(sha256(file), item.sha256, `${item.file} SHA-256 must match`);
}

console.log("Real Estate Savant Aransas County official source capture tests passed.");
