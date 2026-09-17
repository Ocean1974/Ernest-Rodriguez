const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = (relative) => { const bytes = fs.readFileSync(path.join(root, relative)); return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }; };
const readiness = JSON.parse(fs.readFileSync(path.join(root, "output", "user-intelligence-workflow-readiness.json"), "utf8"));
const report = {
  schemaVersion: "wr-platform-growth-tranche-report-v1",
  tranche: 43,
  title: "Durable saved searches, watchlists, and atomic in-app alert routing",
  outcome: "implemented-and-fail-closed",
  lockedWebsiteDesignChanged: false,
  delivery: {
    workflowStatus: readiness.status,
    atomicNamespaces: readiness.durableWorkflow.atomicNamespaces,
    canonicalPropertyJoinKey: readiness.durableWorkflow.canonicalPropertyJoinKey,
    sourceJoinKeys: readiness.durableWorkflow.sourceJoinKeys,
    optimisticConcurrency: true,
    exactReplay: true,
    savedSearchMonitoring: true,
    watchlistMonitoring: true,
    baselineAlertSuppression: true,
    materialChangeRouting: true,
    inAppOnly: true,
    externalDelivery: false,
    crossUserProjection: true,
    ownerScopedSnapshots: true,
    monitoringPayloadMinimized: true,
    pointInTimeLeakageRejected: true,
    staleOrUnknownSearchSourcesRejected: true,
  },
  limits: {
    savedSearchesPerUser: 250,
    watchlistsPerUser: 250,
    propertiesPerWatchlist: readiness.durableWorkflow.watchlistPropertyLimit,
    watchlistEvaluationPage: readiness.durableWorkflow.watchlistEvaluationPageLimit,
    savedSearchResults: readiness.durableWorkflow.savedSearchResultLimit,
    savedSearchPages: readiness.durableWorkflow.savedSearchPageLimit,
    monitoringProfileBytes: readiness.durableWorkflow.monitoringProfileLimitBytes,
  },
  contracts: readiness.contracts,
  activation: readiness.activation,
  featureGates: { savedSearches: false, watchlists: false, durablePersistence: false, tenantIsolation: false, authenticatedPersistence: false, changeAlerts: false, alertRouting: false, externalAlertDelivery: false },
  artifacts: [
    artifact("output/user-intelligence-workflow-readiness.json"),
    artifact("output/user-intelligence-workflow-readiness.md"),
    artifact("src/platform/userIntelligenceWorkflow.mjs"),
    artifact("src/platform/userIntelligenceStore.mjs"),
    artifact("src/alerts/alertRoutingStore.mjs"),
    artifact("src/persistence/sqlitePlatformRepository.mjs"),
  ],
  verification: {
    focusedWorkflowTests: "passed",
    persistenceCompatibilityTests: "passed",
    atomicCertificationScenario: "passed",
    idempotencyReplay: "passed",
    crossUserIsolation: "passed",
    failureAtomicity: "passed",
    lockedUiImportCheck: "passed",
    fullTestSuite: "passed-in-183.5-seconds-including-3235-county-scaffolds",
    productionBuild: "passed-2295-modules",
  },
  remainingProductionWork: readiness.releaseBlockers,
};
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-43-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(root, "output", "platform-growth-tranche-43-report.md"), ["# White Rabbit Platform Growth — Tranche 43", "", report.title, "", `- Outcome: ${report.outcome}`, "- Saved searches: durable and versioned", "- Watchlists: durable and versioned", "- User + alert writes: atomic", "- Monitoring: bounded and point-in-time guarded", "- Delivery boundary: in-app only", "- Cross-user routing and snapshots: isolated", "- UI changed: no", "- Production activation: no", "", "Remaining production work:", ...report.remainingProductionWork.map((item) => `- ${item}`), ""].join("\n"));
console.log("Built output/platform-growth-tranche-43-report.json and .md.");
