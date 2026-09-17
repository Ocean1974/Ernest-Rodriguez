import { createHash } from "node:crypto";

export const COUNTY_PERMIT_SOURCE_PROBE_VERSION = "wr-county-permit-source-probe-v1";
export const COUNTY_PERMIT_COVERAGE_RECONCILIATION_VERSION = "wr-county-permit-coverage-reconciliation-v1";
export const COUNTY_PERMIT_NORMALIZATION_POLICY_VERSION = "wr-county-permit-normalization-policy-v1";
export const NORMALIZED_COUNTY_PERMIT_EVENT_VERSION = "wr-normalized-county-permit-event-v1";
export const COUNTY_PERMIT_PARCEL_LINK_AUDIT_VERSION = "wr-county-permit-parcel-link-audit-v1";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function countyPermitSha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyPermitSha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function https(value, name) { const text = required(value, name); if (!text.startsWith("https://")) throw new TypeError(`${name} must use HTTPS`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function digest(value, name) { const text = required(value, name); if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`); return text; }
const ROLES = new Set(["municipal-building", "county-utility", "county-specialty", "municipal-specialty"]);

export function createCountyPermitSourceProbe(input = {}) {
  const sourceRole = required(input.sourceRole, "sourceRole");
  if (!ROLES.has(sourceRole)) throw new TypeError(`Unsupported permit source role: ${sourceRole}`);
  const featureCount = integer(input.featureCount, "featureCount");
  const counts = {};
  for (const [field, value] of Object.entries(input.nonNullCounts || {})) {
    counts[required(field, "nonNullCounts field")] = integer(value, `nonNullCounts.${field}`);
    if (counts[field] > featureCount) throw new TypeError(`nonNullCounts.${field} cannot exceed featureCount`);
  }
  const identityField = required(input.identityField, "identityField");
  if (!(identityField in counts)) throw new TypeError("nonNullCounts must include identityField");
  const jurisdictionIds = [...new Set((input.jurisdictionIds || []).map(String).filter(Boolean))].sort();
  if (sourceRole.startsWith("municipal-") && !jurisdictionIds.length) throw new TypeError("Municipal permit sources require jurisdictionIds");
  const core = {
    schemaVersion: COUNTY_PERMIT_SOURCE_PROBE_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    sourceRole,
    jurisdictionIds,
    coverageStatement: required(input.coverageStatement, "coverageStatement"),
    temporalCoverage: required(input.temporalCoverage, "temporalCoverage"),
    serviceUrl: https(input.serviceUrl, "serviceUrl"),
    layerUrl: https(input.layerUrl, "layerUrl"),
    layerName: required(input.layerName, "layerName"),
    geometryType: required(input.geometryType, "geometryType"),
    spatialReference: required(input.spatialReference, "spatialReference"),
    identityField,
    identityUniqueness: input.identityUniqueness === "verified-unique" ? "verified-unique" : "unverified",
    addressField: String(input.addressField || ""),
    sourceParcelKeyField: String(input.sourceParcelKeyField || ""),
    sourceParcelKeyBridgeStatus: input.sourceParcelKeyBridgeStatus === "verified" ? "verified" : "unverified",
    featureCount,
    nonNullCounts: Object.freeze(counts),
    nullIdentityCount: featureCount - counts[identityField],
    typeStatusTupleCount: integer(input.typeStatusTupleCount, "typeStatusTupleCount"),
    permitTypes: [...new Set((input.permitTypes || []).map(String).filter(Boolean))].sort(),
    metadataSha256: digest(input.metadataSha256, "metadataSha256"),
    countResponseSha256: digest(input.countResponseSha256, "countResponseSha256"),
    completenessResponseSha256: digest(input.completenessResponseSha256, "completenessResponseSha256"),
    taxonomyResponseSha256: digest(input.taxonomyResponseSha256, "taxonomyResponseSha256"),
    observedAt: iso(input.observedAt, "observedAt"),
    capturesRecords: false,
    capturesGeometry: false,
    captureAuthorized: false,
  };
  const metadataReady = featureCount > 0 && core.nullIdentityCount === 0 && core.typeStatusTupleCount > 0;
  return seal({ ...core, metadataReady, status: metadataReady ? "metadata-ready" : "metadata-rejected" }, "probeSha256");
}

export function reconcileCountyPermitCoverage(input = {}) {
  const universeIds = [...new Set((input.jurisdictionUniverseIds || []).map(String).filter(Boolean))].sort();
  if (!universeIds.length) throw new TypeError("jurisdictionUniverseIds must not be empty");
  const probes = input.probes || [];
  const building = probes.filter((probe) => probe.sourceRole === "municipal-building" && probe.metadataReady);
  const known = new Set(universeIds);
  const discovered = [...new Set(building.flatMap((probe) => probe.jurisdictionIds).filter((id) => known.has(id)))].sort();
  const certified = [...new Set(building.filter((probe) => probe.captureAuthorized && probe.identityUniqueness === "verified-unique").flatMap((probe) => probe.jurisdictionIds).filter((id) => known.has(id)))].sort();
  const core = {
    schemaVersion: COUNTY_PERMIT_COVERAGE_RECONCILIATION_VERSION,
    countyId: required(input.countyId, "countyId"),
    jurisdictionUniverseIds: universeIds,
    probeSha256s: probes.map((probe) => probe.probeSha256).filter(Boolean).sort(),
    discoveredBuildingJurisdictionIds: discovered,
    certifiedBuildingJurisdictionIds: certified,
    uncoveredBuildingJurisdictionIds: universeIds.filter((id) => !certified.includes(id)),
    nonBuildingSourceIds: probes.filter((probe) => probe.sourceRole !== "municipal-building").map((probe) => probe.sourceId).sort(),
    rules: ["county-utility-never-labeled-building-permit", "municipal-record-never-labeled-countywide", "rolling-window-never-labeled-full-history", "source-property-id-never-assumed-to-equal-county-parcel-id"],
  };
  return seal({ ...core, complete: core.uncoveredBuildingJurisdictionIds.length === 0, status: core.uncoveredBuildingJurisdictionIds.length ? "blocked" : "certified" }, "reconciliationSha256");
}

export function createCountyPermitNormalizationPolicy(input = {}) {
  const rights = [...new Set((input.rights || []).map(String).filter(Boolean))].sort();
  const approvals = [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort();
  const checks = [
    { id: "source-identity", passed: input.identityUniqueness === "verified-unique" },
    { id: "parcel-key-bridge", passed: input.sourceParcelKeyBridgeStatus === "verified" || (Boolean(input.addressField) && input.geometryAvailable === true) },
    { id: "reuse-rights", passed: ["store", "derive", "query"].every((right) => rights.includes(right)) && Boolean(input.rightsEvidenceRef) },
    { id: "independent-approvals", passed: approvals.length >= 2 },
    { id: "jurisdiction-boundary", passed: /^[a-f0-9]{64}$/.test(String(input.jurisdictionBoundarySnapshotSha256 || "")) },
  ];
  const core = { schemaVersion: COUNTY_PERMIT_NORMALIZATION_POLICY_VERSION, countyId: required(input.countyId, "countyId"), sourceProbeSha256: digest(input.sourceProbeSha256, "sourceProbeSha256"), jurisdictionBoundarySnapshotSha256: String(input.jurisdictionBoundarySnapshotSha256 || ""), addressField: String(input.addressField || ""), sourceParcelKeyField: String(input.sourceParcelKeyField || ""), rights, rightsEvidenceRef: String(input.rightsEvidenceRef || ""), approvalRefs: approvals, requiredCounts: ["source", "normalized", "direct-linked", "address-linked", "spatial-linked", "unmatched", "ambiguous", "conflict", "invalid"], checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "normalization-authorized" : "blocked" }, "policySha256");
}

export function createNormalizedCountyPermitEvent(input = {}) {
  const core = {
    schemaVersion: NORMALIZED_COUNTY_PERMIT_EVENT_VERSION,
    countyId: required(input.countyId, "countyId"),
    jurisdictionId: required(input.jurisdictionId, "jurisdictionId"),
    sourceId: required(input.sourceId, "sourceId"),
    sourcePermitId: required(input.sourcePermitId, "sourcePermitId"),
    permitNumber: String(input.permitNumber || ""),
    permitType: required(input.permitType, "permitType"),
    permitCategory: required(input.permitCategory, "permitCategory"),
    status: required(input.status, "status"),
    filedAt: input.filedAt ? iso(input.filedAt, "filedAt") : "",
    statusAt: input.statusAt ? iso(input.statusAt, "statusAt") : "",
    workDescription: String(input.workDescription || ""),
    declaredValue: input.declaredValue == null ? null : Number(input.declaredValue),
    normalizedAddress: String(input.normalizedAddress || ""),
    sourceParcelKey: String(input.sourceParcelKey || ""),
    point: input.point ? { longitude: Number(input.point.longitude), latitude: Number(input.point.latitude) } : null,
    sourceSnapshotSha256: digest(input.sourceSnapshotSha256, "sourceSnapshotSha256"),
    sourceRecordSha256: digest(input.sourceRecordSha256, "sourceRecordSha256"),
  };
  if (core.declaredValue != null && (!Number.isFinite(core.declaredValue) || core.declaredValue < 0)) throw new TypeError("declaredValue must be non-negative");
  if (core.point && (!Number.isFinite(core.point.longitude) || !Number.isFinite(core.point.latitude) || Math.abs(core.point.longitude) > 180 || Math.abs(core.point.latitude) > 90)) throw new TypeError("point coordinates are invalid");
  return seal(core, "eventSha256");
}

export function createCountyPermitParcelLinkAudit(input = {}) {
  const counts = Object.fromEntries(["source", "normalized", "directLinked", "addressLinked", "spatialLinked", "unmatched", "ambiguous", "conflict", "invalid"].map((field) => [field, integer(input.counts?.[field], `counts.${field}`)]));
  const partition = counts.directLinked + counts.addressLinked + counts.spatialLinked + counts.unmatched + counts.ambiguous + counts.conflict + counts.invalid;
  const checks = [
    { id: "source-normalized-parity", passed: counts.source === counts.normalized + counts.invalid },
    { id: "exclusive-link-partition", passed: partition === counts.source },
    { id: "source-snapshot", passed: input.sourceSnapshotCertified === true },
    { id: "parcel-bridge", passed: input.parcelBridgeCertified === true },
    { id: "ambiguity-threshold", passed: counts.ambiguous <= integer(input.maximumAmbiguousCount ?? 0, "maximumAmbiguousCount") },
    { id: "conflict-threshold", passed: counts.conflict <= integer(input.maximumConflictCount ?? 0, "maximumConflictCount") },
  ];
  const core = { schemaVersion: COUNTY_PERMIT_PARCEL_LINK_AUDIT_VERSION, countyId: required(input.countyId, "countyId"), sourceId: required(input.sourceId, "sourceId"), sourceSnapshotSha256: required(input.sourceSnapshotSha256, "sourceSnapshotSha256"), parcelManifestSha256: required(input.parcelManifestSha256, "parcelManifestSha256"), counts, unmatchedRate: counts.source ? counts.unmatched / counts.source : 0, checks, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt") };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "rejected" }, "auditSha256");
}
