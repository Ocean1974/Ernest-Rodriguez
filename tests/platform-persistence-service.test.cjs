const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const service = await import("../src/persistence/platformPersistenceService.mjs");
  const collaboration = await import("../src/collaboration/dealCollaborationStore.mjs");
  const alerts = await import("../src/alerts/alertRoutingStore.mjs");
  const fixed = "2026-08-14T13:00:00.000Z";
  const context = { organizationId: "org-a", actorUserId: "user-a", subjectUserId: "user-a", sessionId: "session-a", requestId: "request-a", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z" };
  const otherContext = { ...context, organizationId: "org-b", actorUserId: "user-b", subjectUserId: "user-b", sessionId: "session-b", requestId: "request-b" };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-platform-service-"));
  const databasePath = path.join(tempDir, "platform.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => fixed });
  const options = (expectedTenantRevision, idempotencyKey, expectedRecordRevision = 0) => ({ expectedTenantRevision, expectedRecordRevision, idempotencyKey, occurredAt: fixed, validation: { now: fixed } });

  service.persistUserIntelligenceState(repository, context, { revision: 1, savedSearches: [{ id: "search-1", name: "Infill", createdAt: fixed }], watchlists: [], updatedAt: fixed }, options(0, "user-state-1"));
  assert.equal(service.loadUserIntelligenceState(repository, context, { validation: { now: fixed } }).savedSearches[0].name, "Infill");
  assert.equal(service.loadUserIntelligenceState(repository, otherContext, { validation: { now: fixed } }), null);

  const organization = collaboration.createOrganization({ id: "org-a", name: "Rabbit Capital", createdAt: fixed });
  const member = collaboration.createMembership({ organizationId: "org-a", userId: "user-a", role: "owner", createdAt: fixed });
  const collaborationState = collaboration.createCollaborationState({ organizations: [organization], memberships: [member], updatedAt: fixed });
  service.persistCollaborationState(repository, context, collaborationState, options(1, "collaboration-state-1"));
  assert.equal(service.loadCollaborationState(repository, context, { validation: { now: fixed } }).organizations[0].id, "org-a");
  assert.throws(() => service.persistCollaborationState(repository, context, { organizations: [collaboration.createOrganization({ id: "org-b", name: "Foreign", createdAt: fixed })], updatedAt: fixed }, options(2, "foreign-state")), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const subscription = alerts.createAlertSubscription({ id: "sub-1", organizationId: "org-a", ownerUserId: "user-a", sourceId: "watch-1", createdAt: fixed });
  service.persistAlertRoutingState(repository, context, alerts.createAlertRoutingState({ subscriptions: [subscription], updatedAt: fixed }), options(2, "alert-state-1"));
  assert.equal(service.loadAlertRoutingState(repository, context, { validation: { now: fixed } }).subscriptions.length, 1);
  const profile = { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A1", lineage: { sourceDatasetId: "dcad" } };
  const snapshot = alerts.createPropertySnapshot({ profile, capturedAt: fixed });
  service.persistPropertySnapshot(repository, context, snapshot, options(3, "snapshot-1"));
  assert.equal(service.listPropertySnapshots(repository, context, { validation: { now: fixed } })[0].whiteRabbitPropertyId, profile.whiteRabbitPropertyId);
  service.persistDeliveryAttempt(repository, context, { id: "delivery-1", organizationId: "org-a", status: "queued", createdAt: fixed }, options(4, "delivery-1"));
  assert.equal(service.listDeliveryAttempts(repository, context, { validation: { now: fixed } }).length, 1);
  assert.equal(service.listDeliveryAttempts(repository, otherContext, { validation: { now: fixed } }).length, 0);
  assert.throws(() => service.persistDeliveryAttempt(repository, context, { id: "delivery-bad", organizationId: "org-b" }, options(5, "delivery-bad")), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  service.persistAlertWorkerState(repository, context, { organizationId: "org-a", updatedAt: fixed }, options(5, "alert-worker-state-1"));
  assert.equal(service.loadAlertWorkerState(repository, context, { validation: { now: fixed } }).organizationId, "org-a");
  assert.equal(service.loadAlertWorkerState(repository, otherContext, { validation: { now: fixed } }), null);
  assert.throws(() => service.persistAlertWorkerState(repository, context, { organizationId: "org-b", updatedAt: fixed }, options(6, "foreign-alert-worker")), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  assert.equal(repository.tenantRevision(context, { now: fixed }), 6);
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  console.log("White Rabbit domain persistence orchestration tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
