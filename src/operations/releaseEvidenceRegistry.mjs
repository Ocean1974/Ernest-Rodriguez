import { createHash, createPublicKey } from "node:crypto";
import { assertPersistenceGrant, assertTenantBoundValue } from "../persistence/persistenceContracts.mjs";
import {
  computeReleaseAttestationSha256,
  verifyPlatformReleaseManifest,
  verifyReleaseEvidenceAttestation,
} from "./releaseActivation.mjs";

export const RELEASE_TRUST_STATE_VERSION = "wr-release-trust-state-v1";
export const RELEASE_TRUST_KEY_VERSION = "wr-release-trust-key-v1";
export const RELEASE_REGISTRY_ENTRY_VERSION = "wr-release-registry-entry-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name, allowEmpty = false) {
  if (allowEmpty && !value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function sha256(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }

function trustRevision(value, expected) {
  const actual = Number(value?.revision || 0);
  if (expected !== undefined && Number(expected) !== actual) { const error = new Error(`Release trust revision conflict: expected ${expected}, found ${actual}`); error.code = "WR_REVISION_CONFLICT"; throw error; }
  return actual;
}

function requireGrant(context, grant) {
  assertPersistenceGrant(context, grant);
  if (context.actorUserId !== context.subjectUserId) { const error = new Error("Release-control actor must match authenticated subject"); error.code = "WR_PERSISTENCE_AUTHORIZATION_DENIED"; throw error; }
}

function normalizePublicKey(value) {
  const key = value?.type === "public" ? value : createPublicKey(value);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("Release trust keys must be Ed25519 public keys");
  return key.export({ type: "spki", format: "pem" }).toString();
}

export function createReleaseTrustState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const keys = (input.keys || []).map((key) => {
    const activeFrom = iso(key.activeFrom, "key.activeFrom");
    const expiresAt = iso(key.expiresAt, "key.expiresAt");
    if (expiresAt <= activeFrom) throw new TypeError("key.expiresAt must be after key.activeFrom");
    const revokedAt = iso(key.revokedAt, "key.revokedAt", true);
    return Object.freeze({
      schemaVersion: RELEASE_TRUST_KEY_VERSION,
      keyId: required(key.keyId, "key.keyId"),
      publicKeyPem: normalizePublicKey(key.publicKeyPem || key.publicKey),
      allowedRoles: [...new Set((key.allowedRoles || []).map(String).filter(Boolean))].sort(),
      activeFrom,
      expiresAt,
      revokedAt,
      addedAt: iso(key.addedAt || activeFrom, "key.addedAt"),
      addedBy: required(key.addedBy, "key.addedBy"),
      revokedBy: revokedAt ? required(key.revokedBy, "key.revokedBy") : "",
      revocationReason: revokedAt ? required(key.revocationReason, "key.revocationReason") : "",
    });
  });
  if (new Set(keys.map((key) => key.keyId)).size !== keys.length) throw new TypeError("Release trust key IDs must be unique");
  return Object.freeze({ schemaVersion: RELEASE_TRUST_STATE_VERSION, organizationId, revision: Math.max(0, Math.trunc(Number(input.revision) || 0)), updatedAt: iso(input.updatedAt, "updatedAt"), keys });
}

export function registerReleaseTrustKey(stateInput, keyInput, context, options = {}) {
  requireGrant(context, "release:trust-admin");
  const state = createReleaseTrustState(stateInput);
  if (state.organizationId !== context.organizationId) { const error = new Error("Release trust state belongs to another tenant"); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error; }
  trustRevision(state, options.expectedRevision);
  const keyId = required(keyInput.keyId, "keyId");
  if (state.keys.some((key) => key.keyId === keyId)) throw new TypeError(`Release trust key already exists: ${keyId}`);
  return createReleaseTrustState({ ...state, revision: state.revision + 1, updatedAt: options.occurredAt, keys: [...state.keys, { ...keyInput, keyId, addedAt: options.occurredAt, addedBy: context.actorUserId }] });
}

export function revokeReleaseTrustKey(stateInput, keyIdInput, context, options = {}) {
  requireGrant(context, "release:trust-admin");
  const state = createReleaseTrustState(stateInput);
  if (state.organizationId !== context.organizationId) { const error = new Error("Release trust state belongs to another tenant"); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error; }
  trustRevision(state, options.expectedRevision);
  const keyId = required(keyIdInput, "keyId");
  const target = state.keys.find((key) => key.keyId === keyId);
  if (!target) throw new TypeError(`Unknown release trust key: ${keyId}`);
  if (target.revokedAt) throw new TypeError(`Release trust key is already revoked: ${keyId}`);
  const occurredAt = iso(options.occurredAt, "occurredAt");
  return createReleaseTrustState({ ...state, revision: state.revision + 1, updatedAt: occurredAt, keys: state.keys.map((key) => key.keyId === keyId ? { ...key, revokedAt: occurredAt, revokedBy: context.actorUserId, revocationReason: required(options.reason, "reason") } : key) });
}

export function trustStoreFromReleaseState(stateInput) {
  const state = createReleaseTrustState(stateInput);
  return Object.fromEntries(state.keys.map((key) => [key.keyId, { publicKey: createPublicKey(key.publicKeyPem), organizationId: state.organizationId, allowedRoles: key.allowedRoles, activeFrom: key.activeFrom, expiresAt: key.expiresAt, revokedAt: key.revokedAt }]));
}

function commit(repository, context, key, value, options = {}) {
  if (!repository?.commit) throw new TypeError("repository.commit is required");
  assertTenantBoundValue(value, context.organizationId);
  return repository.commit({ context, namespace: "release-control", key, value, expectedTenantRevision: options.expectedTenantRevision, expectedRecordRevision: options.expectedRecordRevision, idempotencyKey: options.idempotencyKey, occurredAt: options.occurredAt }, options.validation || {});
}

export function persistReleaseTrustState(repository, context, stateInput, options = {}) {
  requireGrant(context, "release:trust-admin");
  const state = createReleaseTrustState(stateInput);
  if (state.organizationId !== context.organizationId) { const error = new Error("Release trust state belongs to another tenant"); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error; }
  return commit(repository, context, "trust-state", state, options);
}

export function loadReleaseTrustState(repository, context, options = {}) {
  requireGrant(context, "release:registry-read");
  const record = repository.readRecord(context, "release-control", "trust-state", options.validation || {});
  return record ? createReleaseTrustState(record.value) : null;
}

export function persistReleaseAttestation(repository, context, trustState, attestation, options = {}) {
  requireGrant(context, "release:evidence-write");
  const trustStore = trustStoreFromReleaseState(trustState);
  const verification = verifyReleaseEvidenceAttestation(attestation, { trustStore, asOf: options.asOf, expectedOrganizationId: context.organizationId, expectedCapabilityId: attestation.capabilityId });
  if (!verification.valid) { const error = new Error("Release evidence attestation failed current trust verification"); error.code = "WR_RELEASE_EVIDENCE_REJECTED"; error.verification = verification; throw error; }
  const contentSha256 = computeReleaseAttestationSha256(attestation);
  const entry = Object.freeze({ schemaVersion: RELEASE_REGISTRY_ENTRY_VERSION, organizationId: context.organizationId, entryType: "attestation", contentSha256, capabilityId: attestation.capabilityId, evidenceType: attestation.evidenceType, storedAt: iso(options.occurredAt, "occurredAt"), storedBy: context.actorUserId, content: structuredClone(attestation) });
  return commit(repository, context, `attestation:${contentSha256}`, entry, { ...options, expectedRecordRevision: 0 });
}

export function persistReleaseManifest(repository, context, trustState, manifest, options = {}) {
  requireGrant(context, "release:manifest-write");
  const trustStore = trustStoreFromReleaseState(trustState);
  const verification = verifyPlatformReleaseManifest(manifest, { trustStore, asOf: options.asOf, expectedOrganizationId: context.organizationId });
  if (!verification.valid || !verification.activationAuthorized) { const error = new Error("Platform release manifest failed current trust verification"); error.code = "WR_RELEASE_MANIFEST_REJECTED"; error.verification = verification; throw error; }
  const contentSha256 = sha256(JSON.stringify(manifest));
  const entry = Object.freeze({ schemaVersion: RELEASE_REGISTRY_ENTRY_VERSION, organizationId: context.organizationId, entryType: "manifest", contentSha256, capabilityId: "platform", evidenceType: "platform-release-manifest", storedAt: iso(options.occurredAt, "occurredAt"), storedBy: context.actorUserId, content: structuredClone(manifest) });
  return commit(repository, context, `manifest:${manifest.releaseId}:${contentSha256}`, entry, { ...options, expectedRecordRevision: 0 });
}

export function loadReleaseAttestation(repository, context, contentSha256, options = {}) {
  requireGrant(context, "release:registry-read");
  const hash = required(contentSha256, "contentSha256");
  const record = repository.readRecord(context, "release-control", `attestation:${hash}`, options.validation || {});
  if (!record) return null;
  if (record.value.contentSha256 !== hash || computeReleaseAttestationSha256(record.value.content) !== hash) { const error = new Error("Release registry attestation digest mismatch"); error.code = "WR_RELEASE_REGISTRY_INTEGRITY_FAILURE"; throw error; }
  return record.value;
}

export function listReleaseRegistryEntries(repository, context, options = {}) {
  requireGrant(context, "release:registry-read");
  if (!repository?.listRecordsPage) throw new TypeError("repository.listRecordsPage is required");
  return repository.listRecordsPage(context, "release-control", { keyPrefix: String(options.keyPrefix || ""), afterKey: String(options.afterKey || ""), limit: Math.max(1, Math.min(1000, Number(options.limit) || 100)), validation: options.validation || {} });
}
