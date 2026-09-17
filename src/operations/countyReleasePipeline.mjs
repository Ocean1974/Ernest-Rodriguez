import { createHash } from "node:crypto";

export const COUNTY_SOURCE_SNAPSHOT_VERSION = "wr-county-source-snapshot-v1";
export const COUNTY_ARTIFACT_BUNDLE_VERSION = "wr-county-artifact-bundle-v1";
export const COUNTY_RELEASE_POLICY_VERSION = "wr-county-release-policy-v1";
export const COUNTY_RELEASE_DECISION_VERSION = "wr-county-release-decision-v1";
export const COUNTY_RELEASE_STATE_VERSION = "wr-county-release-state-v1";
export const COUNTY_RELEASE_RUN_VERSION = "wr-county-release-run-v1";

const DEFAULT_ARTIFACT_TYPES = Object.freeze([
  "parcel-manifest",
  "viewport-index",
  "search-index",
  "qc-report",
  "schema-report",
  "join-key-report",
  "full-access-report",
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

function nonnegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

function digestHex(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${name} must be a SHA-256 hex digest`);
  return normalized;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function countyReleaseSha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function seal(core, field) {
  return Object.freeze({ ...core, [field]: countyReleaseSha256(core) });
}

function verifySeal(value, field) {
  if (!value || typeof value !== "object") return false;
  const { [field]: observed, ...core } = value;
  return typeof observed === "string" && observed === countyReleaseSha256(core);
}

function normalizeJoinKeys(input = []) {
  const keys = input.map((item, index) => ({
    canonicalField: required(item.canonicalField, `joinKeys[${index}].canonicalField`),
    sourceField: required(item.sourceField, `joinKeys[${index}].sourceField`),
    normalization: required(item.normalization, `joinKeys[${index}].normalization`),
    verified: item.verified === true,
  }));
  if (!keys.length) throw new TypeError("joinKeys must contain at least one explicit join key");
  return keys.sort((a, b) => `${a.canonicalField}|${a.sourceField}`.localeCompare(`${b.canonicalField}|${b.sourceField}`));
}

export function createCountySourceSnapshot(input = {}) {
  const capturedAt = iso(input.capturedAt, "capturedAt");
  const sourcePublishedAt = iso(input.sourcePublishedAt, "sourcePublishedAt");
  if (sourcePublishedAt > capturedAt) throw new TypeError("sourcePublishedAt cannot be after capturedAt");
  const core = {
    schemaVersion: COUNTY_SOURCE_SNAPSHOT_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    countyFips: required(input.countyFips, "countyFips"),
    datasetId: required(input.datasetId, "datasetId"),
    sourceRevision: required(input.sourceRevision, "sourceRevision"),
    contentKind: input.contentKind === "source-audit" ? "source-audit" : "source-data",
    officialSourceUrl: required(input.officialSourceUrl, "officialSourceUrl"),
    officialSource: input.officialSource === true,
    license: required(input.license, "license"),
    sourcePublishedAt,
    capturedAt,
    sourceFeatureCount: nonnegativeInteger(input.sourceFeatureCount, "sourceFeatureCount"),
    sourceBytes: nonnegativeInteger(input.sourceBytes, "sourceBytes"),
    sourceSha256: digestHex(input.sourceSha256, "sourceSha256"),
    joinKeys: normalizeJoinKeys(input.joinKeys),
  };
  if (!/^\d{5}$/.test(core.countyFips)) throw new TypeError("countyFips must contain exactly five digits");
  if (!/^https:\/\//.test(core.officialSourceUrl)) throw new TypeError("officialSourceUrl must use HTTPS");
  return seal(core, "snapshotSha256");
}

function normalizeArtifact(item, index) {
  const artifact = {
    type: required(item.type, `artifacts[${index}].type`),
    ref: required(item.ref, `artifacts[${index}].ref`),
    sha256: digestHex(item.sha256, `artifacts[${index}].sha256`),
    bytes: nonnegativeInteger(item.bytes, `artifacts[${index}].bytes`),
    immutable: item.immutable === true,
  };
  if (!(artifact.ref.startsWith("https://") || artifact.ref.startsWith("artifact://"))) {
    throw new TypeError(`artifacts[${index}].ref must use HTTPS or artifact://`);
  }
  return artifact;
}

export function createCountyArtifactBundle(input = {}) {
  const generatedAt = iso(input.generatedAt, "generatedAt");
  const artifacts = (input.artifacts || []).map(normalizeArtifact).sort((a, b) => a.type.localeCompare(b.type));
  if (!artifacts.length) throw new TypeError("artifacts must contain at least one artifact");
  if (new Set(artifacts.map((item) => item.type)).size !== artifacts.length) throw new TypeError("artifact types must be unique");
  const exclusions = (input.exclusions || []).map((item, index) => ({
    reasonCode: required(item.reasonCode, `exclusions[${index}].reasonCode`),
    count: nonnegativeInteger(item.count, `exclusions[${index}].count`),
    evidenceRef: required(item.evidenceRef, `exclusions[${index}].evidenceRef`),
    evidenceSha256: digestHex(item.evidenceSha256, `exclusions[${index}].evidenceSha256`),
  })).sort((a, b) => `${a.reasonCode}|${a.evidenceRef}`.localeCompare(`${b.reasonCode}|${b.evidenceRef}`));
  const counts = {
    emittedFeatureCount: nonnegativeInteger(input.counts?.emittedFeatureCount, "counts.emittedFeatureCount"),
    geometryFeatureCount: nonnegativeInteger(input.counts?.geometryFeatureCount, "counts.geometryFeatureCount"),
    uniquePrimaryIdCount: nonnegativeInteger(input.counts?.uniquePrimaryIdCount, "counts.uniquePrimaryIdCount"),
    searchIndexCount: nonnegativeInteger(input.counts?.searchIndexCount, "counts.searchIndexCount"),
    viewportIndexedFeatureCount: nonnegativeInteger(input.counts?.viewportIndexedFeatureCount, "counts.viewportIndexedFeatureCount"),
    duplicatePrimaryIdCount: nonnegativeInteger(input.counts?.duplicatePrimaryIdCount, "counts.duplicatePrimaryIdCount"),
    missingGeometryCount: nonnegativeInteger(input.counts?.missingGeometryCount, "counts.missingGeometryCount"),
    sourceLineageCount: nonnegativeInteger(input.counts?.sourceLineageCount, "counts.sourceLineageCount"),
    placeholderPathCount: nonnegativeInteger(input.counts?.placeholderPathCount, "counts.placeholderPathCount"),
    qcFailureCount: nonnegativeInteger(input.counts?.qcFailureCount, "counts.qcFailureCount"),
    qcWarningCount: nonnegativeInteger(input.counts?.qcWarningCount, "counts.qcWarningCount"),
  };
  const core = {
    schemaVersion: COUNTY_ARTIFACT_BUNDLE_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    releaseId: required(input.releaseId, "releaseId"),
    sourceSnapshotSha256: digestHex(input.sourceSnapshotSha256, "sourceSnapshotSha256"),
    generatedAt,
    builderActorId: required(input.builderActorId, "builderActorId"),
    buildRevision: required(input.buildRevision, "buildRevision"),
    counts,
    exclusions,
    artifacts,
  };
  return seal(core, "bundleSha256");
}

export function createCountyReleasePolicy(input = {}) {
  return Object.freeze({
    schemaVersion: COUNTY_RELEASE_POLICY_VERSION,
    id: required(input.id, "id"),
    policyVersion: required(input.policyVersion, "policyVersion"),
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    maximumSourceAgeHours: Math.max(1, Number(input.maximumSourceAgeHours) || 24 * 45),
    maximumArtifactAgeHours: Math.max(1, Number(input.maximumArtifactAgeHours) || 72),
    maximumExcludedFeatures: Math.max(0, nonnegativeInteger(input.maximumExcludedFeatures ?? 0, "maximumExcludedFeatures")),
    maximumQcWarnings: Math.max(0, nonnegativeInteger(input.maximumQcWarnings ?? 0, "maximumQcWarnings")),
    requiredArtifactTypes: [...new Set((input.requiredArtifactTypes || DEFAULT_ARTIFACT_TYPES).map(String).filter(Boolean))].sort(),
    requiredApprovalRoles: [...new Set((input.requiredApprovalRoles || ["county-data-reviewer", "quality-reviewer", "release-manager"]).map(String).filter(Boolean))].sort(),
    requireOfficialSource: input.requireOfficialSource !== false,
    requireAllJoinKeysVerified: input.requireAllJoinKeysVerified !== false,
    requireIndependentApprovers: input.requireIndependentApprovers !== false,
    requirePlatformReleaseAuthorization: input.requirePlatformReleaseAuthorization !== false,
  });
}

function normalizeApprovals(input = [], asOf) {
  return input.map((item, index) => ({
    role: required(item.role, `approvals[${index}].role`),
    actorId: required(item.actorId, `approvals[${index}].actorId`),
    decision: item.decision === "approve" ? "approve" : "reject",
    approvedBundleSha256: digestHex(item.approvedBundleSha256, `approvals[${index}].approvedBundleSha256`),
    approvedAt: iso(item.approvedAt, `approvals[${index}].approvedAt`),
    expiresAt: iso(item.expiresAt, `approvals[${index}].expiresAt`),
    current: iso(item.approvedAt, `approvals[${index}].approvedAt`) <= asOf && iso(item.expiresAt, `approvals[${index}].expiresAt`) >= asOf,
  }));
}

export function evaluateCountyRelease(input = {}) {
  const policy = input.policy?.schemaVersion === COUNTY_RELEASE_POLICY_VERSION ? input.policy : createCountyReleasePolicy(input.policy);
  const snapshot = input.sourceSnapshot;
  const bundle = input.artifactBundle;
  const asOf = iso(input.asOf, "asOf");
  const approvals = normalizeApprovals(input.approvals || [], asOf);
  const exclusions = (bundle?.exclusions || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const sourceAgeHours = snapshot?.capturedAt ? (new Date(asOf).getTime() - new Date(snapshot.capturedAt).getTime()) / 3600000 : Number.POSITIVE_INFINITY;
  const artifactAgeHours = bundle?.generatedAt ? (new Date(asOf).getTime() - new Date(bundle.generatedAt).getTime()) / 3600000 : Number.POSITIVE_INFINITY;
  const artifactTypes = new Set((bundle?.artifacts || []).filter((item) => item.immutable === true).map((item) => item.type));
  const checks = [];
  const blockers = [];
  const add = (id, passed, reason, details = {}) => {
    const check = { id, passed: passed === true, ...details };
    checks.push(check);
    if (!check.passed) blockers.push({ checkId: id, reason });
  };
  add("source-integrity", verifySeal(snapshot, "snapshotSha256"), "Source snapshot digest is invalid or the snapshot was modified.");
  add("bundle-integrity", verifySeal(bundle, "bundleSha256"), "Artifact bundle digest is invalid or the bundle was modified.");
  add("organization", snapshot?.organizationId === policy.organizationId && bundle?.organizationId === policy.organizationId, "County release evidence belongs to another organization.");
  add("county", snapshot?.countyId === policy.countyId && bundle?.countyId === policy.countyId, "County release evidence belongs to another county.");
  add("snapshot-link", bundle?.sourceSnapshotSha256 === snapshot?.snapshotSha256, "Artifact bundle does not bind to this source snapshot.");
  add("official-source", !policy.requireOfficialSource || snapshot?.officialSource === true, "An official government source is required.");
  add("source-content", snapshot?.contentKind === "source-data", "A content-addressed raw source snapshot is required; a source audit alone cannot authorize production release.");
  add("source-freshness", sourceAgeHours >= 0 && sourceAgeHours <= policy.maximumSourceAgeHours, "Source snapshot is future-dated or stale.", { sourceAgeHours: Number.isFinite(sourceAgeHours) ? Number(sourceAgeHours.toFixed(3)) : null });
  add("artifact-freshness", artifactAgeHours >= 0 && artifactAgeHours <= policy.maximumArtifactAgeHours && bundle?.generatedAt >= snapshot?.capturedAt, "Artifacts are stale, future-dated, or older than their source snapshot.", { artifactAgeHours: Number.isFinite(artifactAgeHours) ? Number(artifactAgeHours.toFixed(3)) : null });
  add("join-keys", !policy.requireAllJoinKeysVerified || (snapshot?.joinKeys?.length > 0 && snapshot.joinKeys.every((item) => item.verified === true)), "One or more county join keys remain unverified.");
  add("required-artifacts", policy.requiredArtifactTypes.every((type) => artifactTypes.has(type)), "One or more required immutable artifacts are missing.", { missingArtifactTypes: policy.requiredArtifactTypes.filter((type) => !artifactTypes.has(type)) });
  add("source-count-reconciliation", Number(bundle?.counts?.emittedFeatureCount) + exclusions === Number(snapshot?.sourceFeatureCount), "Emitted and explicitly excluded features do not reconcile to the official source count.", { sourceFeatureCount: snapshot?.sourceFeatureCount ?? null, emittedFeatureCount: bundle?.counts?.emittedFeatureCount ?? null, excludedFeatureCount: exclusions });
  add("exclusion-policy", exclusions <= policy.maximumExcludedFeatures && (bundle?.exclusions || []).every((item) => item.count > 0 && item.reasonCode !== "unknown"), "Feature exclusions exceed policy or lack an acceptable reason.");
  add("geometry-parity", bundle?.counts?.geometryFeatureCount === bundle?.counts?.emittedFeatureCount && bundle?.counts?.missingGeometryCount === 0, "Geometry count does not match emitted parcels.");
  add("identity-parity", bundle?.counts?.uniquePrimaryIdCount === bundle?.counts?.emittedFeatureCount && bundle?.counts?.duplicatePrimaryIdCount === 0, "Canonical parcel identifiers are incomplete or duplicated.");
  add("search-parity", bundle?.counts?.searchIndexCount === bundle?.counts?.emittedFeatureCount, "Search index count does not match emitted parcels.");
  add("viewport-parity", bundle?.counts?.viewportIndexedFeatureCount === bundle?.counts?.emittedFeatureCount, "Viewport index count does not match emitted parcels.");
  add("lineage-parity", bundle?.counts?.sourceLineageCount === bundle?.counts?.emittedFeatureCount, "Source lineage is missing for one or more emitted parcels.");
  add("no-placeholders", bundle?.counts?.placeholderPathCount === 0, "Source or join placeholder paths remain.");
  add("qc", bundle?.counts?.qcFailureCount === 0 && bundle?.counts?.qcWarningCount <= policy.maximumQcWarnings, "County QC exceeds the release policy.");
  const approvalActors = new Set();
  for (const role of policy.requiredApprovalRoles) {
    const matches = approvals.filter((item) => item.role === role && item.decision === "approve" && item.current && item.approvedBundleSha256 === bundle?.bundleSha256 && (!policy.requireIndependentApprovers || item.actorId !== bundle?.builderActorId));
    matches.forEach((item) => approvalActors.add(item.actorId));
    add(`approval:${role}`, matches.length > 0, `A current independent ${role} approval bound to this bundle is missing.`);
  }
  add("approval-separation", !policy.requireIndependentApprovers || approvalActors.size === policy.requiredApprovalRoles.length, "Required approval roles must be held by distinct actors.");
  const authorization = input.platformReleaseAuthorization;
  add("platform-release-authorization", !policy.requirePlatformReleaseAuthorization || (authorization?.schemaVersion === "wr-capability-release-decision-v1" && authorization?.activationAuthorized === true && authorization?.expiresAt >= asOf && authorization?.capabilityId === `county:${policy.countyId}` && /^[a-f0-9]{64}$/.test(String(authorization?.decisionSha256 || ""))), "A current authorized platform release decision for this county is required.");
  const core = {
    schemaVersion: COUNTY_RELEASE_DECISION_VERSION,
    organizationId: policy.organizationId,
    countyId: policy.countyId,
    releaseId: bundle?.releaseId || "",
    policyId: policy.id,
    policyVersion: policy.policyVersion,
    evaluatedAt: asOf,
    sourceSnapshotSha256: snapshot?.snapshotSha256 || "",
    bundleSha256: bundle?.bundleSha256 || "",
    platformDecisionSha256: authorization?.decisionSha256 || "",
    checks,
    blockers,
    status: blockers.length ? "rejected" : "authorized",
    activationAuthorized: blockers.length === 0,
  };
  return seal(core, "decisionSha256");
}

export function createCountyReleaseState(input = {}) {
  const state = {
    schemaVersion: COUNTY_RELEASE_STATE_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    revision: nonnegativeInteger(input.revision ?? 0, "revision"),
    activeRelease: input.activeRelease ? structuredClone(input.activeRelease) : null,
    stagedRelease: input.stagedRelease ? structuredClone(input.stagedRelease) : null,
    runs: (input.runs || []).map((item) => structuredClone(item)),
    updatedAt: iso(input.updatedAt, "updatedAt"),
  };
  if (state.activeRelease?.organizationId && state.activeRelease.organizationId !== state.organizationId) throw new TypeError("activeRelease belongs to another organization");
  if (state.stagedRelease?.countyId && state.stagedRelease.countyId !== state.countyId) throw new TypeError("stagedRelease belongs to another county");
  return Object.freeze(state);
}

export function stageCountyRelease(stateInput, decision, { actorId, stagedAt } = {}) {
  const state = createCountyReleaseState(stateInput);
  const time = iso(stagedAt, "stagedAt");
  if (!verifySeal(decision, "decisionSha256") || decision.activationAuthorized !== true) throw Object.assign(new Error("Only an intact authorized county release decision can be staged"), { code: "WR_COUNTY_RELEASE_NOT_AUTHORIZED" });
  if (decision.organizationId !== state.organizationId || decision.countyId !== state.countyId) throw Object.assign(new Error("County release decision scope does not match state"), { code: "WR_COUNTY_RELEASE_SCOPE_MISMATCH" });
  const stagedRelease = { organizationId: state.organizationId, countyId: state.countyId, releaseId: decision.releaseId, decisionSha256: decision.decisionSha256, bundleSha256: decision.bundleSha256, stagedBy: required(actorId, "actorId"), stagedAt: time };
  return createCountyReleaseState({ ...state, revision: state.revision + 1, stagedRelease, updatedAt: time });
}

export async function activateStagedCountyRelease(stateInput, { actorId, activatedAt, pointerAdapter, healthEvaluator } = {}) {
  const state = createCountyReleaseState(stateInput);
  const time = iso(activatedAt, "activatedAt");
  if (!state.stagedRelease) throw Object.assign(new Error("No county release is staged"), { code: "WR_COUNTY_RELEASE_NOT_STAGED" });
  if (!pointerAdapter?.compareAndSwap || !pointerAdapter?.read) throw new TypeError("pointerAdapter read and compareAndSwap are required");
  if (typeof healthEvaluator !== "function") throw new TypeError("healthEvaluator is required");
  const before = await pointerAdapter.read(state.countyId);
  const desired = { releaseId: state.stagedRelease.releaseId, bundleSha256: state.stagedRelease.bundleSha256 };
  const runBase = { schemaVersion: COUNTY_RELEASE_RUN_VERSION, id: `county-release:${state.countyId}:${state.stagedRelease.releaseId}:${state.revision + 1}`, organizationId: state.organizationId, countyId: state.countyId, releaseId: state.stagedRelease.releaseId, requestedBy: required(actorId, "actorId"), startedAt: time, previousPointer: before || null, desiredPointer: desired };
  let activationReceipt;
  try {
    activationReceipt = await pointerAdapter.compareAndSwap(state.countyId, before || null, desired);
  } catch (error) {
    const completedAt = iso(activatedAt, "completedAt");
    const run = { ...runBase, status: "activation-failed", completedAt, health: null, activationReceipt: null, rollbackReceipt: null, error: String(error.message || error) };
    return createCountyReleaseState({ ...state, revision: state.revision + 1, runs: [...state.runs, run], updatedAt: completedAt });
  }
  let health;
  try { health = await healthEvaluator({ countyId: state.countyId, release: desired, previous: before || null }); }
  catch (error) { health = { healthy: false, signals: [String(error.code || "health-evaluator-error")], error: String(error.message || error) }; }
  let status = "active";
  let rollbackReceipt = null;
  let error = "";
  if (health?.healthy !== true || (health?.signals || []).length > 0) {
    try {
      rollbackReceipt = await pointerAdapter.compareAndSwap(state.countyId, desired, before || null);
      status = "rolled-back";
    } catch (rollbackError) {
      status = "rollback-failed";
      error = String(rollbackError.message || rollbackError);
    }
  }
  const completedAt = iso(activatedAt, "completedAt");
  const activeRelease = status === "active" ? { ...state.stagedRelease, activatedBy: actorId, activatedAt: time, previousPointer: before || null } : state.activeRelease;
  const run = { ...runBase, status, completedAt, health: structuredClone(health || {}), activationReceipt: structuredClone(activationReceipt || {}), rollbackReceipt: rollbackReceipt ? structuredClone(rollbackReceipt) : null, error };
  const next = createCountyReleaseState({ ...state, revision: state.revision + 1, activeRelease, stagedRelease: status === "active" ? null : state.stagedRelease, runs: [...state.runs, run], updatedAt: completedAt });
  if (status === "rollback-failed") throw Object.assign(new Error("County release health failed and pointer rollback failed"), { code: "WR_COUNTY_RELEASE_ROLLBACK_FAILED", state: next });
  return next;
}

export function verifyCountyReleaseState(stateInput) {
  try {
    const state = createCountyReleaseState(stateInput);
    const invalidRuns = state.runs.filter((run) => run.organizationId !== state.organizationId || run.countyId !== state.countyId || !["active", "rolled-back", "activation-failed"].includes(run.status));
    return Object.freeze({ valid: invalidRuns.length === 0, state, invalidRunIds: invalidRuns.map((run) => run.id) });
  } catch (error) {
    return Object.freeze({ valid: false, state: null, invalidRunIds: [], error: String(error.message || error) });
  }
}
