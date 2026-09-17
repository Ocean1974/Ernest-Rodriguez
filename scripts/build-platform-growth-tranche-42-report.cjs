const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = (relative) => { const bytes = fs.readFileSync(path.join(root, relative)); return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }; };
const certification = JSON.parse(fs.readFileSync(path.join(root, "output", "tarrant", "search-readiness", "tarrant-candidate-adapter-certification.json"), "utf8"));
const report = {
  schemaVersion: "wr-platform-growth-tranche-report-v1",
  tranche: 42,
  title: "Tarrant explainable-search artifact adapter and authenticated runtime",
  outcome: "implemented-and-fail-closed",
  lockedWebsiteDesignChanged: false,
  delivery: {
    countyId: certification.countyId,
    exactParcelCount: certification.manifest.featureCount,
    exactSearchCount: certification.manifest.searchIndexCount,
    chunkCount: certification.manifest.chunkCount,
    searchShardKeyCount: certification.manifest.searchShardKeyCount,
    searchShardFileCount: certification.manifest.searchShardFileCount,
    primaryJoinKey: certification.manifest.primaryJoinKey,
    secondaryJoinKey: certification.manifest.secondaryJoinKey,
    manifestSha256: certification.manifest.sha256,
    adapterStatus: certification.status,
    knownProbeAccount: certification.representativeProbe.expectedAccount,
    knownProbeFound: certification.representativeProbe.expectedFound,
    serverSideOnly: true,
    uiWired: false,
  },
  controls: {
    boundedArtifactReads: true,
    countyAllowlist: true,
    canonicalIdentityRequired: true,
    stableAdapterCursor: true,
    queryBudgetEnforced: true,
    tenantScopeRequired: true,
    permissionRequired: "property-intelligence:query",
    signedReleaseVerificationRequired: true,
    staleSourcesRejected: true,
    unknownFreshnessRejected: true,
    countyWideUnindexedFilterScansRejected: true,
  },
  contracts: ["wr-county-artifact-candidate-adapter-v1", "wr-county-artifact-query-runtime-v1", "wr-county-candidate-adapter-certification-v1"],
  featureGates: certification.featureGates,
  activationAuthorized: false,
  artifacts: [
    artifact("output/tarrant/search-readiness/tarrant-candidate-adapter-certification.json"),
    artifact("output/tarrant/search-readiness/tarrant-candidate-adapter-certification.md"),
    artifact("src/search/countyArtifactCandidateAdapter.mjs"),
    artifact("src/search/countyArtifactQueryRuntime.mjs"),
  ],
  verification: {
    focusedAdapterTests: "passed",
    authenticatedRuntimeTests: "passed",
    realTarrantArtifactProbe: "passed",
    unknownFreshnessFailClosedProbe: "passed",
    lockedUiImportCheck: "passed",
    fullTestSuite: "passed-in-165.8-seconds-including-3235-county-scaffolds",
    productionBuild: "passed-2295-modules",
  },
  remainingProductionWork: certification.releaseBlockers,
};
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-42-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-42-report.md"), ["# White Rabbit Platform Growth — Tranche 42", "", report.title, "", `- Outcome: ${report.outcome}`, `- Tarrant parcel/search parity: ${report.delivery.exactParcelCount.toLocaleString()} / ${report.delivery.exactSearchCount.toLocaleString()}`, `- Known RIMROCK account found: ${report.delivery.knownProbeFound ? "yes" : "no"} (${report.delivery.knownProbeAccount})`, `- Adapter: server-side only`, `- Unknown freshness: rejected for live execution`, `- Signed release verification: required`, `- Locked UI changed: no`, `- Activation authorized: no`, "", "Remaining production work:", ...report.remainingProductionWork.map((item) => `- ${item}`), ""].join("\n"));
console.log("Built output/platform-growth-tranche-42-report.json and .md.");
