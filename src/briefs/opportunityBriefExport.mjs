import { createHash } from "node:crypto";

export const OPPORTUNITY_BRIEF_EXPORT_POLICY_VERSION = "wr-opportunity-brief-export-policy-v1";
export const OPPORTUNITY_BRIEF_EXPORT_REQUEST_VERSION = "wr-opportunity-brief-export-request-v1";
export const OPPORTUNITY_BRIEF_ACCESS_GRANT_VERSION = "wr-opportunity-brief-access-grant-v1";
export const OPPORTUNITY_BRIEF_REVOCATION_VERSION = "wr-opportunity-brief-revocation-v1";
export const OPPORTUNITY_BRIEF_EXPORT_ARTIFACT_VERSION = "wr-opportunity-brief-export-artifact-v1";

export const BRIEF_CLASSIFICATIONS = Object.freeze(["public", "internal", "confidential", "restricted"]);

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

export function opportunityBriefSha256(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest("hex");
}

function stableId(prefix, seed) {
  return `${prefix}_${opportunityBriefSha256(seed).slice(0, 24)}`;
}

function classification(value, name = "classification") {
  const normalized = String(value || "internal").toLowerCase();
  if (!BRIEF_CLASSIFICATIONS.includes(normalized)) throw new TypeError(`${name} is unsupported`);
  return normalized;
}

function normalizeRecipient(value = {}) {
  const type = ["user", "email"].includes(value.type) ? value.type : "email";
  const id = required(value.id || value.email, "recipient.id").toLowerCase();
  if (type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id)) throw new TypeError("recipient email is invalid");
  return Object.freeze({ type, id, displayName: String(value.displayName || "") });
}

function tenantError(message) {
  const error = new Error(message);
  error.code = "WR_TENANT_ISOLATION_VIOLATION";
  return error;
}

function accessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createOpportunityBriefExportPolicy(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const issuedAt = iso(input.issuedAt, "issuedAt");
  const allowedRecipientIds = [...new Set((input.allowedRecipientIds || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean))].sort();
  const allowedEmailDomains = [...new Set((input.allowedEmailDomains || []).map((item) => String(item).trim().toLowerCase().replace(/^@/, "")).filter(Boolean))].sort();
  if (!allowedRecipientIds.length && !allowedEmailDomains.length) throw new TypeError("At least one authorized recipient or email domain is required");
  const fieldClassifications = Object.fromEntries(Object.entries(input.fieldClassifications || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, classification(value, `fieldClassifications.${key}`)]));
  const maxAccessSeconds = Math.max(60, Math.trunc(Number(input.maxAccessSeconds) || 7 * 86400));
  const policy = {
    schemaVersion: OPPORTUNITY_BRIEF_EXPORT_POLICY_VERSION,
    id: String(input.id || stableId("brief_policy", `${organizationId}|${issuedAt}|${allowedRecipientIds.join(",")}|${allowedEmailDomains.join(",")}`)),
    organizationId,
    issuedAt,
    allowedFormats: [...new Set((input.allowedFormats || ["json"]).map((item) => String(item).toLowerCase()))].sort(),
    allowedRecipientIds,
    allowedEmailDomains,
    defaultClassification: classification(input.defaultClassification),
    fieldClassifications,
    maxRecipientClearance: classification(input.maxRecipientClearance || "confidential", "maxRecipientClearance"),
    maxAccessSeconds,
    watermarkRequired: input.watermarkRequired !== false,
  };
  if (!policy.allowedFormats.length) throw new TypeError("allowedFormats must not be empty");
  const policySha256 = opportunityBriefSha256(policy);
  if (input.policySha256 && input.policySha256 !== policySha256) throw accessError("WR_BRIEF_POLICY_INTEGRITY_FAILURE", "Export policy digest verification failed");
  return Object.freeze({ ...policy, policySha256 });
}

export function createOpportunityBriefExportRequest(input = {}) {
  const requestedAt = iso(input.requestedAt, "requestedAt");
  const request = {
    schemaVersion: OPPORTUNITY_BRIEF_EXPORT_REQUEST_VERSION,
    id: String(input.id || stableId("brief_export", `${input.organizationId}|${input.briefRef}|${input.recipient?.id || input.recipient?.email}|${requestedAt}`)),
    organizationId: required(input.organizationId, "organizationId"),
    requestedByUserId: required(input.requestedByUserId, "requestedByUserId"),
    briefRef: required(input.briefRef, "briefRef"),
    briefSha256: required(input.briefSha256, "briefSha256"),
    recipient: normalizeRecipient(input.recipient),
    recipientClearance: classification(input.recipientClearance || "internal", "recipientClearance"),
    format: String(input.format || "json").toLowerCase(),
    purpose: required(input.purpose, "purpose"),
    requestedAt,
    expiresAt: iso(input.expiresAt, "expiresAt"),
  };
  if (new Date(request.expiresAt) <= new Date(requestedAt)) throw new TypeError("expiresAt must be after requestedAt");
  const requestSha256 = opportunityBriefSha256(request);
  if (input.requestSha256 && input.requestSha256 !== requestSha256) throw accessError("WR_BRIEF_REQUEST_INTEGRITY_FAILURE", "Export request digest verification failed");
  return Object.freeze({ ...request, requestSha256 });
}

function recipientAllowed(policy, recipient) {
  if (policy.allowedRecipientIds.includes(recipient.id)) return true;
  if (recipient.type !== "email") return false;
  const domain = recipient.id.split("@")[1] || "";
  return policy.allowedEmailDomains.includes(domain);
}

function grantAuthorization(grant) {
  return {
    schemaVersion: grant.schemaVersion, id: grant.id, organizationId: grant.organizationId, policyId: grant.policyId, policySha256: grant.policySha256,
    requestId: grant.requestId, requestSha256: grant.requestSha256, recipient: grant.recipient, recipientClearance: grant.recipientClearance,
    format: grant.format, briefRef: grant.briefRef, briefSha256: grant.briefSha256, purpose: grant.purpose, grantedByUserId: grant.grantedByUserId,
    grantedAt: grant.grantedAt, expiresAt: grant.expiresAt,
  };
}

export function grantOpportunityBriefAccess(policyInput, requestInput, options = {}) {
  const policy = createOpportunityBriefExportPolicy(policyInput);
  const request = createOpportunityBriefExportRequest(requestInput);
  if (policy.organizationId !== request.organizationId) throw tenantError("Export policy and request organizations do not match");
  if (!policy.allowedFormats.includes(request.format)) throw accessError("WR_BRIEF_EXPORT_FORMAT_DENIED", `Export format is not allowed: ${request.format}`);
  if (!recipientAllowed(policy, request.recipient)) throw accessError("WR_BRIEF_RECIPIENT_DENIED", "Recipient is not authorized by export policy");
  if (BRIEF_CLASSIFICATIONS.indexOf(request.recipientClearance) > BRIEF_CLASSIFICATIONS.indexOf(policy.maxRecipientClearance)) throw accessError("WR_BRIEF_CLEARANCE_DENIED", "Recipient clearance exceeds policy authority");
  const grantedAt = iso(options.grantedAt || request.requestedAt, "grantedAt");
  const maximumExpiry = new Date(new Date(grantedAt).getTime() + policy.maxAccessSeconds * 1000);
  const expiresAt = new Date(request.expiresAt) < maximumExpiry ? request.expiresAt : maximumExpiry.toISOString();
  const grant = {
    schemaVersion: OPPORTUNITY_BRIEF_ACCESS_GRANT_VERSION,
    id: String(options.id || stableId("brief_grant", `${policy.id}|${request.id}|${grantedAt}`)),
    organizationId: request.organizationId,
    policyId: policy.id,
    policySha256: policy.policySha256,
    requestId: request.id,
    requestSha256: request.requestSha256,
    recipient: request.recipient,
    recipientClearance: request.recipientClearance,
    format: request.format,
    briefRef: request.briefRef,
    briefSha256: request.briefSha256,
    purpose: request.purpose,
    grantedByUserId: required(options.grantedByUserId, "grantedByUserId"),
    grantedAt,
    expiresAt,
    revokedAt: "",
    revocationId: "",
  };
  return Object.freeze({ ...grant, grantAuthorizationSha256: opportunityBriefSha256(grantAuthorization(grant)) });
}

export function revokeOpportunityBriefAccess(grantInput, input = {}) {
  const grant = { ...grantInput };
  if (grant.schemaVersion !== OPPORTUNITY_BRIEF_ACCESS_GRANT_VERSION) throw new TypeError("Unsupported brief access grant");
  if (input.organizationId && input.organizationId !== grant.organizationId) throw tenantError("Revocation organization does not match access grant");
  const revokedAt = iso(input.revokedAt, "revokedAt");
  const revocation = Object.freeze({
    schemaVersion: OPPORTUNITY_BRIEF_REVOCATION_VERSION,
    id: String(input.id || stableId("brief_revocation", `${grant.id}|${revokedAt}`)),
    organizationId: grant.organizationId,
    accessGrantId: grant.id,
    revokedByUserId: required(input.revokedByUserId, "revokedByUserId"),
    reason: required(input.reason, "reason"),
    revokedAt,
  });
  return Object.freeze({ grant: Object.freeze({ ...grant, revokedAt, revocationId: revocation.id }), revocation });
}

export function assertOpportunityBriefAccess(grant, options = {}) {
  if (grant?.schemaVersion !== OPPORTUNITY_BRIEF_ACCESS_GRANT_VERSION) throw accessError("WR_BRIEF_ACCESS_INVALID", "Unsupported brief access grant");
  if (options.organizationId && grant.organizationId !== options.organizationId) throw tenantError("Access grant organization does not match request organization");
  if (options.requestId && grant.requestId !== options.requestId) throw accessError("WR_BRIEF_ACCESS_INVALID", "Access grant does not authorize this export request");
  if (opportunityBriefSha256(grantAuthorization(grant)) !== grant.grantAuthorizationSha256) throw accessError("WR_BRIEF_ACCESS_INTEGRITY_FAILURE", "Brief access grant authorization digest verification failed");
  if (grant.revokedAt) throw accessError("WR_BRIEF_ACCESS_REVOKED", "Brief export access was revoked");
  const now = new Date(iso(options.now, "now"));
  if (new Date(grant.expiresAt) <= now) throw accessError("WR_BRIEF_ACCESS_EXPIRED", "Brief export access expired");
  return grant;
}

function factClassification(policy, sectionId, factId) {
  return classification(policy.fieldClassifications[`sections.${sectionId}.${factId}`] || policy.fieldClassifications[factId] || policy.defaultClassification);
}

export function redactOpportunityBrief(brief, policyInput, clearanceInput = "internal") {
  if (brief?.schemaVersion !== "wr-opportunity-brief-v1") throw new TypeError("Unsupported opportunity brief");
  const policy = createOpportunityBriefExportPolicy(policyInput);
  const clearance = classification(clearanceInput, "clearance");
  const clearanceRank = BRIEF_CLASSIFICATIONS.indexOf(clearance);
  const copy = structuredClone(brief);
  let redactedFactCount = 0;
  copy.sections = (copy.sections || []).map((section) => ({
    ...section,
    facts: (section.facts || []).map((fact) => {
      const fieldLevel = factClassification(policy, section.id, fact.id);
      if (BRIEF_CLASSIFICATIONS.indexOf(fieldLevel) <= clearanceRank) return { ...fact, classification: fieldLevel };
      redactedFactCount += 1;
      return { id: fact.id, label: fact.label, value: null, status: "redacted", source: "", sourceField: "", asOf: "", confidence: 0, classification: fieldLevel };
    }),
  }));
  for (const field of ["opportunitySignals", "underwriting", "sensitivity", "scenarioComparison"]) {
    const fieldLevel = classification(policy.fieldClassifications[field] || policy.defaultClassification);
    if (BRIEF_CLASSIFICATIONS.indexOf(fieldLevel) > clearanceRank) copy[field] = null;
  }
  for (const field of ["whiteRabbitPropertyId", "profileSchemaVersion", "lineage", "warnings", "evidenceSummary"]) {
    const fieldLevel = classification(policy.fieldClassifications[field] || policy.defaultClassification);
    if (BRIEF_CLASSIFICATIONS.indexOf(fieldLevel) > clearanceRank) copy[field] = field === "warnings" ? [] : null;
  }
  const exportModelLevel = classification(policy.fieldClassifications.exportModel || policy.defaultClassification);
  if (BRIEF_CLASSIFICATIONS.indexOf(exportModelLevel) > clearanceRank) {
    copy.exportModel = { formatVersion: copy.schemaVersion, title: "White Rabbit Opportunity Brief", sectionOrder: (copy.sections || []).map((section) => section.id), disclaimer: String(copy.exportModel?.disclaimer || "") };
  }
  copy.exportRedaction = { classification: clearance, redactedFactCount, policyId: policy.id };
  return Object.freeze(copy);
}

function lineageFrom(brief) {
  const sources = new Map();
  for (const fact of (brief.sections || []).flatMap((section) => section.facts || [])) {
    if (fact.status !== "observed" || !fact.source) continue;
    const key = `${fact.source}|${fact.sourceField}|${fact.asOf}`;
    sources.set(key, { sourceDatasetId: fact.source, sourceField: fact.sourceField, asOf: fact.asOf || "" });
  }
  return [...sources.values()].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

export function prepareOpportunityBriefExport(input = {}) {
  const policy = createOpportunityBriefExportPolicy(input.policy);
  const request = createOpportunityBriefExportRequest(input.request);
  const preparedAt = iso(input.preparedAt || input.createdAt, "preparedAt");
  const grant = assertOpportunityBriefAccess(input.accessGrant, { organizationId: request.organizationId, requestId: request.id, now: preparedAt });
  if (policy.id !== grant.policyId) throw accessError("WR_BRIEF_ACCESS_INVALID", "Access grant policy does not match export policy");
  if (policy.policySha256 !== grant.policySha256 || request.requestSha256 !== grant.requestSha256) throw accessError("WR_BRIEF_ACCESS_INTEGRITY_FAILURE", "Access grant is not bound to the supplied policy and request");
  const sourceBriefSha256 = opportunityBriefSha256(input.brief);
  if (sourceBriefSha256 !== request.briefSha256 || sourceBriefSha256 !== grant.briefSha256) throw accessError("WR_BRIEF_SOURCE_INTEGRITY_FAILURE", "Opportunity brief does not match its authorized digest");
  const redactedBrief = redactOpportunityBrief(input.brief, policy, grant.recipientClearance);
  const redactedPayload = canonicalJson(redactedBrief);
  const redactedPayloadSha256 = opportunityBriefSha256(redactedPayload);
  const watermark = policy.watermarkRequired ? {
    text: `WHITE RABBIT • ${grant.recipient.id} • ${grant.recipientClearance.toUpperCase()} • EXPIRES ${grant.expiresAt}`,
    recipientId: grant.recipient.id,
    classification: grant.recipientClearance,
    issuedAt: preparedAt,
    expiresAt: grant.expiresAt,
  } : null;
  const watermarkSha256 = watermark ? opportunityBriefSha256(watermark) : "";
  return Object.freeze({ policy, request, grant, redactedBrief, redactedPayload, redactedPayloadSha256, sourceBriefSha256, watermark, watermarkSha256, lineage: lineageFrom(redactedBrief), preparedAt });
}

export function sealOpportunityBriefExportArtifact(input = {}) {
  const prepared = input.prepared || prepareOpportunityBriefExport(input);
  const { policy, request, grant, redactedPayload, redactedPayloadSha256, sourceBriefSha256 } = prepared;
  assertOpportunityBriefAccess(grant, { organizationId: request.organizationId, requestId: request.id, now: input.createdAt });
  const rendered = input.rendered || { format: "json", content: `${prepared.watermark?.text || ""}\n${redactedPayload}`, sourcePayloadSha256: redactedPayloadSha256, watermarkSha256: prepared.watermarkSha256 };
  if (String(rendered.format || "") !== request.format) throw accessError("WR_BRIEF_RENDER_INTEGRITY_FAILURE", "Renderer returned the wrong format");
  if (String(rendered.sourcePayloadSha256 || "") !== redactedPayloadSha256) throw accessError("WR_BRIEF_RENDER_INTEGRITY_FAILURE", "Renderer did not bind output to the authorized payload");
  if (policy.watermarkRequired && String(rendered.watermarkSha256 || "") !== prepared.watermarkSha256) throw accessError("WR_BRIEF_RENDER_INTEGRITY_FAILURE", "Renderer did not attest the required watermark");
  const content = Buffer.isBuffer(rendered.content) ? rendered.content : Buffer.from(String(rendered.content ?? ""));
  if (!content.length) throw new TypeError("Rendered content must not be empty");
  const createdAt = iso(input.createdAt, "createdAt");
  const manifest = {
    schemaVersion: OPPORTUNITY_BRIEF_EXPORT_ARTIFACT_VERSION,
    id: String(input.id || stableId("brief_artifact", `${request.id}|${grant.id}|${redactedPayloadSha256}|${createdAt}`)),
    organizationId: request.organizationId,
    requestId: request.id,
    accessGrantId: grant.id,
    policyId: policy.id,
    briefRef: request.briefRef,
    sourceBriefSha256,
    redactedPayloadSha256,
    contentSha256: opportunityBriefSha256(content),
    contentLength: content.length,
    format: request.format,
    recipient: grant.recipient,
    classification: grant.recipientClearance,
    watermark: prepared.watermark,
    watermarkSha256: prepared.watermarkSha256,
    lineage: prepared.lineage,
    createdAt,
    expiresAt: grant.expiresAt,
    artifactRef: required(input.artifactRef, "artifactRef"),
  };
  return Object.freeze({ ...manifest, artifactSha256: opportunityBriefSha256(manifest) });
}

export function verifyOpportunityBriefExportArtifact(artifact, options = {}) {
  const artifactSha256 = String(artifact?.artifactSha256 || "");
  const { artifactSha256: ignored, ...manifest } = artifact || {};
  const validManifest = artifact?.schemaVersion === OPPORTUNITY_BRIEF_EXPORT_ARTIFACT_VERSION && artifactSha256 === opportunityBriefSha256(manifest);
  const contentSha256 = options.content === undefined ? String(artifact?.contentSha256 || "") : opportunityBriefSha256(Buffer.isBuffer(options.content) ? options.content : Buffer.from(String(options.content)));
  const validContent = contentSha256 === artifact?.contentSha256;
  return Object.freeze({ valid: validManifest && validContent, validManifest, validContent, artifactSha256, computedArtifactSha256: opportunityBriefSha256(manifest), contentSha256 });
}
