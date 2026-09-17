export const PERSISTENCE_CONTEXT_VERSION = "wr-persistence-context-v1";
export const PERSISTENCE_MUTATION_VERSION = "wr-persistence-mutation-v1";
export const PERSISTENCE_RECEIPT_VERSION = "wr-persistence-receipt-v1";
export const PERSISTENCE_BATCH_MUTATION_VERSION = "wr-persistence-batch-mutation-v1";
export const PERSISTENCE_BATCH_RECEIPT_VERSION = "wr-persistence-batch-receipt-v1";
export const PERSISTENCE_SCHEMA_VERSION = 2;

export const PERSISTENCE_NAMESPACES = Object.freeze([
  "user-intelligence",
  "collaboration",
  "alert-routing",
  "property-snapshots",
  "delivery-attempts",
  "alert-worker",
  "underwriting",
  "property-graph",
  "release-control",
  "brief-exports",
  "deal-room",
  "document-evidence",
  "diligence",
  "portfolio",
  "operating-feed",
  "opportunity-intelligence",
  "acquisition-handoff",
  "committee-workspace",
]);

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

export class PersistenceAuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PersistenceAuthorizationError";
    this.code = "WR_PERSISTENCE_AUTHORIZATION_DENIED";
  }
}

export class TenantIsolationError extends Error {
  constructor(expectedOrganizationId, foundOrganizationId, path) {
    super(`Cross-tenant organizationId at ${path}: expected ${expectedOrganizationId}, found ${foundOrganizationId}`);
    this.name = "TenantIsolationError";
    this.code = "WR_TENANT_ISOLATION_VIOLATION";
    this.expectedOrganizationId = expectedOrganizationId;
    this.foundOrganizationId = foundOrganizationId;
    this.path = path;
  }
}

export function createPersistenceContext(input = {}, options = {}) {
  const issuedAt = iso(input.issuedAt, "issuedAt");
  const expiresAt = iso(input.expiresAt, "expiresAt");
  if (new Date(expiresAt) <= new Date(issuedAt)) throw new TypeError("expiresAt must be after issuedAt");
  const now = new Date(options.now || Date.now());
  const maxClockSkewSeconds = Math.max(0, Number(options.maxClockSkewSeconds ?? 60));
  if (new Date(issuedAt).getTime() > now.getTime() + maxClockSkewSeconds * 1000) throw new PersistenceAuthorizationError("Persistence context is not yet valid");
  if (!options.allowExpired && new Date(expiresAt) <= now) throw new PersistenceAuthorizationError("Persistence context is expired");
  const actorUserId = required(input.actorUserId, "actorUserId");
  const subjectUserId = required(input.subjectUserId || actorUserId, "subjectUserId");
  if (actorUserId !== subjectUserId) throw new PersistenceAuthorizationError("Acting user must match the authenticated subject");
  const grants = [...new Set((input.grants || []).map(String).filter(Boolean))];
  if (!grants.includes("persistence:read")) throw new PersistenceAuthorizationError("persistence:read grant is required");
  return Object.freeze({
    schemaVersion: PERSISTENCE_CONTEXT_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    actorUserId,
    subjectUserId,
    sessionId: required(input.sessionId, "sessionId"),
    requestId: required(input.requestId, "requestId"),
    grants,
    issuedAt,
    expiresAt,
  });
}

export function assertPersistenceGrant(context, grant) {
  if (!context?.grants?.includes(grant)) throw new PersistenceAuthorizationError(`${grant} grant is required`);
}

export function assertTenantBoundValue(value, organizationId, path = "$") {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "organizationId")) {
    const found = String(value.organizationId || "");
    if (found !== organizationId) throw new TenantIsolationError(organizationId, found || "<empty>", `${path}.organizationId`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTenantBoundValue(item, organizationId, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) assertTenantBoundValue(item, organizationId, `${path}.${key}`);
}

export function createPersistenceMutation(input = {}, options = {}) {
  const context = createPersistenceContext(input.context, options);
  assertPersistenceGrant(context, "persistence:write");
  const namespace = required(input.namespace, "namespace");
  if (!PERSISTENCE_NAMESPACES.includes(namespace)) throw new TypeError(`Unsupported persistence namespace: ${namespace}`);
  const operation = input.operation === "delete" ? "delete" : "put";
  if (operation === "put" && (input.value === undefined || input.value === null)) throw new TypeError("value is required for put mutations");
  if (operation === "put") assertTenantBoundValue(input.value, context.organizationId);
  const expectedTenantRevision = Number(input.expectedTenantRevision);
  const expectedRecordRevision = input.expectedRecordRevision === undefined ? undefined : Number(input.expectedRecordRevision);
  if (!Number.isInteger(expectedTenantRevision) || expectedTenantRevision < 0) throw new TypeError("expectedTenantRevision must be a non-negative integer");
  if (expectedRecordRevision !== undefined && (!Number.isInteger(expectedRecordRevision) || expectedRecordRevision < 0)) throw new TypeError("expectedRecordRevision must be a non-negative integer");
  return Object.freeze({
    schemaVersion: PERSISTENCE_MUTATION_VERSION,
    context,
    namespace,
    key: required(input.key, "key"),
    operation,
    value: operation === "put" ? structuredClone(input.value) : null,
    expectedTenantRevision,
    expectedRecordRevision,
    idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
    occurredAt: iso(input.occurredAt, "occurredAt"),
  });
}

export function createPersistenceBatchMutation(input = {}, options = {}) {
  const context = createPersistenceContext(input.context, options);
  assertPersistenceGrant(context, "persistence:write");
  const expectedTenantRevision = Number(input.expectedTenantRevision);
  if (!Number.isInteger(expectedTenantRevision) || expectedTenantRevision < 0) throw new TypeError("expectedTenantRevision must be a non-negative integer");
  const occurredAt = iso(input.occurredAt, "occurredAt");
  const seen = new Set();
  const mutations = (input.mutations || []).map((item, index) => {
    const namespace = required(item.namespace, `mutations[${index}].namespace`);
    if (!PERSISTENCE_NAMESPACES.includes(namespace)) throw new TypeError(`Unsupported persistence namespace: ${namespace}`);
    const key = required(item.key, `mutations[${index}].key`);
    const identity = `${namespace}\u0000${key}`;
    if (seen.has(identity)) throw new TypeError(`Duplicate batch record target: ${namespace}/${key}`);
    seen.add(identity);
    const operation = item.operation === "delete" ? "delete" : "put";
    if (operation === "put" && (item.value === undefined || item.value === null)) throw new TypeError(`mutations[${index}].value is required for put`);
    if (operation === "put") assertTenantBoundValue(item.value, context.organizationId);
    const expectedRecordRevision = item.expectedRecordRevision === undefined ? undefined : Number(item.expectedRecordRevision);
    if (expectedRecordRevision !== undefined && (!Number.isInteger(expectedRecordRevision) || expectedRecordRevision < 0)) throw new TypeError(`mutations[${index}].expectedRecordRevision must be a non-negative integer`);
    return { namespace, key, operation, value: operation === "put" ? structuredClone(item.value) : null, expectedRecordRevision };
  });
  if (!mutations.length) throw new TypeError("mutations must contain at least one item");
  if (mutations.length > 1000) throw new RangeError("A persistence batch cannot exceed 1000 mutations");
  const responseMetadata = input.responseMetadata && typeof input.responseMetadata === "object" ? structuredClone(input.responseMetadata) : {};
  assertTenantBoundValue(responseMetadata, context.organizationId);
  if (JSON.stringify(responseMetadata).length > 16384) throw new RangeError("responseMetadata cannot exceed 16 KiB");
  return Object.freeze({
    schemaVersion: PERSISTENCE_BATCH_MUTATION_VERSION,
    context,
    mutations,
    expectedTenantRevision,
    idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
    requestFingerprint: String(input.requestFingerprint || ""),
    responseMetadata,
    occurredAt,
  });
}

export function assertReadContext(contextInput, options = {}) {
  return createPersistenceContext(contextInput, options);
}
