const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
execFileSync("node", ["scripts/build-master-program-manifest.cjs"], { cwd: root, stdio: "pipe" });
const manifest = JSON.parse(fs.readFileSync(path.join(root, "output", "program", "master-program-manifest.json"), "utf8"));
const sourceAudit = JSON.parse(fs.readFileSync(path.join(root, manifest.sourceAudit), "utf8"));

assert.equal(manifest.schemaVersion, "wr-master-program-manifest-v1");
assert.equal(manifest.summary.featureCapabilityCount, 10);
assert.equal(manifest.summary.nationalCountyEquivalentCount, 3235);
assert.equal(manifest.summary.nationalStateAreaCount, 57);
assert.equal(manifest.summary.immediateCountyCount, 3);
assert.equal(manifest.summary.immediateCountiesWithSourcesIdentified, 3);
assert.equal(manifest.summary.immediateCountiesRightsVerified, 0);
assert.equal(manifest.summary.immediateCountiesLive, 0);
assert.equal(manifest.summary.featureCapabilitiesLive, 0);
assert.equal(manifest.integrationMatrix.length, 8);
assert.equal(manifest.visibleUiChanged, false);
assert(manifest.featureChecklist.every((item) => item.activationAuthorized === false));
assert(manifest.countyChecklist.every((item) => item.gates.scaffoldPresent && item.gates.officialSourcesIdentified));
assert(manifest.countyChecklist.every((item) => !item.gates.rightsVerified && !item.gates.joinKeysVerified && !item.gates.live));
assert.equal(sourceAudit.counties.length, 3);
const montgomery = sourceAudit.counties.find((county) => county.countyId === "montgomery-county-tx");
assert.equal(montgomery.observedParcelCount, 276557);
assert.equal(montgomery.observedCountCertified, false);
assert(montgomery.sources.some((source) => source.url.includes("cityofconroe.org")));
assert(sourceAudit.policy.includes("does not certify"));

console.log("White Rabbit master program manifest tests passed.");
