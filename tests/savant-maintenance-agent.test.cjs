const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildRefreshPlan, validateSavantArtifacts } = require("../scripts/savant-maintenance-agent-lib.cjs");

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wr-savant-agent-"));
const now = "2026-09-16T12:00:00.000Z";
const sourceUpdatedAt = "2026-09-15T12:00:00.000Z";
const generatedAt = "2026-09-16T11:00:00.000Z";
write(root, "data/permits/raw/source-manifest.json", { generatedAt, sources: [
  { id: "e7gq-4sah", name: "Building Permits", sourceUrl: "https://example.test/permits", rowCount: 80, fetchedRows: 80, sourceUpdatedAt },
  { id: "9qet-qt9e", name: "Certificates of Occupancy", sourceUrl: "https://example.test/co", rowCount: 20, fetchedRows: 20, sourceUpdatedAt },
] });
write(root, "public/data/permits/manifest.json", { generatedAt, permitCount: 100, joinedPermitCount: 65, unmatchedPermitCount: 35, searchIndexCount: 100 });
write(root, "output/development-intelligence.json", { generatedAt, sourcePermitCount: 100, parcelCountWithSignals: 30 });
write(root, "public/data/developments/manifest.json", { generatedAt, parcelCount: 30 });
write(root, "public/data/opportunities/manifest.json", { generatedAt, candidateCount: 10 });
write(root, "public/data/savant-tools/development-path-radar.json", { generatedAt, opportunityCandidateCount: 10, analyzedCandidateCount: 10, topCandidates: [
  { accountNum: "A", score: 90, reasonCodes: ["growth-pattern"] },
  { accountNum: "B", score: 80, reasonCodes: ["development-path"] },
] });

const healthy = validateSavantArtifacts(root, { now });
assert.equal(healthy.status, "healthy");
assert.equal(healthy.publishAuthorized, true);
assert.equal(healthy.metrics.permitJoinRate, 0.65);
assert(buildRefreshPlan().some((step) => step.id === "fetch-permits"));
assert(!buildRefreshPlan({ skipFetch: true }).some((step) => step.id === "fetch-permits"));

const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wr-savant-agent-stale-"));
fs.cpSync(root, staleRoot, { recursive: true });
write(staleRoot, "data/permits/raw/source-manifest.json", { generatedAt: "2026-09-10T11:00:00.000Z", sources: [
  { id: "e7gq-4sah", rowCount: 80, fetchedRows: 80, sourceUpdatedAt: "2025-01-01T00:00:00.000Z" },
  { id: "9qet-qt9e", rowCount: 20, fetchedRows: 20, sourceUpdatedAt: "2025-01-01T00:00:00.000Z" },
] });
const stale = validateSavantArtifacts(staleRoot, { now });
assert.equal(stale.status, "blocked");
assert(stale.gates.find((item) => item.id === "source-snapshot-recency").status === "blocked");
assert(stale.gates.find((item) => item.id === "upstream-source-recency").status === "blocked");

write(staleRoot, "public/data/permits/manifest.json", { generatedAt, permitCount: 100, joinedPermitCount: 10, unmatchedPermitCount: 80, searchIndexCount: 90 });
const inconsistent = validateSavantArtifacts(staleRoot, { now });
assert(inconsistent.gates.find((item) => item.id === "permit-count-reconciliation").status === "blocked");
assert(inconsistent.gates.find((item) => item.id === "permit-join-quality").status === "blocked");

console.log("Savant disconnected maintenance agent validation tests passed.");
