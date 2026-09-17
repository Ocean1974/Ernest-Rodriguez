export const ORGANIZATION_VERSION = "wr-organization-v1";
export const MEMBERSHIP_VERSION = "wr-organization-membership-v1";
export const DEAL_VERSION = "wr-deal-v1";
export const DEAL_NOTE_VERSION = "wr-deal-note-v1";
export const DEAL_TASK_VERSION = "wr-deal-task-v1";
export const ACTIVITY_EVENT_VERSION = "wr-collaboration-activity-v1";
export const COLLABORATION_STATE_VERSION = "wr-collaboration-state-v1";

export const DEAL_STAGES = Object.freeze(["sourced", "screening", "underwriting", "due-diligence", "offer", "contract", "closed", "passed"]);
export const ORGANIZATION_ROLES = Object.freeze(["owner", "admin", "member", "viewer"]);

const ROLE_PERMISSIONS = Object.freeze({
  owner: ["organization:manage", "members:manage", "deals:write", "notes:write", "tasks:write", "activity:read"],
  admin: ["members:manage", "deals:write", "notes:write", "tasks:write", "activity:read"],
  member: ["deals:write", "notes:write", "tasks:write", "activity:read"],
  viewer: ["activity:read"],
});

function stableId(prefix, seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function iso(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid date: ${value}`);
  return date.toISOString();
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function propertyId(value) {
  const normalized = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(normalized)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return normalized;
}

function revision(value) {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

export class RevisionConflictError extends Error {
  constructor(entityType, entityId, expectedRevision, actualRevision) {
    super(`${entityType} ${entityId} revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = "RevisionConflictError";
    this.code = "WR_REVISION_CONFLICT";
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function createOrganization(input = {}) {
  const createdAt = iso(input.createdAt);
  const name = required(input.name, "name");
  return { schemaVersion: ORGANIZATION_VERSION, id: String(input.id || stableId("org", `${name}|${createdAt}`)), name, revision: revision(input.revision), createdAt, updatedAt: iso(input.updatedAt || createdAt) };
}

export function createMembership(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const userId = required(input.userId, "userId");
  const role = ORGANIZATION_ROLES.includes(input.role) ? input.role : "viewer";
  const createdAt = iso(input.createdAt);
  return {
    schemaVersion: MEMBERSHIP_VERSION,
    id: String(input.id || stableId("member", `${organizationId}|${userId}`)),
    organizationId,
    userId,
    displayName: String(input.displayName || ""),
    role,
    status: ["invited", "active", "suspended"].includes(input.status) ? input.status : "active",
    permissions: [...ROLE_PERMISSIONS[role]],
    revision: revision(input.revision),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt),
  };
}

export function hasOrganizationPermission(membership, permission) {
  return membership?.status === "active" && Array.isArray(membership.permissions) && membership.permissions.includes(permission);
}

export function createDeal(input = {}) {
  const createdAt = iso(input.createdAt);
  const organizationId = required(input.organizationId, "organizationId");
  const whiteRabbitPropertyId = propertyId(input.whiteRabbitPropertyId);
  const stage = DEAL_STAGES.includes(input.stage) ? input.stage : "sourced";
  const title = String(input.title || whiteRabbitPropertyId).trim();
  return {
    schemaVersion: DEAL_VERSION,
    id: String(input.id || stableId("deal", `${organizationId}|${whiteRabbitPropertyId}|${createdAt}`)),
    organizationId,
    whiteRabbitPropertyId,
    title,
    stage,
    status: ["active", "closed", "archived"].includes(input.status) ? input.status : "active",
    ownerUserId: String(input.ownerUserId || ""),
    tags: [...new Set((input.tags || []).map(String).map((item) => item.trim()).filter(Boolean))],
    underwritingScenarioId: String(input.underwritingScenarioId || ""),
    revision: revision(input.revision),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt),
  };
}

export function createDealNote(input = {}) {
  const createdAt = iso(input.createdAt);
  const dealId = required(input.dealId, "dealId");
  const body = required(input.body, "body");
  const authorUserId = required(input.authorUserId, "authorUserId");
  return { schemaVersion: DEAL_NOTE_VERSION, id: String(input.id || stableId("note", `${dealId}|${authorUserId}|${createdAt}|${body}`)), organizationId: required(input.organizationId, "organizationId"), dealId, whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId), authorUserId, body, visibility: input.visibility === "private" ? "private" : "organization", revision: revision(input.revision), createdAt, updatedAt: iso(input.updatedAt || createdAt) };
}

export function createDealTask(input = {}) {
  const createdAt = iso(input.createdAt);
  const dealId = required(input.dealId, "dealId");
  const title = required(input.title, "title");
  return {
    schemaVersion: DEAL_TASK_VERSION,
    id: String(input.id || stableId("task", `${dealId}|${title}|${createdAt}`)),
    organizationId: required(input.organizationId, "organizationId"),
    dealId,
    whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId),
    title,
    description: String(input.description || ""),
    assigneeUserId: String(input.assigneeUserId || ""),
    status: ["open", "in-progress", "completed", "cancelled"].includes(input.status) ? input.status : "open",
    priority: ["low", "normal", "high", "urgent"].includes(input.priority) ? input.priority : "normal",
    dueAt: input.dueAt ? iso(input.dueAt) : "",
    revision: revision(input.revision),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt),
  };
}

export function createActivityEvent(input = {}) {
  const occurredAt = iso(input.occurredAt);
  const event = {
    schemaVersion: ACTIVITY_EVENT_VERSION,
    id: String(input.id || stableId("activity", `${input.organizationId}|${input.actorUserId}|${input.action}|${input.entityType}|${input.entityId}|${occurredAt}`)),
    organizationId: required(input.organizationId, "organizationId"),
    actorUserId: required(input.actorUserId, "actorUserId"),
    action: required(input.action, "action"),
    entityType: required(input.entityType, "entityType"),
    entityId: required(input.entityId, "entityId"),
    whiteRabbitPropertyId: input.whiteRabbitPropertyId ? propertyId(input.whiteRabbitPropertyId) : "",
    occurredAt,
    changes: Array.isArray(input.changes) ? input.changes.map((item) => ({ field: String(item.field || ""), before: item.before ?? null, after: item.after ?? null })) : [],
    metadata: input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {},
  };
  return Object.freeze(event);
}

export function createCollaborationState(input = {}) {
  return {
    schemaVersion: COLLABORATION_STATE_VERSION,
    revision: revision(input.revision),
    organizations: (input.organizations || []).map(createOrganization),
    memberships: (input.memberships || []).map(createMembership),
    deals: (input.deals || []).map(createDeal),
    notes: (input.notes || []).map(createDealNote),
    tasks: (input.tasks || []).map(createDealTask),
    activity: (input.activity || []).map(createActivityEvent),
    updatedAt: iso(input.updatedAt),
  };
}

function authorize(state, organizationId, actorUserId, permission) {
  const member = state.memberships.find((item) => item.organizationId === organizationId && item.userId === actorUserId);
  if (!hasOrganizationPermission(member, permission)) {
    const error = new Error(`User ${actorUserId} lacks ${permission} in organization ${organizationId}`);
    error.code = "WR_PERMISSION_DENIED";
    throw error;
  }
}

function assertStateRevision(state, expectedRevision) {
  if (expectedRevision !== undefined && Number(expectedRevision) !== state.revision) throw new RevisionConflictError("collaboration-state", "root", Number(expectedRevision), state.revision);
}

function appendActivity(state, event) {
  const normalizedEvent = createActivityEvent(event);
  return { ...state, revision: state.revision + 1, activity: [...state.activity, normalizedEvent], updatedAt: normalizedEvent.occurredAt };
}

export function upsertDeal(stateInput, dealInput, context = {}) {
  let state = createCollaborationState(stateInput);
  assertStateRevision(state, context.expectedStateRevision);
  const deal = createDeal(dealInput);
  authorize(state, deal.organizationId, context.actorUserId, "deals:write");
  const existing = state.deals.find((item) => item.id === deal.id);
  if (existing && context.expectedEntityRevision !== undefined && Number(context.expectedEntityRevision) !== existing.revision) throw new RevisionConflictError("deal", deal.id, Number(context.expectedEntityRevision), existing.revision);
  const nextDeal = existing ? { ...deal, createdAt: existing.createdAt, revision: existing.revision + 1, updatedAt: iso(context.occurredAt) } : deal;
  state.deals = [...state.deals.filter((item) => item.id !== nextDeal.id), nextDeal];
  return appendActivity(state, { organizationId: nextDeal.organizationId, actorUserId: context.actorUserId, action: existing ? "deal.updated" : "deal.created", entityType: "deal", entityId: nextDeal.id, whiteRabbitPropertyId: nextDeal.whiteRabbitPropertyId, occurredAt: context.occurredAt, changes: existing ? [{ field: "stage", before: existing.stage, after: nextDeal.stage }, { field: "status", before: existing.status, after: nextDeal.status }].filter((item) => item.before !== item.after) : [] });
}

export function upsertMembership(stateInput, membershipInput, context = {}) {
  let state = createCollaborationState(stateInput);
  assertStateRevision(state, context.expectedStateRevision);
  const membership = createMembership(membershipInput);
  authorize(state, membership.organizationId, context.actorUserId, "members:manage");
  const existing = state.memberships.find((item) => item.id === membership.id);
  if (existing && context.expectedEntityRevision !== undefined && Number(context.expectedEntityRevision) !== existing.revision) throw new RevisionConflictError("membership", membership.id, Number(context.expectedEntityRevision), existing.revision);
  const nextMembership = existing ? { ...membership, createdAt: existing.createdAt, revision: existing.revision + 1, updatedAt: iso(context.occurredAt) } : membership;
  state.memberships = [...state.memberships.filter((item) => item.id !== nextMembership.id), nextMembership];
  return appendActivity(state, { organizationId: nextMembership.organizationId, actorUserId: context.actorUserId, action: existing ? "membership.updated" : "membership.created", entityType: "organization-membership", entityId: nextMembership.id, occurredAt: context.occurredAt, changes: existing ? [{ field: "role", before: existing.role, after: nextMembership.role }, { field: "status", before: existing.status, after: nextMembership.status }].filter((item) => item.before !== item.after) : [] });
}

export function addDealNote(stateInput, noteInput, context = {}) {
  let state = createCollaborationState(stateInput);
  assertStateRevision(state, context.expectedStateRevision);
  const note = createDealNote(noteInput);
  authorize(state, note.organizationId, context.actorUserId, "notes:write");
  if (note.authorUserId !== context.actorUserId) throw new TypeError("A deal note author must match the acting user");
  if (!state.deals.some((deal) => deal.id === note.dealId && deal.organizationId === note.organizationId && deal.whiteRabbitPropertyId === note.whiteRabbitPropertyId)) throw new TypeError("Note must reference a deal with the same organization and canonical property ID");
  state.notes = [...state.notes, note];
  return appendActivity(state, { organizationId: note.organizationId, actorUserId: context.actorUserId, action: "note.created", entityType: "deal-note", entityId: note.id, whiteRabbitPropertyId: note.whiteRabbitPropertyId, occurredAt: context.occurredAt });
}

export function visibleDealNotes(stateInput, { organizationId, dealId, userId } = {}) {
  const state = createCollaborationState(stateInput);
  const membership = state.memberships.find((item) => item.organizationId === organizationId && item.userId === userId);
  if (!membership || membership.status !== "active") return [];
  return state.notes.filter((note) => note.organizationId === organizationId && (!dealId || note.dealId === dealId) && (note.visibility === "organization" || note.authorUserId === userId));
}

export function upsertDealTask(stateInput, taskInput, context = {}) {
  let state = createCollaborationState(stateInput);
  assertStateRevision(state, context.expectedStateRevision);
  const task = createDealTask(taskInput);
  authorize(state, task.organizationId, context.actorUserId, "tasks:write");
  if (!state.deals.some((deal) => deal.id === task.dealId && deal.organizationId === task.organizationId && deal.whiteRabbitPropertyId === task.whiteRabbitPropertyId)) throw new TypeError("Task must reference a deal with the same organization and canonical property ID");
  const existing = state.tasks.find((item) => item.id === task.id);
  if (existing && context.expectedEntityRevision !== undefined && Number(context.expectedEntityRevision) !== existing.revision) throw new RevisionConflictError("deal-task", task.id, Number(context.expectedEntityRevision), existing.revision);
  const nextTask = existing ? { ...task, createdAt: existing.createdAt, revision: existing.revision + 1, updatedAt: iso(context.occurredAt) } : task;
  state.tasks = [...state.tasks.filter((item) => item.id !== nextTask.id), nextTask];
  return appendActivity(state, { organizationId: nextTask.organizationId, actorUserId: context.actorUserId, action: existing ? "task.updated" : "task.created", entityType: "deal-task", entityId: nextTask.id, whiteRabbitPropertyId: nextTask.whiteRabbitPropertyId, occurredAt: context.occurredAt, changes: existing ? [{ field: "status", before: existing.status, after: nextTask.status }].filter((item) => item.before !== item.after) : [] });
}
