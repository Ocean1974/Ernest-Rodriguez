const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const { SqlitePlatformRepository, verifyAuditLog } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const operations = await import("../src/persistence/backupRecovery.mjs");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-backup-"));
  const databasePath = path.join(tempDir, "operations.sqlite");
  const context = (organizationId, actorUserId) => ({ organizationId, actorUserId, subjectUserId: actorUserId, sessionId: `session-${actorUserId}`, requestId: `request-${actorUserId}`, grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-14T20:00:00.000Z" });
  const orgA = context("org-a", "operator-a");
  const orgB = context("org-b", "operator-b");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => "2026-08-14T13:00:00.000Z" });
  const put = (ctx, namespace, key, value, expectedTenantRevision, idempotencyKey, occurredAt) => repository.commit({ context: ctx, namespace, key, value, expectedTenantRevision, expectedRecordRevision: 0, idempotencyKey, occurredAt }, { now: "2026-08-14T13:00:00.000Z" });
  put(orgA, "user-intelligence", "operator-a", { organizationId: "org-a", value: "Confidential Acquisition" }, 0, "a-initial", "2026-08-14T13:00:00.000Z");
  put(orgB, "user-intelligence", "operator-b", { organizationId: "org-b", value: "Other Tenant" }, 0, "b-initial", "2026-08-14T13:00:00.000Z");
  const keyMaterial = "correct horse battery staple for backup tests";
  const backup = operations.createEncryptedTenantBackup({ repository, context: orgA, keyMaterial, keyId: "kms-key-2026-08", createdAt: "2026-08-14T14:00:00.000Z" });
  assert.equal(backup.schemaVersion, "wr-encrypted-backup-bundle-v1");
  assert.equal(backup.recordCount, 1);
  assert.equal(backup.sourceTenantRevision, 1);
  assert.equal(JSON.stringify(backup).includes("Confidential Acquisition"), false, "encrypted bundle must not expose plaintext records");
  assert.equal(JSON.stringify(backup).includes(keyMaterial), false, "encrypted bundle must not contain key material");
  assert.equal(operations.decryptTenantBackup(backup, { keyMaterial, expectedOrganizationId: "org-a" }).records[0].value.value, "Confidential Acquisition");
  assert.throws(() => operations.decryptTenantBackup(backup, { keyMaterial: "wrong backup key material", expectedOrganizationId: "org-a" }), (error) => error.code === "WR_BACKUP_DECRYPTION_FAILED");
  assert.throws(() => operations.decryptTenantBackup(backup, { keyMaterial, expectedOrganizationId: "org-b" }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  repository.commit({ context: orgA, namespace: "user-intelligence", key: "operator-a", value: { organizationId: "org-a", value: "Changed After Backup" }, expectedTenantRevision: 1, expectedRecordRevision: 1, idempotencyKey: "a-update", occurredAt: "2026-08-14T15:00:00.000Z" }, { now: "2026-08-14T15:00:00.000Z" });
  const restored = operations.restoreEncryptedTenantBackup({ repository, context: orgA, bundle: backup, keyMaterial, expectedTenantRevision: 2, idempotencyKey: "restore-a", occurredAt: "2026-08-14T16:00:00.000Z" });
  assert.equal(restored.receipt.restoredRecordCount, 1);
  assert.equal(restored.receipt.tenantRevision, 3);
  assert.equal(repository.readRecord(orgA, "user-intelligence", "operator-a", { now: "2026-08-14T16:00:00.000Z" }).value.value, "Confidential Acquisition", "restore must recover the point-in-time value");
  assert.equal(repository.readRecord(orgB, "user-intelligence", "operator-b", { now: "2026-08-14T16:00:00.000Z" }).value.value, "Other Tenant");

  put(orgA, "property-snapshots", "snapshot-old", { organizationId: "org-a", capturedAt: "2026-01-01T00:00:00.000Z" }, 3, "snapshot-old", "2026-01-01T00:00:00.000Z");
  put(orgA, "property-snapshots", "snapshot-new", { organizationId: "org-a", capturedAt: "2026-08-14T16:30:00.000Z" }, 4, "snapshot-new", "2026-08-14T16:30:00.000Z");
  put(orgA, "delivery-attempts", "delivery-old", { organizationId: "org-a", status: "delivered" }, 5, "delivery-old", "2026-01-01T00:00:00.000Z");
  put(orgA, "collaboration", "state", { organizationId: "org-a", activity: [{ action: "deal.created" }] }, 6, "collaboration-history", "2026-01-01T00:00:00.000Z");
  put(orgB, "property-snapshots", "snapshot-b-old", { organizationId: "org-b" }, 1, "snapshot-b-old", "2026-01-01T00:00:00.000Z");
  const preRetentionBackup = operations.createEncryptedTenantBackup({ repository, context: orgA, keyMaterial, keyId: "kms-key-2026-08", createdAt: "2026-08-14T17:00:00.000Z" });
  const policy = operations.createRetentionPolicy({ organizationId: "org-a", now: "2026-08-14T17:00:00.000Z", snapshotDays: 30, deliveryAttemptDays: 30, retainSnapshotsAtLeast: 1 });
  assert(policy.protectedNamespaces.includes("collaboration"));
  assert(policy.protectedNamespaces.includes("release-control"));
  const retention = operations.applyRetentionPolicy({ repository, context: orgA, policy, backupSnapshotSha256: preRetentionBackup.snapshotSha256, expectedTenantRevision: 7, idempotencyKey: "retention-a", occurredAt: "2026-08-14T17:05:00.000Z" });
  assert.equal(retention.deletedByNamespace["property-snapshots"], 1);
  assert.equal(retention.deletedByNamespace["delivery-attempts"], 1);
  assert.equal(repository.listRecords(orgA, "property-snapshots", { now: "2026-08-14T17:05:00.000Z" })[0].key, "snapshot-new");
  assert.equal(repository.readRecord(orgA, "collaboration", "state", { now: "2026-08-14T17:05:00.000Z" }).value.activity.length, 1, "collaboration history must remain protected");
  assert.equal(repository.listRecords(orgB, "property-snapshots", { now: "2026-08-14T17:05:00.000Z" }).length, 1, "retention must not affect another tenant");
  assert.throws(() => repository.pruneTenantRecords(orgA, [{ namespace: "collaboration", before: "2026-08-14T17:00:00.000Z" }], { expectedTenantRevision: 8, idempotencyKey: "bad-retention", occurredAt: "2026-08-14T17:10:00.000Z", backupSnapshotSha256: preRetentionBackup.snapshotSha256, validation: { now: "2026-08-14T17:10:00.000Z" } }), /not permitted/);

  const audit = operations.createImmutableAuditExport({ repository, context: orgA, exportedAt: "2026-08-14T17:10:00.000Z" });
  assert.equal(audit.verification.valid, true);
  assert.equal(audit.entries.length, 8);
  assert.match(audit.exportSha256, /^[a-f0-9]{64}$/);
  const tampered = audit.entries.map((entry) => ({ ...entry, details: { ...entry.details } }));
  tampered[1].details.key = "tampered";
  assert.equal(verifyAuditLog(tampered).valid, false);

  const healthy = operations.buildOperationalHealthReport({ repository, context: orgA, now: "2026-08-14T18:00:00.000Z", backupInventory: [preRetentionBackup], workerState: { organizationId: "org-a", jobs: [] }, circuitStates: [] });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.database.schemaVersion, 2);
  assert.equal(healthy.database.auditValid, true);
  const critical = operations.buildOperationalHealthReport({ repository, context: orgA, now: "2026-08-14T18:00:00.000Z", backupInventory: [{ ...preRetentionBackup, createdAt: "2026-08-01T00:00:00.000Z" }], workerState: { organizationId: "org-a", jobs: [{ status: "dead-lettered" }, { status: "leased", lease: { expiresAt: "2026-08-14T17:00:00.000Z" } }] }, circuitStates: [{ status: "open" }], thresholds: { maxBackupAgeHours: 24 } });
  assert.equal(critical.status, "critical");
  assert(critical.findings.some((finding) => finding.code === "backup-stale"));
  assert(critical.findings.some((finding) => finding.code === "expired-worker-leases"));
  assert(critical.findings.some((finding) => finding.code === "provider-circuit-open"));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "persistence-operations.schema.json"), "utf8"));
  assert.equal(schema.$defs.encryptedBackup.properties.schemaVersion.const, "wr-encrypted-backup-bundle-v1");
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  console.log("White Rabbit encrypted backup, point-in-time restore, protected retention, immutable audit, and operational health tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
