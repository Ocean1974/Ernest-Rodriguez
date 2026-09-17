const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-persistence-"));
  const databasePath = path.join(tempDir, "platform.sqlite");
  const fixed = "2026-08-14T13:00:00.000Z";
  const context = (organizationId, actorUserId, requestId) => ({
    organizationId, actorUserId, subjectUserId: actorUserId, sessionId: `session-${actorUserId}`, requestId,
    grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z",
  });
  const orgA = context("org-a", "user-a", "request-1");
  const orgB = context("org-b", "user-b", "request-2");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => fixed });
  assert.deepEqual(repository.schemaState(), { schemaVersion: 2, integrity: "ok", migrations: [{ version: 1, migrationId: "001-tenant-records-idempotency", appliedAt: fixed }, { version: 2, migrationId: "002-tamper-evident-audit-log", appliedAt: fixed }] });

  const put = { context: orgA, namespace: "user-intelligence", key: "user-a", value: { schemaVersion: "wr-user-intelligence-state-v1", revision: 1, savedSearches: [], watchlists: [] }, expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "save-user-intel-1", occurredAt: fixed };
  const receipt = repository.commit(put, { now: fixed });
  assert.equal(receipt.schemaVersion, "wr-persistence-receipt-v1");
  assert.equal(receipt.tenantRevision, 1);
  assert.equal(receipt.recordRevision, 1);
  assert.match(receipt.valueSha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.replayed, false);
  const replay = repository.commit(put, { now: fixed });
  assert.equal(replay.replayed, true);
  assert.equal(repository.tenantRevision(orgA, { now: fixed }), 1, "idempotent replay must not advance revision");
  assert.throws(() => repository.commit({ ...put, value: { changed: true } }, { now: fixed }), (error) => error.code === "WR_IDEMPOTENCY_CONFLICT");
  assert.throws(() => repository.commit({ ...put, idempotencyKey: "stale", value: { changed: true } }, { now: fixed }), (error) => error.code === "WR_PERSISTENCE_CONFLICT");
  assert.equal(repository.tenantRevision(orgA, { now: fixed }), 1, "failed transactions must roll back");
  assert.equal(repository.readRecord(orgB, "user-intelligence", "user-a", { now: fixed }), null, "another tenant must not read the record");
  assert.equal(repository.listRecords(orgB, "user-intelligence", { now: fixed }).length, 0);
  assert.throws(() => repository.commit({ ...put, context: orgA, expectedTenantRevision: 1, expectedRecordRevision: 1, idempotencyKey: "cross-tenant", value: { organizations: [{ id: "org-b", organizationId: "org-b" }] } }, { now: fixed }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const update = repository.commit({ ...put, expectedTenantRevision: 1, expectedRecordRevision: 1, idempotencyKey: "save-user-intel-2", value: { ...put.value, revision: 2, savedSearches: [{ id: "search-1" }] } }, { now: fixed });
  assert.equal(update.tenantRevision, 2);
  assert.equal(update.recordRevision, 2);
  assert.equal(repository.readRecord(orgA, "user-intelligence", "user-a", { now: fixed }).value.savedSearches.length, 1);
  assert.equal(repository.exportAuditLog(orgA, { now: fixed, exportedAt: fixed }).verification.entryCount, 2);
  repository.close();

  const reopened = new SqlitePlatformRepository({ filename: databasePath, clock: () => fixed });
  assert.equal(reopened.schemaState().integrity, "ok");
  assert.equal(reopened.tenantRevision(orgA, { now: fixed }), 2);
  assert.equal(reopened.readRecord(orgA, "user-intelligence", "user-a", { now: fixed }).revision, 2, "committed state must survive repository restart");
  assert.equal(reopened.readRecord(orgB, "user-intelligence", "user-a", { now: fixed }), null);
  const deleted = reopened.commit({ context: orgA, namespace: "user-intelligence", key: "user-a", operation: "delete", expectedTenantRevision: 2, expectedRecordRevision: 2, idempotencyKey: "delete-user-intel", occurredAt: fixed }, { now: fixed });
  assert.equal(deleted.recordRevision, 0);
  assert.equal(reopened.readRecord(orgA, "user-intelligence", "user-a", { now: fixed }), null);
  reopened.close();

  const legacyPath = path.join(tempDir, "legacy-v1.sqlite");
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE wr_tenant_revisions (organization_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE wr_records (organization_id TEXT NOT NULL, namespace TEXT NOT NULL, record_key TEXT NOT NULL, revision INTEGER NOT NULL, value_json TEXT NOT NULL, value_sha256 TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (organization_id, namespace, record_key));
    CREATE TABLE wr_idempotency (organization_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_sha256 TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (organization_id, idempotency_key));
    CREATE TABLE wr_schema_migrations (version INTEGER PRIMARY KEY, migration_id TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);
    INSERT INTO wr_tenant_revisions VALUES ('legacy-org', 7);
    INSERT INTO wr_records VALUES ('legacy-org', 'user-intelligence', 'legacy-user', 3, '{}', 'legacy-digest', '${fixed}', 'legacy-user');
    INSERT INTO wr_schema_migrations VALUES (1, '001-tenant-records-idempotency', '${fixed}');
    PRAGMA user_version = 1;
  `);
  legacy.close();
  const migrated = new SqlitePlatformRepository({ filename: legacyPath, clock: () => fixed });
  const legacyContext = context("legacy-org", "legacy-user", "legacy-request");
  const genesisAudit = migrated.exportAuditLog(legacyContext, { now: fixed, exportedAt: fixed });
  assert.equal(migrated.schemaState().schemaVersion, 2);
  assert.equal(genesisAudit.entries.length, 1);
  assert.equal(genesisAudit.entries[0].action, "audit.genesis");
  assert.equal(genesisAudit.entries[0].details.tenantRevision, 7);
  assert.equal(genesisAudit.entries[0].details.recordCount, 1);
  migrated.close();

  for (const base of [databasePath, legacyPath]) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const target = `${base}${suffix}`;
      if (fs.existsSync(target)) fs.rmSync(target);
    }
  }
  fs.rmdirSync(tempDir);
  console.log("White Rabbit SQLite durable repository, idempotency, recovery, and tenant-isolation tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
