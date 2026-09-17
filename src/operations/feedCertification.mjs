import { createHash } from "node:crypto";

export const FEED_CONNECTOR_MANIFEST_VERSION = "wr-feed-connector-manifest-v1";
export const FEED_CERTIFICATION_EVIDENCE_VERSION = "wr-feed-certification-evidence-v1";
export const FEED_CERTIFICATION_DECISION_VERSION = "wr-feed-certification-decision-v1";

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

function bounded(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

export function createFeedConnectorManifest(input = {}) {
  const contractStartsAt = iso(input.contractStartsAt, "contractStartsAt");
  const contractExpiresAt = iso(input.contractExpiresAt, "contractExpiresAt");
  if (contractExpiresAt <= contractStartsAt) throw new TypeError("contractExpiresAt must be after contractStartsAt");
  const requiredRights = [...new Set((input.requiredRights || ["store", "derive", "query"]).map(String).filter(Boolean))];
  return Object.freeze({
    schemaVersion: FEED_CONNECTOR_MANIFEST_VERSION,
    connectorId: required(input.connectorId, "connectorId"),
    connectorVersion: required(input.connectorVersion, "connectorVersion"),
    providerId: required(input.providerId, "providerId"),
    datasetId: required(input.datasetId, "datasetId"),
    expectedEventSchemaVersion: required(input.expectedEventSchemaVersion, "expectedEventSchemaVersion"),
    licenseId: required(input.licenseId, "licenseId"),
    contractStartsAt,
    contractExpiresAt,
    minimumContractDaysRemaining: Math.max(0, Math.trunc(bounded(input.minimumContractDaysRemaining, 30, 0, 3650))),
    requiredRights,
    permittedCountyIds: [...new Set((input.permittedCountyIds || []).map(String).filter(Boolean))].sort(),
    thresholds: {
      minimumFixtureCount: Math.max(1, Math.trunc(bounded(input.thresholds?.minimumFixtureCount, 20, 1, 100000))),
      minimumSampleCount: Math.max(1, Math.trunc(bounded(input.thresholds?.minimumSampleCount, 1000, 1, 10000000))),
      maximumP95LagMs: bounded(input.thresholds?.maximumP95LagMs, 86400000, 0, Number.MAX_SAFE_INTEGER),
      maximumLagMs: bounded(input.thresholds?.maximumLagMs, 172800000, 0, Number.MAX_SAFE_INTEGER),
      minimumCurrentPct: bounded(input.thresholds?.minimumCurrentPct, 99, 0, 100),
      minimumCanonicalIdentityPct: bounded(input.thresholds?.minimumCanonicalIdentityPct, 99.9, 0, 100),
      minimumRequiredFieldPct: bounded(input.thresholds?.minimumRequiredFieldPct, 99, 0, 100),
      minimumGeometryPct: bounded(input.thresholds?.minimumGeometryPct, 95, 0, 100),
      maximumDuplicatePct: bounded(input.thresholds?.maximumDuplicatePct, 0.1, 0, 100),
      maximumInvalidIdentityPct: bounded(input.thresholds?.maximumInvalidIdentityPct, 0.1, 0, 100),
      maximumQuarantinePct: bounded(input.thresholds?.maximumQuarantinePct, 2, 0, 100),
    },
  });
}

export function createFeedCertificationEvidence(input = {}) {
  return Object.freeze({
    schemaVersion: FEED_CERTIFICATION_EVIDENCE_VERSION,
    connectorId: required(input.connectorId, "connectorId"),
    connectorVersion: required(input.connectorVersion, "connectorVersion"),
    generatedAt: iso(input.generatedAt, "generatedAt"),
    license: structuredClone(input.license || {}),
    schema: structuredClone(input.schema || {}),
    pointInTime: structuredClone(input.pointInTime || {}),
    replay: structuredClone(input.replay || {}),
    freshness: structuredClone(input.freshness || {}),
    coverage: structuredClone(input.coverage || {}),
    dataQuality: structuredClone(input.dataQuality || {}),
    security: structuredClone(input.security || {}),
    loadReport: structuredClone(input.loadReport || null),
    provenance: structuredClone(input.provenance || {}),
  });
}

function check(id, passed, actual, threshold, blocker) { return { id, passed: passed === true, actual: actual ?? null, threshold: threshold ?? null, blocker: passed === true ? "" : blocker }; }

export function certifyFeedConnector({ manifest: manifestInput, evidence: evidenceInput, asOf } = {}) {
  const manifest = manifestInput?.schemaVersion === FEED_CONNECTOR_MANIFEST_VERSION ? manifestInput : createFeedConnectorManifest(manifestInput);
  const evidence = evidenceInput?.schemaVersion === FEED_CERTIFICATION_EVIDENCE_VERSION ? evidenceInput : createFeedCertificationEvidence(evidenceInput);
  const evaluatedAt = iso(asOf, "asOf");
  const daysRemaining = Math.floor((new Date(manifest.contractExpiresAt).getTime() - new Date(evaluatedAt).getTime()) / 86400000);
  const evidenceAgeMs = Math.max(0, new Date(evaluatedAt).getTime() - new Date(evidence.generatedAt).getTime());
  const rights = evidence.license?.rights || {};
  const thresholds = manifest.thresholds;
  const checks = [
    check("connector-identity", evidence.connectorId === manifest.connectorId && evidence.connectorVersion === manifest.connectorVersion, `${evidence.connectorId}@${evidence.connectorVersion}`, `${manifest.connectorId}@${manifest.connectorVersion}`, "Connector evidence identity/version does not match the manifest."),
    check("contract-executed", evidence.license?.contractExecuted === true, evidence.license?.contractExecuted, true, "An executed provider contract is not evidenced."),
    check("license-id", evidence.license?.licenseId === manifest.licenseId, evidence.license?.licenseId, manifest.licenseId, "License identity does not match the approved manifest."),
    check("contract-window", evaluatedAt >= manifest.contractStartsAt && daysRemaining >= manifest.minimumContractDaysRemaining, daysRemaining, manifest.minimumContractDaysRemaining, "The contract is inactive, expired, or too close to expiry."),
    check("license-rights", manifest.requiredRights.every((right) => rights[right] === true), manifest.requiredRights.filter((right) => rights[right] === true), manifest.requiredRights, "Required storage, derivation, or query rights are missing."),
    check("event-schema", evidence.schema?.schemaVersion === manifest.expectedEventSchemaVersion, evidence.schema?.schemaVersion, manifest.expectedEventSchemaVersion, "The connector output schema does not match the approved event contract."),
    check("schema-fixtures", Number(evidence.schema?.fixtureCount) >= thresholds.minimumFixtureCount && Number(evidence.schema?.failedFixtureCount) === 0, `${Number(evidence.schema?.fixtureCount || 0)} fixtures; ${Number(evidence.schema?.failedFixtureCount || 0)} failed`, `${thresholds.minimumFixtureCount}+ fixtures; 0 failed`, "Schema fixture evidence is missing, insufficient, or failing."),
    check("point-in-time-controls", evidence.pointInTime?.futureEvidenceRejected === true && evidence.pointInTime?.availabilityTimePreserved === true && evidence.pointInTime?.expiryEnforced === true, evidence.pointInTime, "all point-in-time controls", "Future-evidence, availability-time, or expiry enforcement is not proven."),
    check("replay-controls", evidence.replay?.idempotencyPassed === true && evidence.replay?.checkpointResumePassed === true && Number(evidence.replay?.duplicateWriteCount) === 0, evidence.replay, "idempotent, resumable, zero duplicate writes", "Replay/idempotency/checkpoint recovery is not proven."),
    check("freshness-samples", Number(evidence.freshness?.sampleCount) >= thresholds.minimumSampleCount, Number(evidence.freshness?.sampleCount || 0), thresholds.minimumSampleCount, "Freshness evidence has too few samples."),
    check("freshness-lag", Number(evidence.freshness?.p95LagMs) <= thresholds.maximumP95LagMs && Number(evidence.freshness?.maxLagMs) <= thresholds.maximumLagMs && Number(evidence.freshness?.currentPct) >= thresholds.minimumCurrentPct, evidence.freshness, { p95LagMs: thresholds.maximumP95LagMs, maxLagMs: thresholds.maximumLagMs, currentPct: thresholds.minimumCurrentPct }, "Freshness latency or current-record coverage misses the manifest threshold."),
    check("coverage", Number(evidence.coverage?.sampleCount) >= thresholds.minimumSampleCount && Number(evidence.coverage?.canonicalIdentityPct) >= thresholds.minimumCanonicalIdentityPct && Number(evidence.coverage?.requiredFieldPct) >= thresholds.minimumRequiredFieldPct && Number(evidence.coverage?.geometryPct) >= thresholds.minimumGeometryPct, evidence.coverage, { sampleCount: thresholds.minimumSampleCount, canonicalIdentityPct: thresholds.minimumCanonicalIdentityPct, requiredFieldPct: thresholds.minimumRequiredFieldPct, geometryPct: thresholds.minimumGeometryPct }, "Identity, required-field, geometry, or sample coverage misses the manifest threshold."),
    check("data-quality", Number(evidence.dataQuality?.duplicatePct) <= thresholds.maximumDuplicatePct && Number(evidence.dataQuality?.invalidIdentityPct) <= thresholds.maximumInvalidIdentityPct && Number(evidence.dataQuality?.quarantinePct) <= thresholds.maximumQuarantinePct, evidence.dataQuality, { duplicatePct: thresholds.maximumDuplicatePct, invalidIdentityPct: thresholds.maximumInvalidIdentityPct, quarantinePct: thresholds.maximumQuarantinePct }, "Duplicate, invalid-identity, or quarantine rates exceed the manifest threshold."),
    check("security", evidence.security?.secretRefOnly === true && evidence.security?.encryptedTransport === true && evidence.security?.ssrfProtection === true && evidence.security?.leastPrivilege === true, evidence.security, "all security controls", "Connector secret, transport, SSRF, or least-privilege evidence is incomplete."),
    check("load-resilience", evidence.loadReport?.schemaVersion === "wr-load-resilience-report-v1" && evidence.loadReport?.status === "passed", evidence.loadReport?.status, "passed", "A passing load/resilience report is missing."),
    check("evidence-recency", evidenceAgeMs <= 7 * 86400000, evidenceAgeMs, 7 * 86400000, "Certification evidence is older than seven days."),
    check("provenance", Boolean(evidence.provenance?.artifactSha256) && Boolean(evidence.provenance?.testRunId) && evidence.provenance?.independentReviewer === true, evidence.provenance, "artifact hash, test run, independent review", "Certification provenance or independent review is incomplete."),
  ];
  const blockers = checks.filter((item) => !item.passed).map((item) => ({ checkId: item.id, reason: item.blocker }));
  const core = { connectorId: manifest.connectorId, connectorVersion: manifest.connectorVersion, providerId: manifest.providerId, datasetId: manifest.datasetId, evaluatedAt, checks, blockers };
  return Object.freeze({ schemaVersion: FEED_CERTIFICATION_DECISION_VERSION, ...core, status: blockers.length ? "rejected" : "certified", activationAuthorized: blockers.length === 0, certificationSha256: digest(core), manifest, evidence });
}
