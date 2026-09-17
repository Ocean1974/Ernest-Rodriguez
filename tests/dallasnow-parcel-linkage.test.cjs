const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  addressEvidence,
  normalizeTokens,
  searchShardKey,
  selectParcelCandidates,
} = require("../scripts/dallasnow-parcel-linkage-utils.cjs");

const root = path.join(__dirname, "..");
const artifactFile = path.join(root, "output", "dallas-city-building-parcel-linkage.json");
const sourceFile = path.join(root, "output", "dallas-city-building-supply-intelligence.json");
const artifact = JSON.parse(fs.readFileSync(artifactFile, "utf8"));
const sourceBytes = fs.readFileSync(sourceFile);

assert.equal(normalizeTokens("5151 Belt Line Road"), "5151 BELT LINE RD");
assert.equal(normalizeTokens("8411 W Preston Rd RD"), "8411 W PRESTON RD");
assert.deepEqual(addressEvidence("8144 WALNUT HILL LN, 750, Dallas TX 75231"), {
  rawAddress: "8144 WALNUT HILL LN, 750, Dallas TX 75231",
  valid: true,
  reason: "",
  primaryAddress: "8144 WALNUT HILL LN",
  normalizedBase: "8144 WALNUT HILL LN",
  normalizedWithUnit: "8144 WALNUT HILL LN UNIT 750",
  unit: "750",
});
assert.equal(addressEvidence("3500 Gaston Avenue STE 500").normalizedWithUnit, "3500 GASTON AVE UNIT 500");
assert.equal(addressEvidence("8411 8411 La Prada DR, Dallas TX 75228 United States").reason, "duplicated-street-number");
assert.equal(addressEvidence("United States").valid, false);
assert.equal(addressEvidence("").reason, "missing-address");
assert.equal(searchShardKey(addressEvidence("2 SPINNAKER COVE, Dallas TX 75088")), "2s");

const sourceEvidence = addressEvidence("100 Main Street, 200, Dallas TX 75201");
const candidate = (accountNum, address) => ({ accountNum, address, addressEvidence: addressEvidence(address) });
assert.equal(selectParcelCandidates(sourceEvidence, []).partition, "unmatched");
assert.equal(selectParcelCandidates(sourceEvidence, [candidate("1", "100 MAIN ST")]).partition, "exact");
assert.equal(selectParcelCandidates(sourceEvidence, [candidate("1", "100 MAIN ST"), candidate("2", "100 MAIN ST")]).partition, "ambiguous");
assert.deepEqual(
  selectParcelCandidates(sourceEvidence, [candidate("1", "100 MAIN ST STE 100"), candidate("2", "100 MAIN ST STE 200")]),
  { partition: "exact", matchMethod: "normalized-address-and-unit", candidates: [candidate("2", "100 MAIN ST STE 200")] },
);

assert.equal(artifact.schemaVersion, "wr-dallasnow-dcad-parcel-linkage-v1");
assert.equal(artifact.sourceArtifactSha256, crypto.createHash("sha256").update(sourceBytes).digest("hex"));
assert.equal(artifact.sourceCountyId, "dallas-county-dcad");
assert.deepEqual(artifact.exactSummary, {
  sourceRecordCount: 1746,
  uniqueSourceRecordNumberCount: 1746,
  sourceRecordWithAddressCount: 1706,
  distinctSourceAddressCount: 1483,
  validNormalizedRecordCount: 1697,
  normalizedAddressGroupCount: 1404,
  loadedSearchShardCount: 92,
  loadedSearchShardBytes: 430366925,
  exactLinkedRecordCount: 1227,
  ambiguousRecordCount: 70,
  unmatchedRecordCount: 400,
  invalidRecordCount: 49,
  partitionTotal: 1746,
  uniqueExactParcelCount: 1061,
});
assert.equal(artifact.recordLinks.length, 1746);
assert.equal(new Set(artifact.recordLinks.map((link) => link.recordNumber)).size, 1746);
assert.equal(
  ["exact", "ambiguous", "unmatched", "invalid"].reduce((sum, partition) => sum + artifact.recordLinks.filter((link) => link.partition === partition).length, 0),
  artifact.recordLinks.length,
);
assert(artifact.recordLinks.filter((link) => link.partition === "exact").every((link) => link.candidateCount === 1 && link.exactParcel?.accountNum));
assert(artifact.recordLinks.filter((link) => link.partition === "ambiguous").every((link) => link.candidateCount > 1 && link.exactParcel === null));
assert(artifact.recordLinks.filter((link) => link.partition === "unmatched").every((link) => link.candidateCount === 0 && link.exactParcel === null));
assert(artifact.recordLinks.filter((link) => link.partition === "invalid").every((link) => link.invalidReason && link.exactParcel === null));
for (const group of artifact.addressGroups) {
  assert.equal(group.candidateCount, group.candidates.length);
  assert.equal(new Set(group.candidates.map((candidate) => candidate.parcelKey)).size, group.candidates.length);
  assert(group.candidates.every((candidate) => addressEvidence(candidate.address).normalizedBase === group.normalizedBase));
}
assert.equal(artifact.certification.duplicateAddressesPreservedAsAmbiguous, true);
assert.equal(artifact.certification.exactParcelLinksCertified, true);
assert.equal(artifact.certification.visibleUiActivated, false);
assert.equal(artifact.certification.lockedUiChanged, false);
assert.match(artifact.activationPolicy, /Only recordLinks with partition=exact/);
assert(artifact.joinContract.prohibitedInference.includes("first-candidate selection"));
assert.match(artifact.joinContract.coordinateSemantics, /not longitude\/latitude/);

console.log("White Rabbit DallasNow-to-DCAD deterministic linkage, duplicate-address ambiguity, reconciliation, and activation-gate tests passed.");
