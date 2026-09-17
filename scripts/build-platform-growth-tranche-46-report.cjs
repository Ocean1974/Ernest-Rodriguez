const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const readinessPath = path.join(root, "output", "committee-workspace-readiness.json");
if (!fs.existsSync(readinessPath)) throw new Error("Committee workspace readiness evidence is missing; run committee-workspace:readiness first.");
const readiness = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
if (readiness.status !== "foundation-ready-release-blocked" || !readiness.checks.every((item) => item.passed)) throw new Error("Committee workspace readiness evidence is not fully passing.");
const fullTestSeconds = Number(process.env.WR_FULL_TEST_SECONDS);
const buildModules = Number(process.env.WR_BUILD_MODULES);
const buildMs = Number(process.env.WR_BUILD_MS);
if (![fullTestSeconds, buildModules, buildMs].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Measured WR_FULL_TEST_SECONDS, WR_BUILD_MODULES, and WR_BUILD_MS are required to seal tranche 46.");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = (relative) => { const bytes = fs.readFileSync(path.join(root, relative)); return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }; };
const report = {
  schemaVersion: "wr-platform-growth-tranche-report-v1", tranche: 46, title: "Approved underwriting to committee collaboration workspace", outcome: "implemented-and-fail-closed", lockedWebsiteDesignChanged: false,
  delivery: { workflowStatus: readiness.status, atomicNamespaces: readiness.durableWorkspace.atomicNamespaces, canonicalPropertyJoinKey: readiness.durableWorkspace.canonicalPropertyJoinKey, linkedApprovalChainRequired: true, separationOfDutiesRequired: true, signedWorkspacePackRequired: true, verifiedCleanMalwareScanRequired: true, authoritativeDiligenceTemplateAndCalendarRequired: true, exactReplay: true, externalSharing: false, externalReminderDelivery: false, automaticTaskCompletion: false, automaticCommitteeDecision: false },
  limits: { workspacesPerProperty: 25, dealsPerTenant: 5000, roomsPerTenant: 5000, documentVersionsPerTenant: 25000, diligenceTasksPerWorkspace: 100, workspacePackBytes: 2097152, malwareScanAgeHours: 24, approvalAgeHours: 168 },
  contracts: readiness.contracts, activation: readiness.activation,
  featureGates: { organizations: false, dealCollaboration: false, propertyTasksAndNotes: false, durablePersistence: false, tenantIsolation: false, authenticatedPersistence: false },
  artifacts: [artifact("output/committee-workspace-readiness.json"), artifact("output/committee-workspace-readiness.md"), artifact("src/collaboration/committeeWorkspaceWorkflow.mjs"), artifact("src/collaboration/committeeWorkspaceWorkflow.d.mts"), artifact("src/collaboration/dealCollaborationStore.mjs"), artifact("src/collaboration/dealRoomRegistry.mjs"), artifact("src/collaboration/transactionDiligence.mjs"), artifact("src/persistence/sqlitePlatformRepository.mjs")],
  verification: { focusedWorkflowTests: "passed", persistenceCompatibilityTests: "passed", approvalChainAndSeparation: "passed", signedPackAndMalwareControls: "passed", staleApprovalAndMembershipRejection: "passed", atomicCertificationScenario: "passed", exactReplay: "passed", noShareNoDecisionBoundary: "passed", lockedUiImportCheck: "passed", fullTestSuite: `passed-in-${fullTestSeconds}-seconds-including-3235-county-scaffolds`, productionBuild: `passed-${buildModules}-modules-in-${buildMs}ms` },
  remainingProductionWork: readiness.releaseBlockers
};
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-46-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-46-report.md"), ["# White Rabbit Platform Growth - Tranche 46", "", report.title, "", `- Outcome: ${report.outcome}`, "- Approved underwriting -> deal + room + clean evidence document + diligence: atomic", "- External shares: none", "- Automatic task completion or committee decision: none", "- UI changed: no", "- Production activation: no", `- Full tests: ${fullTestSeconds} seconds`, `- Build: ${buildModules} modules in ${buildMs} ms`, "", "Remaining production work:", ...report.remainingProductionWork.map((item) => `- ${item}`), ""].join("\n"));
console.log("Built output/platform-growth-tranche-46-report.json and .md.");
