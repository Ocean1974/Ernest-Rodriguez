const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const { planParcelQuery } = await import("../src/search/parcelQueryPlanner.mjs");
  const { createUserIntelligenceWorkflow } = await import("../src/platform/userIntelligenceWorkflow.mjs");
  const countyId = "dallas-county-dcad";
  const organizationId = "org-workflow";
  const userId = "user-workflow";
  const fixed = "2026-08-24T12:00:00.000Z";
  let currentTime = fixed;
  const context = { organizationId, actorUserId: userId, subjectUserId: userId, sessionId: "session-workflow", requestId: "request-workflow", grants: ["persistence:read", "persistence:write", "user-intelligence:read", "user-intelligence:write", "user-intelligence:evaluate"], issuedAt: "2026-08-24T11:00:00.000Z", expiresAt: "2026-08-25T12:00:00.000Z" };
  const releaseDecision = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "deal-workflow-collaboration", activationAuthorized: true };
  const verifyReleaseDecision = () => ({ valid: true, activationAuthorized: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-user-workflow-"));
  const databasePath = path.join(tempDir, "platform.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => currentTime });
  const propertyIdA = `wrp:v1:${countyId}:A1`;
  const propertyIdB = `wrp:v1:${countyId}:B2`;
  let ownerName = "RABBIT HOLDINGS LLC";
  let savedSearchIds = [propertyIdA];
  let profileTimeOverride = "";
  let searchFreshness = "current";
  const profileProvider = { schemaVersion: "wr-property-profile-monitor-provider-v1", activationAuthorized: true, async getProfile(id, { asOf }) { return { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: id, asOf: profileTimeOverride || asOf, parcel: { whiteRabbitPropertyId: id, ownerName, totalValue: 100000, geometry: { forbidden: "not persisted in monitoring snapshots" } }, lineage: { sourceDatasetId: "dcad", sourceUpdatedAt: profileTimeOverride || asOf, arbitrarySecret: "discarded" } }; } };
  const searchExecutor = { schemaVersion: "wr-saved-search-monitor-executor-v1", activationAuthorized: true, async execute({ cursor }) {
    const first = !cursor;
    const ids = first ? savedSearchIds.slice(0, 1) : savedSearchIds.slice(1);
    return { status: "complete", results: ids.map((id) => ({ parcel: { whiteRabbitPropertyId: id } })), nextCursor: first && savedSearchIds.length > 1 ? "page-2" : "", sourceEvidence: [{ sourceCountyId: countyId, datasetId: "dcad", sourceVersion: "2026.08.24", sourceUpdatedAt: "2026-08-24", freshnessStatus: searchFreshness, ignoredCredential: "must-not-persist" }] };
  } };
  const workflow = createUserIntelligenceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision, propertyProfileProvider: profileProvider, savedSearchExecutor: searchExecutor, clock: () => currentTime });
  assert.equal(workflow.activationAuthorized, true);
  const inactive = createUserIntelligenceWorkflow({ repository, allowedCountyIds: [countyId] });
  assert.throws(() => inactive.inspect(context, { asOf: fixed }), (error) => error.code === "WR_USER_INTELLIGENCE_RUNTIME_INACTIVE");

  const searchInput = { id: "search-large", name: "Large sites", queryPlan: planParcelQuery("parcels over 5 acres"), countyIds: [countyId], alertPolicy: { enabled: true, cadence: "daily", materialChangesOnly: true }, createdAt: fixed };
  const saveSearchInput = { savedSearch: searchInput, expectedTenantRevision: 0, expectedUserRecordRevision: 0, expectedAlertRecordRevision: 0, expectedStateRevision: 1, idempotencyKey: "workflow-save-search-1", occurredAt: fixed };
  const savedSearch = await workflow.saveSearch(saveSearchInput, context);
  assert.equal(savedSearch.receipt.mutationCount, 2);
  assert.equal(savedSearch.userState.organizationId, organizationId);
  assert.equal(savedSearch.userState.ownerUserId, userId);
  assert.equal(savedSearch.routingState.subscriptions.length, 1);
  assert.deepEqual(savedSearch.routingState.subscriptions[0].channels.map((item) => item.type), ["in-app"]);
  const replay = await workflow.saveSearch(saveSearchInput, context);
  assert.equal(replay.receipt.replayed, true);
  assert.equal(repository.tenantRevision(context, { now: fixed }), 1);
  await assert.rejects(() => workflow.saveSearch({ ...saveSearchInput, savedSearch: { ...searchInput, name: "Changed" } }, context), (error) => error.code === "WR_IDEMPOTENCY_CONFLICT");

  currentTime = "2026-08-24T12:01:00.000Z";
  const watchInput = { id: "watch-acquisitions", name: "Acquisitions", propertyIds: [propertyIdA], alertPolicy: { enabled: true, cadence: "immediate", materialChangesOnly: true }, createdAt: fixed };
  const savedWatch = await workflow.saveWatchlist({ watchlist: watchInput, expectedTenantRevision: 1, expectedUserRecordRevision: 1, expectedAlertRecordRevision: 1, expectedStateRevision: 2, idempotencyKey: "workflow-save-watch-1", occurredAt: currentTime }, context);
  assert.equal(savedWatch.userState.watchlists.length, 1);
  assert.equal(savedWatch.routingState.subscriptions.length, 2);

  let inspected = workflow.inspect(context, { asOf: currentTime });
  currentTime = "2026-08-24T12:02:00.000Z";
  const watchBaseline = await workflow.evaluateWatchlist({ sourceId: watchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "workflow-watch-eval-1", occurredAt: currentTime }, context);
  assert.equal(watchBaseline.envelope.events.length, 0);
  assert.equal(watchBaseline.routingDecision.status, "suppressed");
  ownerName = "NEW OWNER LLC";
  inspected = workflow.inspect(context, { asOf: currentTime });
  currentTime = "2026-08-24T12:03:00.000Z";
  const watchChanged = await workflow.evaluateWatchlist({ sourceId: watchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "workflow-watch-eval-2", occurredAt: currentTime }, context);
  assert.equal(watchChanged.envelope.events[0].category, "ownership");
  assert.equal(watchChanged.routingDecision.status, "queued");
  assert.deepEqual(watchChanged.routingDecision.attempts.map((item) => item.channelType), ["in-app"]);
  assert.equal("geometry" in watchChanged.routingState.snapshots.at(-1).profile.parcel, false);
  assert.equal("arbitrarySecret" in watchChanged.routingState.snapshots.at(-1).profile.lineage, false);

  inspected = workflow.inspect(context, { asOf: currentTime });
  const tenantBeforeFuture = inspected.tenantRevision;
  profileTimeOverride = "2026-08-25T00:00:00.000Z";
  await assert.rejects(() => workflow.evaluateWatchlist({ sourceId: watchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "workflow-watch-future", occurredAt: "2026-08-24T12:03:30.000Z" }, context), (error) => error.code === "WR_POINT_IN_TIME_LEAKAGE");
  assert.equal(repository.tenantRevision(context, { now: currentTime }), tenantBeforeFuture, "rejected future evidence must not mutate durable state");
  profileTimeOverride = "";

  inspected = workflow.inspect(context, { asOf: currentTime });
  currentTime = "2026-08-24T12:04:00.000Z";
  const searchBaseline = await workflow.evaluateSavedSearch({ sourceId: searchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "workflow-search-eval-1", occurredAt: currentTime }, context);
  assert.equal(searchBaseline.baselineEstablished, true);
  assert.equal(searchBaseline.envelope.events.length, 0);
  savedSearchIds = [propertyIdA, propertyIdB];
  inspected = workflow.inspect(context, { asOf: currentTime });
  currentTime = "2026-08-24T12:05:00.000Z";
  const searchChanged = await workflow.evaluateSavedSearch({ sourceId: searchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "workflow-search-eval-2", occurredAt: currentTime }, context);
  assert.deepEqual(searchChanged.addedPropertyIds, [propertyIdB]);
  assert.equal(searchChanged.routingDecision.status, "queued");
  assert.equal(searchChanged.userState.savedSearches[0].lastEvaluation.pageCount, 2);

  inspected = workflow.inspect(context, { asOf: currentTime });
  const tenantBeforeUnknown = inspected.tenantRevision;
  searchFreshness = "unknown";
  await assert.rejects(() => workflow.evaluateSavedSearch({ sourceId: searchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, idempotencyKey: "workflow-search-unknown", occurredAt: "2026-08-24T12:05:30.000Z" }, context), (error) => error.code === "WR_SAVED_SEARCH_SOURCE_NOT_CURRENT");
  assert.equal(repository.tenantRevision(context, { now: currentTime }), tenantBeforeUnknown, "rejected unknown freshness must not mutate durable state");
  searchFreshness = "current";

  const otherContext = { ...context, actorUserId: "other-user", subjectUserId: "other-user", sessionId: "other-session", requestId: "other-request" };
  const otherView = workflow.inspect(otherContext, { asOf: currentTime });
  assert.equal(otherView.userState.savedSearches.length, 0);
  assert.equal(otherView.routingState.subscriptions.length, 0, "shared alert routing state must be projected to the authenticated user");
  assert.equal(otherView.routingState.snapshots.length, 0);
  assert.throws(() => workflow.inspect({ ...context, grants: ["persistence:read"] }, { asOf: currentTime }), (error) => error.code === "WR_USER_INTELLIGENCE_PERMISSION_DENIED");

  currentTime = "2026-08-24T12:05:40.000Z";
  const otherSaved = await workflow.saveWatchlist({ watchlist: { ...watchInput, id: "watch-other" }, expectedTenantRevision: otherView.tenantRevision, expectedUserRecordRevision: 0, expectedAlertRecordRevision: otherView.alertRecordRevision, expectedStateRevision: 1, idempotencyKey: "workflow-other-watch-save", occurredAt: currentTime }, otherContext);
  ownerName = "OTHER USER BASELINE OWNER";
  const otherReady = workflow.inspect(otherContext, { asOf: currentTime });
  currentTime = "2026-08-24T12:05:50.000Z";
  const otherBaseline = await workflow.evaluateWatchlist({ sourceId: "watch-other", expectedTenantRevision: otherReady.tenantRevision, expectedUserRecordRevision: otherReady.userRecordRevision, expectedAlertRecordRevision: otherReady.alertRecordRevision, expectedStateRevision: otherReady.userState.revision, idempotencyKey: "workflow-other-watch-eval", occurredAt: currentTime }, otherContext);
  assert.equal(otherBaseline.envelope.events.length, 0, "another user's snapshot must not become this user's comparison baseline");
  assert.equal(otherBaseline.routingState.snapshots.length, 1);
  const firstUserAfterOther = workflow.inspect(context, { asOf: currentTime });
  assert.equal(firstUserAfterOther.routingState.snapshots.length, 2, "snapshot views must remain owner-scoped even for the same property");

  inspected = workflow.inspect(context, { asOf: currentTime });
  currentTime = "2026-08-24T12:06:00.000Z";
  const deleted = await workflow.deleteWatchlist({ sourceId: watchInput.id, expectedTenantRevision: inspected.tenantRevision, expectedUserRecordRevision: inspected.userRecordRevision, expectedAlertRecordRevision: inspected.alertRecordRevision, expectedStateRevision: inspected.userState.revision, expectedEntityRevision: inspected.userState.watchlists[0].revision, idempotencyKey: "workflow-watch-delete-1", occurredAt: currentTime }, context);
  assert.equal(deleted.userState.watchlists.length, 0);
  assert(!deleted.routingState.subscriptions.some((item) => item.sourceId === watchInput.id));

  const audit = repository.exportAuditLog(context, { now: currentTime, exportedAt: currentTime });
  assert.equal(audit.verification.valid, true);
  assert(audit.entries.some((item) => item.action === "records.batch-committed"));
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  console.log("White Rabbit durable saved-search/watchlist workflow, atomic alert routing, replay, isolation, and evaluation tests passed.");
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "build-user-intelligence-workflow-readiness.cjs")], { stdio: "pipe" });
  require("./user-intelligence-workflow-readiness.test.cjs");
})().catch((error) => { console.error(error); process.exit(1); });
