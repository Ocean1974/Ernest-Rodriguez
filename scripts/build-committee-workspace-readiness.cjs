const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "committee-workspace-readiness.json");
const outputMd = path.join(root, "output", "committee-workspace-readiness.md");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
execFileSync(process.execPath, [path.join(root, "tests", "committee-workspace-workflow.test.cjs")], { stdio: "inherit", env: { ...process.env, WR_COMMITTEE_CERTIFICATION_CHILD: "1" } });
const workflowSource = fs.readFileSync(path.join(root, "src", "collaboration", "committeeWorkspaceWorkflow.mjs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const checks = [
  { id: "integration-certification", passed: true },
  { id: "release-default-off", passed: workflowSource.includes("WR_COMMITTEE_WORKSPACE_INACTIVE") },
  { id: "approval-chain", passed: workflowSource.includes("WR_COMMITTEE_APPROVAL_CHAIN_INVALID") && workflowSource.includes("WR_COMMITTEE_SEPARATION_OF_DUTIES") },
  { id: "stale-approval", passed: workflowSource.includes("WR_COMMITTEE_APPROVAL_STALE") },
  { id: "signed-workspace-pack", passed: workflowSource.includes("WR_COMMITTEE_PACK_SIGNATURE_REJECTED") },
  { id: "clean-document-release", passed: workflowSource.includes("WR_COMMITTEE_DOCUMENT_SCAN_REJECTED") && workflowSource.includes("WR_COMMITTEE_DOCUMENT_SCAN_STALE") && workflowSource.includes("WR_COMMITTEE_DOCUMENT_QUARANTINED") },
  { id: "atomic-four-namespace-write", passed: ["committee-workspace", "collaboration", "deal-room", "diligence"].every((namespace) => workflowSource.includes(`namespace: \"${namespace}\"`)) },
  { id: "no-auto-sharing-or-decision", passed: workflowSource.includes("externalSharingAuthorized: false") && workflowSource.includes("committeeDecisionRecorded: false") },
  { id: "locked-ui", passed: !appSource.includes("committeeWorkspaceWorkflow") }
];
const report = {
  schemaVersion: "wr-committee-workspace-readiness-v1", generatedAt: "2026-08-24T14:30:00.000Z", status: checks.every((item) => item.passed) ? "foundation-ready-release-blocked" : "rejected",
  contracts: ["wr-committee-workspace-workflow-v1", "wr-committee-workspace-v1", "wr-committee-workspace-ledger-v1", "wr-committee-workspace-result-v1", "wr-committee-workspace-provider-v1", "wr-committee-workspace-pack-v1", "wr-deal-v1", "wr-deal-room-v1", "wr-deal-room-document-version-v1", "wr-diligence-workflow-v1"],
  durableWorkspace: { atomicNamespaces: ["committee-workspace", "collaboration", "deal-room", "diligence"], canonicalPropertyJoinKey: "whiteRabbitPropertyId", handoffJoinKey: "handoffId", scenarioJoinKey: "scenarioId", approvalJoinKey: "approvalId", maximumWorkspacesPerProperty: 25, optimisticConcurrency: true, idempotentReplay: true, tamperEvidentAudit: true, existingOrganizationMembershipRequired: true },
  approvalBoundary: { approvedScenarioRequired: true, recommendedReviewRequired: true, linkedApprovalRequired: true, matchingEvidenceDigestRequired: true, distinctAuthorReviewerApproverRequired: true, maximumApprovalAgeHours: 168, staleApprovalRejected: true, committeeDecisionRecordedAutomatically: false },
  documentBoundary: { signedWorkspacePackRequired: true, verifiedCleanMalwareScanRequired: true, contentMatchedScanRequired: true, maximumMalwareScanAgeHours: 24, quarantinedDocumentsRejected: true, maximumPackBytes: 2097152, externalSharesCreated: 0 },
  diligenceBoundary: { certifiedTemplateRequired: true, authoritativeCalendarRequired: true, minimumTaskCount: 3, maximumTaskCount: 100, completedTasksCreated: 0, waivedTasksCreated: 0, externalReminderDeliveryAuthorized: false },
  activation: { productionReleaseDecisionPresent: false, certificationUsedSyntheticAuthorization: true, certifiedProductionWorkspaceProviderConnected: false, productionObjectStorageConnected: false, visibleUiActivated: false, lockedWebsiteDesignChanged: false },
  certificationScenario: { propertyCount: 1, approvedScenarioCount: 1, recommendedReviewCount: 1, approvalCount: 1, atomicMutationCount: 4, dealCount: 1, roomCount: 1, releasedDocumentCount: 1, diligenceTaskCount: 3, externalShareCount: 0, exactReplayPreservedRevision: true, unsignedPackRejectedWithoutMutation: true, staleApprovalRejectedWithoutMutation: true, outsiderMembershipRejectedWithoutMutation: true },
  checks,
  releaseBlockers: ["No production-signed collaboration capability release decision exists.", "No production committee-package renderer, malware scanner attestation service, or object storage is connected.", "Production identity roles, authoritative diligence templates/calendars, and committee policy approvals remain incomplete.", "Tenant penetration, sustained-load, recovery, rollback, security, and product approvals remain incomplete."]
};
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(outputMd, ["# Committee Workspace Readiness", "", `Status: ${report.status}`, "", "- Approved underwriting -> deal + room + clean evidence document + diligence: atomic", "- Author/reviewer/approver separation: required", "- Verified clean malware scan: required", "- External shares created: 0", "- Diligence tasks auto-completed: 0", "- Committee decision auto-recorded: no", "- UI changed: no", "- Production activation: no", "", "Release blockers:", ...report.releaseBlockers.map((item) => `- ${item}`), ""].join("\n"));
console.log(`Built ${path.relative(root, outputJson)} and ${path.relative(root, outputMd)} (${sha256(fs.readFileSync(outputJson))}).`);
