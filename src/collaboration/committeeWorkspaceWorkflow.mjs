import { createHash } from "node:crypto";
import { assertPersistenceGrant } from "../persistence/persistenceContracts.mjs";
import { createCollaborationState, upsertDeal, hasOrganizationPermission } from "./dealCollaborationStore.mjs";
import { createDealRoomState, createDealRoom, addDealRoom, createDealRoomDocumentVersion, addDealRoomDocumentVersion } from "./dealRoomRegistry.mjs";
import { createDiligenceChecklistTemplate, createBusinessCalendar, instantiateDiligenceWorkflow } from "./transactionDiligence.mjs";
import { createUnderwritingGovernanceState } from "../underwriting/underwritingGovernance.mjs";

export const COMMITTEE_WORKSPACE_WORKFLOW_VERSION = "wr-committee-workspace-workflow-v1";
export const COMMITTEE_WORKSPACE_VERSION = "wr-committee-workspace-v1";
export const COMMITTEE_WORKSPACE_LEDGER_VERSION = "wr-committee-workspace-ledger-v1";
export const COMMITTEE_WORKSPACE_RESULT_VERSION = "wr-committee-workspace-result-v1";
export const COMMITTEE_WORKSPACE_PROVIDER_VERSION = "wr-committee-workspace-provider-v1";
export const COMMITTEE_WORKSPACE_PACK_VERSION = "wr-committee-workspace-pack-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function fail(code, message) { const error = new Error(message); error.code = code; return error; }
function propertyId(value) { const id = required(value, "whiteRabbitPropertyId"); if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity"); return id; }
function countyIdFromProperty(id) { return propertyId(id).split(":").slice(2, -1).join(":"); }

function authorizedRelease(decision, verifier) { let verification; try { verification = typeof verifier === "function" ? verifier(decision) : null; } catch { verification = null; } return decision?.schemaVersion === "wr-capability-release-decision-v1" && decision.capabilityId === "deal-workflow-collaboration" && decision.activationAuthorized === true && verification?.valid === true && verification?.activationAuthorized === true; }
function authorizedProvider(provider, verifier) { let verification; try { verification = typeof verifier === "function" ? verifier(provider, "committee-workspace") : null; } catch { verification = null; } return provider?.schemaVersion === COMMITTEE_WORKSPACE_PROVIDER_VERSION && provider.activationAuthorized === true && typeof provider.getWorkspacePack === "function" && verification?.valid === true && verification?.activationAuthorized === true; }

function approvedSource(handoffRecord, underwritingRecord, id, organizationId, asOf, maximumApprovalAgeHours) {
  const handoff = handoffRecord?.value?.handoffs?.at(-1);
  if (handoffRecord?.value?.schemaVersion !== "wr-acquisition-handoff-ledger-v1" || !handoff) throw fail("WR_COMMITTEE_HANDOFF_MISSING", "A governed acquisition handoff is required");
  if (handoff.organizationId !== organizationId || handoff.whiteRabbitPropertyId !== id || handoff.schemaVersion !== "wr-acquisition-handoff-v1" || handoff.advisoryOnly !== true) throw fail("WR_COMMITTEE_HANDOFF_INVALID", "Acquisition handoff is invalid or outside tenant/property scope");
  if (handoff.status !== "draft-pending-independent-review" || iso(handoff.createdAt, "handoff.createdAt") > asOf) throw fail("WR_COMMITTEE_HANDOFF_INVALID", "Acquisition handoff status or chronology is invalid");
  if (digest(handoff.brief) !== handoff.briefSha256) throw fail("WR_COMMITTEE_BRIEF_INTEGRITY_FAILURE", "Acquisition handoff brief digest is invalid");
  const governance = createUnderwritingGovernanceState(underwritingRecord?.value || {});
  if (governance.organizationId !== organizationId) throw fail("WR_TENANT_ISOLATION_VIOLATION", "Underwriting governance belongs to another tenant");
  const scenario = governance.scenarios.find((item) => item.id === handoff.scenarioId && item.whiteRabbitPropertyId === id);
  if (!scenario || scenario.status !== "approved" || scenario.evidenceDigest !== handoff.scenarioEvidenceDigest) throw fail("WR_COMMITTEE_UNDERWRITING_NOT_APPROVED", "Handoff scenario is not currently approved with the same evidence digest");
  const approval = [...governance.approvals].reverse().find((item) => item.scenarioId === scenario.id && item.decision === "approved" && item.approvedScenarioRevision === scenario.revision && item.evidenceDigest === scenario.evidenceDigest);
  const review = approval ? governance.reviews.find((item) => item.id === approval.reviewId && item.scenarioId === scenario.id && item.decision === "recommended" && item.scenarioRevision === approval.reviewedScenarioRevision && item.evidenceDigest === scenario.evidenceDigest) : null;
  if (!approval || !review) throw fail("WR_COMMITTEE_APPROVAL_CHAIN_INVALID", "A current recommended review and linked approval are required");
  if (new Set([scenario.createdBy, review.reviewerUserId, approval.approverUserId]).size !== 3) throw fail("WR_COMMITTEE_SEPARATION_OF_DUTIES", "Scenario author, reviewer, and approver must be distinct");
  const decidedAt = iso(approval.decidedAt, "approval.decidedAt");
  if (iso(review.createdAt, "review.createdAt") > decidedAt || iso(scenario.generatedAt, "scenario.generatedAt") > review.createdAt) throw fail("WR_COMMITTEE_APPROVAL_CHAIN_INVALID", "Review and approval chronology is invalid");
  const ageHours = (new Date(asOf).getTime() - new Date(decidedAt).getTime()) / 3600000;
  if (ageHours < 0 || ageHours > maximumApprovalAgeHours) throw fail("WR_COMMITTEE_APPROVAL_STALE", "Underwriting approval is future-dated or outside the committee freshness window");
  return { handoff, governance, scenario, review, approval };
}

function normalizePack(input, source, id, asOf, verifier, maximumMalwareScanAgeHours) {
  if (input?.schemaVersion !== COMMITTEE_WORKSPACE_PACK_VERSION || input.activationAuthorized !== true) throw fail("WR_COMMITTEE_PACK_NOT_CERTIFIED", "An activation-authorized committee workspace pack is required");
  let verification; try { verification = typeof verifier === "function" ? verifier(input) : null; } catch { verification = null; }
  if (verification?.valid !== true || verification?.activationAuthorized !== true) throw fail("WR_COMMITTEE_PACK_SIGNATURE_REJECTED", "Committee workspace pack failed current trust verification");
  const generatedAt = iso(input.generatedAt, "workspacePack.generatedAt");
  if (generatedAt > asOf) throw fail("WR_COMMITTEE_POINT_IN_TIME_LEAKAGE", "Committee workspace pack is future-dated");
  if (input.sourceHandoffId !== source.handoff.id || input.sourceHandoffSha256 !== digest(source.handoff) || input.scenarioId !== source.scenario.id || input.scenarioEvidenceDigest !== source.scenario.evidenceDigest || input.approvalId !== source.approval.id || input.approvalEvidenceDigest !== source.approval.evidenceDigest) throw fail("WR_COMMITTEE_PACK_SOURCE_MISMATCH", "Committee pack does not bind to the exact approved handoff evidence");
  const template = createDiligenceChecklistTemplate(input.template);
  const calendar = createBusinessCalendar(input.calendar);
  if (template.tasks.length < 3 || template.tasks.length > 100) throw fail("WR_COMMITTEE_DILIGENCE_TEMPLATE_SCOPE", "Committee diligence template must contain 3-100 tasks");
  if (template.jurisdiction !== calendar.jurisdiction || calendar.validThrough < asOf.slice(0, 10)) throw fail("WR_COMMITTEE_CALENDAR_INVALID", "Diligence calendar is mismatched or does not cover the workspace date");
  const document = structuredClone(input.document || {});
  if (document.whiteRabbitPropertyId && document.whiteRabbitPropertyId !== id) throw fail("WR_COMMITTEE_DOCUMENT_SCOPE", "Committee document belongs to another property");
  if (document.contentSha256 !== document.malwareScan?.contentSha256 || document.malwareScan?.result !== "clean" || document.malwareScan?.verificationStatus !== "verified") throw fail("WR_COMMITTEE_DOCUMENT_SCAN_REJECTED", "Committee document requires a content-matched verified clean malware scan");
  const scannedAt = iso(document.malwareScan?.scannedAt, "document.malwareScan.scannedAt");
  const verifiedAt = iso(document.malwareScan?.verifiedAt, "document.malwareScan.verifiedAt");
  const scanAgeHours = (new Date(asOf).getTime() - new Date(verifiedAt).getTime()) / 3600000;
  if (scannedAt > verifiedAt || verifiedAt > asOf || scanAgeHours > maximumMalwareScanAgeHours) throw fail("WR_COMMITTEE_DOCUMENT_SCAN_STALE", "Committee document malware scan is future-dated, misordered, or stale");
  if (JSON.stringify(input).length > 2097152) throw fail("WR_COMMITTEE_PACK_TOO_LARGE", "Committee workspace pack exceeds 2 MiB");
  return { generatedAt, template, calendar, anchors: structuredClone(input.anchors || {}), assignments: structuredClone(input.assignments || {}), document };
}

function createLedger(input) { return { schemaVersion: COMMITTEE_WORKSPACE_LEDGER_VERSION, organizationId: required(input.organizationId, "ledger.organizationId"), whiteRabbitPropertyId: propertyId(input.whiteRabbitPropertyId), revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), workspaces: (input.workspaces || []).slice(-25), updatedAt: iso(input.updatedAt, "ledger.updatedAt") }; }
function fingerprint(context, input) { return digest({ organizationId: context.organizationId, actorUserId: context.actorUserId, whiteRabbitPropertyId: input.whiteRabbitPropertyId, asOf: input.asOf, expectedTenantRevision: input.expectedTenantRevision, expectedWorkspaceRecordRevision: input.expectedWorkspaceRecordRevision, expectedCollaborationRecordRevision: input.expectedCollaborationRecordRevision, expectedDealRoomRecordRevision: input.expectedDealRoomRecordRevision, expectedDiligenceRecordRevision: input.expectedDiligenceRecordRevision }); }

export function createCommitteeWorkspaceWorkflow({ repository, allowedCountyIds = [], releaseDecision = null, verifyReleaseDecision = null, workspaceProvider = null, verifyProvider = null, verifyWorkspacePack = null, maximumApprovalAgeHours = 168, maximumMalwareScanAgeHours = 24, clock = () => new Date().toISOString() } = {}) {
  if (!repository?.readRecord || !repository?.readIdempotencyReceipt || !repository?.commitMany) throw new TypeError("A durable transactional repository is required");
  const counties = new Set(allowedCountyIds.map(String).filter(Boolean)); if (!counties.size) throw new TypeError("allowedCountyIds must contain at least one county");
  const activationAuthorized = authorizedRelease(releaseDecision, verifyReleaseDecision);
  const providerAuthorized = authorizedProvider(workspaceProvider, verifyProvider);
  return Object.freeze({ schemaVersion: COMMITTEE_WORKSPACE_WORKFLOW_VERSION, activationAuthorized, async create(input = {}, context = {}) {
    if (!activationAuthorized) throw fail("WR_COMMITTEE_WORKSPACE_INACTIVE", "Committee workspace is not release-authorized");
    assertPersistenceGrant(context, "persistence:read"); assertPersistenceGrant(context, "persistence:write");
    if (!context.grants?.includes("committee-workspace:create")) throw fail("WR_COMMITTEE_PERMISSION_DENIED", "committee-workspace:create grant is required");
    if (!providerAuthorized) throw fail("WR_COMMITTEE_PROVIDER_INACTIVE", "A verified committee workspace provider is required");
    const id = propertyId(input.whiteRabbitPropertyId); if (!counties.has(countyIdFromProperty(id))) throw fail("WR_COMMITTEE_COUNTY_SCOPE", "Property is outside the committee workspace county allowlist");
    const asOf = iso(input.asOf || clock(), "asOf"), idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    const requestFingerprint = fingerprint(context, { ...input, whiteRabbitPropertyId: id, asOf });
    const priorReceipt = repository.readIdempotencyReceipt(context, idempotencyKey, { now: asOf });
    if (priorReceipt) { if (priorReceipt.requestFingerprint !== requestFingerprint) throw fail("WR_IDEMPOTENCY_CONFLICT", "Idempotency key was used for another committee workspace"); const record = repository.readRecord(context, "committee-workspace", `property:${id}`, { now: asOf }); const workspace = record?.value?.workspaces?.find((item) => item.id === priorReceipt.responseMetadata?.workspaceId); if (!workspace) throw fail("WR_IDEMPOTENCY_RESULT_MISSING", "Replay workspace is outside the bounded ledger"); return { schemaVersion: COMMITTEE_WORKSPACE_RESULT_VERSION, status: "replayed", receipt: { ...priorReceipt, replayed: true }, workspace, replayed: true }; }
    const tenantRevision = repository.tenantRevision(context, { now: asOf }); if (Number(input.expectedTenantRevision) !== tenantRevision) throw fail("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${input.expectedTenantRevision}, found ${tenantRevision}`);
    const handoffRecord = repository.readRecord(context, "acquisition-handoff", `property:${id}`, { now: asOf });
    const underwritingRecord = repository.readRecord(context, "underwriting", "governance-state", { now: asOf });
    const source = approvedSource(handoffRecord, underwritingRecord, id, context.organizationId, asOf, Math.max(1, Number(maximumApprovalAgeHours) || 168));
    const workspaceKey = `property:${id}`;
    const workspaceRecord = repository.readRecord(context, "committee-workspace", workspaceKey, { now: asOf });
    const collaborationRecord = repository.readRecord(context, "collaboration", "state", { now: asOf });
    const dealRoomRecord = repository.readRecord(context, "deal-room", "state", { now: asOf });
    if (Number(input.expectedWorkspaceRecordRevision || 0) !== Number(workspaceRecord?.revision || 0) || Number(input.expectedCollaborationRecordRevision || 0) !== Number(collaborationRecord?.revision || 0) || Number(input.expectedDealRoomRecordRevision || 0) !== Number(dealRoomRecord?.revision || 0)) throw fail("WR_PERSISTENCE_CONFLICT", "Committee workspace record revision conflict");
    const ledger = workspaceRecord ? createLedger(workspaceRecord.value) : createLedger({ organizationId: context.organizationId, whiteRabbitPropertyId: id, updatedAt: asOf });
    if (ledger.organizationId !== context.organizationId || ledger.workspaces.some((item) => item.approvalId === source.approval.id)) throw fail("WR_COMMITTEE_WORKSPACE_DUPLICATE", "This approval already has a committee workspace or crosses tenant scope");
    let collaboration = collaborationRecord ? createCollaborationState(collaborationRecord.value) : null;
    const membership = collaboration?.memberships.find((item) => item.organizationId === context.organizationId && item.userId === context.actorUserId);
    if (!collaboration?.organizations.some((item) => item.id === context.organizationId) || !hasOrganizationPermission(membership, "deals:write")) throw fail("WR_COMMITTEE_MEMBERSHIP_REQUIRED", "An existing active deal-writing organization membership is required");
    const rawPack = await workspaceProvider.getWorkspacePack(id, { asOf, context, handoff: source.handoff, scenario: source.scenario, review: source.review, approval: source.approval, signal: input.signal || null });
    const pack = normalizePack(rawPack, source, id, asOf, verifyWorkspacePack, Math.max(1, Number(maximumMalwareScanAgeHours) || 24));
    const dealId = `deal_committee_${digest(`${context.organizationId}|${source.approval.id}`).slice(0, 20)}`;
    if (collaboration.deals.some((item) => item.whiteRabbitPropertyId === id && item.status === "active")) throw fail("WR_COMMITTEE_ACTIVE_DEAL_EXISTS", "An active deal already exists for this property");
    if (collaboration.deals.length >= 5000) throw fail("WR_COMMITTEE_CAPACITY_REACHED", "Collaboration state has reached the 5,000-deal workspace limit");
    collaboration = upsertDeal(collaboration, { id: dealId, organizationId: context.organizationId, whiteRabbitPropertyId: id, title: source.handoff.brief?.exportModel?.title || id, stage: "due-diligence", status: "active", ownerUserId: context.actorUserId, tags: ["committee-approved-underwriting"], underwritingScenarioId: source.scenario.id, createdAt: asOf }, { actorUserId: context.actorUserId, expectedStateRevision: collaboration.revision, occurredAt: asOf });
    let dealRoom = dealRoomRecord ? createDealRoomState(dealRoomRecord.value) : createDealRoomState({ organizationId: context.organizationId, updatedAt: asOf });
    if (dealRoom.rooms.length >= 5000 || dealRoom.documentVersions.length >= 25000) throw fail("WR_COMMITTEE_CAPACITY_REACHED", "Deal-room state has reached its bounded workspace limit");
    const roomId = `room_committee_${digest(dealId).slice(0, 20)}`;
    const room = createDealRoom({ id: roomId, organizationId: context.organizationId, dealId, whiteRabbitPropertyId: id, name: `${source.handoff.brief?.exportModel?.title || id} Committee Workspace`, createdByUserId: context.actorUserId, createdAt: asOf });
    dealRoom = addDealRoom(dealRoom, room, { organizationId: context.organizationId, actorUserId: context.actorUserId, grants: ["deal-room:write"], expectedStateRevision: dealRoom.revision, occurredAt: asOf });
    const document = createDealRoomDocumentVersion({ ...pack.document, organizationId: context.organizationId, roomId, dealId, whiteRabbitPropertyId: id, documentId: `document_committee_${digest(source.approval.id).slice(0, 20)}`, versionNumber: 1, logicalName: pack.document.logicalName || "Investment Committee Evidence Package", uploadedByUserId: context.actorUserId, uploadedAt: asOf });
    dealRoom = addDealRoomDocumentVersion(dealRoom, document, { organizationId: context.organizationId, actorUserId: context.actorUserId, grants: ["deal-room:write"], expectedStateRevision: dealRoom.revision, occurredAt: asOf });
    if (document.quarantineStatus !== "released") throw fail("WR_COMMITTEE_DOCUMENT_QUARANTINED", "Committee evidence package did not pass release controls");
    const workflowId = `diligence_committee_${digest(dealId).slice(0, 20)}`;
    const diligenceRecord = repository.readRecord(context, "diligence", workflowId, { now: asOf });
    if (Number(input.expectedDiligenceRecordRevision || 0) !== Number(diligenceRecord?.revision || 0) || diligenceRecord) throw fail("WR_PERSISTENCE_CONFLICT", "Committee diligence workflow already exists or revision conflicts");
    const diligence = instantiateDiligenceWorkflow({ id: workflowId, organizationId: context.organizationId, dealId, whiteRabbitPropertyId: id, template: pack.template, calendar: pack.calendar, anchors: pack.anchors, assignments: pack.assignments, createdByUserId: context.actorUserId, createdAt: asOf });
    const workspaceCore = { whiteRabbitPropertyId: id, handoffId: source.handoff.id, handoffSha256: digest(source.handoff), scenarioId: source.scenario.id, scenarioEvidenceDigest: source.scenario.evidenceDigest, reviewId: source.review.id, approvalId: source.approval.id, approvalEvidenceDigest: source.approval.evidenceDigest, dealId, roomId, documentVersionId: document.id, documentVersionSha256: document.versionSha256, diligenceWorkflowId: diligence.id, diligenceWorkflowSha256: diligence.workflowSha256, createdAt: asOf, createdBy: context.actorUserId, status: "committee-review-ready", externalSharingAuthorized: false, externalReminderDeliveryAuthorized: false, committeeDecisionRecorded: false };
    const workspace = { schemaVersion: COMMITTEE_WORKSPACE_VERSION, id: `committee_workspace_${digest(workspaceCore).slice(0, 24)}`, organizationId: context.organizationId, ...workspaceCore };
    const nextLedger = { ...ledger, revision: ledger.revision + 1, workspaces: [...ledger.workspaces, workspace].slice(-25), updatedAt: asOf };
    const receipt = repository.commitMany({ context, mutations: [
      { namespace: "committee-workspace", key: workspaceKey, operation: "put", value: nextLedger, expectedRecordRevision: Number(workspaceRecord?.revision || 0) },
      { namespace: "collaboration", key: "state", operation: "put", value: collaboration, expectedRecordRevision: Number(collaborationRecord?.revision || 0) },
      { namespace: "deal-room", key: "state", operation: "put", value: dealRoom, expectedRecordRevision: Number(dealRoomRecord?.revision || 0) },
      { namespace: "diligence", key: workflowId, operation: "put", value: diligence, expectedRecordRevision: 0 }
    ], expectedTenantRevision: tenantRevision, idempotencyKey, requestFingerprint, responseMetadata: { workspaceId: workspace.id, dealId, roomId, diligenceWorkflowId: workflowId, approvalId: source.approval.id, whiteRabbitPropertyId: id }, occurredAt: asOf }, { now: asOf });
    return { schemaVersion: COMMITTEE_WORKSPACE_RESULT_VERSION, status: "created", receipt, workspace, deal: collaboration.deals.find((item) => item.id === dealId), room, document, diligence, replayed: false };
  } });
}
