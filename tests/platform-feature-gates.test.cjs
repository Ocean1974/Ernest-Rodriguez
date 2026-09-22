const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const gates = fs.readFileSync(path.join(root, "src", "data", "platformFeatureGates.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
for (const gate of ["propertyProfileApi", "explainableQueryExecution", "savedSearches", "watchlists", "opportunitySignals", "changeAlerts", "searchBarQueryPlanning", "opportunityBriefs", "underwriting", "underwritingExports", "marketComparables", "comparableAdjustments", "underwritingGovernance", "underwritingApprovals", "organizations", "dealCollaboration", "propertyTasksAndNotes", "alertRouting", "externalAlertDelivery", "development3dAnalysis", "developmentMassing", "terrainStreaming", "canonicalPropertyGraph", "licensedPropertyEventIngestion", "durablePropertyGraph", "transactionHistory", "listingHistory", "entityResolution", "productionCandidateRetrieval", "propertyIntelligenceQueryService", "explainableSearchRanking", "stableSearchPagination", "predictiveSignalExpansion", "pointInTimeFeatures", "predictiveModelValidation", "pmtilesRuntime", "durablePersistence", "tenantIsolation", "authenticatedPersistence", "alertDeliveryWorkers", "alertProviderExecution", "authenticatedAlertProviders", "signedWebhookDelivery", "alertSchedulerRunner", "encryptedTenantBackups", "pointInTimeRestore", "retentionAutomation", "operationalHealthMonitoring", "serviceObservability", "serviceSloGates", "loadResilienceCertification", "feedConnectorCertification", "signedReleaseEvidence", "releaseActivationManifests", "platformReadinessMatrix", "durableReleaseEvidenceRegistry", "releaseTrustKeyRotation", "stagingActivationController", "automaticReleaseRollback", "opportunityBriefExports", "evidenceBoundBriefExports", "briefExportWorkers", "revocableBriefAccess", "dealRooms", "dueDiligenceDocuments", "documentMalwareScanning", "expiringDocumentShares", "documentLegalHolds", "documentEvidenceExtraction", "reviewedFactPromotion", "transactionDiligence", "criticalDateEngine", "evidenceGatedTaskCompletion", "diligenceSlaEscalation", "diligenceReminderWorkers", "assetOperations", "effectiveDatedLeases", "portfolioRentRolls", "operatingStatements", "budgetVarianceIntelligence", "debtCovenantMonitoring", "portfolioAnomalySignals", "assetPlans", "portfolioRollups", "leaseRolloverIntelligence", "cashFlowForecasting", "capitalProjectPlanning", "scenarioStressTesting", "forwardStrategyGovernance", "operatingFeedIngestion", "operatingFeedReconciliation", "accountingCloseControls", "operatingRestatements", "governedReforecasting", "operatingConnectorRuntime", "operatingMappingRegistry", "operatingConnectorScheduler", "operatingBackfills", "operatingConnectorDeadLetters", "connectorObservability", "connectorSchemaDriftContainment", "connectorCredentialRotation", "connectorOperationalDrills", "providerAdapterCertificationPacks", "operatingProviderAdapterSdk", "managedConnectorSecrets", "durableProviderRateLimits", "durableProviderCircuits", "automaticSchemaAssessmentJournal", "vendorSandboxCertification", "canonicalAccountingTaxonomy", "crossVendorAccountMappings", "reconciliationQualityGates", "providerOnboardingWorkflows", "providerIncidentRouting", "certificationExpiryAutomation", "countySourceSnapshots", "countyArtifactReconciliation", "countyAtomicPromotion", "countyAutomaticRollback", "countyReleaseJournals", "countyRawSourceCapture", "countySourceDriftContainment", "countyOutputLineageCertification", "countySourceToOutputCertification"]) {
  assert(gates.includes(`${gate}: false`), `${gate} must remain default-off`);
}
assert(gates.includes("houstonMapSearch: true"), "Houston map/search pilot activation must use its scoped gate");
assert(gates.includes("priorityCountyActivation: false"), "Broad priority county activation must remain default-off");
const restrictedRuntimeModules = [
  "parcelQueryExecutor",
  "userIntelligenceStore",
  "opportunitySignals",
  "opportunityBrief",
  "underwritingEngine",
  "marketComparables",
  "underwritingGovernance",
  "dealCollaborationStore",
  "alertRoutingStore",
  "developmentAnalysis",
  "viewport3dStrategy",
  "propertyGraph",
  "propertyEventIngestion",
  "parcelCandidateRetriever",
  "propertyIntelligenceQueryService",
  "predictiveSignals",
  "signalValidation",
  "geospatialDelivery",
  "sqlitePlatformRepository",
  "alertDeliveryWorker",
  "providerAdapters",
  "alertWorkerScheduler",
  "backupRecovery",
  "serviceObservability",
  "feedCertification",
  "releaseActivation",
  "platformReadiness",
  "releaseEvidenceRegistry",
  "stagingActivationController",
  "opportunityBriefExport",
  "dealRoomRegistry",
  "documentEvidenceExtraction",
  "documentEvidenceRegistry",
  "transactionDiligence",
  "diligenceReminderWorker",
  "assetOperations",
  "portfolioIntelligence",
  "forwardStrategy",
  "operatingFeedControl",
  "operatingConnectorRuntime",
  "operatingConnectorAssurance",
  "operatingProviderSdk",
  "providerOnboardingGovernance",
  "countyReleasePipeline",
  "countySourceCapture",
];
const importSpecifiers = [...app.matchAll(/(?:import[\s\S]*?from\s*|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
for (const moduleName of restrictedRuntimeModules) {
  assert(!importSpecifiers.some((specifier) => specifier.includes(moduleName)), `Visible White Rabbit pages must not import restricted runtime module ${moduleName}`);
}
assert(app.includes("platformFeatureGates.opportunitySignals"), "Gated feature previews must read the release gate instead of implying activation");
console.log("White Rabbit platform feature-gate tests passed.");
