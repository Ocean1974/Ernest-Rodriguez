import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

export const ENCRYPTED_BACKUP_BUNDLE_VERSION = "wr-encrypted-backup-bundle-v1";
export const TENANT_SNAPSHOT_VERSION = "wr-tenant-snapshot-v1";
export const RESTORE_PLAN_VERSION = "wr-restore-plan-v1";
export const RETENTION_POLICY_VERSION = "wr-retention-policy-v1";
export const IMMUTABLE_AUDIT_EXPORT_VERSION = "wr-immutable-audit-export-v1";
export const OPERATIONAL_HEALTH_VERSION = "wr-operational-health-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex");
}

function keyFrom(keyMaterial, salt) {
  const material = Buffer.isBuffer(keyMaterial) ? keyMaterial : Buffer.from(String(keyMaterial || ""));
  if (material.length < 16) throw new TypeError("Backup key material must contain at least 16 bytes");
  return scryptSync(material, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function bundleMetadata(bundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    organizationId: bundle.organizationId,
    keyId: bundle.keyId,
    createdAt: bundle.createdAt,
    cipher: bundle.cipher,
    kdf: bundle.kdf,
  };
}

export function createEncryptedTenantBackup({ repository, context, keyMaterial, keyId, createdAt } = {}) {
  if (!repository?.exportTenantSnapshot) throw new TypeError("repository.exportTenantSnapshot is required");
  const timestamp = iso(createdAt, "createdAt");
  const snapshot = repository.exportTenantSnapshot(context, { now: timestamp, exportedAt: timestamp });
  const plaintext = canonicalJson(snapshot);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const shell = {
    schemaVersion: ENCRYPTED_BACKUP_BUNDLE_VERSION,
    organizationId: context.organizationId,
    keyId: required(keyId, "keyId"),
    createdAt: timestamp,
    cipher: "aes-256-gcm",
    kdf: "scrypt-n16384-r8-p1",
  };
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyMaterial, salt), iv);
  cipher.setAAD(Buffer.from(canonicalJson(bundleMetadata(shell))));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Object.freeze({
    ...shell,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    plaintextSha256: sha256(plaintext),
    snapshotSha256: snapshot.snapshotSha256,
    recordCount: snapshot.records.length,
    sourceTenantRevision: snapshot.tenantRevision,
  });
}

export function decryptTenantBackup(bundle, { keyMaterial, expectedOrganizationId } = {}) {
  if (bundle?.schemaVersion !== ENCRYPTED_BACKUP_BUNDLE_VERSION || bundle.cipher !== "aes-256-gcm" || bundle.kdf !== "scrypt-n16384-r8-p1") throw new TypeError("Unsupported encrypted backup bundle");
  if (expectedOrganizationId && bundle.organizationId !== expectedOrganizationId) {
    const error = new Error(`Backup tenant ${bundle.organizationId} does not match ${expectedOrganizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  try {
    const salt = Buffer.from(bundle.salt, "base64");
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyMaterial, salt), Buffer.from(bundle.iv, "base64"));
    decipher.setAAD(Buffer.from(canonicalJson(bundleMetadata(bundle))));
    decipher.setAuthTag(Buffer.from(bundle.authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()]).toString("utf8");
    if (sha256(plaintext) !== bundle.plaintextSha256) throw new Error("Plaintext digest mismatch");
    const snapshot = JSON.parse(plaintext);
    if (snapshot.schemaVersion !== TENANT_SNAPSHOT_VERSION || snapshot.organizationId !== bundle.organizationId || snapshot.snapshotSha256 !== bundle.snapshotSha256 || snapshot.records.length !== Number(bundle.recordCount) || Number(snapshot.tenantRevision) !== Number(bundle.sourceTenantRevision)) throw new Error("Snapshot metadata mismatch");
    return snapshot;
  } catch (cause) {
    if (cause?.code === "WR_TENANT_ISOLATION_VIOLATION") throw cause;
    const error = new Error("Encrypted backup authentication or integrity verification failed");
    error.code = "WR_BACKUP_DECRYPTION_FAILED";
    error.cause = cause;
    throw error;
  }
}

export function planTenantRestore({ bundle, keyMaterial, expectedOrganizationId } = {}) {
  const snapshot = decryptTenantBackup(bundle, { keyMaterial, expectedOrganizationId });
  const namespaces = {};
  for (const record of snapshot.records) namespaces[record.namespace] = (namespaces[record.namespace] || 0) + 1;
  return Object.freeze({ schemaVersion: RESTORE_PLAN_VERSION, organizationId: snapshot.organizationId, snapshotSha256: snapshot.snapshotSha256, sourceTenantRevision: snapshot.tenantRevision, exportedAt: snapshot.exportedAt, recordCount: snapshot.records.length, recordsByNamespace: namespaces, auditEntryCount: snapshot.audit?.verification?.entryCount || 0, snapshot });
}

export function restoreEncryptedTenantBackup({ repository, context, bundle, keyMaterial, expectedTenantRevision, idempotencyKey, occurredAt } = {}) {
  if (!repository?.restoreTenantSnapshot) throw new TypeError("repository.restoreTenantSnapshot is required");
  const plan = planTenantRestore({ bundle, keyMaterial, expectedOrganizationId: context.organizationId });
  const receipt = repository.restoreTenantSnapshot(context, plan.snapshot, { expectedTenantRevision, idempotencyKey, occurredAt, validation: { now: occurredAt } });
  return { schemaVersion: RESTORE_PLAN_VERSION, plan: { ...plan, snapshot: undefined }, receipt };
}

export function createRetentionPolicy(input = {}) {
  const now = new Date(iso(input.now, "now"));
  const snapshotDays = Math.max(1, Number(input.snapshotDays) || 365);
  const deliveryAttemptDays = Math.max(1, Number(input.deliveryAttemptDays) || 90);
  return Object.freeze({
    schemaVersion: RETENTION_POLICY_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    createdAt: now.toISOString(),
    policies: [
      { namespace: "property-snapshots", before: new Date(now.getTime() - snapshotDays * 86400000).toISOString(), retainAtLeast: Math.max(1, Math.trunc(Number(input.retainSnapshotsAtLeast) || 2)) },
      { namespace: "delivery-attempts", before: new Date(now.getTime() - deliveryAttemptDays * 86400000).toISOString(), retainAtLeast: Math.max(0, Math.trunc(Number(input.retainDeliveryAttemptsAtLeast) || 0)) },
    ],
    protectedNamespaces: ["user-intelligence", "collaboration", "alert-routing", "alert-worker", "underwriting", "property-graph", "release-control", "brief-exports", "deal-room", "document-evidence", "diligence", "portfolio", "operating-feed"],
  });
}

export function applyRetentionPolicy({ repository, context, policy, backupSnapshotSha256, expectedTenantRevision, idempotencyKey, occurredAt } = {}) {
  if (policy?.schemaVersion !== RETENTION_POLICY_VERSION || policy.organizationId !== context.organizationId) {
    const error = new Error("Retention policy does not match the authenticated organization");
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  return repository.pruneTenantRecords(context, policy.policies, { expectedTenantRevision, idempotencyKey, occurredAt, backupSnapshotSha256, validation: { now: occurredAt } });
}

export function createImmutableAuditExport({ repository, context, exportedAt } = {}) {
  const audit = repository.exportAuditLog(context, { now: exportedAt, exportedAt });
  const payload = { schemaVersion: IMMUTABLE_AUDIT_EXPORT_VERSION, organizationId: audit.organizationId, exportedAt: audit.exportedAt, entries: audit.entries, verification: audit.verification };
  return Object.freeze({ ...payload, exportSha256: sha256(payload) });
}

export function buildOperationalHealthReport({ repository, context, now, backupInventory = [], workerState, circuitStates = [], thresholds = {} } = {}) {
  const evaluatedAt = iso(now, "now");
  const nowMs = new Date(evaluatedAt).getTime();
  const schema = repository.schemaState();
  const audit = repository.exportAuditLog(context, { now: evaluatedAt, exportedAt: evaluatedAt });
  const backups = backupInventory.filter((item) => item.organizationId === context.organizationId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const latestBackup = backups[0] || null;
  const backupAgeHours = latestBackup ? (nowMs - new Date(latestBackup.createdAt).getTime()) / 3600000 : null;
  const jobs = workerState?.organizationId === context.organizationId ? workerState.jobs || [] : [];
  if (workerState && workerState.organizationId !== context.organizationId) {
    const error = new Error("Worker health state does not match the authenticated organization");
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  const dueBacklog = jobs.filter((job) => ["queued", "retry-scheduled"].includes(job.status) && new Date(job.nextAttemptAt).getTime() <= nowMs).length;
  const expiredLeases = jobs.filter((job) => job.status === "leased" && new Date(job.lease?.expiresAt || 0).getTime() <= nowMs).length;
  const deadLetters = jobs.filter((job) => job.status === "dead-lettered").length;
  const openCircuits = circuitStates.filter((item) => item.status === "open").length;
  const findings = [];
  if (schema.integrity !== "ok") findings.push({ severity: "critical", code: "database-integrity-failed" });
  if (!audit.verification.valid) findings.push({ severity: "critical", code: "audit-integrity-failed" });
  const maxBackupAgeHours = Math.max(1, Number(thresholds.maxBackupAgeHours) || 24);
  if (!latestBackup) findings.push({ severity: "critical", code: "backup-missing" });
  else if (backupAgeHours > maxBackupAgeHours) findings.push({ severity: "critical", code: "backup-stale" });
  else if (backupAgeHours < -0.1) findings.push({ severity: "degraded", code: "backup-clock-skew" });
  if (dueBacklog > Math.max(0, Number(thresholds.maxDueBacklog ?? 100))) findings.push({ severity: "degraded", code: "worker-backlog-high" });
  if (expiredLeases > 0) findings.push({ severity: "degraded", code: "expired-worker-leases" });
  if (deadLetters > Math.max(0, Number(thresholds.maxDeadLetters ?? 0))) findings.push({ severity: "degraded", code: "dead-letters-present" });
  if (openCircuits > 0) findings.push({ severity: "degraded", code: "provider-circuit-open" });
  const status = findings.some((item) => item.severity === "critical") ? "critical" : findings.length ? "degraded" : "healthy";
  const report = { schemaVersion: OPERATIONAL_HEALTH_VERSION, organizationId: context.organizationId, evaluatedAt, status, pageDesignChanged: false, database: { schemaVersion: schema.schemaVersion, integrity: schema.integrity, auditValid: audit.verification.valid, auditEntryCount: audit.verification.entryCount }, backups: { count: backups.length, latestCreatedAt: latestBackup?.createdAt || "", ageHours: backupAgeHours, maxAgeHours: maxBackupAgeHours }, worker: { dueBacklog, expiredLeases, deadLetters }, providers: { openCircuits }, findings };
  return Object.freeze({ ...report, reportSha256: sha256(report) });
}
