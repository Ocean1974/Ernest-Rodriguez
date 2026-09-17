import { createHash } from "node:crypto";

export const COUNTY_BOUNDARY_SOURCE_PROBE_VERSION = "wr-county-boundary-source-probe-v1";
export const COUNTY_ETJ_RECONCILIATION_VERSION = "wr-county-etj-reconciliation-v1";
export const COUNTY_BOUNDARY_SNAPSHOT_POLICY_VERSION = "wr-county-boundary-snapshot-policy-v1";
export const COUNTY_PARCEL_JURISDICTION_ASSIGNMENT_VERSION = "wr-county-parcel-jurisdiction-assignment-v1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function countyBoundarySha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyBoundarySha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function https(value, name) { const text = required(value, name); if (!text.startsWith("https://")) throw new TypeError(`${name} must use HTTPS`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function names(values = []) { return [...new Set(values.map((value) => required(value, "name").toUpperCase()))].sort(); }

export function createCountyBoundarySourceProbe(input = {}) {
  const distinctNames = names(input.distinctNames);
  const expectedUniverseNames = names(input.expectedUniverseNames);
  const featureCount = integer(input.featureCount, "featureCount");
  const serviceUrl = https(input.serviceUrl, "serviceUrl");
  const layerUrl = https(input.layerUrl, "layerUrl");
  if (!layerUrl.startsWith(`${serviceUrl}/`)) throw new TypeError("layerUrl must be inside serviceUrl");
  if (featureCount < distinctNames.length) throw new TypeError("featureCount cannot be smaller than distinctNameCount");
  const observed = new Set(distinctNames);
  const core = {
    schemaVersion: COUNTY_BOUNDARY_SOURCE_PROBE_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    serviceUrl,
    layerUrl,
    layerName: required(input.layerName, "layerName"),
    geometryType: required(input.geometryType, "geometryType"),
    spatialReference: required(input.spatialReference, "spatialReference"),
    objectIdField: required(input.objectIdField, "objectIdField"),
    jurisdictionNameField: required(input.jurisdictionNameField, "jurisdictionNameField"),
    maxRecordCount: integer(input.maxRecordCount, "maxRecordCount"),
    featureCount,
    distinctNameCount: distinctNames.length,
    distinctNames,
    expectedUniverseNames,
    missingExpectedNames: expectedUniverseNames.filter((name) => !observed.has(name)),
    additionalObservedNames: distinctNames.filter((name) => !expectedUniverseNames.includes(name)),
    metadataSha256: required(input.metadataSha256, "metadataSha256"),
    countResponseSha256: required(input.countResponseSha256, "countResponseSha256"),
    distinctResponseSha256: required(input.distinctResponseSha256, "distinctResponseSha256"),
    observedAt: iso(input.observedAt, "observedAt"),
    capturesGeometry: false,
    captureAuthorized: false,
    status: "discovery-only",
  };
  for (const field of ["metadataSha256", "countResponseSha256", "distinctResponseSha256"]) if (!/^[a-f0-9]{64}$/.test(core[field])) throw new TypeError(`${field} must be a SHA-256 digest`);
  return seal(core, "probeSha256");
}

export function createCountyEtjReconciliation(input = {}) {
  const guidanceNames = names(input.guidanceNames);
  const serviceNames = names(input.serviceNames);
  const service = new Set(serviceNames);
  const guidance = new Set(guidanceNames);
  const missingFromService = guidanceNames.filter((name) => !service.has(name));
  const serviceOnly = serviceNames.filter((name) => !guidance.has(name));
  const core = {
    schemaVersion: COUNTY_ETJ_RECONCILIATION_VERSION,
    countyId: required(input.countyId, "countyId"),
    guidanceUrl: https(input.guidanceUrl, "guidanceUrl"),
    serviceProbeSha256: required(input.serviceProbeSha256, "serviceProbeSha256"),
    guidanceObservedAt: iso(input.guidanceObservedAt, "guidanceObservedAt"),
    guidanceNames,
    serviceNames,
    matchingNames: guidanceNames.filter((name) => service.has(name)),
    missingFromService,
    serviceOnly,
    consistent: missingFromService.length === 0 && serviceOnly.length === 0,
    resolutionEvidenceRef: String(input.resolutionEvidenceRef || ""),
  };
  return seal({ ...core, status: core.consistent || core.resolutionEvidenceRef ? "reviewed" : "inconsistent-needs-review" }, "reconciliationSha256");
}

export function createCountyBoundarySnapshotPolicy(input = {}) {
  const rights = [...new Set((input.rights || []).map(String).filter(Boolean))].sort();
  const core = {
    schemaVersion: COUNTY_BOUNDARY_SNAPSHOT_POLICY_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceProbeSha256: required(input.sourceProbeSha256, "sourceProbeSha256"),
    reconciliationSha256: required(input.reconciliationSha256, "reconciliationSha256"),
    effectiveAt: iso(input.effectiveAt, "effectiveAt"),
    observedAt: iso(input.observedAt, "observedAt"),
    outputSpatialReference: required(input.outputSpatialReference || "EPSG:4326", "outputSpatialReference"),
    geometryChecks: ["non-empty", "valid", "county-clipped", "no-unreviewed-overlap", "exact-source-count", "stable-identity"],
    rights,
    rightsEvidenceRef: String(input.rightsEvidenceRef || ""),
    approvalRefs: [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort(),
  };
  const checks = [
    { id: "source-probe", passed: /^[a-f0-9]{64}$/.test(core.sourceProbeSha256) },
    { id: "etj-reconciliation", passed: input.reconciliationStatus === "reviewed" },
    { id: "reuse-rights", passed: ["store", "derive", "query"].every((right) => rights.includes(right)) && Boolean(core.rightsEvidenceRef) },
    { id: "independent-approvals", passed: core.approvalRefs.length >= 2 },
    { id: "effective-time", passed: new Date(core.effectiveAt) <= new Date(core.observedAt) },
  ];
  return seal({ ...core, checks, status: checks.every((check) => check.passed) ? "capture-authorized" : "blocked" }, "policySha256");
}

export function classifyParcelJurisdiction(input = {}) {
  const fragments = (input.candidates || []).map((candidate) => ({
    jurisdictionId: required(candidate.jurisdictionId, "candidate.jurisdictionId"),
    scope: required(candidate.scope, "candidate.scope"),
    intersectionRatio: Number(candidate.intersectionRatio),
    containsCentroid: candidate.containsCentroid === true,
    boundaryFeatureId: required(candidate.boundaryFeatureId, "candidate.boundaryFeatureId"),
  }));
  if (fragments.some((candidate) => !["incorporated", "limited-purpose", "etj", "unincorporated"].includes(candidate.scope) || !Number.isFinite(candidate.intersectionRatio) || candidate.intersectionRatio < 0 || candidate.intersectionRatio > 1)) throw new TypeError("Invalid jurisdiction candidate");
  const grouped = new Map();
  for (const fragment of fragments) {
    const key = `${fragment.scope}\u0000${fragment.jurisdictionId}`;
    const current = grouped.get(key) || { jurisdictionId: fragment.jurisdictionId, scope: fragment.scope, intersectionRatio: 0, containsCentroid: false, boundaryFeatureIds: [] };
    current.intersectionRatio = Math.min(1, current.intersectionRatio + fragment.intersectionRatio);
    current.containsCentroid ||= fragment.containsCentroid;
    current.boundaryFeatureIds.push(fragment.boundaryFeatureId);
    grouped.set(key, current);
  }
  const precedence = { incorporated: 4, "limited-purpose": 3, etj: 2, unincorporated: 1 };
  const material = [...grouped.values()].filter((candidate) => candidate.intersectionRatio > 0).map((candidate) => ({ ...candidate, boundaryFeatureIds: [...new Set(candidate.boundaryFeatureIds)].sort() })).sort((a, b) => precedence[b.scope] - precedence[a.scope] || Number(b.containsCentroid) - Number(a.containsCentroid) || b.intersectionRatio - a.intersectionRatio || a.jurisdictionId.localeCompare(b.jurisdictionId));
  const best = material[0] || null;
  const peers = best ? material.filter((candidate) => precedence[candidate.scope] === precedence[best.scope] && candidate.containsCentroid === best.containsCentroid && Math.abs(candidate.intersectionRatio - best.intersectionRatio) < 1e-12) : [];
  const ambiguous = !best || peers.length > 1 || input.geometryValid !== true || input.boundarySnapshotCertified !== true;
  const core = {
    schemaVersion: COUNTY_PARCEL_JURISDICTION_ASSIGNMENT_VERSION,
    countyId: required(input.countyId, "countyId"),
    countyParcelId: required(input.countyParcelId, "countyParcelId"),
    boundarySnapshotSha256: required(input.boundarySnapshotSha256, "boundarySnapshotSha256"),
    effectiveAt: iso(input.effectiveAt, "effectiveAt"),
    candidates: material,
    assignedJurisdictionId: ambiguous ? "" : best.jurisdictionId,
    assignedScope: ambiguous ? "" : best.scope,
    ambiguous,
    ambiguityReason: !input.boundarySnapshotCertified ? "boundary-snapshot-not-certified" : input.geometryValid !== true ? "invalid-parcel-geometry" : !best ? "no-boundary-intersection" : peers.length > 1 ? "equal-precedence-overlap" : "",
    zoningEligible: !ambiguous && ["incorporated", "limited-purpose"].includes(best.scope),
    etjReviewRequired: !ambiguous && best.scope === "etj",
  };
  return seal(core, "assignmentSha256");
}
