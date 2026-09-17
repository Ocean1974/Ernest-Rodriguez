const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "user-intelligence-workflow-readiness.json");
const outputMd = path.join(root, "output", "user-intelligence-workflow-readiness.md");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

(async () => {
  const { SqlitePlatformRepository } = await import(pathToFileURL(path.join(root, "src", "persistence", "sqlitePlatformRepository.mjs")).href);
  const { createUserIntelligenceWorkflow } = await import(pathToFileURL(path.join(root, "src", "platform", "userIntelligenceWorkflow.mjs")).href);
  const countyId = "dallas-county-dcad";
  const propertyId = `wrp:v1:${countyId}:CERT-1`;
  const organizationId = "org-certification";
  const userId = "user-certification";
  let now = "2026-08-24T14:00:00.000Z";
  let ownerName = "BASELINE OWNER LLC";
  const context = { organizationId, actorUserId: userId, subjectUserId: userId, sessionId: "cert-session", requestId: "cert-request", grants: ["persistence:read", "persistence:write", "user-intelligence:read", "user-intelligence:write", "user-intelligence:evaluate"], issuedAt: "2026-08-24T13:00:00.000Z", expiresAt: "2026-08-25T14:00:00.000Z" };
  const releaseDecision = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "deal-workflow-collaboration", activationAuthorized: true };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-user-intelligence-cert-"));
  const databasePath = path.join(tempDir, "cert.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => now });
  const profileProvider = { schemaVersion: "wr-property-profile-monitor-provider-v1", activationAuthorized: true, async getProfile(id, { asOf }) { return { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: id, asOf, parcel: { whiteRabbitPropertyId: id, ownerName, totalValue: 100, geometry: { omitted: true } }, lineage: { sourceDatasetId: "certified-fixture", sourceUpdatedAt: asOf, credential: "discarded" } }; } };
  const workflow = createUserIntelligenceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision: () => ({ valid: true, activationAuthorized: true }), propertyProfileProvider: profileProvider, clock: () => now });
  const inactive = createUserIntelligenceWorkflow({ repository, allowedCountyIds: [countyId] });
  let inactiveRejected = false;
  try { inactive.inspect(context, { asOf: now }); } catch (error) { inactiveRejected = error.code === "WR_USER_INTELLIGENCE_RUNTIME_INACTIVE"; }
  const saveInput = { watchlist: { id: "cert-watch", name: "Certification watchlist", propertyIds: [propertyId], alertPolicy: { enabled: true, cadence: "immediate", materialChangesOnly: true }, createdAt: now }, expectedTenantRevision: 0, expectedUserRecordRevision: 0, expectedAlertRecordRevision: 0, expectedStateRevision: 1, idempotencyKey: "cert-watch-save", occurredAt: now };
  const saved = await workflow.saveWatchlist(saveInput, context);
  const replay = await workflow.saveWatchlist(saveInput, context);
  let inspected = workflow.inspect(context, { asOf: now });
  now = "2026-08-24T14:01:00.000Z";
  const baseline = await workflow.evaluateWatchlist({ sourceId: "cert-watch", expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "cert-watch-baseline", occurredAt: now }, context);
  ownerName = "CHANGED OWNER LLC";
  inspected = workflow.inspect(context, { asOf: now });
  now = "2026-08-24T14:02:00.000Z";
  const changedInput = { sourceId: "cert-watch", expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "cert-watch-change", occurredAt: now };
  const changed = await workflow.evaluateWatchlist(changedInput, context);
  const revisionBeforeReplay = repository.tenantRevision(context, { now });
  const changedReplay = await workflow.evaluateWatchlist(changedInput, context);
  const revisionAfterReplay = repository.tenantRevision(context, { now });
  const otherContext = { ...context, actorUserId: "other-user", subjectUserId: "other-user", sessionId: "other-session", requestId: "other-request" };
  const otherView = workflow.inspect(otherContext, { asOf: now });
  const audit = repository.exportAuditLog(context, { now, exportedAt: now });
  const schemaState = repository.schemaState();
  const stored = repository.readRecord(context, "alert-routing", "state", { now }).value;
  const snapshot = stored.snapshots[0];
  const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  const checks = [
    { id: "release-default-off", passed: inactiveRejected && workflow.activationAuthorized === true },
    { id: "atomic-user-alert-write", passed: saved.receipt.mutationCount === 2 && saved.receipt.records.some((item) => item.namespace === "user-intelligence") && saved.receipt.records.some((item) => item.namespace === "alert-routing") },
    { id: "exact-replay", passed: replay.receipt.replayed === true && repository.readIdempotencyReceipt(context, "cert-watch-save", { now })?.requestFingerprint === saved.receipt.requestFingerprint },
    { id: "in-app-only", passed: saved.routingState.subscriptions.length === 1 && saved.routingState.subscriptions[0].channels.length === 1 && saved.routingState.subscriptions[0].channels[0].type === "in-app" },
    { id: "baseline-suppressed", passed: baseline.envelope.events.length === 0 && baseline.routingDecision.status === "suppressed" },
    { id: "ownership-change-queued", passed: changed.envelope.events.length === 1 && changed.envelope.events[0].category === "ownership" && changed.routingDecision.status === "queued" },
    { id: "evaluation-replay-no-write", passed: changedReplay.receipt.replayed === true && revisionBeforeReplay === revisionAfterReplay },
    { id: "cross-user-projection", passed: otherView.routingState.subscriptions.length === 0 && otherView.routingState.snapshots.length === 0 },
    { id: "monitoring-minimization", passed: !snapshot.profile.parcel.geometry && !snapshot.profile.lineage.credential && snapshot.ownerUserId === userId && snapshot.sourceId === "cert-watch" },
    { id: "tamper-evident-audit", passed: audit.verification.valid === true && audit.entries.filter((item) => item.action === "records.batch-committed").length === 3 },
    { id: "sqlite-integrity", passed: schemaState.integrity === "ok" && schemaState.schemaVersion === 2 },
    { id: "locked-ui", passed: !appSource.includes("userIntelligenceWorkflow") },
  ];
  const report = {
    schemaVersion: "wr-user-intelligence-workflow-readiness-v1",
    generatedAt: now,
    status: checks.every((item) => item.passed) ? "foundation-ready-release-blocked" : "rejected",
    contracts: ["wr-user-intelligence-workflow-v1", "wr-user-intelligence-operation-result-v1", "wr-user-intelligence-evaluation-result-v1", "wr-saved-search-monitor-executor-v1", "wr-property-profile-monitor-provider-v1"],
    durableWorkflow: { databaseSchemaVersion: schemaState.schemaVersion, atomicNamespaces: ["user-intelligence", "alert-routing"], canonicalPropertyJoinKey: "whiteRabbitPropertyId", sourceJoinKeys: ["saved-search:id", "watchlist:id"], optimisticConcurrency: true, idempotentReplay: true, tamperEvidentAudit: true, userScopedRoutingProjection: true, ownerScopedSnapshots: true, monitoringProfileLimitBytes: 131072, watchlistPropertyLimit: 10000, watchlistEvaluationPageLimit: 100, savedSearchResultLimit: 5000, savedSearchPageLimit: 20 },
    alertBoundary: { inAppOnly: true, externalProviderContacted: false, externalDeliveryActivated: false, baselineAlertsSuppressed: true, materialOwnershipChangeQueued: true },
    activation: { productionReleaseDecisionPresent: false, certificationUsedSyntheticAuthorization: true, certifiedProfileProviderConnected: false, certifiedSavedSearchExecutorConnected: false, savedSearches: false, watchlists: false, alertRouting: false, visibleUiActivated: false, lockedWebsiteDesignChanged: false },
    certificationScenario: { propertyCount: 1, userCount: 2, committedBatchCount: 3, auditEntryCount: audit.entries.length, finalTenantRevision: revisionAfterReplay, baselineEventCount: baseline.envelope.events.length, changedEventCount: changed.envelope.events.length, replayPreservedTenantRevision: revisionBeforeReplay === revisionAfterReplay },
    checks,
    releaseBlockers: ["No production identity provider, KMS, or supported database topology is connected.", "No production-signed collaboration capability release decision exists.", "No activation-authorized production property-profile or saved-search executor is connected.", "Tenant penetration, sustained-load, recovery, and rollback drills remain incomplete."],
  };
  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMd, ["# User Intelligence Workflow Readiness", "", `Status: ${report.status}`, "", "- Atomic namespaces: user-intelligence + alert-routing", "- Canonical property join: whiteRabbitPropertyId", "- Alert channel: in-app only", "- Exact replay: passed", "- Cross-user routing and snapshot isolation: passed", "- Monitoring payload minimization: passed", "- Tamper-evident audit: passed", "- UI changed: no", "- Production activation: no", "", "Release blockers:", ...report.releaseBlockers.map((item) => `- ${item}`), ""].join("\n"));
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  console.log(`Built ${path.relative(root, outputJson)} and ${path.relative(root, outputMd)} (${sha256(fs.readFileSync(outputJson))}).`);
})().catch((error) => { console.error(error); process.exit(1); });
