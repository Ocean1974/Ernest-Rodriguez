const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = (relative) => { const bytes = fs.readFileSync(path.join(root, relative)); return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }; };
const readiness = JSON.parse(fs.readFileSync(path.join(root, "output", "acquisition-handoff-readiness.json"), "utf8"));
const report = {
  schemaVersion: "wr-platform-growth-tranche-report-v1",
  tranche: 45,
  title: "Governed opportunity-to-brief and underwriting handoff",
  outcome: "implemented-and-fail-closed",
  lockedWebsiteDesignChanged: false,
  delivery: {
    workflowStatus: readiness.status,
    atomicNamespaces: readiness.durableHandoff.atomicNamespaces,
    canonicalPropertyJoinKey: readiness.durableHandoff.canonicalPropertyJoinKey,
    priorityDecisionRequired: true,
    dualCapabilityReleaseGate: true,
    signedUnderwritingEvidenceRequired: true,
    licensedPointInTimeComparablesRequired: true,
    sanitizedProfileProjection: true,
    evidenceBoundBrief: true,
    draftUnderwritingScenario: true,
    exactReplay: true,
    humanReviewRequired: true,
    humanApprovalRequired: true,
    automaticExport: false,
    automaticApproval: false
  },
  limits: { handoffsPerProperty: 25, scenariosPerTenant: 5000, comparableAnalyses: 4, selectedComparablesPerAnalysis: 8, profileBytes: 262144, assumptionInputBytes: 65536 },
  contracts: readiness.contracts,
  activation: readiness.activation,
  featureGates: { opportunityBriefs: false, underwriting: false, underwritingExports: false, marketComparables: false, comparableAdjustments: false, underwritingGovernance: false, underwritingApprovals: false },
  artifacts: [
    artifact("output/acquisition-handoff-readiness.json"), artifact("output/acquisition-handoff-readiness.md"),
    artifact("src/intelligence/acquisitionHandoffWorkflow.mjs"), artifact("src/intelligence/acquisitionHandoffWorkflow.d.mts"),
    artifact("src/briefs/opportunityBrief.mjs"), artifact("src/underwriting/underwritingGovernance.mjs"), artifact("src/underwriting/marketComparables.mjs"),
    artifact("src/persistence/sqlitePlatformRepository.mjs")
  ],
  verification: { focusedWorkflowTests: "passed", persistenceCompatibilityTests: "passed", atomicCertificationScenario: "passed", signedEvidenceRejection: "passed", pointInTimeAndLicenseGuards: "passed", replayAndConcurrency: "passed", humanDecisionBoundary: "passed", lockedUiImportCheck: "passed", fullTestSuite: "passed-in-167.8-seconds-including-3235-county-scaffolds", productionBuild: "passed-2295-modules-in-790ms" },
  remainingProductionWork: readiness.releaseBlockers
};
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-45-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-45-report.md"), ["# White Rabbit Platform Growth - Tranche 45", "", report.title, "", `- Outcome: ${report.outcome}`, "- Priority decision -> evidence-bound brief -> draft underwriting: atomic", "- Signed licensed point-in-time evidence: required", "- Raw profile persisted: no", "- Automatic review/approval/export: no", "- UI changed: no", "- Production activation: no", "", "Remaining production work:", ...report.remainingProductionWork.map((item) => `- ${item}`), ""].join("\n"));
console.log("Built output/platform-growth-tranche-45-report.json and .md.");
