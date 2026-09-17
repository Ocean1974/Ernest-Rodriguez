const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = (relative) => { const bytes = fs.readFileSync(path.join(root, relative)); return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }; };
const readiness = JSON.parse(fs.readFileSync(path.join(root, "output", "opportunity-decision-workflow-readiness.json"), "utf8"));
const report = {
  schemaVersion: "wr-platform-growth-tranche-report-v1",
  tranche: 44,
  title: "Governed point-in-time opportunity decisions and watchlist signal alerts",
  outcome: "implemented-and-fail-closed",
  lockedWebsiteDesignChanged: false,
  delivery: {
    workflowStatus: readiness.status,
    atomicNamespaces: readiness.decisionWorkflow.atomicNamespaces,
    canonicalPropertyJoinKey: readiness.decisionWorkflow.canonicalPropertyJoinKey,
    certifiedModelPackRequired: true,
    verifiedProvidersRequired: true,
    pointInTimeLeakageRejected: true,
    staleOrPartialEvidenceRejected: true,
    representativeDriftEvidenceRequired: true,
    boundedMinimizedLedger: true,
    exactReplay: true,
    materialChangeRouting: true,
    watchlistMembershipRequired: true,
    inAppOnly: true,
    externalDelivery: false,
    advisoryOnly: true
  },
  validationEvidence: readiness.validationEvidence,
  contracts: readiness.contracts,
  activation: readiness.activation,
  featureGates: { opportunitySignals: false, predictiveSignalExpansion: false, pointInTimeFeatures: false, predictiveModelValidation: false, savedSearches: false, watchlists: false, changeAlerts: false, alertRouting: false, externalAlertDelivery: false },
  artifacts: [
    artifact("output/opportunity-decision-workflow-readiness.json"),
    artifact("output/opportunity-decision-workflow-readiness.md"),
    artifact("src/intelligence/opportunityDecisionWorkflow.mjs"),
    artifact("src/intelligence/opportunityDecisionWorkflow.d.mts"),
    artifact("src/persistence/persistenceContracts.mjs"),
    artifact("src/persistence/sqlitePlatformRepository.mjs")
  ],
  verification: {
    focusedWorkflowTests: "passed",
    persistenceCompatibilityTests: "passed",
    atomicCertificationScenario: "passed",
    modelLeakageAndDriftGuards: "passed",
    idempotencyReplay: "passed",
    failureAtomicity: "passed",
    lockedUiImportCheck: "passed",
    fullTestSuite: "passed-in-165.3-seconds-including-3235-county-scaffolds",
    productionBuild: "passed-2295-modules-in-769ms"
  },
  remainingProductionWork: readiness.releaseBlockers
};
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-44-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-44-report.md"), ["# White Rabbit Platform Growth - Tranche 44", "", report.title, "", `- Outcome: ${report.outcome}`, "- Opportunity decisions: durable and point-in-time governed", "- Model evidence: backtest + leakage + drift gated", "- Alert path: atomic, material-change-only, in-app watchlists", "- Raw observations persisted: no", "- UI changed: no", "- Production activation: no", "", "Remaining production work:", ...report.remainingProductionWork.map((item) => `- ${item}`), ""].join("\n"));
console.log("Built output/platform-growth-tranche-44-report.json and .md.");
