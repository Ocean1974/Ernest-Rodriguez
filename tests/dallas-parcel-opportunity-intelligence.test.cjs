const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "output", "dallas-parcel-opportunity-intelligence.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "data", "opportunities", "manifest.json"), "utf8"));

assert.equal(report.schemaVersion, "wr-dallas-parcel-opportunity-intelligence-v1");
assert.equal(report.sourceCountyId, "dallas-county-dcad");
assert.equal(report.status, "verified-staged-default-off");
assert.deepEqual(report.exactSummary, {
  sourceParcelFeatureCount: 696601,
  uniqueAccountNumberCount: 696008,
  duplicateAccountNumberCount: 98,
  duplicateFeatureExcessCount: 593,
  conflictingOpportunityEvidenceAccountCount: 21,
  scoredUniqueAccountCount: 695987,
  parcelChunkCount: 1614,
  activeDevelopmentParcelCount: 24950,
  activeDevelopmentEarliestActivityDate: "2018-01-02",
  activeDevelopmentLatestActivityDate: "2022-11-15",
  activeDevelopmentWithin730DaysCount: 0,
  currentDallasNowExactLinkedRecordCount: 1227,
  currentDallasNowClassifiedSignalsStagedOutsideRuntime: 777,
  mediumOrHighCandidateCount: 3592,
  selectedCandidateCount: 3592,
  selectedHighCount: 0,
  selectedMediumCount: 3592,
  selectedZoningMatchCount: 3496,
  selectedFloodplainMatchCount: 760,
  selectedDevelopmentMatchCount: 276,
  selectedRecentDevelopmentFactorCount: 0,
  selectedBuildingCharacteristicsMatchCount: 3592,
  selectedScoreFloor: 41,
  candidatePageCount: 36,
  tierPartitionTotal: 695987,
});
assert.deepEqual(report.tierCounts, { high: 0, medium: 3592, emerging: 450028, "insufficient-evidence": 242367 });
assert.deepEqual(report.factorCounts, { "older-improvements": 356908, "entity-owner": 78736, "low-improvement-to-land": 77750, "large-site": 11719 });
assert.deepEqual(report.evidenceCounts, { landValue: 694427, improvementValue: 694427, landArea: 471522, yearBuilt: 629361, buildingCharacteristics: 694427, frontage: 572600, development: 24950, appraisalJoin: 694427, blockIdJoin: 655873, parcelDimensionJoin: 572929 });
assert.equal(Object.values(report.tierCounts).reduce((sum, count) => sum + count, 0), report.exactSummary.scoredUniqueAccountCount);
assert.equal(report.exactSummary.sourceParcelFeatureCount - report.exactSummary.duplicateFeatureExcessCount, report.exactSummary.uniqueAccountNumberCount);
assert.equal(report.exactSummary.scoredUniqueAccountCount + report.exactSummary.conflictingOpportunityEvidenceAccountCount, report.exactSummary.uniqueAccountNumberCount);

for (const source of [report.sourceEvidence.parcelManifest, report.sourceEvidence.developmentIndex, report.sourceEvidence.developmentManifest, report.sourceEvidence.buildingCharacteristics, report.sourceEvidence.zoningIndex, report.sourceEvidence.floodplainIndex, report.sourceEvidence.dallasNowLinkage]) {
  const bytes = fs.readFileSync(path.join(root, source.path));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), source.sha256);
}
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, report.model.source))).digest("hex"), report.model.sha256);

assert.equal(report.accountIdentityAudit.duplicateAccounts.length, 98);
assert.equal(report.accountIdentityAudit.conflictingAccounts.length, 21);
assert.equal(report.accountIdentityAudit.duplicateAccounts.filter((record) => !record.opportunityEvidenceConsistent).length, 21);
assert(report.accountIdentityAudit.conflictingAccounts.every((account) => !report.candidates.some((candidate) => candidate.accountNum === account)));
assert.equal(new Set(report.candidates.map((candidate) => candidate.accountNum)).size, report.candidates.length);
assert(report.candidates.every((candidate, index) => candidate.rank === index + 1));
assert(report.candidates.every((candidate) => candidate.signal.score >= 40 && candidate.signal.tier === "medium"));
assert(report.candidates.every((candidate) => candidate.signal.factors.every((factor) => factor.evidence && factor.sourceFields.length)));
assert(report.candidates.every((candidate) => !candidate.signal.factors.some((factor) => ["no-linked-permits", "development-momentum"].includes(factor.id))));
assert(report.candidates.every((candidate) => candidate.buildingCharacteristics.status === "matched" && candidate.metrics.yearBuilt === candidate.buildingCharacteristics.conservativeYearBuilt));
assert(report.candidates.filter((candidate) => candidate.developmentEvidence.status === "matched-active-runtime-index").every((candidate) => candidate.developmentEvidence.scoringStatus === "historical-outside-730-day-scoring-window"));
assert(report.candidates.filter((candidate) => candidate.constraints.floodplain.status !== "matched").every((candidate) => /Unknown/.test(candidate.constraints.floodplain.interpretation)));
assert(report.candidates.filter((candidate) => candidate.constraints.zoning.status !== "matched").every((candidate) => /Unknown/.test(candidate.constraints.zoning.interpretation)));
assert.equal(report.rankingContract.developmentRecencyMaximumAgeDays, 730);
assert.equal(report.rankingContract.constraintsDoNotAddPoints, true);
assert.match(report.rankingContract.permitsEvidencePolicy, /No parcel receives a no-permits factor/);

assert.equal(manifest.schemaVersion, "wr-dallas-parcel-opportunity-service-v1");
assert.equal(manifest.candidateCount, report.candidates.length);
assert.equal(manifest.pageCount, 36);
assert.equal(manifest.pageSize, 100);
assert.equal(manifest.featureGate, "opportunitySignals");
assert.equal(manifest.featureGateEnabled, false);
assert.equal(manifest.defaultVisible, false);
assert.equal(manifest.publicRuntimeActivated, false);
assert.match(manifest.runtimePolicy, /never fetch the full audit report/i);
const pageCandidates = [];
for (const page of manifest.pageFiles) {
  const file = path.join(root, "public", "data", "opportunities", page.file);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, page.bytes);
  assert(page.bytes <= 400000, `Opportunity page exceeds bounded delivery limit: ${page.file}`);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), page.sha256);
  const payload = JSON.parse(bytes.toString("utf8"));
  assert.equal(payload.records.length, page.count);
  pageCandidates.push(...payload.records);
}
assert.equal(pageCandidates.length, report.candidates.length);
assert.deepEqual(pageCandidates.map((candidate) => [candidate.rank, candidate.accountNum]), report.candidates.map((candidate) => [candidate.rank, candidate.accountNum]));
assert.equal(report.activation.featureGateEnabled, false);
assert.equal(report.activation.publicRuntimeActivated, false);
assert.equal(report.activation.pageDesignChanged, false);
assert.equal(report.activation.earthImageryChanged, false);
assert.equal(report.activation.advisoryOnly, true);

console.log("White Rabbit full-population Dallas opportunity ranking, identity exceptions, recency, evidence constraints, bounded delivery, and fail-closed activation tests passed.");
