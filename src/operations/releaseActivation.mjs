import { createHash, sign, verify } from "node:crypto";

export const RELEASE_EVIDENCE_ATTESTATION_VERSION = "wr-release-evidence-attestation-v1";
export const CAPABILITY_RELEASE_POLICY_VERSION = "wr-capability-release-policy-v1";
export const CAPABILITY_RELEASE_DECISION_VERSION = "wr-capability-release-decision-v1";
export const PLATFORM_RELEASE_MANIFEST_VERSION = "wr-platform-release-manifest-v1";

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

function sha256(value) { return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex"); }
function signaturePayload(value) { const { signature, ...payload } = value; return Buffer.from(canonicalJson(payload)); }
function releaseCandidateSha256(candidate) { return sha256(candidate); }

export function computeReleaseAttestationSha256(attestation = {}) { return sha256(attestation); }

export function computeReleaseCandidateSha256(input = {}) {
  const candidate = {
    sourceRevision: required(input.sourceRevision, "candidate.sourceRevision"),
    buildSha256: required(input.buildSha256, "candidate.buildSha256"),
    environment: input.environment === "production" ? "production" : "staging",
    activationStartsAt: iso(input.activationStartsAt, "candidate.activationStartsAt"),
    activationExpiresAt: iso(input.activationExpiresAt, "candidate.activationExpiresAt"),
    featureGates: [...new Set((input.featureGates || []).map(String).filter(Boolean))].sort(),
  };
  return releaseCandidateSha256(candidate);
}

export function createReleaseEvidenceAttestation(input = {}) {
  const issuedAt = iso(input.issuedAt, "issuedAt");
  const expiresAt = iso(input.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) throw new TypeError("expiresAt must be after issuedAt");
  const artifactGeneratedAt = iso(input.artifactGeneratedAt, "artifactGeneratedAt");
  if (artifactGeneratedAt > issuedAt) throw new TypeError("artifactGeneratedAt cannot be after issuedAt");
  if (!input.privateKey) throw new TypeError("privateKey is required to sign release evidence");
  const artifactSha256 = input.artifact === undefined ? required(input.artifactSha256, "artifactSha256") : sha256(input.artifact);
  if (!/^[a-f0-9]{64}$/.test(artifactSha256)) throw new TypeError("artifactSha256 must be a SHA-256 hex digest");
  const core = {
    schemaVersion: RELEASE_EVIDENCE_ATTESTATION_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    capabilityId: required(input.capabilityId, "capabilityId"),
    evidenceType: required(input.evidenceType, "evidenceType"),
    artifactId: required(input.artifactId, "artifactId"),
    artifactRef: required(input.artifactRef, "artifactRef"),
    artifactSchemaVersion: required(input.artifactSchemaVersion, "artifactSchemaVersion"),
    artifactSha256,
    artifactGeneratedAt,
    issuedAt,
    expiresAt,
    environment: ["development", "staging", "production"].includes(input.environment) ? input.environment : "development",
    synthetic: input.synthetic === true,
    artifactAuthorId: required(input.artifactAuthorId, "artifactAuthorId"),
    signer: { actorId: required(input.signer?.actorId, "signer.actorId"), role: required(input.signer?.role, "signer.role"), keyId: required(input.signer?.keyId, "signer.keyId") },
    claims: input.claims && typeof input.claims === "object" ? structuredClone(input.claims) : {},
    signatureAlgorithm: "Ed25519",
  };
  return Object.freeze({ ...core, signature: sign(null, Buffer.from(canonicalJson(core)), input.privateKey).toString("base64") });
}

export function verifyReleaseEvidenceAttestation(attestation, { trustStore = {}, asOf, expectedOrganizationId = "", expectedCapabilityId = "", allowedRoles = [], maximumArtifactAgeHours = null } = {}) {
  const evaluatedAt = iso(asOf, "asOf");
  const key = trustStore[attestation?.signer?.keyId];
  const checks = [];
  const add = (id, passed, reason) => checks.push({ id, passed: passed === true, reason: passed === true ? "" : reason });
  add("schema", attestation?.schemaVersion === RELEASE_EVIDENCE_ATTESTATION_VERSION && attestation?.signatureAlgorithm === "Ed25519", "Unsupported evidence attestation schema or algorithm.");
  add("trusted-key", Boolean(key?.publicKey), "Signing key is not trusted.");
  add("key-organization", Boolean(key) && (!key.organizationId || key.organizationId === attestation.organizationId), "Signing key is not trusted for this organization.");
  add("key-role", Boolean(key) && (!key.allowedRoles?.length || key.allowedRoles.includes(attestation?.signer?.role)), "Signing key is not authorized for the signer role.");
  add("required-role", !allowedRoles.length || allowedRoles.includes(attestation?.signer?.role), "Signer role is not permitted for this evidence requirement.");
  add("organization", !expectedOrganizationId || attestation?.organizationId === expectedOrganizationId, "Evidence belongs to another organization.");
  add("capability", !expectedCapabilityId || attestation?.capabilityId === expectedCapabilityId, "Evidence belongs to another capability.");
  add("issued-window", Boolean(attestation?.issuedAt && attestation?.expiresAt) && attestation.issuedAt <= evaluatedAt && attestation.expiresAt >= evaluatedAt, "Evidence attestation is not yet valid or has expired.");
  add("key-window", Boolean(key) && (!key.activeFrom || key.activeFrom <= evaluatedAt) && (!key.expiresAt || key.expiresAt >= evaluatedAt) && (!key.revokedAt || key.revokedAt > evaluatedAt), "Signing key is inactive, expired, or revoked.");
  const artifactAgeHours = attestation?.artifactGeneratedAt ? (new Date(evaluatedAt).getTime() - new Date(attestation.artifactGeneratedAt).getTime()) / 3600000 : Number.POSITIVE_INFINITY;
  add("artifact-time", artifactAgeHours >= 0, "Artifact timestamp is in the future.");
  add("artifact-age", maximumArtifactAgeHours === null || artifactAgeHours <= maximumArtifactAgeHours, "Artifact is older than the evidence policy permits.");
  let signatureValid = false;
  try { signatureValid = Boolean(key?.publicKey) && verify(null, signaturePayload(attestation), key.publicKey, Buffer.from(String(attestation.signature || ""), "base64")); } catch {}
  add("signature", signatureValid, "Ed25519 signature verification failed.");
  return Object.freeze({ valid: checks.every((check) => check.passed), evaluatedAt, artifactAgeHours: Number.isFinite(artifactAgeHours) ? Number(artifactAgeHours.toFixed(3)) : null, checks });
}

export function createCapabilityReleasePolicy(input = {}) {
  const requiredEvidence = (input.requiredEvidence || []).map((requirement, index) => ({
    evidenceType: required(requirement.evidenceType, `requiredEvidence[${index}].evidenceType`),
    minimumCount: Math.max(1, Math.min(10, Math.trunc(Number(requirement.minimumCount) || 1))),
    allowedSignerRoles: [...new Set((requirement.allowedSignerRoles || []).map(String).filter(Boolean))],
    maximumArtifactAgeHours: Math.max(1, Number(requirement.maximumArtifactAgeHours) || 168),
    requireIndependentSigner: requirement.requireIndependentSigner !== false,
    allowSynthetic: requirement.allowSynthetic === true,
  }));
  if (!requiredEvidence.length) throw new TypeError("requiredEvidence must contain at least one requirement");
  return Object.freeze({
    schemaVersion: CAPABILITY_RELEASE_POLICY_VERSION,
    id: required(input.id, "id"),
    policyVersion: required(input.policyVersion, "policyVersion"),
    organizationId: required(input.organizationId, "organizationId"),
    capabilityId: required(input.capabilityId, "capabilityId"),
    featureGates: [...new Set((input.featureGates || []).map(String).filter(Boolean))].sort(),
    requiredEvidence,
    requiredApprovalRoles: [...new Set((input.requiredApprovalRoles || ["product-owner", "security-reviewer", "operations-reviewer"]).map(String).filter(Boolean))],
    decisionTtlHours: Math.max(1, Math.min(168, Number(input.decisionTtlHours) || 24)),
    rollback: {
      maximumMinutes: Math.max(1, Math.min(240, Number(input.rollback?.maximumMinutes) || 30)),
      maximumDrillAgeDays: Math.max(1, Math.min(365, Number(input.rollback?.maximumDrillAgeDays) || 30)),
      requireAutomatedDisable: input.rollback?.requireAutomatedDisable !== false,
    },
  });
}

function verifyRollback(plan, policy, asOf) {
  const drillAgeDays = plan?.lastTestedAt ? (new Date(asOf).getTime() - new Date(plan.lastTestedAt).getTime()) / 86400000 : Number.POSITIVE_INFINITY;
  return [
    { id: "rollback-owner", passed: Boolean(plan?.ownerActorId), reason: "Rollback owner is missing." },
    { id: "rollback-procedure", passed: Boolean(plan?.procedureRef) && Boolean(plan?.recoveryPointRef), reason: "Rollback procedure or recovery point is missing." },
    { id: "rollback-time", passed: Number(plan?.maximumMinutes) > 0 && Number(plan.maximumMinutes) <= policy.rollback.maximumMinutes, reason: "Rollback time exceeds policy." },
    { id: "rollback-drill", passed: drillAgeDays >= 0 && drillAgeDays <= policy.rollback.maximumDrillAgeDays, reason: "Rollback drill is missing, future-dated, or stale." },
    { id: "rollback-automation", passed: !policy.rollback.requireAutomatedDisable || plan?.automatedDisable === true, reason: "Automated feature disable is required." },
    { id: "rollback-signals", passed: Array.isArray(plan?.abortSignals) && plan.abortSignals.length > 0, reason: "Rollback abort signals are missing." },
  ].map((check) => ({ ...check, reason: check.passed ? "" : check.reason }));
}

export function decideCapabilityRelease(input = {}) {
  const policy = input.policy?.schemaVersion === CAPABILITY_RELEASE_POLICY_VERSION ? input.policy : createCapabilityReleasePolicy(input.policy);
  const asOf = iso(input.asOf, "asOf");
  const candidate = {
    sourceRevision: required(input.candidate?.sourceRevision, "candidate.sourceRevision"),
    buildSha256: required(input.candidate?.buildSha256, "candidate.buildSha256"),
    environment: input.candidate?.environment === "production" ? "production" : "staging",
    activationStartsAt: iso(input.candidate?.activationStartsAt, "candidate.activationStartsAt"),
    activationExpiresAt: iso(input.candidate?.activationExpiresAt, "candidate.activationExpiresAt"),
    featureGates: [...new Set((input.candidate?.featureGates || []).map(String).filter(Boolean))].sort(),
  };
  if (!/^[a-f0-9]{64}$/.test(candidate.buildSha256)) throw new TypeError("candidate.buildSha256 must be a SHA-256 hex digest");
  const candidateSha256 = releaseCandidateSha256(candidate);
  const evidence = input.evidenceAttestations || [];
  const approvals = input.approvalAttestations || [];
  const checks = [];
  const blockers = [];
  const add = (id, passed, reason, details = {}) => { const item = { id, passed: passed === true, ...details }; checks.push(item); if (!item.passed) blockers.push({ checkId: id, reason }); };
  add("organization", policy.organizationId === input.organizationId, "Release organization does not match policy.");
  add("capability", policy.capabilityId === input.capabilityId, "Release capability does not match policy.");
  add("feature-gate-scope", canonicalJson(candidate.featureGates) === canonicalJson(policy.featureGates), "Candidate feature gates do not exactly match policy.");
  add("gates-currently-off", policy.featureGates.every((gate) => input.currentGateStates?.[gate] === false), "One or more feature gates are already enabled outside this release decision.");
  add("activation-window", candidate.activationStartsAt <= asOf && candidate.activationExpiresAt >= asOf && candidate.activationExpiresAt > candidate.activationStartsAt, "Release candidate is outside its activation window.");
  const decisionExpiry = new Date(Math.min(new Date(candidate.activationExpiresAt).getTime(), new Date(asOf).getTime() + policy.decisionTtlHours * 3600000)).toISOString();
  for (const requirement of policy.requiredEvidence) {
    const matching = evidence.filter((item) => item.evidenceType === requirement.evidenceType);
    const verified = matching.map((attestation) => ({ attestation, verification: verifyReleaseEvidenceAttestation(attestation, { trustStore: input.trustStore, asOf, expectedOrganizationId: policy.organizationId, expectedCapabilityId: policy.capabilityId, allowedRoles: requirement.allowedSignerRoles, maximumArtifactAgeHours: requirement.maximumArtifactAgeHours }) }));
    const acceptable = verified.filter(({ attestation, verification }) => verification.valid && (requirement.allowSynthetic || !attestation.synthetic) && (!requirement.requireIndependentSigner || attestation.signer.actorId !== attestation.artifactAuthorId));
    add(`evidence:${requirement.evidenceType}`, acceptable.length >= requirement.minimumCount, `Required verified evidence is missing or unacceptable: ${requirement.evidenceType}.`, { acceptableCount: acceptable.length, requiredCount: requirement.minimumCount });
  }
  const requestedBy = required(input.requestedBy, "requestedBy");
  const approvalActors = new Set();
  for (const role of policy.requiredApprovalRoles) {
    const valid = approvals.filter((attestation) => attestation.evidenceType === "release-approval" && attestation.signer?.role === role && attestation.claims?.decision === "approve" && attestation.claims?.releaseCandidateSha256 === candidateSha256).filter((attestation) => verifyReleaseEvidenceAttestation(attestation, { trustStore: input.trustStore, asOf, expectedOrganizationId: policy.organizationId, expectedCapabilityId: policy.capabilityId, allowedRoles: [role], maximumArtifactAgeHours: policy.decisionTtlHours }).valid).filter((attestation) => attestation.signer.actorId !== requestedBy);
    valid.forEach((attestation) => approvalActors.add(attestation.signer.actorId));
    add(`approval:${role}`, valid.length >= 1, `A current signed ${role} approval from someone other than the requester is missing.`);
  }
  add("approval-separation", approvalActors.size >= policy.requiredApprovalRoles.length, "Required approval roles must be held by distinct actors.");
  verifyRollback(input.rollbackPlan, policy, asOf).forEach((item) => add(item.id, item.passed, item.reason));
  const core = {
    organizationId: policy.organizationId,
    capabilityId: policy.capabilityId,
    policyId: policy.id,
    policyVersion: policy.policyVersion,
    requestedBy,
    candidate,
    candidateSha256,
    evaluatedAt: asOf,
    expiresAt: decisionExpiry,
    checks,
    blockers,
    rollbackPlan: structuredClone(input.rollbackPlan || {}),
    evidenceAttestationSha256s: evidence.map(computeReleaseAttestationSha256).sort(),
    approvalAttestationSha256s: approvals.map(computeReleaseAttestationSha256).sort(),
  };
  return Object.freeze({ schemaVersion: CAPABILITY_RELEASE_DECISION_VERSION, ...core, status: blockers.length ? "rejected" : "authorized", activationAuthorized: blockers.length === 0, decisionSha256: sha256(core) });
}

export function createPlatformReleaseManifest(input = {}) {
  const generatedAt = iso(input.generatedAt, "generatedAt");
  const expiresAt = iso(input.expiresAt, "expiresAt");
  if (expiresAt <= generatedAt) throw new TypeError("expiresAt must be after generatedAt");
  if (!input.privateKey) throw new TypeError("privateKey is required to sign the platform release manifest");
  const decisions = (input.decisions || []).map((decision) => structuredClone(decision));
  if (!decisions.length) throw new TypeError("decisions must contain at least one capability decision");
  const core = {
    schemaVersion: PLATFORM_RELEASE_MANIFEST_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    releaseId: required(input.releaseId, "releaseId"),
    environment: input.environment === "production" ? "production" : "staging",
    generatedAt,
    expiresAt,
    decisions,
    activationAuthorized: decisions.every((decision) => decision.schemaVersion === CAPABILITY_RELEASE_DECISION_VERSION && decision.activationAuthorized === true && decision.expiresAt >= generatedAt),
    signer: { actorId: required(input.signer?.actorId, "signer.actorId"), role: required(input.signer?.role, "signer.role"), keyId: required(input.signer?.keyId, "signer.keyId") },
    signatureAlgorithm: "Ed25519",
  };
  return Object.freeze({ ...core, manifestSha256: sha256(core), signature: sign(null, Buffer.from(canonicalJson(core)), input.privateKey).toString("base64") });
}

export function verifyPlatformReleaseManifest(manifest, { trustStore = {}, asOf, expectedOrganizationId = "" } = {}) {
  const evaluatedAt = iso(asOf, "asOf");
  const key = trustStore[manifest?.signer?.keyId];
  const { signature, manifestSha256, ...core } = manifest || {};
  const checks = [
    { id: "schema", passed: manifest?.schemaVersion === PLATFORM_RELEASE_MANIFEST_VERSION },
    { id: "organization", passed: !expectedOrganizationId || manifest?.organizationId === expectedOrganizationId },
    { id: "trusted-controller-key", passed: Boolean(key?.publicKey) && key.allowedRoles?.includes("release-controller") && (!key.organizationId || key.organizationId === manifest?.organizationId) },
    { id: "manifest-window", passed: Boolean(manifest?.generatedAt && manifest?.expiresAt) && manifest.generatedAt <= evaluatedAt && manifest.expiresAt >= evaluatedAt },
    { id: "manifest-digest", passed: manifestSha256 === sha256(core) },
    { id: "capability-decisions", passed: Array.isArray(manifest?.decisions) && manifest.decisions.length > 0 && manifest.decisions.every((decision) => decision.activationAuthorized === true && decision.expiresAt >= evaluatedAt) },
  ];
  let signatureValid = false;
  try { signatureValid = Boolean(key?.publicKey) && verify(null, Buffer.from(canonicalJson(core)), key.publicKey, Buffer.from(String(signature || ""), "base64")); } catch {}
  checks.push({ id: "signature", passed: signatureValid });
  return Object.freeze({ valid: checks.every((check) => check.passed), activationAuthorized: checks.every((check) => check.passed) && manifest.activationAuthorized === true, evaluatedAt, checks });
}
