const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const persistence = await import("../src/persistence/platformPersistenceService.mjs");
  const worker = await import("../src/alerts/alertDeliveryWorker.mjs");
  const scheduler = await import("../src/alerts/alertWorkerScheduler.mjs");
  const fixed = "2026-08-14T13:00:00.000Z";
  const context = { organizationId: "org-a", actorUserId: "worker-service", subjectUserId: "worker-service", sessionId: "worker-session", requestId: "scheduler-request", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z" };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-scheduler-"));
  const databasePath = path.join(tempDir, "scheduler.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => fixed });
  let state = worker.createAlertWorkerState({ organizationId: "org-a", updatedAt: fixed });
  state = worker.enqueueDeliveryAttempts(state, [{ id: "attempt-1", status: "queued", alertEnvelopeId: "alert-1", subscriptionId: "sub-1", channelType: "email", endpointRef: "secret-ref:email", scheduledFor: fixed, createdAt: fixed }], { createdAt: fixed, payloadRef: "payload-ref:alert-1", providerIdForChannel: () => "email-primary" });
  persistence.persistAlertWorkerState(repository, context, state, { expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "seed-worker-state", occurredAt: fixed, validation: { now: fixed } });
  let providerCalls = 0;
  const provider = { send: async (request) => {
    providerCalls += 1;
    const persistedDuringSend = repository.readRecord(context, "alert-worker", "state", { now: fixed });
    assert.equal(persistedDuringSend.value.jobs.find((job) => job.id === request.jobId).status, "leased", "lease must be durably committed before provider execution");
    return { success: true, providerMessageId: "provider-message-1" };
  } };
  const run = await scheduler.runAlertWorkerCycle({ repository, context, workerId: "worker-1", now: fixed, clock: () => "2026-08-14T13:00:01.000Z", leaseSeconds: 30, providerTimeoutMs: 5000, providerRegistry: { "email-primary": provider } });
  assert.equal(run.schemaVersion, "wr-alert-scheduler-run-v1");
  assert.deepEqual(run.deliveredJobIds, ["attempt-1"]);
  assert.equal(run.retryScheduledJobIds.length, 0);
  assert.equal(run.leaseReceipt.tenantRevision, 2);
  assert.equal(run.completionReceipt.tenantRevision, 3);
  assert.equal(repository.readRecord(context, "alert-worker", "state", { now: fixed }).value.jobs[0].status, "delivered");
  assert.equal(providerCalls, 1);
  const emptyRun = await scheduler.runAlertWorkerCycle({ repository, context, workerId: "worker-1", now: "2026-08-14T13:00:02.000Z", providerRegistry: { "email-primary": provider } });
  assert.equal(emptyRun.leasedJobIds.length, 0);
  assert.equal(emptyRun.leaseReceipt, null);
  assert.equal(providerCalls, 1);
  let nextState = repository.readRecord(context, "alert-worker", "state", { now: fixed }).value;
  nextState = worker.enqueueDeliveryAttempts(nextState, [{ id: "attempt-2", status: "queued", alertEnvelopeId: "alert-2", subscriptionId: "sub-1", channelType: "email", endpointRef: "secret-ref:email", scheduledFor: "2026-08-14T13:01:00.000Z", createdAt: fixed }], { createdAt: "2026-08-14T13:01:00.000Z", payloadRef: "payload-ref:alert-2", providerIdForChannel: () => "missing-provider" });
  persistence.persistAlertWorkerState(repository, context, nextState, { expectedTenantRevision: 3, expectedRecordRevision: 3, idempotencyKey: "seed-missing-provider", occurredAt: "2026-08-14T13:01:00.000Z", validation: { now: "2026-08-14T13:01:00.000Z" } });
  const missingProviderRun = await scheduler.runAlertWorkerCycle({ repository, context, workerId: "worker-1", now: "2026-08-14T13:01:00.000Z", clock: () => "2026-08-14T13:01:01.000Z", providerRegistry: {} });
  assert.deepEqual(missingProviderRun.retryScheduledJobIds, ["attempt-2"]);
  assert.equal(repository.readRecord(context, "alert-worker", "state", { now: "2026-08-14T13:01:01.000Z" }).value.jobs.find((job) => job.id === "attempt-2").lastErrorCode, "provider-not-configured");
  await assert.rejects(() => scheduler.runAlertWorkerCycle({ repository, context, workerId: "worker-1", now: fixed, leaseSeconds: 5, providerTimeoutMs: 5000 }), /shorter than the worker lease/);
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  console.log("White Rabbit durable alert scheduler lease-before-send and completion persistence tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
