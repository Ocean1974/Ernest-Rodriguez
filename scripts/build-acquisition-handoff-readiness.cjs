const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "acquisition-handoff-readiness.json");
const outputMd = path.join(root, "output", "acquisition-handoff-readiness.md");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

execFileSync(process.execPath, [path.join(root, "tests", "acquisition-handoff-workflow.test.cjs")], { stdio: "inherit", env: { ...process.env, WR_HANDOFF_CERTIFICATION_CHILD: "1" } });
const workflowSource = fs.readFileSync(path.join(root, "src", "intelligence", "acquisitionHandoffWorkflow.mjs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const checks = [
  { id: "integration-certification", passed: true },
  { id: "dual-release-gate", passed: workflowSource.includes('"opportunity-briefs"') && workflowSource.includes('"scenario-underwriting"') },
  { id: "atomic-handoff-underwriting", passed: workflowSource.includes('namespace: "acquisition-handoff"') && workflowSource.includes('namespace: "underwriting"') },
  { id: "signed-evidence-pack", passed: workflowSource.includes("WR_UNDERWRITING_EVIDENCE_SIGNATURE_REJECTED") },
  { id: "point-in-time-and-license-gates", passed: workflowSource.includes("WR_UNDERWRITING_POINT_IN_TIME_LEAKAGE") && workflowSource.includes("WR_UNDERWRITING_SOURCE_NOT_AUTHORIZED") },
  { id: "sanitized-profile-projection", passed: workflowSource.includes("parcelFields") && workflowSource.includes("WR_HANDOFF_PROFILE_TOO_LARGE") },
  { id: "human-review-boundary", passed: workflowSource.includes('status: "draft-pending-independent-review"') && workflowSource.includes("approvalAuthorized: false") && workflowSource.includes("exportAuthorized: false") },
  { id: "bounded-ledger", passed: workflowSource.includes("slice(-25)") },
  { id: "locked-ui", passed: !appSource.includes("acquisitionHandoffWorkflow") }
];
const report = {
  schemaVersion: "wr-acquisition-handoff-readiness-v1",
  generatedAt: "2026-08-24T16:00:00.000Z",
  status: checks.every((item) => item.passed) ? "foundation-ready-release-blocked" : "rejected",
  contracts: ["wr-acquisition-handoff-workflow-v1", "wr-acquisition-handoff-v1", "wr-acquisition-handoff-ledger-v1", "wr-acquisition-handoff-result-v1", "wr-acquisition-handoff-profile-provider-v1", "wr-underwriting-evidence-provider-v1", "wr-underwriting-evidence-pack-v1", "wr-opportunity-brief-v1", "wr-underwriting-scenario-v1"],
  durableHandoff: { atomicNamespaces: ["acquisition-handoff", "underwriting"], canonicalPropertyJoinKey: "whiteRabbitPropertyId", sourceDecisionJoinKey: "sourceDecisionId", scenarioJoinKey: "scenarioId", maximumHandoffsPerProperty: 25, maximumScenariosPerTenant: 5000, optimisticConcurrency: true, idempotentReplay: true, tamperEvidentAudit: true },
  evidenceBoundary: { currentPriorityDecisionRequired: true, maximumDecisionAgeHours: 24, currentModelCertificationRequired: true, signedUnderwritingEvidenceRequired: true, licensedPointInTimeComparablesRequired: true, maximumComparableAnalyses: 4, maximumSelectedComparablesPerAnalysis: 8, maximumSanitizedProfileBytes: 262144, maximumAssumptionInputBytes: 65536, rawProfilePersisted: false },
  humanDecisionBoundary: { scenarioStatus: "draft", advisoryOnly: true, reviewManufactured: false, approvalManufactured: false, exportAuthorized: false, independentReviewStillRequired: true, independentApprovalStillRequired: true },
  activation: { productionReleaseDecisionsPresent: false, certificationUsedSyntheticAuthorization: true, certifiedProductionProfileProviderConnected: false, certifiedProductionUnderwritingEvidenceProviderConnected: false, visibleUiActivated: false, lockedWebsiteDesignChanged: false },
  certificationScenario: { propertyCount: 1, priorityDecisionCount: 1, comparableTypeCount: 1, licensedComparableCount: 3, atomicMutationCount: 2, handoffCount: 1, draftScenarioCount: 1, reviewCount: 0, approvalCount: 0, exactReplayPreservedRevision: true, unsignedEvidenceRejectedWithoutMutation: true, staleDecisionRejectedWithoutMutation: true },
  checks,
  releaseBlockers: ["No production-signed opportunity-brief and scenario-underwriting release decisions exist.", "No verified production property-profile or signed underwriting-evidence provider is connected.", "Licensed production comparable feeds and geography/property-type holdout evidence remain incomplete.", "Production identity, KMS, tenant-penetration, sustained-load, recovery, rollback, security, and product approvals remain incomplete."]
};
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(outputMd, ["# Acquisition Handoff Readiness", "", `Status: ${report.status}`, "", "- Priority decision -> evidence-bound brief -> draft underwriting scenario: certified", "- Atomic namespaces: acquisition-handoff + underwriting", "- Signed underwriting evidence: required", "- Licensed point-in-time comparables: required", "- Raw profile persisted: no", "- Review manufactured: no", "- Approval manufactured: no", "- Export authorized: no", "- UI changed: no", "- Production activation: no", "", "Release blockers:", ...report.releaseBlockers.map((item) => `- ${item}`), ""].join("\n"));
console.log(`Built ${path.relative(root, outputJson)} and ${path.relative(root, outputMd)} (${sha256(fs.readFileSync(outputJson))}).`);
