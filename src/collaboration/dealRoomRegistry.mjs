import { createHash, timingSafeEqual } from "node:crypto";

export const DEAL_ROOM_VERSION = "wr-deal-room-v1";
export const DEAL_ROOM_DOCUMENT_VERSION = "wr-deal-room-document-version-v1";
export const MALWARE_SCAN_EVIDENCE_VERSION = "wr-malware-scan-evidence-v1";
export const DEAL_ROOM_SHARE_VERSION = "wr-deal-room-share-v1";
export const DEAL_ROOM_LEGAL_HOLD_VERSION = "wr-deal-room-legal-hold-v1";
export const DEAL_ROOM_ACCESS_EVENT_VERSION = "wr-deal-room-access-event-v1";
export const DEAL_ROOM_DELETION_REQUEST_VERSION = "wr-deal-room-deletion-request-v1";
export const DEAL_ROOM_STATE_VERSION = "wr-deal-room-state-v1";

export const DOCUMENT_CLASSIFICATIONS = Object.freeze(["public", "internal", "confidential", "restricted"]);
export const MALWARE_SCAN_RESULTS = Object.freeze(["clean", "infected", "error", "pending"]);

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

export function dealRoomSha256(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex");
}

function stableId(prefix, seed) { return `${prefix}_${dealRoomSha256(seed).slice(0, 24)}`; }

function classification(value, name = "classification") {
  const normalized = String(value || "internal").toLowerCase();
  if (!DOCUMENT_CLASSIFICATIONS.includes(normalized)) throw new TypeError(`${name} is unsupported`);
  return normalized;
}

function propertyId(value) {
  const normalized = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(normalized)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return normalized;
}

function opaqueRef(value, name, prefix = "object-ref:") {
  const normalized = required(value, name);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${name} must be an opaque ${prefix} reference`);
  return normalized;
}

function integrityError(code, message) { const error = new Error(message); error.code = code; return error; }
function tenantError(message) { return integrityError("WR_TENANT_ISOLATION_VIOLATION", message); }

function verifyDigest(input, body, digestField, code, label) {
  const digest = dealRoomSha256(body);
  if (input[digestField] && input[digestField] !== digest) throw integrityError(code, `${label} digest verification failed`);
  return digest;
}

function assertContext(context, organizationId, grant) {
  if (context?.organizationId !== organizationId) throw tenantError("Deal-room context does not match the organization");
  if (!context?.actorUserId) throw new TypeError("context.actorUserId is required");
  if (!(context.grants || []).includes(grant)) throw integrityError("WR_DEAL_ROOM_PERMISSION_DENIED", `${grant} grant is required`);
}

function assertRevision(state, expected) {
  if (expected !== undefined && Number(expected) !== state.revision) throw integrityError("WR_REVISION_CONFLICT", `Deal-room state revision conflict: expected ${expected}, found ${state.revision}`);
}

export function createDealRoom(input = {}) {
  const createdAt = iso(input.createdAt, "createdAt");
  const body = {
    schemaVersion: DEAL_ROOM_VERSION,
    id: String(input.id || stableId("deal_room", `${input.organizationId}|${input.dealId}|${createdAt}`)),
    organizationId: required(input.organizationId, "organizationId"),
    dealId: required(input.dealId, "dealId"),
    whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId),
    name: required(input.name, "name"),
    status: ["active", "archived"].includes(input.status) ? input.status : "active",
    createdByUserId: required(input.createdByUserId, "createdByUserId"),
    createdAt,
  };
  return Object.freeze({ ...body, roomSha256: verifyDigest(input, body, "roomSha256", "WR_DEAL_ROOM_INTEGRITY_FAILURE", "Deal room") });
}

export function createMalwareScanEvidence(input = {}) {
  const result = MALWARE_SCAN_RESULTS.includes(input.result) ? input.result : "pending";
  const scannedAt = iso(input.scannedAt, "scannedAt");
  const body = {
    schemaVersion: MALWARE_SCAN_EVIDENCE_VERSION,
    id: String(input.id || stableId("malware_scan", `${input.organizationId}|${input.contentSha256}|${input.engineId}|${scannedAt}`)),
    organizationId: required(input.organizationId, "organizationId"),
    contentSha256: required(input.contentSha256, "contentSha256"),
    engineId: required(input.engineId, "engineId"),
    engineVersion: required(input.engineVersion, "engineVersion"),
    definitionsVersion: required(input.definitionsVersion, "definitionsVersion"),
    result,
    threatNames: [...new Set((input.threatNames || []).map(String).filter(Boolean))].sort(),
    scannedAt,
    evidenceRef: opaqueRef(input.evidenceRef, "evidenceRef", "scan-ref:"),
    verificationStatus: input.verificationStatus === "verified" ? "verified" : "unverified",
    verificationPolicyId: String(input.verificationPolicyId || ""),
    scannerAttestationSha256: String(input.scannerAttestationSha256 || ""),
    verifiedAt: input.verifiedAt ? iso(input.verifiedAt, "verifiedAt") : "",
  };
  if (!/^[a-f0-9]{64}$/.test(body.contentSha256)) throw new TypeError("contentSha256 must be a SHA-256 digest");
  if (result === "clean" && body.threatNames.length) throw new TypeError("A clean malware scan cannot contain threat names");
  if (result === "infected" && !body.threatNames.length) throw new TypeError("An infected malware scan must name at least one threat");
  if (body.verificationStatus === "verified" && (!body.verificationPolicyId || !/^[a-f0-9]{64}$/.test(body.scannerAttestationSha256) || !body.verifiedAt)) throw new TypeError("Verified malware scans require policy, attestation digest, and verification time");
  if (body.verifiedAt && new Date(body.verifiedAt) < new Date(body.scannedAt)) throw new TypeError("Malware verification cannot predate the scan");
  return Object.freeze({ ...body, scanSha256: verifyDigest(input, body, "scanSha256", "WR_MALWARE_SCAN_INTEGRITY_FAILURE", "Malware scan") });
}

export function createDealRoomDocumentVersion(input = {}) {
  const uploadedAt = iso(input.uploadedAt, "uploadedAt");
  const organizationId = required(input.organizationId, "organizationId");
  const contentSha256 = required(input.contentSha256, "contentSha256");
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new TypeError("contentSha256 must be a SHA-256 digest");
  const scan = createMalwareScanEvidence(input.malwareScan);
  if (scan.organizationId !== organizationId) throw tenantError("Malware scan and document organizations do not match");
  if (scan.contentSha256 !== contentSha256) throw integrityError("WR_MALWARE_SCAN_CONTENT_MISMATCH", "Malware scan does not cover the document bytes");
  const documentId = String(input.documentId || stableId("document", `${organizationId}|${input.roomId}|${input.logicalName}`));
  const versionNumber = Math.max(1, Math.trunc(Number(input.versionNumber) || 1));
  const body = {
    schemaVersion: DEAL_ROOM_DOCUMENT_VERSION,
    id: String(input.id || stableId("document_version", `${documentId}|${versionNumber}|${contentSha256}`)),
    organizationId,
    roomId: required(input.roomId, "roomId"),
    dealId: required(input.dealId, "dealId"),
    whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId),
    documentId,
    versionNumber,
    logicalName: required(input.logicalName, "logicalName"),
    fileName: required(input.fileName, "fileName"),
    mediaType: required(input.mediaType, "mediaType").toLowerCase(),
    byteLength: Math.max(1, Math.trunc(Number(input.byteLength) || 0)),
    contentSha256,
    objectRef: opaqueRef(input.objectRef, "objectRef"),
    classification: classification(input.classification),
    uploadedByUserId: required(input.uploadedByUserId, "uploadedByUserId"),
    uploadedAt,
    malwareScan: scan,
    quarantineStatus: scan.result === "clean" && scan.verificationStatus === "verified" ? "released" : "quarantined",
    supersedesVersionId: String(input.supersedesVersionId || ""),
  };
  return Object.freeze({ ...body, versionSha256: verifyDigest(input, body, "versionSha256", "WR_DOCUMENT_VERSION_INTEGRITY_FAILURE", "Document version") });
}

function shareBody(input) {
  return {
    schemaVersion: DEAL_ROOM_SHARE_VERSION,
    id: required(input.id, "share.id"), organizationId: required(input.organizationId, "share.organizationId"), roomId: required(input.roomId, "share.roomId"),
    documentVersionIds: [...new Set((input.documentVersionIds || []).map(String).filter(Boolean))].sort(),
    recipientId: required(input.recipientId, "share.recipientId").toLowerCase(), recipientType: ["user", "email"].includes(input.recipientType) ? input.recipientType : "email",
    clearance: classification(input.clearance, "share.clearance"), tokenSha256: required(input.tokenSha256, "share.tokenSha256"),
    maxDownloads: Math.max(1, Math.trunc(Number(input.maxDownloads) || 10)), createdByUserId: required(input.createdByUserId, "share.createdByUserId"),
    createdAt: iso(input.createdAt, "share.createdAt"), expiresAt: iso(input.expiresAt, "share.expiresAt"), revokedAt: input.revokedAt ? iso(input.revokedAt, "share.revokedAt") : "", revokedByUserId: String(input.revokedByUserId || ""), revocationReason: String(input.revocationReason || ""),
  };
}

export function createExpiringDealRoomShare(input = {}, options = {}) {
  const token = required(options.token, "token");
  if (token.length < 32) throw new TypeError("Share token must contain at least 32 characters");
  const createdAt = iso(input.createdAt, "createdAt");
  const expiresAt = iso(input.expiresAt, "expiresAt");
  if (new Date(expiresAt) <= new Date(createdAt)) throw new TypeError("Share expiry must be after creation");
  const maxShareSeconds = Math.max(60, Number(options.maxShareSeconds) || 7 * 86400);
  if (new Date(expiresAt).getTime() - new Date(createdAt).getTime() > maxShareSeconds * 1000) throw new TypeError("Share expiry exceeds the configured maximum");
  const base = shareBody({ ...input, id: String(input.id || stableId("deal_share", `${input.organizationId}|${input.roomId}|${input.recipientId}|${createdAt}`)), createdAt, expiresAt, tokenSha256: dealRoomSha256(token) });
  if (!base.documentVersionIds.length) throw new TypeError("A share must authorize at least one document version");
  return Object.freeze({ ...base, shareSha256: verifyDigest(input, base, "shareSha256", "WR_DEAL_ROOM_SHARE_INTEGRITY_FAILURE", "Deal-room share") });
}

function normalizeShare(input) {
  const body = shareBody(input);
  return Object.freeze({ ...body, shareSha256: verifyDigest(input, body, "shareSha256", "WR_DEAL_ROOM_SHARE_INTEGRITY_FAILURE", "Deal-room share") });
}

export function createLegalHold(input = {}) {
  const issuedAt = iso(input.issuedAt, "issuedAt");
  const body = {
    schemaVersion: DEAL_ROOM_LEGAL_HOLD_VERSION, id: String(input.id || stableId("legal_hold", `${input.organizationId}|${input.roomId}|${input.documentId || "*"}|${issuedAt}`)),
    organizationId: required(input.organizationId, "organizationId"), roomId: required(input.roomId, "roomId"), documentId: String(input.documentId || ""),
    matterId: required(input.matterId, "matterId"), reason: required(input.reason, "reason"), issuedByUserId: required(input.issuedByUserId, "issuedByUserId"), issuedAt,
    status: input.status === "released" ? "released" : "active", releasedAt: input.releasedAt ? iso(input.releasedAt, "releasedAt") : "", releasedByUserId: String(input.releasedByUserId || ""), releaseReason: String(input.releaseReason || ""),
  };
  if (body.status === "released" && (!body.releasedAt || !body.releasedByUserId || !body.releaseReason || new Date(body.releasedAt) < new Date(body.issuedAt))) throw new TypeError("Released legal holds require complete, chronological release evidence");
  return Object.freeze({ ...body, holdSha256: verifyDigest(input, body, "holdSha256", "WR_LEGAL_HOLD_INTEGRITY_FAILURE", "Legal hold") });
}

function accessEvent(input) {
  const body = { schemaVersion: DEAL_ROOM_ACCESS_EVENT_VERSION, id: String(input.id || stableId("document_access", `${input.organizationId}|${input.documentVersionId}|${input.actorId}|${input.occurredAt}|${input.outcome}`)), organizationId: required(input.organizationId, "organizationId"), roomId: required(input.roomId, "roomId"), documentVersionId: required(input.documentVersionId, "documentVersionId"), actorId: required(input.actorId, "actorId"), actorType: ["user", "email", "service"].includes(input.actorType) ? input.actorType : "user", action: required(input.action, "action"), outcome: input.outcome === "allowed" ? "allowed" : "denied", reasonCode: required(input.reasonCode, "reasonCode"), shareId: String(input.shareId || ""), occurredAt: iso(input.occurredAt, "occurredAt") };
  return Object.freeze({ ...body, eventSha256: dealRoomSha256(body) });
}

function deletionRequest(input) {
  const body = { schemaVersion: DEAL_ROOM_DELETION_REQUEST_VERSION, id: required(input.id, "deletionRequest.id"), organizationId: required(input.organizationId, "deletionRequest.organizationId"), documentId: required(input.documentId, "deletionRequest.documentId"), requestedByUserId: required(input.requestedByUserId, "deletionRequest.requestedByUserId"), reason: required(input.reason, "deletionRequest.reason"), status: input.status === "purged" ? "purged" : "pending-purge", requestedAt: iso(input.requestedAt, "deletionRequest.requestedAt") };
  return Object.freeze({ ...body, deletionRequestSha256: verifyDigest(input, body, "deletionRequestSha256", "WR_DELETION_REQUEST_INTEGRITY_FAILURE", "Deletion request") });
}

export function createDealRoomState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const checkTenant = (item, label) => { if (item.organizationId !== organizationId) throw tenantError(`${label} does not belong to the deal-room state organization`); return item; };
  return {
    schemaVersion: DEAL_ROOM_STATE_VERSION, organizationId, revision: Math.max(1, Math.trunc(Number(input.revision) || 1)),
    rooms: (input.rooms || []).map(createDealRoom).map((item) => checkTenant(item, "Room")),
    documentVersions: (input.documentVersions || []).map(createDealRoomDocumentVersion).map((item) => checkTenant(item, "Document version")),
    shares: (input.shares || []).map(normalizeShare).map((item) => checkTenant(item, "Share")),
    legalHolds: (input.legalHolds || []).map(createLegalHold).map((item) => checkTenant(item, "Legal hold")),
    accessLog: (input.accessLog || []).map((item) => { const event = accessEvent(item); if (item.eventSha256 && item.eventSha256 !== event.eventSha256) throw integrityError("WR_ACCESS_LOG_INTEGRITY_FAILURE", "Access event digest verification failed"); return checkTenant(event, "Access event"); }),
    deletionRequests: (input.deletionRequests || []).map(deletionRequest).map((item) => checkTenant(item, "Deletion request")),
    updatedAt: iso(input.updatedAt, "updatedAt"),
  };
}

function commit(state, occurredAt, changes) {
  const timestamp = iso(occurredAt, "occurredAt");
  if (new Date(timestamp) < new Date(state.updatedAt)) throw integrityError("WR_DEAL_ROOM_TIME_REGRESSION", "Deal-room mutations must not move backward in time");
  return { ...state, ...changes, revision: state.revision + 1, updatedAt: timestamp };
}

export function addDealRoom(stateInput, roomInput, context = {}) {
  const state = createDealRoomState(stateInput); const room = createDealRoom(roomInput);
  assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:write");
  if (room.organizationId !== state.organizationId) throw tenantError("Room and state organizations do not match");
  if (room.createdByUserId !== context.actorUserId) throw integrityError("WR_ACTOR_IMPERSONATION_DENIED", "Room creator must match the acting user");
  if (state.rooms.some((item) => item.id === room.id)) throw new TypeError(`Deal room already exists: ${room.id}`);
  return commit(state, context.occurredAt, { rooms: [...state.rooms, room] });
}

export function addDealRoomDocumentVersion(stateInput, versionInput, context = {}) {
  const state = createDealRoomState(stateInput); const version = createDealRoomDocumentVersion(versionInput);
  assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:write");
  if (version.organizationId !== state.organizationId) throw tenantError("Document and state organizations do not match");
  if (version.uploadedByUserId !== context.actorUserId) throw integrityError("WR_ACTOR_IMPERSONATION_DENIED", "Uploader must match the acting user");
  const room = state.rooms.find((item) => item.id === version.roomId && item.dealId === version.dealId && item.whiteRabbitPropertyId === version.whiteRabbitPropertyId && item.status === "active");
  if (!room) throw new TypeError("Document must reference an active room with the same deal and canonical property ID");
  if (state.documentVersions.some((item) => item.id === version.id || (item.documentId === version.documentId && item.versionNumber === version.versionNumber))) throw integrityError("WR_DOCUMENT_VERSION_CONFLICT", "Document version identity already exists");
  const previous = state.documentVersions.filter((item) => item.documentId === version.documentId).sort((a, b) => b.versionNumber - a.versionNumber)[0];
  if (previous && (version.versionNumber !== previous.versionNumber + 1 || version.supersedesVersionId !== previous.id)) throw integrityError("WR_DOCUMENT_VERSION_CHAIN_INVALID", "Document version must increment and identify the exact predecessor");
  if (previous && ["roomId", "dealId", "whiteRabbitPropertyId", "logicalName"].some((field) => previous[field] !== version[field])) throw integrityError("WR_DOCUMENT_VERSION_CHAIN_INVALID", "Document versions must retain their room, deal, property, and logical identity");
  if (!previous && (version.versionNumber !== 1 || version.supersedesVersionId)) throw integrityError("WR_DOCUMENT_VERSION_CHAIN_INVALID", "First document version must be version 1 without a predecessor");
  return commit(state, context.occurredAt, { documentVersions: [...state.documentVersions, version] });
}

export function addDealRoomShare(stateInput, shareInput, context = {}) {
  const state = createDealRoomState(stateInput); const share = normalizeShare(shareInput);
  assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:share");
  if (share.organizationId !== state.organizationId) throw tenantError("Share and state organizations do not match");
  if (share.createdByUserId !== context.actorUserId) throw integrityError("WR_ACTOR_IMPERSONATION_DENIED", "Share creator must match the acting user");
  if (state.shares.some((item) => item.id === share.id)) throw new TypeError(`Share already exists: ${share.id}`);
  for (const versionId of share.documentVersionIds) {
    const version = state.documentVersions.find((item) => item.id === versionId && item.roomId === share.roomId);
    if (!version) throw new TypeError(`Share references an unknown document version: ${versionId}`);
    if (DOCUMENT_CLASSIFICATIONS.indexOf(version.classification) > DOCUMENT_CLASSIFICATIONS.indexOf(share.clearance)) throw integrityError("WR_DEAL_ROOM_CLEARANCE_DENIED", "Share clearance is below a document classification");
  }
  return commit(state, context.occurredAt, { shares: [...state.shares, share] });
}

export function revokeDealRoomShare(stateInput, shareId, context = {}) {
  const state = createDealRoomState(stateInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:share");
  const index = state.shares.findIndex((item) => item.id === shareId); if (index < 0) throw new TypeError(`Unknown share: ${shareId}`);
  const current = state.shares[index]; if (current.revokedAt) return state;
  const body = shareBody({ ...current, revokedAt: context.occurredAt, revokedByUserId: context.actorUserId, revocationReason: required(context.reason, "reason") });
  const shares = [...state.shares]; shares[index] = Object.freeze({ ...body, shareSha256: dealRoomSha256(body) });
  return commit(state, context.occurredAt, { shares });
}

export function addLegalHold(stateInput, holdInput, context = {}) {
  const state = createDealRoomState(stateInput); const hold = createLegalHold(holdInput);
  assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:legal-hold");
  if (hold.organizationId !== state.organizationId) throw tenantError("Legal hold and state organizations do not match");
  if (hold.issuedByUserId !== context.actorUserId) throw integrityError("WR_ACTOR_IMPERSONATION_DENIED", "Legal-hold issuer must match the acting user");
  if (!state.rooms.some((item) => item.id === hold.roomId)) throw new TypeError(`Unknown room: ${hold.roomId}`);
  if (hold.documentId && !state.documentVersions.some((item) => item.documentId === hold.documentId && item.roomId === hold.roomId)) throw new TypeError(`Unknown held document: ${hold.documentId}`);
  return commit(state, context.occurredAt, { legalHolds: [...state.legalHolds, hold] });
}

export function releaseLegalHold(stateInput, holdId, context = {}) {
  const state = createDealRoomState(stateInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:legal-hold");
  const index = state.legalHolds.findIndex((item) => item.id === holdId); if (index < 0) throw new TypeError(`Unknown legal hold: ${holdId}`);
  const current = state.legalHolds[index]; if (current.status === "released") return state;
  const released = createLegalHold({ ...current, holdSha256: undefined, status: "released", releasedAt: context.occurredAt, releasedByUserId: context.actorUserId, releaseReason: required(context.reason, "reason") });
  const legalHolds = [...state.legalHolds]; legalHolds[index] = released;
  return commit(state, context.occurredAt, { legalHolds });
}

export function requestDocumentDeletion(stateInput, documentId, context = {}) {
  const state = createDealRoomState(stateInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "deal-room:write");
  const versions = state.documentVersions.filter((item) => item.documentId === documentId); if (!versions.length) throw new TypeError(`Unknown document: ${documentId}`);
  const held = state.legalHolds.some((hold) => hold.status === "active" && (hold.documentId === documentId || (!hold.documentId && versions.some((item) => item.roomId === hold.roomId))));
  if (held) throw integrityError("WR_LEGAL_HOLD_DELETION_BLOCKED", "Document deletion is prohibited by an active legal hold");
  const requestedAt = iso(context.occurredAt, "occurredAt");
  const request = deletionRequest({ id: stableId("document_deletion", `${state.organizationId}|${documentId}|${requestedAt}`), organizationId: state.organizationId, documentId, requestedByUserId: context.actorUserId, reason: required(context.reason, "reason"), status: "pending-purge", requestedAt });
  return commit(state, requestedAt, { deletionRequests: [...state.deletionRequests, request] });
}

function tokenMatches(token, expectedSha) {
  const actual = Buffer.from(dealRoomSha256(String(token || "")), "hex"); const expected = Buffer.from(String(expectedSha || ""), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function evaluateSharedDocumentAccess(stateInput, input = {}) {
  const state = createDealRoomState(stateInput); const occurredAt = iso(input.occurredAt, "occurredAt");
  if (input.organizationId !== state.organizationId) throw tenantError("Document access tenant does not match deal-room state");
  const share = state.shares.find((item) => item.id === input.shareId); const version = state.documentVersions.find((item) => item.id === input.documentVersionId);
  let reasonCode = "allowed";
  if (!share) reasonCode = "share-not-found";
  else if (!version || version.roomId !== share.roomId) reasonCode = "document-not-found";
  else if (share.recipientId !== String(input.recipientId || "").toLowerCase()) reasonCode = "recipient-mismatch";
  else if (!tokenMatches(input.token, share.tokenSha256)) reasonCode = "token-invalid";
  else if (share.revokedAt) reasonCode = "share-revoked";
  else if (new Date(share.expiresAt) <= new Date(occurredAt)) reasonCode = "share-expired";
  else if (!share.documentVersionIds.includes(version.id)) reasonCode = "document-not-authorized";
  else if (version.quarantineStatus !== "released") reasonCode = "document-quarantined";
  else if (state.deletionRequests.some((item) => item.documentId === version.documentId && item.status === "pending-purge")) reasonCode = "document-pending-deletion";
  else if (state.accessLog.filter((event) => event.shareId === share.id && event.action === "download" && event.outcome === "allowed").length >= share.maxDownloads) reasonCode = "download-limit-reached";
  const allowed = reasonCode === "allowed";
  const event = accessEvent({ organizationId: state.organizationId, roomId: version?.roomId || share?.roomId || "unknown", documentVersionId: input.documentVersionId, actorId: String(input.recipientId || "unknown").toLowerCase(), actorType: share?.recipientType || "email", action: "download", outcome: allowed ? "allowed" : "denied", reasonCode, shareId: String(input.shareId || ""), occurredAt });
  const nextState = commit(state, occurredAt, { accessLog: [...state.accessLog, event] });
  return Object.freeze({ allowed, reasonCode, objectRef: allowed ? version.objectRef : "", documentVersionSha256: allowed ? version.versionSha256 : "", state: nextState, accessEvent: event });
}
