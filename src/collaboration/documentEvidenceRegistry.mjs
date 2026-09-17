import { createDocumentExtractionRun, createDocumentExtractionReview, normalizeDocumentCitationVerification, normalizeReviewedFactPromotion } from "./documentEvidenceExtraction.mjs";

export const DOCUMENT_EVIDENCE_STATE_VERSION = "wr-document-evidence-state-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function error(code, message) { const value = new Error(message); value.code = code; return value; }
function tenantError(message) { return error("WR_TENANT_ISOLATION_VIOLATION", message); }
function assertContext(context, organizationId, grant) { if (context?.organizationId !== organizationId) throw tenantError("Document-evidence context does not match organization"); if (!(context.grants || []).includes(grant)) throw error("WR_DOCUMENT_EVIDENCE_PERMISSION_DENIED", `${grant} grant is required`); required(context.actorUserId, "context.actorUserId"); }
function assertRevision(state, expected) { if (expected !== undefined && Number(expected) !== state.revision) throw error("WR_REVISION_CONFLICT", `Document-evidence state revision conflict: expected ${expected}, found ${state.revision}`); }
function commit(state, occurredAt, changes) { const timestamp = iso(occurredAt, "occurredAt"); if (new Date(timestamp) < new Date(state.updatedAt)) throw error("WR_DOCUMENT_EVIDENCE_TIME_REGRESSION", "Document-evidence mutations must not move backward in time"); return { ...state, ...changes, revision: state.revision + 1, updatedAt: timestamp }; }

export function createDocumentEvidenceState(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const runs = (input.extractionRuns || []).map(createDocumentExtractionRun);
  const reviews = (input.reviews || []).map((review) => { const run = runs.find((item) => item.id === review.extractionRunId); if (!run) throw new TypeError(`Review references unknown extraction run: ${review.extractionRunId}`); return createDocumentExtractionReview(run, review); });
  const citationVerifications = (input.citationVerifications || []).map(normalizeDocumentCitationVerification);
  const promotions = (input.promotions || []).map(normalizeReviewedFactPromotion);
  for (const item of [...runs, ...reviews, ...citationVerifications, ...promotions]) if (item.organizationId !== organizationId) throw tenantError("Document evidence crosses state organization boundary");
  return { schemaVersion: DOCUMENT_EVIDENCE_STATE_VERSION, organizationId, revision: Math.max(1, Math.trunc(Number(input.revision) || 1)), extractionRuns: runs, reviews, citationVerifications, promotions, updatedAt: iso(input.updatedAt, "updatedAt") };
}

export function addDocumentExtractionRun(stateInput, runInput, context = {}) {
  const state = createDocumentEvidenceState(stateInput); const run = createDocumentExtractionRun(runInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "document-evidence:write");
  if (run.organizationId !== state.organizationId) throw tenantError("Extraction run belongs to another organization");
  if (run.extractorId !== context.actorUserId) throw error("WR_ACTOR_IMPERSONATION_DENIED", "Extraction actor must match the authenticated actor");
  if (state.extractionRuns.some((item) => item.id === run.id)) throw new TypeError(`Extraction run already exists: ${run.id}`);
  return commit(state, context.occurredAt, { extractionRuns: [...state.extractionRuns, run] });
}

export function addDocumentCitationVerification(stateInput, verificationInput, context = {}) {
  const state = createDocumentEvidenceState(stateInput); const verification = normalizeDocumentCitationVerification(verificationInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "document-evidence:verify");
  if (verification.organizationId !== state.organizationId) throw tenantError("Citation verification belongs to another organization");
  if (verification.verifierId !== context.actorUserId) throw error("WR_ACTOR_IMPERSONATION_DENIED", "Citation verifier must match the authenticated actor");
  const citationExists = state.extractionRuns.flatMap((run) => run.claims).flatMap((claim) => claim.citations).some((citation) => citation.id === verification.citationId && citation.citationSha256 === verification.citationSha256);
  if (!citationExists) throw new TypeError("Citation verification does not reference registered extraction evidence");
  return commit(state, context.occurredAt, { citationVerifications: [...state.citationVerifications, verification] });
}

export function addDocumentExtractionReview(stateInput, reviewInput, context = {}) {
  const state = createDocumentEvidenceState(stateInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "document-evidence:review");
  const run = state.extractionRuns.find((item) => item.id === reviewInput.extractionRunId); if (!run) throw new TypeError(`Unknown extraction run: ${reviewInput.extractionRunId}`);
  const review = createDocumentExtractionReview(run, reviewInput); if (review.reviewerUserId !== context.actorUserId) throw error("WR_ACTOR_IMPERSONATION_DENIED", "Reviewer must match the authenticated actor");
  if (state.reviews.some((item) => item.id === review.id)) throw new TypeError(`Extraction review already exists: ${review.id}`);
  return commit(state, context.occurredAt, { reviews: [...state.reviews, review] });
}

export function addReviewedFactPromotion(stateInput, promotionInput, context = {}) {
  const state = createDocumentEvidenceState(stateInput); const promotion = normalizeReviewedFactPromotion(promotionInput); assertRevision(state, context.expectedStateRevision); assertContext(context, state.organizationId, "document-evidence:promote");
  if (promotion.organizationId !== state.organizationId) throw tenantError("Fact promotion belongs to another organization");
  if (promotion.promotedByUserId !== context.actorUserId) throw error("WR_ACTOR_IMPERSONATION_DENIED", "Promotion actor must match the authenticated actor");
  const run = state.extractionRuns.find((item) => item.id === promotion.extractionRunId && item.runSha256 === promotion.extractionRunSha256);
  const review = state.reviews.find((item) => item.id === promotion.reviewId && item.reviewSha256 === promotion.reviewSha256 && item.extractionRunId === promotion.extractionRunId);
  if (!run || !review || review.decision !== "approved") throw error("WR_HUMAN_REVIEW_REQUIRED", "Promotion requires registered, approved extraction evidence");
  const verificationSet = new Set(state.citationVerifications.filter((item) => item.valid).map((item) => item.verificationSha256));
  if (promotion.citationVerificationSha256s.some((digest) => !verificationSet.has(digest))) throw error("WR_CITATION_VERIFICATION_REQUIRED", "Promotion references unregistered citation verification");
  if (state.promotions.some((item) => item.id === promotion.id)) throw new TypeError(`Fact promotion already exists: ${promotion.id}`);
  return commit(state, context.occurredAt, { promotions: [...state.promotions, promotion] });
}

