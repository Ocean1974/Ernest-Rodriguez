import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PERSISTENCE_RECEIPT_VERSION,
  PERSISTENCE_BATCH_RECEIPT_VERSION,
  PERSISTENCE_SCHEMA_VERSION,
  PERSISTENCE_NAMESPACES,
  assertPersistenceGrant,
  assertReadContext,
  assertTenantBoundValue,
  createPersistenceMutation,
  createPersistenceBatchMutation,
} from "./persistenceContracts.mjs";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function persistenceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function namespaceValue(value) {
  const normalized = String(value || "");
  if (!PERSISTENCE_NAMESPACES.includes(normalized)) throw new TypeError(`Unsupported persistence namespace: ${normalized}`);
  return normalized;
}

function auditCore(entry) {
  return {
    organizationId: entry.organizationId,
    sequence: Number(entry.sequence),
    eventId: entry.eventId,
    action: entry.action,
    actorUserId: entry.actorUserId,
    occurredAt: entry.occurredAt,
    details: entry.details || {},
    previousHash: entry.previousHash || "",
  };
}

export function verifyAuditLog(entries = []) {
  let previousHash = "";
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (Number(entry.sequence) !== index + 1) return { valid: false, entryCount: entries.length, invalidSequence: Number(entry.sequence), reason: "sequence-gap" };
    if (entry.previousHash !== previousHash) return { valid: false, entryCount: entries.length, invalidSequence: Number(entry.sequence), reason: "previous-hash-mismatch" };
    const expected = digest(auditCore(entry));
    if (entry.entryHash !== expected) return { valid: false, entryCount: entries.length, invalidSequence: Number(entry.sequence), reason: "entry-hash-mismatch" };
    previousHash = entry.entryHash;
  }
  return { valid: true, entryCount: entries.length, headHash: previousHash };
}

export class SqlitePlatformRepository {
  constructor({ filename, clock = () => new Date().toISOString() } = {}) {
    if (!filename) throw new TypeError("filename is required");
    this.filename = filename;
    this.clock = clock;
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    this.#migrate();
  }

  #migrate() {
    const version = Number(this.database.prepare("PRAGMA user_version").get().user_version || 0);
    if (version > PERSISTENCE_SCHEMA_VERSION) throw persistenceError("WR_PERSISTENCE_SCHEMA_TOO_NEW", `Database schema ${version} is newer than supported schema ${PERSISTENCE_SCHEMA_VERSION}`);
    if (version < 1) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS wr_tenant_revisions (
          organization_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK (revision >= 0)
        );
        CREATE TABLE IF NOT EXISTS wr_records (
          organization_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          record_key TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          value_json TEXT NOT NULL,
          value_sha256 TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          PRIMARY KEY (organization_id, namespace, record_key)
        );
        CREATE INDEX IF NOT EXISTS wr_records_tenant_namespace ON wr_records (organization_id, namespace, updated_at);
        CREATE TABLE IF NOT EXISTS wr_idempotency (
          organization_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_sha256 TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (organization_id, idempotency_key)
        );
        CREATE TABLE IF NOT EXISTS wr_schema_migrations (
          version INTEGER PRIMARY KEY,
          migration_id TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO wr_schema_migrations(version, migration_id, applied_at)
          VALUES (1, '001-tenant-records-idempotency', '${this.clock().replaceAll("'", "''")}');
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
    if (version < 2) {
      this.database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS wr_audit_log (
          organization_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence >= 1),
          event_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          details_json TEXT NOT NULL,
          previous_hash TEXT NOT NULL,
          entry_hash TEXT NOT NULL,
          PRIMARY KEY (organization_id, sequence),
          UNIQUE (organization_id, event_id)
        );
        CREATE INDEX IF NOT EXISTS wr_audit_log_tenant_time ON wr_audit_log (organization_id, occurred_at);
        INSERT OR IGNORE INTO wr_schema_migrations(version, migration_id, applied_at)
          VALUES (2, '002-tamper-evident-audit-log', '${this.clock().replaceAll("'", "''")}');
      `);
      try {
        const tenants = this.database.prepare("SELECT organization_id, revision FROM wr_tenant_revisions ORDER BY organization_id").all();
        for (const tenant of tenants) {
          const existingAudit = this.database.prepare("SELECT COUNT(*) AS count FROM wr_audit_log WHERE organization_id = ?").get(tenant.organization_id);
          if (Number(existingAudit.count) > 0) continue;
          const inventory = this.database.prepare("SELECT namespace, record_key AS key, revision, value_sha256 AS valueSha256, updated_at AS updatedAt FROM wr_records WHERE organization_id = ? ORDER BY namespace, record_key").all(tenant.organization_id);
          this.#appendAudit({ organizationId: tenant.organization_id, actorUserId: "system:migration" }, { eventId: "migration:002-genesis", action: "audit.genesis", occurredAt: this.clock(), details: { tenantRevision: Number(tenant.revision), recordCount: inventory.length, inventorySha256: digest(inventory) } });
        }
        this.database.exec("PRAGMA user_version = 2; COMMIT;");
      } catch (error) {
        try { this.database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    }
  }

  #appendAudit(context, { eventId, action, occurredAt, details }) {
    const previous = this.database.prepare("SELECT sequence, entry_hash FROM wr_audit_log WHERE organization_id = ? ORDER BY sequence DESC LIMIT 1").get(context.organizationId);
    const entry = auditCore({
      organizationId: context.organizationId,
      sequence: Number(previous?.sequence || 0) + 1,
      eventId,
      action,
      actorUserId: context.actorUserId,
      occurredAt,
      details,
      previousHash: String(previous?.entry_hash || ""),
    });
    const entryHash = digest(entry);
    this.database.prepare("INSERT INTO wr_audit_log(organization_id, sequence, event_id, action, actor_user_id, occurred_at, details_json, previous_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      entry.organizationId, entry.sequence, entry.eventId, entry.action, entry.actorUserId, entry.occurredAt, canonicalJson(entry.details), entry.previousHash, entryHash,
    );
    return { ...entry, entryHash };
  }

  schemaState() {
    const integrity = this.database.prepare("PRAGMA integrity_check").get().integrity_check;
    return {
      schemaVersion: Number(this.database.prepare("PRAGMA user_version").get().user_version),
      integrity,
      migrations: this.database.prepare("SELECT version, migration_id AS migrationId, applied_at AS appliedAt FROM wr_schema_migrations ORDER BY version").all(),
    };
  }

  tenantRevision(contextInput, options = {}) {
    const context = assertReadContext(contextInput, options);
    return Number(this.database.prepare("SELECT revision FROM wr_tenant_revisions WHERE organization_id = ?").get(context.organizationId)?.revision || 0);
  }

  readRecord(contextInput, namespace, key, options = {}) {
    const context = assertReadContext(contextInput, options);
    const normalizedNamespace = namespaceValue(namespace);
    const row = this.database.prepare("SELECT revision, value_json, value_sha256, updated_at, updated_by FROM wr_records WHERE organization_id = ? AND namespace = ? AND record_key = ?").get(context.organizationId, normalizedNamespace, String(key));
    if (!row) return null;
    const value = JSON.parse(row.value_json);
    if (digest(value) !== row.value_sha256) throw persistenceError("WR_PERSISTENCE_INTEGRITY_FAILURE", `Digest mismatch for ${namespace}/${key}`);
    return { organizationId: context.organizationId, namespace: normalizedNamespace, key: String(key), revision: Number(row.revision), value, valueSha256: row.value_sha256, updatedAt: row.updated_at, updatedBy: row.updated_by };
  }

  listRecords(contextInput, namespace, options = {}) {
    const context = assertReadContext(contextInput, options);
    const normalizedNamespace = namespaceValue(namespace);
    return this.database.prepare("SELECT record_key AS key, revision, value_json AS valueJson, value_sha256 AS valueSha256, updated_at AS updatedAt, updated_by AS updatedBy FROM wr_records WHERE organization_id = ? AND namespace = ? ORDER BY record_key").all(context.organizationId, normalizedNamespace).map((row) => {
      const value = JSON.parse(row.valueJson);
      if (digest(value) !== row.valueSha256) throw persistenceError("WR_PERSISTENCE_INTEGRITY_FAILURE", `Digest mismatch for ${namespace}/${row.key}`);
      return { organizationId: context.organizationId, namespace: normalizedNamespace, key: row.key, revision: Number(row.revision), value, valueSha256: row.valueSha256, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
    });
  }

  listRecordsPage(contextInput, namespace, options = {}) {
    const context = assertReadContext(contextInput, options.validation || options);
    const normalizedNamespace = namespaceValue(namespace);
    const keyPrefix = String(options.keyPrefix || "");
    const afterKey = String(options.afterKey || "");
    const limit = Math.max(1, Math.min(1000, Math.trunc(Number(options.limit) || 100)));
    const rows = this.database.prepare(`SELECT record_key AS key, revision, value_json AS valueJson, value_sha256 AS valueSha256, updated_at AS updatedAt, updated_by AS updatedBy
      FROM wr_records
      WHERE organization_id = ? AND namespace = ? AND substr(record_key, 1, length(?)) = ? AND record_key > ?
      ORDER BY record_key LIMIT ?`).all(context.organizationId, normalizedNamespace, keyPrefix, keyPrefix, afterKey, limit + 1);
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit).map((row) => {
      const value = JSON.parse(row.valueJson);
      if (digest(value) !== row.valueSha256) throw persistenceError("WR_PERSISTENCE_INTEGRITY_FAILURE", `Digest mismatch for ${namespace}/${row.key}`);
      return { organizationId: context.organizationId, namespace: normalizedNamespace, key: row.key, revision: Number(row.revision), value, valueSha256: row.valueSha256, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
    });
    return { records: selected, nextKey: hasMore ? selected.at(-1)?.key || "" : "", hasMore };
  }

  readIdempotencyReceipt(contextInput, idempotencyKey, options = {}) {
    const context = assertReadContext(contextInput, options);
    const key = String(idempotencyKey || "").trim();
    if (!key) throw new TypeError("idempotencyKey is required");
    const row = this.database.prepare("SELECT receipt_json AS receiptJson FROM wr_idempotency WHERE organization_id = ? AND idempotency_key = ?").get(context.organizationId, key);
    return row ? JSON.parse(row.receiptJson) : null;
  }

  commit(input, options = {}) {
    const mutation = createPersistenceMutation(input, options);
    const requestSha256 = digest({
      organizationId: mutation.context.organizationId,
      actorUserId: mutation.context.actorUserId,
      namespace: mutation.namespace,
      key: mutation.key,
      operation: mutation.operation,
      value: mutation.value,
      expectedTenantRevision: mutation.expectedTenantRevision,
      expectedRecordRevision: mutation.expectedRecordRevision,
      occurredAt: mutation.occurredAt,
    });
    const db = this.database;
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db.prepare("SELECT request_sha256, receipt_json FROM wr_idempotency WHERE organization_id = ? AND idempotency_key = ?").get(mutation.context.organizationId, mutation.idempotencyKey);
      if (prior) {
        if (prior.request_sha256 !== requestSha256) throw persistenceError("WR_IDEMPOTENCY_CONFLICT", `Idempotency key ${mutation.idempotencyKey} was already used for a different request`);
        db.exec("COMMIT");
        return { ...JSON.parse(prior.receipt_json), replayed: true };
      }
      const tenantRevision = Number(db.prepare("SELECT revision FROM wr_tenant_revisions WHERE organization_id = ?").get(mutation.context.organizationId)?.revision || 0);
      if (tenantRevision !== mutation.expectedTenantRevision) throw persistenceError("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${mutation.expectedTenantRevision}, found ${tenantRevision}`, { expectedRevision: mutation.expectedTenantRevision, actualRevision: tenantRevision });
      const existing = db.prepare("SELECT revision FROM wr_records WHERE organization_id = ? AND namespace = ? AND record_key = ?").get(mutation.context.organizationId, mutation.namespace, mutation.key);
      const recordRevision = Number(existing?.revision || 0);
      if (mutation.expectedRecordRevision !== undefined && recordRevision !== mutation.expectedRecordRevision) throw persistenceError("WR_PERSISTENCE_CONFLICT", `Record revision conflict: expected ${mutation.expectedRecordRevision}, found ${recordRevision}`, { expectedRevision: mutation.expectedRecordRevision, actualRevision: recordRevision });
      const nextTenantRevision = tenantRevision + 1;
      const nextRecordRevision = recordRevision + 1;
      if (mutation.operation === "delete") {
        db.prepare("DELETE FROM wr_records WHERE organization_id = ? AND namespace = ? AND record_key = ?").run(mutation.context.organizationId, mutation.namespace, mutation.key);
      } else {
        const valueJson = canonicalJson(mutation.value);
        const valueSha256 = digest(mutation.value);
        db.prepare(`INSERT INTO wr_records(organization_id, namespace, record_key, revision, value_json, value_sha256, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, namespace, record_key) DO UPDATE SET revision=excluded.revision, value_json=excluded.value_json, value_sha256=excluded.value_sha256, updated_at=excluded.updated_at, updated_by=excluded.updated_by`).run(
          mutation.context.organizationId, mutation.namespace, mutation.key, nextRecordRevision, valueJson, valueSha256, mutation.occurredAt, mutation.context.actorUserId,
        );
      }
      db.prepare("INSERT INTO wr_tenant_revisions(organization_id, revision) VALUES (?, ?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision").run(mutation.context.organizationId, nextTenantRevision);
      const receipt = {
        schemaVersion: PERSISTENCE_RECEIPT_VERSION,
        organizationId: mutation.context.organizationId,
        namespace: mutation.namespace,
        key: mutation.key,
        operation: mutation.operation,
        tenantRevision: nextTenantRevision,
        recordRevision: mutation.operation === "delete" ? 0 : nextRecordRevision,
        valueSha256: mutation.operation === "delete" ? "" : digest(mutation.value),
        idempotencyKey: mutation.idempotencyKey,
        committedAt: mutation.occurredAt,
        actorUserId: mutation.context.actorUserId,
        requestId: mutation.context.requestId,
        replayed: false,
      };
      this.#appendAudit(mutation.context, {
        eventId: `mutation:${mutation.idempotencyKey}`,
        action: mutation.operation === "delete" ? "record.deleted" : "record.put",
        occurredAt: mutation.occurredAt,
        details: { namespace: mutation.namespace, key: mutation.key, tenantRevision: nextTenantRevision, recordRevision: receipt.recordRevision, valueSha256: receipt.valueSha256 },
      });
      db.prepare("INSERT INTO wr_idempotency(organization_id, idempotency_key, request_sha256, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)").run(mutation.context.organizationId, mutation.idempotencyKey, requestSha256, JSON.stringify(receipt), mutation.occurredAt);
      db.exec("COMMIT");
      return receipt;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  commitMany(input, options = {}) {
    const batch = createPersistenceBatchMutation(input, options);
    const requestSha256 = digest({
      organizationId: batch.context.organizationId,
      actorUserId: batch.context.actorUserId,
      mutations: batch.mutations,
      expectedTenantRevision: batch.expectedTenantRevision,
      requestFingerprint: batch.requestFingerprint,
      responseMetadata: batch.responseMetadata,
      occurredAt: batch.occurredAt,
    });
    const db = this.database;
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db.prepare("SELECT request_sha256, receipt_json FROM wr_idempotency WHERE organization_id = ? AND idempotency_key = ?").get(batch.context.organizationId, batch.idempotencyKey);
      if (prior) {
        if (prior.request_sha256 !== requestSha256) throw persistenceError("WR_IDEMPOTENCY_CONFLICT", `Idempotency key ${batch.idempotencyKey} was already used for a different request`);
        db.exec("COMMIT");
        return { ...JSON.parse(prior.receipt_json), replayed: true };
      }
      const tenantRevision = Number(db.prepare("SELECT revision FROM wr_tenant_revisions WHERE organization_id = ?").get(batch.context.organizationId)?.revision || 0);
      if (tenantRevision !== batch.expectedTenantRevision) throw persistenceError("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${batch.expectedTenantRevision}, found ${tenantRevision}`, { expectedRevision: batch.expectedTenantRevision, actualRevision: tenantRevision });
      const nextTenantRevision = tenantRevision + 1;
      const records = [];
      for (const mutation of batch.mutations) {
        const existing = db.prepare("SELECT revision FROM wr_records WHERE organization_id = ? AND namespace = ? AND record_key = ?").get(batch.context.organizationId, mutation.namespace, mutation.key);
        const recordRevision = Number(existing?.revision || 0);
        if (mutation.expectedRecordRevision !== undefined && recordRevision !== mutation.expectedRecordRevision) throw persistenceError("WR_PERSISTENCE_CONFLICT", `Record revision conflict: expected ${mutation.expectedRecordRevision}, found ${recordRevision}`, { expectedRevision: mutation.expectedRecordRevision, actualRevision: recordRevision });
        const nextRecordRevision = recordRevision + 1;
        if (mutation.operation === "delete") {
          db.prepare("DELETE FROM wr_records WHERE organization_id = ? AND namespace = ? AND record_key = ?").run(batch.context.organizationId, mutation.namespace, mutation.key);
        } else {
          const valueJson = canonicalJson(mutation.value);
          const valueSha256 = digest(mutation.value);
          db.prepare(`INSERT INTO wr_records(organization_id, namespace, record_key, revision, value_json, value_sha256, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, namespace, record_key) DO UPDATE SET revision=excluded.revision, value_json=excluded.value_json, value_sha256=excluded.value_sha256, updated_at=excluded.updated_at, updated_by=excluded.updated_by`).run(
            batch.context.organizationId, mutation.namespace, mutation.key, nextRecordRevision, valueJson, valueSha256, batch.occurredAt, batch.context.actorUserId,
          );
        }
        records.push({ namespace: mutation.namespace, key: mutation.key, operation: mutation.operation, recordRevision: mutation.operation === "delete" ? 0 : nextRecordRevision, valueSha256: mutation.operation === "delete" ? "" : digest(mutation.value) });
      }
      db.prepare("INSERT INTO wr_tenant_revisions(organization_id, revision) VALUES (?, ?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision").run(batch.context.organizationId, nextTenantRevision);
      const receipt = {
        schemaVersion: PERSISTENCE_BATCH_RECEIPT_VERSION,
        organizationId: batch.context.organizationId,
        tenantRevision: nextTenantRevision,
        records,
        mutationCount: records.length,
        idempotencyKey: batch.idempotencyKey,
        requestFingerprint: batch.requestFingerprint,
        responseMetadata: batch.responseMetadata,
        committedAt: batch.occurredAt,
        actorUserId: batch.context.actorUserId,
        requestId: batch.context.requestId,
        replayed: false,
      };
      this.#appendAudit(batch.context, { eventId: `batch:${batch.idempotencyKey}`, action: "records.batch-committed", occurredAt: batch.occurredAt, details: { tenantRevision: nextTenantRevision, mutationCount: records.length, recordsSha256: digest(records) } });
      db.prepare("INSERT INTO wr_idempotency(organization_id, idempotency_key, request_sha256, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)").run(batch.context.organizationId, batch.idempotencyKey, requestSha256, JSON.stringify(receipt), batch.occurredAt);
      db.exec("COMMIT");
      return receipt;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  exportAuditLog(contextInput, options = {}) {
    const context = assertReadContext(contextInput, options);
    const entries = this.database.prepare("SELECT sequence, event_id AS eventId, action, actor_user_id AS actorUserId, occurred_at AS occurredAt, details_json AS detailsJson, previous_hash AS previousHash, entry_hash AS entryHash FROM wr_audit_log WHERE organization_id = ? ORDER BY sequence").all(context.organizationId).map((row) => ({
      organizationId: context.organizationId,
      sequence: Number(row.sequence),
      eventId: row.eventId,
      action: row.action,
      actorUserId: row.actorUserId,
      occurredAt: row.occurredAt,
      details: JSON.parse(row.detailsJson),
      previousHash: row.previousHash,
      entryHash: row.entryHash,
    }));
    const verification = verifyAuditLog(entries);
    if (!verification.valid) throw persistenceError("WR_AUDIT_INTEGRITY_FAILURE", `Audit chain failed at sequence ${verification.invalidSequence}: ${verification.reason}`);
    return { schemaVersion: "wr-immutable-audit-export-v1", organizationId: context.organizationId, exportedAt: String(options.exportedAt || this.clock()), entries, verification };
  }

  exportTenantSnapshot(contextInput, options = {}) {
    const context = assertReadContext(contextInput, options);
    const rows = this.database.prepare("SELECT namespace, record_key AS key, revision, value_json AS valueJson, value_sha256 AS valueSha256, updated_at AS updatedAt, updated_by AS updatedBy FROM wr_records WHERE organization_id = ? ORDER BY namespace, record_key").all(context.organizationId);
    const records = rows.map((row) => {
      const value = JSON.parse(row.valueJson);
      if (digest(value) !== row.valueSha256) throw persistenceError("WR_PERSISTENCE_INTEGRITY_FAILURE", `Digest mismatch for ${row.namespace}/${row.key}`);
      return { namespace: row.namespace, key: row.key, revision: Number(row.revision), value, valueSha256: row.valueSha256, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
    });
    const payload = {
      schemaVersion: "wr-tenant-snapshot-v1",
      organizationId: context.organizationId,
      tenantRevision: this.tenantRevision(context, options),
      exportedAt: String(options.exportedAt || this.clock()),
      records,
      audit: this.exportAuditLog(context, { ...options, exportedAt: options.exportedAt || this.clock() }),
    };
    return { ...payload, snapshotSha256: digest(payload) };
  }

  restoreTenantSnapshot(contextInput, snapshot, options = {}) {
    const context = assertReadContext(contextInput, options.validation || {});
    assertPersistenceGrant(context, "persistence:write");
    if (snapshot?.schemaVersion !== "wr-tenant-snapshot-v1") throw new TypeError("Unsupported tenant snapshot version");
    if (snapshot.organizationId !== context.organizationId) throw persistenceError("WR_TENANT_ISOLATION_VIOLATION", `Snapshot tenant ${snapshot.organizationId} does not match ${context.organizationId}`);
    const payload = { schemaVersion: snapshot.schemaVersion, organizationId: snapshot.organizationId, tenantRevision: snapshot.tenantRevision, exportedAt: snapshot.exportedAt, records: snapshot.records, audit: snapshot.audit };
    if (digest(payload) !== snapshot.snapshotSha256) throw persistenceError("WR_BACKUP_INTEGRITY_FAILURE", "Tenant snapshot digest mismatch");
    const snapshotAuditVerification = verifyAuditLog(snapshot.audit?.entries || []);
    if (!snapshotAuditVerification.valid || snapshot.audit?.organizationId !== context.organizationId) throw persistenceError("WR_BACKUP_INTEGRITY_FAILURE", "Tenant snapshot audit chain is invalid");
    const seenRecords = new Set();
    for (const record of snapshot.records || []) {
      namespaceValue(record.namespace);
      const compositeKey = `${record.namespace}\u0000${record.key}`;
      if (!String(record.key || "") || seenRecords.has(compositeKey) || !Number.isInteger(Number(record.revision)) || Number(record.revision) < 1 || !Number.isFinite(new Date(record.updatedAt).getTime()) || !String(record.updatedBy || "")) throw persistenceError("WR_BACKUP_INTEGRITY_FAILURE", `Invalid snapshot record metadata for ${record.namespace}/${record.key}`);
      seenRecords.add(compositeKey);
      assertTenantBoundValue(record.value, context.organizationId);
      if (digest(record.value) !== record.valueSha256) throw persistenceError("WR_BACKUP_INTEGRITY_FAILURE", `Snapshot record digest mismatch for ${record.namespace}/${record.key}`);
    }
    const expectedTenantRevision = Number(options.expectedTenantRevision);
    const idempotencyKey = String(options.idempotencyKey || "").trim();
    const occurredAt = String(options.occurredAt || "");
    if (!Number.isInteger(expectedTenantRevision) || expectedTenantRevision < 0 || !idempotencyKey || !Number.isFinite(new Date(occurredAt).getTime())) throw new TypeError("expectedTenantRevision, idempotencyKey, and occurredAt are required");
    const requestSha256 = digest({ operation: "tenant.restore", organizationId: context.organizationId, snapshotSha256: snapshot.snapshotSha256, expectedTenantRevision, occurredAt });
    const db = this.database;
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db.prepare("SELECT request_sha256, receipt_json FROM wr_idempotency WHERE organization_id = ? AND idempotency_key = ?").get(context.organizationId, idempotencyKey);
      if (prior) {
        if (prior.request_sha256 !== requestSha256) throw persistenceError("WR_IDEMPOTENCY_CONFLICT", `Idempotency key ${idempotencyKey} was already used for a different request`);
        db.exec("COMMIT");
        return { ...JSON.parse(prior.receipt_json), replayed: true };
      }
      const currentRevision = Number(db.prepare("SELECT revision FROM wr_tenant_revisions WHERE organization_id = ?").get(context.organizationId)?.revision || 0);
      if (currentRevision !== expectedTenantRevision) throw persistenceError("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${expectedTenantRevision}, found ${currentRevision}`, { expectedRevision: expectedTenantRevision, actualRevision: currentRevision });
      db.prepare("DELETE FROM wr_records WHERE organization_id = ?").run(context.organizationId);
      const insert = db.prepare("INSERT INTO wr_records(organization_id, namespace, record_key, revision, value_json, value_sha256, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const record of snapshot.records || []) insert.run(context.organizationId, record.namespace, record.key, Math.max(1, Number(record.revision) || 1), canonicalJson(record.value), record.valueSha256, record.updatedAt, record.updatedBy);
      const nextTenantRevision = currentRevision + 1;
      db.prepare("INSERT INTO wr_tenant_revisions(organization_id, revision) VALUES (?, ?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision").run(context.organizationId, nextTenantRevision);
      const receipt = { schemaVersion: PERSISTENCE_RECEIPT_VERSION, organizationId: context.organizationId, namespace: "tenant-backup", key: snapshot.snapshotSha256, operation: "restore", tenantRevision: nextTenantRevision, recordRevision: 0, valueSha256: snapshot.snapshotSha256, idempotencyKey, committedAt: occurredAt, actorUserId: context.actorUserId, requestId: context.requestId, replayed: false, restoredRecordCount: (snapshot.records || []).length, sourceTenantRevision: Number(snapshot.tenantRevision || 0) };
      this.#appendAudit(context, { eventId: `restore:${idempotencyKey}`, action: "tenant.restored", occurredAt, details: { snapshotSha256: snapshot.snapshotSha256, restoredRecordCount: receipt.restoredRecordCount, sourceTenantRevision: receipt.sourceTenantRevision, tenantRevision: nextTenantRevision } });
      db.prepare("INSERT INTO wr_idempotency(organization_id, idempotency_key, request_sha256, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)").run(context.organizationId, idempotencyKey, requestSha256, JSON.stringify(receipt), occurredAt);
      db.exec("COMMIT");
      return receipt;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  pruneTenantRecords(contextInput, policies = [], options = {}) {
    const context = assertReadContext(contextInput, options.validation || {});
    assertPersistenceGrant(context, "persistence:write");
    const allowed = new Set(["property-snapshots", "delivery-attempts"]);
    const normalizedPolicies = policies.map((policy) => {
      const namespace = namespaceValue(policy.namespace);
      if (!allowed.has(namespace)) throw new TypeError(`Retention is not permitted for namespace: ${namespace}`);
      const before = String(policy.before || "");
      if (!Number.isFinite(new Date(before).getTime())) throw new TypeError("Retention before must be a valid date");
      return { namespace, before, retainAtLeast: Math.max(0, Math.trunc(Number(policy.retainAtLeast) || 0)) };
    });
    const expectedTenantRevision = Number(options.expectedTenantRevision);
    const idempotencyKey = String(options.idempotencyKey || "").trim();
    const occurredAt = String(options.occurredAt || "");
    const backupSnapshotSha256 = String(options.backupSnapshotSha256 || "");
    if (!Number.isInteger(expectedTenantRevision) || expectedTenantRevision < 0 || !idempotencyKey || !Number.isFinite(new Date(occurredAt).getTime()) || !/^[a-f0-9]{64}$/.test(backupSnapshotSha256)) throw new TypeError("expectedTenantRevision, idempotencyKey, occurredAt, and backupSnapshotSha256 are required");
    const requestSha256 = digest({ operation: "tenant.retention", organizationId: context.organizationId, policies: normalizedPolicies, expectedTenantRevision, occurredAt, backupSnapshotSha256 });
    const db = this.database;
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db.prepare("SELECT request_sha256, receipt_json FROM wr_idempotency WHERE organization_id = ? AND idempotency_key = ?").get(context.organizationId, idempotencyKey);
      if (prior) {
        if (prior.request_sha256 !== requestSha256) throw persistenceError("WR_IDEMPOTENCY_CONFLICT", `Idempotency key ${idempotencyKey} was already used for a different request`);
        db.exec("COMMIT");
        return { ...JSON.parse(prior.receipt_json), replayed: true };
      }
      const currentRevision = Number(db.prepare("SELECT revision FROM wr_tenant_revisions WHERE organization_id = ?").get(context.organizationId)?.revision || 0);
      if (currentRevision !== expectedTenantRevision) throw persistenceError("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${expectedTenantRevision}, found ${currentRevision}`, { expectedRevision: expectedTenantRevision, actualRevision: currentRevision });
      const deletedByNamespace = {};
      for (const policy of normalizedPolicies) {
        const total = Number(db.prepare("SELECT COUNT(*) AS count FROM wr_records WHERE organization_id = ? AND namespace = ?").get(context.organizationId, policy.namespace).count);
        const maxDelete = Math.max(0, total - policy.retainAtLeast);
        const candidates = db.prepare("SELECT record_key FROM wr_records WHERE organization_id = ? AND namespace = ? AND updated_at < ? ORDER BY updated_at, record_key LIMIT ?").all(context.organizationId, policy.namespace, policy.before, maxDelete);
        const remove = db.prepare("DELETE FROM wr_records WHERE organization_id = ? AND namespace = ? AND record_key = ?");
        for (const candidate of candidates) remove.run(context.organizationId, policy.namespace, candidate.record_key);
        deletedByNamespace[policy.namespace] = candidates.length;
      }
      const nextTenantRevision = currentRevision + 1;
      db.prepare("INSERT INTO wr_tenant_revisions(organization_id, revision) VALUES (?, ?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision").run(context.organizationId, nextTenantRevision);
      const summarySha256 = digest(deletedByNamespace);
      const receipt = { schemaVersion: PERSISTENCE_RECEIPT_VERSION, organizationId: context.organizationId, namespace: "retention", key: idempotencyKey, operation: "prune", tenantRevision: nextTenantRevision, recordRevision: 0, valueSha256: summarySha256, idempotencyKey, committedAt: occurredAt, actorUserId: context.actorUserId, requestId: context.requestId, replayed: false, deletedByNamespace, backupSnapshotSha256 };
      this.#appendAudit(context, { eventId: `retention:${idempotencyKey}`, action: "tenant.retention-applied", occurredAt, details: { policies: normalizedPolicies, deletedByNamespace, backupSnapshotSha256, tenantRevision: nextTenantRevision } });
      db.prepare("INSERT INTO wr_idempotency(organization_id, idempotency_key, request_sha256, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)").run(context.organizationId, idempotencyKey, requestSha256, JSON.stringify(receipt), occurredAt);
      db.exec("COMMIT");
      return receipt;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
