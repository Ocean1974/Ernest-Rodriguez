import { dealRoomSha256, createDealRoomDocumentVersion } from "./dealRoomRegistry.mjs";

export const DOCUMENT_CITATION_VERSION = "wr-document-citation-v1";
export const DOCUMENT_CITATION_VERIFICATION_VERSION = "wr-document-citation-verification-v1";
export const DOCUMENT_EVIDENCE_CLAIM_VERSION = "wr-document-evidence-claim-v1";
export const DOCUMENT_EXTRACTION_RUN_VERSION = "wr-document-extraction-run-v1";
export const DOCUMENT_EXTRACTION_REVIEW_VERSION = "wr-document-extraction-review-v1";
export const REVIEWED_FACT_PROMOTION_VERSION = "wr-reviewed-fact-promotion-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function stableId(prefix, seed) { return `${prefix}_${dealRoomSha256(seed).slice(0, 24)}`; }
function integrityError(code, message) { const error = new Error(message); error.code = code; return error; }
function tenantError(message) { return integrityError("WR_TENANT_ISOLATION_VIOLATION", message); }

function factPath(value) {
  const normalized = required(value, "factPath");
  if (!/^(property\.|underwriting\.)[A-Za-z0-9_.-]+$/.test(normalized) || /(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(normalized)) throw new TypeError("factPath must be a safe property.* or underwriting.* path");
  return normalized;
}

function validateDigest(value, name) { const digest = required(value, name); if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${name} must be a SHA-256 digest`); return digest; }

function digestRecord(input, body, field, code, label) {
  const digest = dealRoomSha256(body);
  if (input[field] && input[field] !== digest) throw integrityError(code, `${label} digest verification failed`);
  return digest;
}

export function createDocumentCitation(input = {}) {
  const pageNumber = Math.trunc(Number(input.pageNumber));
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new TypeError("citation.pageNumber must be a positive integer");
  const excerpt = required(input.excerpt, "citation.excerpt");
  const box = input.boundingBox ? (input.boundingBox || []).map(Number) : [];
  if (box.length && (box.length !== 4 || box.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || box[0] >= box[2] || box[1] >= box[3])) throw new TypeError("citation.boundingBox must be normalized [x1,y1,x2,y2]");
  const body = {
    schemaVersion: DOCUMENT_CITATION_VERSION,
    id: String(input.id || stableId("document_citation", `${input.documentVersionId}|${pageNumber}|${input.startOffset}|${excerpt}`)),
    organizationId: required(input.organizationId, "citation.organizationId"),
    documentVersionId: required(input.documentVersionId, "citation.documentVersionId"),
    documentVersionSha256: validateDigest(input.documentVersionSha256, "citation.documentVersionSha256"),
    pageNumber,
    pageTextSha256: validateDigest(input.pageTextSha256, "citation.pageTextSha256"),
    startOffset: Math.max(0, Math.trunc(Number(input.startOffset) || 0)),
    endOffset: Math.max(0, Math.trunc(Number(input.endOffset) || 0)),
    boundingBox: box,
    excerpt,
    excerptSha256: dealRoomSha256(excerpt),
  };
  if (body.endOffset <= body.startOffset || body.endOffset - body.startOffset !== excerpt.length) throw new TypeError("Citation offsets must exactly span the excerpt length");
  return Object.freeze({ ...body, citationSha256: digestRecord(input, body, "citationSha256", "WR_DOCUMENT_CITATION_INTEGRITY_FAILURE", "Document citation") });
}

export function normalizeDocumentCitationVerification(input = {}) {
  const body = {
    schemaVersion: DOCUMENT_CITATION_VERIFICATION_VERSION,
    citationId: required(input.citationId, "citationVerification.citationId"),
    citationSha256: validateDigest(input.citationSha256, "citationVerification.citationSha256"),
    organizationId: required(input.organizationId, "citationVerification.organizationId"),
    documentVersionId: required(input.documentVersionId, "citationVerification.documentVersionId"),
    documentVersionSha256: validateDigest(input.documentVersionSha256, "citationVerification.documentVersionSha256"),
    pageTextSha256: validateDigest(input.pageTextSha256, "citationVerification.pageTextSha256"),
    verifierId: required(input.verifierId, "citationVerification.verifierId"),
    verifiedAt: iso(input.verifiedAt, "citationVerification.verifiedAt"),
    valid: input.valid === true,
    findings: [...new Set((input.findings || []).map(String).filter(Boolean))].sort(),
  };
  return Object.freeze({ ...body, verificationSha256: digestRecord(input, body, "verificationSha256", "WR_CITATION_VERIFICATION_INTEGRITY_FAILURE", "Citation verification") });
}

export function verifyDocumentCitation(citationInput, options = {}) {
  const citation = createDocumentCitation(citationInput);
  const documentVersion = createDealRoomDocumentVersion(options.documentVersion);
  if (citation.organizationId !== documentVersion.organizationId) throw tenantError("Citation and document version organizations do not match");
  const pageText = String(options.pageText ?? "");
  const findings = [];
  if (citation.documentVersionId !== documentVersion.id || citation.documentVersionSha256 !== documentVersion.versionSha256) findings.push("document-version-mismatch");
  if (dealRoomSha256(pageText) !== citation.pageTextSha256) findings.push("page-text-digest-mismatch");
  if (pageText.slice(citation.startOffset, citation.endOffset) !== citation.excerpt) findings.push("excerpt-anchor-mismatch");
  return normalizeDocumentCitationVerification({ citationId: citation.id, citationSha256: citation.citationSha256, organizationId: citation.organizationId, documentVersionId: documentVersion.id, documentVersionSha256: documentVersion.versionSha256, pageTextSha256: citation.pageTextSha256, verifierId: required(options.verifierId, "verifierId"), verifiedAt: options.verifiedAt, valid: findings.length === 0, findings });
}

export function createDocumentEvidenceClaim(input = {}) {
  const status = ["observed", "unknown", "conflicting"].includes(input.status) ? input.status : "unknown";
  const citations = (input.citations || []).map(createDocumentCitation);
  const body = {
    schemaVersion: DOCUMENT_EVIDENCE_CLAIM_VERSION,
    id: String(input.id || stableId("document_claim", `${input.organizationId}|${input.factPath}|${dealRoomSha256(input.value)}|${citations.map((item) => item.citationSha256).join("|")}`)),
    organizationId: required(input.organizationId, "claim.organizationId"),
    factPath: factPath(input.factPath),
    value: status === "observed" || status === "conflicting" ? (input.value ?? null) : null,
    valueType: ["string", "number", "boolean", "date", "currency", "percentage", "object"].includes(input.valueType) ? input.valueType : "string",
    status,
    confidence: status === "unknown" ? 0 : Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    citations,
    unknownReason: status === "unknown" ? required(input.unknownReason, "claim.unknownReason") : "",
    extractionNotes: String(input.extractionNotes || ""),
  };
  if (status !== "unknown" && body.value === null) throw new TypeError("Observed or conflicting claims require a value");
  if (status !== "unknown" && !citations.length) throw new TypeError("Observed or conflicting claims require at least one citation");
  const foreignCitation = citations.find((item) => item.organizationId !== body.organizationId);
  if (foreignCitation) throw tenantError("Claim citation belongs to another organization");
  return Object.freeze({ ...body, claimSha256: digestRecord(input, body, "claimSha256", "WR_DOCUMENT_CLAIM_INTEGRITY_FAILURE", "Document evidence claim") });
}

function conflictGroups(claims) {
  const byPath = new Map();
  for (const claim of claims.filter((item) => item.status !== "unknown")) {
    const values = byPath.get(claim.factPath) || new Map();
    const valueDigest = dealRoomSha256(claim.value);
    values.set(valueDigest, [...(values.get(valueDigest) || []), claim.id]);
    byPath.set(claim.factPath, values);
  }
  return [...byPath.entries()].filter(([, values]) => values.size > 1).map(([path, values]) => Object.freeze({ factPath: path, valueDigests: [...values.keys()].sort(), claimIds: [...values.values()].flat().sort(), status: "unresolved" })).sort((a, b) => a.factPath.localeCompare(b.factPath));
}

export function createDocumentExtractionRun(input = {}) {
  const createdAt = iso(input.createdAt, "createdAt");
  const claims = (input.claims || []).map(createDocumentEvidenceClaim);
  const organizationId = required(input.organizationId, "organizationId");
  if (claims.some((item) => item.organizationId !== organizationId)) throw tenantError("Extraction claim belongs to another organization");
  const documentVersionId = required(input.documentVersionId, "documentVersionId");
  const documentVersionSha256 = validateDigest(input.documentVersionSha256, "documentVersionSha256");
  for (const citation of claims.flatMap((item) => item.citations)) if (citation.documentVersionId !== documentVersionId || citation.documentVersionSha256 !== documentVersionSha256) throw integrityError("WR_DOCUMENT_CITATION_SOURCE_MISMATCH", "Citation does not point to the extraction source document version");
  const body = {
    schemaVersion: DOCUMENT_EXTRACTION_RUN_VERSION,
    id: String(input.id || stableId("extraction_run", `${organizationId}|${documentVersionId}|${documentVersionSha256}|${createdAt}`)),
    organizationId,
    roomId: required(input.roomId, "roomId"),
    dealId: required(input.dealId, "dealId"),
    whiteRabbitPropertyId: required(input.whiteRabbitPropertyId, "whiteRabbitPropertyId"),
    documentVersionId,
    documentVersionSha256,
    contentSha256: validateDigest(input.contentSha256, "contentSha256"),
    extractorType: ["model", "human", "hybrid"].includes(input.extractorType) ? input.extractorType : "model",
    extractorId: required(input.extractorId, "extractorId"),
    modelId: String(input.modelId || ""),
    modelVersion: String(input.modelVersion || ""),
    promptSha256: input.promptSha256 ? validateDigest(input.promptSha256, "promptSha256") : "",
    claims,
    conflicts: conflictGroups(claims),
    createdAt,
    status: claims.length ? "review-required" : "insufficient-evidence",
  };
  if (body.extractorType !== "human" && (!body.modelId || !body.modelVersion || !body.promptSha256)) throw new TypeError("Model-assisted extraction requires model, version, and prompt digest");
  return Object.freeze({ ...body, runSha256: digestRecord(input, body, "runSha256", "WR_DOCUMENT_EXTRACTION_INTEGRITY_FAILURE", "Document extraction run") });
}

function normalizeReviewDecision(value = {}) {
  const decision = ["accepted", "rejected", "unknown"].includes(value.decision) ? value.decision : "rejected";
  return Object.freeze({ claimId: required(value.claimId, "claimDecision.claimId"), claimSha256: validateDigest(value.claimSha256, "claimDecision.claimSha256"), decision, rationale: required(value.rationale, "claimDecision.rationale"), resolvesConflict: value.resolvesConflict === true });
}

export function createDocumentExtractionReview(runInput, input = {}) {
  const run = createDocumentExtractionRun(runInput);
  if (input.organizationId !== run.organizationId) throw tenantError("Extraction review and run organizations do not match");
  const reviewerUserId = required(input.reviewerUserId, "reviewerUserId");
  if (reviewerUserId === run.extractorId) throw integrityError("WR_EXTRACTION_REVIEW_SEPARATION_REQUIRED", "Reviewer must be independent from the extractor");
  const reviewedAt = iso(input.reviewedAt, "reviewedAt");
  const claimDecisions = (input.claimDecisions || []).map(normalizeReviewDecision);
  if (claimDecisions.length !== run.claims.length || new Set(claimDecisions.map((item) => item.claimId)).size !== run.claims.length) throw new TypeError("Review must make exactly one decision for every extracted claim");
  for (const decision of claimDecisions) {
    const claim = run.claims.find((item) => item.id === decision.claimId);
    if (!claim || claim.claimSha256 !== decision.claimSha256) throw integrityError("WR_DOCUMENT_CLAIM_INTEGRITY_FAILURE", "Review decision does not match an exact extracted claim");
    const conflict = run.conflicts.find((item) => item.claimIds.includes(claim.id));
    if (conflict && decision.decision === "accepted" && !decision.resolvesConflict) throw integrityError("WR_UNRESOLVED_DOCUMENT_CONFLICT", "An accepted conflicting claim must explicitly resolve its conflict");
  }
  for (const conflict of run.conflicts) if (claimDecisions.filter((item) => conflict.claimIds.includes(item.claimId) && item.decision === "accepted" && item.resolvesConflict).length !== 1) throw integrityError("WR_UNRESOLVED_DOCUMENT_CONFLICT", "Each conflicting fact requires exactly one accepted resolution");
  const body = {
    schemaVersion: DOCUMENT_EXTRACTION_REVIEW_VERSION,
    id: String(input.id || stableId("extraction_review", `${run.id}|${reviewerUserId}|${reviewedAt}`)),
    organizationId: run.organizationId,
    extractionRunId: run.id,
    extractionRunSha256: run.runSha256,
    reviewerUserId,
    reviewerRole: required(input.reviewerRole, "reviewerRole"),
    decision: ["approved", "rejected", "changes-requested"].includes(input.decision) ? input.decision : "changes-requested",
    claimDecisions,
    reviewedAt,
  };
  if (body.decision === "approved" && claimDecisions.some((item) => item.decision === "unknown")) throw integrityError("WR_EXTRACTION_REVIEW_INCOMPLETE", "An approved extraction cannot contain undecided claims");
  return Object.freeze({ ...body, reviewSha256: digestRecord(input, body, "reviewSha256", "WR_EXTRACTION_REVIEW_INTEGRITY_FAILURE", "Document extraction review") });
}

export function createReviewedFactPromotion(input = {}) {
  const run = createDocumentExtractionRun(input.run);
  const review = createDocumentExtractionReview(run, input.review);
  const documentVersion = createDealRoomDocumentVersion(input.documentVersion);
  if ([run.organizationId, review.organizationId, documentVersion.organizationId].some((item) => item !== input.organizationId)) throw tenantError("Promotion evidence crosses organization boundaries");
  if (review.decision !== "approved") throw integrityError("WR_HUMAN_REVIEW_REQUIRED", "Only an approved human review can promote document evidence");
  if (documentVersion.id !== run.documentVersionId || documentVersion.versionSha256 !== run.documentVersionSha256 || documentVersion.contentSha256 !== run.contentSha256) throw integrityError("WR_DOCUMENT_EXTRACTION_SOURCE_CHANGED", "Promotion document does not match the reviewed extraction source");
  if (documentVersion.quarantineStatus !== "released") throw integrityError("WR_DOCUMENT_QUARANTINED", "Quarantined document evidence cannot be promoted");
  if (input.latestDocumentVersionId !== documentVersion.id) throw integrityError("WR_DOCUMENT_VERSION_STALE", "Only evidence from the latest document version can be promoted");
  const claim = run.claims.find((item) => item.id === input.claimId);
  const claimDecision = review.claimDecisions.find((item) => item.claimId === input.claimId);
  if (!claim || claim.claimSha256 !== input.claimSha256 || claimDecision?.claimSha256 !== claim.claimSha256) throw integrityError("WR_DOCUMENT_CLAIM_INTEGRITY_FAILURE", "Promotion claim does not match reviewed evidence");
  if (claim.status === "unknown" || claimDecision.decision !== "accepted") throw integrityError("WR_HUMAN_REVIEW_REQUIRED", "Unknown or unaccepted claims cannot be promoted");
  const citationVerifications = (input.citationVerifications || []).map(normalizeDocumentCitationVerification);
  if (citationVerifications.length !== claim.citations.length) throw integrityError("WR_CITATION_VERIFICATION_REQUIRED", "Every promoted citation requires an exact page-anchor verification");
  for (const citation of claim.citations) {
    const verification = citationVerifications.find((item) => item.citationId === citation.id && item.citationSha256 === citation.citationSha256);
    if (!verification || !verification.valid || verification.organizationId !== run.organizationId || verification.documentVersionId !== documentVersion.id || verification.documentVersionSha256 !== documentVersion.versionSha256) throw integrityError("WR_CITATION_VERIFICATION_REQUIRED", "Citation verification is missing, invalid, or bound to different evidence");
  }
  const promotedAt = iso(input.promotedAt, "promotedAt");
  if (!Number.isInteger(Number(input.targetExpectedRevision)) || Number(input.targetExpectedRevision) < 0) throw new TypeError("targetExpectedRevision must be an explicit non-negative integer");
  const body = {
    schemaVersion: REVIEWED_FACT_PROMOTION_VERSION,
    id: String(input.id || stableId("fact_promotion", `${run.id}|${review.id}|${claim.id}|${promotedAt}`)),
    organizationId: run.organizationId,
    dealId: run.dealId,
    whiteRabbitPropertyId: run.whiteRabbitPropertyId,
    factPath: claim.factPath,
    proposedValue: claim.value,
    valueType: claim.valueType,
    documentVersionId: documentVersion.id,
    documentVersionSha256: documentVersion.versionSha256,
    extractionRunId: run.id,
    extractionRunSha256: run.runSha256,
    claimId: claim.id,
    claimSha256: claim.claimSha256,
    citationSha256s: claim.citations.map((item) => item.citationSha256).sort(),
    citationVerificationSha256s: citationVerifications.map((item) => item.verificationSha256).sort(),
    reviewId: review.id,
    reviewSha256: review.reviewSha256,
    promotedByUserId: required(input.promotedByUserId, "promotedByUserId"),
    promotedAt,
    targetExpectedRevision: Number(input.targetExpectedRevision),
    status: "proposed-not-applied",
  };
  if (body.promotedByUserId !== review.reviewerUserId && input.allowIndependentPromoter !== true) throw integrityError("WR_PROMOTION_AUTHORITY_DENIED", "Promotion must be issued by the reviewing user or an explicitly independent promoter");
  return Object.freeze({ ...body, promotionSha256: digestRecord(input, body, "promotionSha256", "WR_FACT_PROMOTION_INTEGRITY_FAILURE", "Reviewed fact promotion") });
}

export function normalizeReviewedFactPromotion(input = {}) {
  const body = {
    schemaVersion: REVIEWED_FACT_PROMOTION_VERSION,
    id: required(input.id, "promotion.id"), organizationId: required(input.organizationId, "promotion.organizationId"), dealId: required(input.dealId, "promotion.dealId"),
    whiteRabbitPropertyId: required(input.whiteRabbitPropertyId, "promotion.whiteRabbitPropertyId"), factPath: factPath(input.factPath), proposedValue: input.proposedValue ?? null,
    valueType: required(input.valueType, "promotion.valueType"), documentVersionId: required(input.documentVersionId, "promotion.documentVersionId"), documentVersionSha256: validateDigest(input.documentVersionSha256, "promotion.documentVersionSha256"),
    extractionRunId: required(input.extractionRunId, "promotion.extractionRunId"), extractionRunSha256: validateDigest(input.extractionRunSha256, "promotion.extractionRunSha256"),
    claimId: required(input.claimId, "promotion.claimId"), claimSha256: validateDigest(input.claimSha256, "promotion.claimSha256"), citationSha256s: [...(input.citationSha256s || [])].map((item) => validateDigest(item, "promotion.citationSha256")).sort(),
    citationVerificationSha256s: [...(input.citationVerificationSha256s || [])].map((item) => validateDigest(item, "promotion.citationVerificationSha256")).sort(), reviewId: required(input.reviewId, "promotion.reviewId"), reviewSha256: validateDigest(input.reviewSha256, "promotion.reviewSha256"),
    promotedByUserId: required(input.promotedByUserId, "promotion.promotedByUserId"), promotedAt: iso(input.promotedAt, "promotion.promotedAt"), targetExpectedRevision: Number(input.targetExpectedRevision), status: input.status,
  };
  if (!Number.isInteger(body.targetExpectedRevision) || body.targetExpectedRevision < 0 || body.status !== "proposed-not-applied") throw new TypeError("Invalid reviewed fact promotion state");
  return Object.freeze({ ...body, promotionSha256: digestRecord(input, body, "promotionSha256", "WR_FACT_PROMOTION_INTEGRITY_FAILURE", "Reviewed fact promotion") });
}
