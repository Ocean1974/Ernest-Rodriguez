import { createHash } from "node:crypto";

export const COUNTY_ZONING_SOURCE_PROBE_VERSION = "wr-county-zoning-source-probe-v1";
export const COUNTY_ZONING_COVERAGE_RECONCILIATION_VERSION = "wr-county-zoning-coverage-reconciliation-v1";
export const COUNTY_ZONING_SNAPSHOT_POLICY_VERSION = "wr-county-zoning-snapshot-policy-v1";
export const COUNTY_ZONING_DISTRICT_DEFINITION_VERSION = "wr-county-zoning-district-definition-v1";
export const COUNTY_PARCEL_ZONING_ASSIGNMENT_VERSION = "wr-county-parcel-zoning-assignment-v1";
export const COUNTY_ZONING_ASSIGNMENT_AUDIT_VERSION = "wr-county-zoning-assignment-audit-v1";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function countyZoningSha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyZoningSha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function https(value, name) { const text = required(value, name); if (!text.startsWith("https://")) throw new TypeError(`${name} must use HTTPS`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function digest(value, name) { const text = required(value, name); if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`); return text; }
const ROLES = new Set(["current-zoning", "overlay", "zoning-case", "future-land-use"]);
const USES = new Set(["residential", "commercial", "industrial", "mixed-use", "agricultural", "public-institutional", "open-space", "special-purpose", "unmapped"]);

export function createCountyZoningSourceProbe(input = {}) {
  const sourceRole = required(input.sourceRole, "sourceRole");
  if (!ROLES.has(sourceRole)) throw new TypeError(`Unsupported zoning source role: ${sourceRole}`);
  const featureCount = integer(input.featureCount, "featureCount");
  const counts = {};
  for (const [field, value] of Object.entries(input.nonNullCounts || {})) {
    counts[field] = integer(value, `nonNullCounts.${field}`);
    if (counts[field] > featureCount) throw new TypeError(`nonNullCounts.${field} cannot exceed featureCount`);
  }
  const identityField = required(input.identityField, "identityField");
  if (!(identityField in counts)) throw new TypeError("nonNullCounts must include identityField");
  const districtField = String(input.districtField || "");
  const core = {
    schemaVersion: COUNTY_ZONING_SOURCE_PROBE_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    sourceRole,
    jurisdictionIds: [...new Set((input.jurisdictionIds || []).map(String).filter(Boolean))].sort(),
    coverageStatement: required(input.coverageStatement, "coverageStatement"),
    temporalCoverage: required(input.temporalCoverage, "temporalCoverage"),
    serviceUrl: https(input.serviceUrl, "serviceUrl"),
    layerUrl: https(input.layerUrl, "layerUrl"),
    layerName: required(input.layerName, "layerName"),
    geometryType: required(input.geometryType, "geometryType"),
    spatialReference: required(input.spatialReference, "spatialReference"),
    identityField,
    identityUniqueness: input.identityUniqueness === "verified-unique" ? "verified-unique" : "unverified",
    districtField,
    baseDistrictField: String(input.baseDistrictField || ""),
    effectiveDateField: String(input.effectiveDateField || ""),
    featureCount,
    nonNullCounts: Object.freeze(counts),
    nullIdentityCount: featureCount - counts[identityField],
    nullDistrictCount: districtField ? featureCount - Number(counts[districtField] || 0) : featureCount,
    taxonomyTupleCount: integer(input.taxonomyTupleCount, "taxonomyTupleCount"),
    metadataSha256: digest(input.metadataSha256, "metadataSha256"),
    countResponseSha256: digest(input.countResponseSha256, "countResponseSha256"),
    completenessResponseSha256: digest(input.completenessResponseSha256, "completenessResponseSha256"),
    taxonomyResponseSha256: digest(input.taxonomyResponseSha256, "taxonomyResponseSha256"),
    observedAt: iso(input.observedAt, "observedAt"),
    capturesGeometry: false,
    captureAuthorized: false,
  };
  if (!core.jurisdictionIds.length) throw new TypeError("Zoning sources require jurisdictionIds");
  const metadataReady = featureCount > 0 && core.nullIdentityCount === 0 && core.taxonomyTupleCount > 0 && (sourceRole !== "current-zoning" || core.nullDistrictCount < featureCount);
  return seal({ ...core, metadataReady, status: metadataReady ? "metadata-ready" : "metadata-rejected" }, "probeSha256");
}

export function reconcileCountyZoningCoverage(input = {}) {
  const universe = [...new Set((input.jurisdictionUniverseIds || []).map(String).filter(Boolean))].sort();
  if (!universe.length) throw new TypeError("jurisdictionUniverseIds must not be empty");
  const known = new Set(universe);
  const probes = input.probes || [];
  const current = probes.filter((probe) => probe.sourceRole === "current-zoning" && probe.metadataReady);
  const discovered = [...new Set(current.flatMap((probe) => probe.jurisdictionIds).filter((id) => known.has(id)))].sort();
  const certified = [...new Set(current.filter((probe) => probe.captureAuthorized && probe.identityUniqueness === "verified-unique" && probe.nullDistrictCount === 0).flatMap((probe) => probe.jurisdictionIds).filter((id) => known.has(id)))].sort();
  const core = {
    schemaVersion: COUNTY_ZONING_COVERAGE_RECONCILIATION_VERSION,
    countyId: required(input.countyId, "countyId"),
    jurisdictionUniverseIds: universe,
    probeSha256s: probes.map((probe) => probe.probeSha256).filter(Boolean).sort(),
    discoveredCurrentZoningJurisdictionIds: discovered,
    certifiedCurrentZoningJurisdictionIds: certified,
    uncoveredCurrentZoningJurisdictionIds: universe.filter((id) => !certified.includes(id)),
    overlaySourceIds: probes.filter((probe) => probe.sourceRole === "overlay").map((probe) => probe.sourceId).sort(),
    caseSourceIds: probes.filter((probe) => probe.sourceRole === "zoning-case").map((probe) => probe.sourceId).sort(),
    rules: ["overlay-never-replaces-current-zoning", "case-never-replaces-current-zoning-until-effective", "future-land-use-never-labeled-current-zoning", "municipal-zoning-never-crosses-certified-jurisdiction-boundary", "missing-effective-date-never-invented"],
  };
  return seal({ ...core, complete: core.uncoveredCurrentZoningJurisdictionIds.length === 0, status: core.uncoveredCurrentZoningJurisdictionIds.length ? "blocked" : "certified" }, "reconciliationSha256");
}

export function createCountyZoningSnapshotPolicy(input = {}) {
  const rights = [...new Set((input.rights || []).map(String).filter(Boolean))].sort();
  const approvals = [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort();
  const checks = [
    { id: "source-identity", passed: input.identityUniqueness === "verified-unique" },
    { id: "district-completeness", passed: Number(input.nullDistrictCount) === 0 },
    { id: "reuse-rights", passed: ["store", "derive", "query"].every((right) => rights.includes(right)) && Boolean(input.rightsEvidenceRef) },
    { id: "independent-approvals", passed: approvals.length >= 2 },
    { id: "jurisdiction-boundary", passed: /^[a-f0-9]{64}$/.test(String(input.jurisdictionBoundarySnapshotSha256 || "")) },
  ];
  const core = { schemaVersion: COUNTY_ZONING_SNAPSHOT_POLICY_VERSION, countyId: required(input.countyId, "countyId"), sourceProbeSha256: digest(input.sourceProbeSha256, "sourceProbeSha256"), jurisdictionBoundarySnapshotSha256: String(input.jurisdictionBoundarySnapshotSha256 || ""), effectiveAt: iso(input.effectiveAt, "effectiveAt"), rights, rightsEvidenceRef: String(input.rightsEvidenceRef || ""), approvalRefs: approvals, requiredGeometryChecks: ["valid", "non-empty", "jurisdiction-clipped", "exact-count", "stable-id", "district-taxonomy", "overlap-audit"], checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "capture-authorized" : "blocked" }, "policySha256");
}

export function createCountyZoningDistrictDefinition(input = {}) {
  const broadUseCategory = input.mappingEvidenceRef ? required(input.broadUseCategory, "broadUseCategory") : "unmapped";
  if (!USES.has(broadUseCategory)) throw new TypeError(`Unsupported broadUseCategory: ${broadUseCategory}`);
  const core = { schemaVersion: COUNTY_ZONING_DISTRICT_DEFINITION_VERSION, jurisdictionId: required(input.jurisdictionId, "jurisdictionId"), districtCode: required(input.districtCode, "districtCode"), districtLabel: required(input.districtLabel, "districtLabel"), baseDistrictCode: String(input.baseDistrictCode || ""), plannedDevelopmentId: String(input.plannedDevelopmentId || ""), broadUseCategory, officialDefinitionRef: https(input.officialDefinitionRef, "officialDefinitionRef"), mappingEvidenceRef: String(input.mappingEvidenceRef || ""), effectiveAt: input.effectiveAt ? iso(input.effectiveAt, "effectiveAt") : "", sourceSnapshotSha256: digest(input.sourceSnapshotSha256, "sourceSnapshotSha256") };
  return seal(core, "definitionSha256");
}

export function assignParcelZoning(input = {}) {
  const fragments = (input.intersections || []).map((item) => ({ sourceFeatureId: required(item.sourceFeatureId, "sourceFeatureId"), districtCode: required(item.districtCode, "districtCode"), baseDistrictCode: String(item.baseDistrictCode || ""), intersectionRatio: Number(item.intersectionRatio), containsCentroid: item.containsCentroid === true, effectiveAt: item.effectiveAt ? iso(item.effectiveAt, "intersection.effectiveAt") : "" }));
  if (fragments.some((item) => !Number.isFinite(item.intersectionRatio) || item.intersectionRatio < 0 || item.intersectionRatio > 1)) throw new TypeError("intersectionRatio must be between zero and one");
  const grouped = new Map();
  for (const item of fragments) {
    const key = `${item.districtCode}\u0000${item.baseDistrictCode}`;
    const current = grouped.get(key) || { districtCode: item.districtCode, baseDistrictCode: item.baseDistrictCode, intersectionRatio: 0, containsCentroid: false, effectiveDates: [], sourceFeatureIds: [] };
    current.intersectionRatio = Math.min(1, Math.round((current.intersectionRatio + item.intersectionRatio) * 1e12) / 1e12);
    current.containsCentroid ||= item.containsCentroid;
    if (item.effectiveAt) current.effectiveDates.push(item.effectiveAt);
    current.sourceFeatureIds.push(item.sourceFeatureId);
    grouped.set(key, current);
  }
  const districts = [...grouped.values()].map((item) => ({ ...item, effectiveDates: [...new Set(item.effectiveDates)].sort(), sourceFeatureIds: [...new Set(item.sourceFeatureIds)].sort() })).sort((a, b) => Number(b.containsCentroid) - Number(a.containsCentroid) || b.intersectionRatio - a.intersectionRatio || a.districtCode.localeCompare(b.districtCode));
  const centroid = districts.filter((item) => item.containsCentroid);
  const dominanceThreshold = Number(input.dominanceThreshold ?? 0.9);
  const marginThreshold = Number(input.marginThreshold ?? 0.2);
  const dominant = districts[0] && districts[0].intersectionRatio >= dominanceThreshold && districts[0].intersectionRatio - Number(districts[1]?.intersectionRatio || 0) >= marginThreshold;
  const chosen = centroid.length === 1 ? centroid[0] : districts.length === 1 || dominant ? districts[0] : null;
  const prerequisiteFailure = input.zoningSnapshotCertified !== true || input.jurisdictionAssignmentCertified !== true || input.parcelGeometryValid !== true;
  const ambiguous = prerequisiteFailure || !chosen;
  const core = {
    schemaVersion: COUNTY_PARCEL_ZONING_ASSIGNMENT_VERSION,
    countyId: required(input.countyId, "countyId"),
    countyParcelId: required(input.countyParcelId, "countyParcelId"),
    jurisdictionId: required(input.jurisdictionId, "jurisdictionId"),
    zoningSnapshotSha256: required(input.zoningSnapshotSha256, "zoningSnapshotSha256"),
    effectiveAt: iso(input.effectiveAt, "effectiveAt"),
    districts,
    primaryDistrictCode: ambiguous ? "" : chosen.districtCode,
    primaryBaseDistrictCode: ambiguous ? "" : chosen.baseDistrictCode,
    splitParcel: districts.length > 1,
    ambiguous,
    ambiguityReason: input.zoningSnapshotCertified !== true ? "zoning-snapshot-not-certified" : input.jurisdictionAssignmentCertified !== true ? "jurisdiction-assignment-not-certified" : input.parcelGeometryValid !== true ? "invalid-parcel-geometry" : !districts.length ? "no-zoning-intersection" : centroid.length > 1 ? "multiple-centroid-districts" : "non-dominant-split",
    overlays: [...new Set((input.overlays || []).map(String).filter(Boolean))].sort(),
    pendingCaseIds: [...new Set((input.pendingCaseIds || []).map(String).filter(Boolean))].sort(),
    disclaimer: "Planning intelligence only; verify current zoning and permitted use with the governing municipality.",
  };
  return seal(core, "assignmentSha256");
}

export function createCountyZoningAssignmentAudit(input = {}) {
  const counts = Object.fromEntries(["parcels", "assigned", "split", "ambiguous", "unmatched", "invalid", "missingDefinition"].map((field) => [field, integer(input.counts?.[field], `counts.${field}`)]));
  const checks = [
    { id: "exclusive-parcel-partition", passed: counts.assigned + counts.ambiguous + counts.unmatched + counts.invalid === counts.parcels },
    { id: "split-subset", passed: counts.split <= counts.assigned + counts.ambiguous },
    { id: "definition-completeness", passed: counts.missingDefinition === 0 },
    { id: "snapshot-certified", passed: input.zoningSnapshotCertified === true },
    { id: "jurisdiction-certified", passed: input.jurisdictionAssignmentsCertified === true },
    { id: "ambiguity-threshold", passed: counts.ambiguous <= integer(input.maximumAmbiguousCount ?? 0, "maximumAmbiguousCount") },
  ];
  const core = { schemaVersion: COUNTY_ZONING_ASSIGNMENT_AUDIT_VERSION, countyId: required(input.countyId, "countyId"), jurisdictionId: required(input.jurisdictionId, "jurisdictionId"), zoningSnapshotSha256: required(input.zoningSnapshotSha256, "zoningSnapshotSha256"), parcelManifestSha256: required(input.parcelManifestSha256, "parcelManifestSha256"), counts, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt"), checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "rejected" }, "auditSha256");
}
