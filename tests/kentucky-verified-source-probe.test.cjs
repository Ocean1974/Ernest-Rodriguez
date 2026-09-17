const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "kentucky-county-source-registry.json"), "utf8"));
const script = fs.readFileSync(path.join(root, "scripts", "probe-kentucky-county-sources.cjs"), "utf8");

assert.equal(registry.schemaVersion, "wr-kentucky-county-source-registry-v1");
assert.equal(registry.sources.length, 7, "The first Kentucky wave must contain the seven verified sources");
assert.equal(new Set(registry.sources.map((source) => source.countyId)).size, registry.sources.length, "County ids must be unique");
assert.equal(new Set(registry.sources.map((source) => source.countyFips)).size, registry.sources.length, "County FIPS values must be unique");
for (const source of registry.sources) {
  assert.match(source.countyFips, /^21\d{3}$/);
  assert.match(source.sourceUrl, /^https:\/\//);
  assert(source.identityCandidates.length > 0);
  assert.match(source.rightsStatus, /review-required/);
}
assert(script.includes("mapConcurrent"), "Probe must use bounded concurrent work");
assert(script.includes("--concurrency must be an integer from 1 through 8"), "Probe must cap concurrency");
assert(script.includes("returnCountOnly"), "Probe must obtain exact source counts");
assert(script.includes("captureAuthorized: false"), "Probe must fail closed before rights evidence exists");
assert(script.includes("identityUniqueness: \"unverified-until-full-identity-audit\""), "Probe must not claim uniqueness from a sample");

const reportPath = path.join(root, "output", "kentucky-source-audit", "kentucky-verified-source-probe.json");
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.summary.attempted, 7);
  assert.equal(report.productionActivationAuthorized, false);
  assert.equal(report.uiChanged, false);
  for (const county of report.counties.filter((item) => item.status === "official-source-probed")) {
    assert(Number.isSafeInteger(county.exactFeatureCount));
    assert(county.exactFeatureCount >= 0);
    assert.equal(county.captureAuthorized, false);
    assert.match(county.responseEvidence.metadata.sha256, /^[a-f0-9]{64}$/);
    assert.match(county.responseEvidence.count.sha256, /^[a-f0-9]{64}$/);
  }
}

console.log("White Rabbit Kentucky bounded source registry and fail-closed official endpoint probe tests passed.");
