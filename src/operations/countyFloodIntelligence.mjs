import { createHash } from "node:crypto";

export const COUNTY_FLOOD_SOURCE_PROBE_VERSION = "wr-county-flood-source-probe-v1";
export const COUNTY_FLOOD_SOURCE_RECONCILIATION_VERSION = "wr-county-flood-source-reconciliation-v1";
export const COUNTY_FLOOD_SNAPSHOT_POLICY_VERSION = "wr-county-flood-snapshot-policy-v1";
export const COUNTY_PARCEL_FLOOD_CLASSIFICATION_VERSION = "wr-county-parcel-flood-classification-v1";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function countyFloodSha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyFloodSha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function https(value, name) { const text = required(value, name); if (!text.startsWith("https://")) throw new TypeError(`${name} must use HTTPS`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function digest(value, name) { const text = required(value, name); if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`); return text; }

const ROLE = new Set(["regulatory-candidate", "planning-estimate-only", "historical-only"]);
const ZONE = Object.freeze({ FLOODWAY: { canonicalZone: "FLOODWAY", riskTier: "extreme", sfha: true, rank: 5 }, V: { canonicalZone: "V", riskTier: "extreme", sfha: true, rank: 5 }, VE: { canonicalZone: "VE", riskTier: "extreme", sfha: true, rank: 5 }, A: { canonicalZone: "A", riskTier: "high", sfha: true, rank: 4 }, AE: { canonicalZone: "AE", riskTier: "high", sfha: true, rank: 4 }, AH: { canonicalZone: "AH", riskTier: "high", sfha: true, rank: 4 }, AO: { canonicalZone: "AO", riskTier: "high", sfha: true, rank: 4 }, A99: { canonicalZone: "A99", riskTier: "high", sfha: true, rank: 4 }, AR: { canonicalZone: "AR", riskTier: "high", sfha: true, rank: 4 }, X: { canonicalZone: "X", riskTier: "minimal-or-moderate", sfha: false, rank: 1 }, D: { canonicalZone: "D", riskTier: "undetermined", sfha: false, rank: 2 } });

export function normalizeFloodZone(value, sfhaFlag = "") {
  const raw = required(value, "zone").toUpperCase().replace(/^ZONE\s+/, "");
  const item = ZONE[raw];
  if (!item) return Object.freeze({ rawZone: raw, canonicalZone: "UNKNOWN", riskTier: "unknown", sfha: null, rank: 0, taxonomyKnown: false, sfhaConsistent: false });
  const flag = String(sfhaFlag || "").trim().toUpperCase();
  const expected = item.sfha ? "T" : "F";
  return Object.freeze({ rawZone: raw, ...item, taxonomyKnown: true, sfhaConsistent: !flag || flag === expected });
}

export function createCountyFloodSourceProbe(input = {}) {
  const role = required(input.role, "role");
  if (!ROLE.has(role)) throw new TypeError(`Unsupported flood source role: ${role}`);
  const featureCount = integer(input.featureCount, "featureCount");
  const nonNullSourceIdCount = integer(input.nonNullSourceIdCount, "nonNullSourceIdCount");
  if (nonNullSourceIdCount > featureCount) throw new TypeError("nonNullSourceIdCount cannot exceed featureCount");
  const zoneTuples = (input.zoneTuples || []).map((tuple) => ({ zone: required(tuple.zone, "zoneTuple.zone"), sfhaFlag: String(tuple.sfhaFlag || ""), versionId: String(tuple.versionId || ""), normalized: normalizeFloodZone(tuple.zone, tuple.sfhaFlag) }));
  const core = {
    schemaVersion: COUNTY_FLOOD_SOURCE_PROBE_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    role,
    serviceUrl: https(input.serviceUrl, "serviceUrl"),
    layerUrl: https(input.layerUrl, "layerUrl"),
    layerName: required(input.layerName, "layerName"),
    sourceIdField: required(input.sourceIdField, "sourceIdField"),
    zoneField: required(input.zoneField, "zoneField"),
    sfhaField: required(input.sfhaField, "sfhaField"),
    geometryType: required(input.geometryType, "geometryType"),
    spatialReference: required(input.spatialReference, "spatialReference"),
    featureCount,
    nonNullSourceIdCount,
    nullSourceIdCount: featureCount - nonNullSourceIdCount,
    sourceIdUniqueness: input.sourceIdUniqueness === "verified-unique" ? "verified-unique" : "unverified",
    zoneTuples,
    unknownZoneTupleCount: zoneTuples.filter((tuple) => !tuple.normalized.taxonomyKnown).length,
    inconsistentSfhaTupleCount: zoneTuples.filter((tuple) => !tuple.normalized.sfhaConsistent).length,
    metadataSha256: digest(input.metadataSha256, "metadataSha256"),
    countResponseSha256: digest(input.countResponseSha256, "countResponseSha256"),
    identityCountResponseSha256: digest(input.identityCountResponseSha256, "identityCountResponseSha256"),
    taxonomyResponseSha256: digest(input.taxonomyResponseSha256, "taxonomyResponseSha256"),
    observedAt: iso(input.observedAt, "observedAt"),
    capturesGeometry: false,
    captureAuthorized: false,
  };
  const metadataReady = core.featureCount > 0 && core.nullSourceIdCount === 0 && core.zoneTuples.length > 0 && core.unknownZoneTupleCount === 0 && core.inconsistentSfhaTupleCount === 0;
  return seal({ ...core, metadataReady, status: metadataReady ? "metadata-ready" : "metadata-rejected" }, "probeSha256");
}

export function reconcileCountyFloodSources(input = {}) {
  const probes = input.probes || [];
  const regulatory = probes.filter((probe) => probe.role === "regulatory-candidate");
  const estimates = probes.filter((probe) => probe.role === "planning-estimate-only");
  const historical = probes.filter((probe) => probe.role === "historical-only");
  const selected = regulatory.length === 1 && regulatory[0].metadataReady ? regulatory[0] : null;
  const core = {
    schemaVersion: COUNTY_FLOOD_SOURCE_RECONCILIATION_VERSION,
    countyId: required(input.countyId, "countyId"),
    probeSha256s: probes.map((probe) => probe.probeSha256).sort(),
    selectedRegulatoryCandidateSourceId: selected?.sourceId || "",
    planningEstimateSourceIds: estimates.map((probe) => probe.sourceId).sort(),
    historicalSourceIds: historical.map((probe) => probe.sourceId).sort(),
    rules: ["regulatory-candidate-never-substituted-by-estimate", "historical-source-never-used-for-current-classification", "all-source-roles-preserved-in-lineage"],
    blockers: [
      ...(regulatory.length !== 1 ? ["exactly-one-regulatory-candidate-required"] : []),
      ...(selected?.sourceIdUniqueness !== "verified-unique" ? ["regulatory-source-id-uniqueness-unverified"] : []),
      ...(selected?.captureAuthorized !== true ? ["regulatory-geometry-capture-not-authorized"] : []),
      ...(selected?.unknownZoneTupleCount ? ["regulatory-zone-taxonomy-unknown"] : []),
      ...(selected?.inconsistentSfhaTupleCount ? ["regulatory-sfha-taxonomy-inconsistent"] : []),
    ],
  };
  return seal({ ...core, status: core.blockers.length ? "blocked" : "selected" }, "reconciliationSha256");
}

export function createCountyFloodSnapshotPolicy(input = {}) {
  const rights = [...new Set((input.rights || []).map(String).filter(Boolean))].sort();
  const approvals = [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort();
  const checks = [
    { id: "source-selection", passed: input.reconciliationStatus === "selected" },
    { id: "stable-identity", passed: input.sourceIdUniqueness === "verified-unique" },
    { id: "reuse-rights", passed: ["store", "derive", "query"].every((right) => rights.includes(right)) && Boolean(input.rightsEvidenceRef) },
    { id: "independent-approvals", passed: approvals.length >= 2 },
    { id: "boundary-clip", passed: Boolean(input.countyBoundarySnapshotSha256) && /^[a-f0-9]{64}$/.test(String(input.countyBoundarySnapshotSha256)) },
  ];
  const core = { schemaVersion: COUNTY_FLOOD_SNAPSHOT_POLICY_VERSION, countyId: required(input.countyId, "countyId"), reconciliationSha256: digest(input.reconciliationSha256, "reconciliationSha256"), sourceProbeSha256: digest(input.sourceProbeSha256, "sourceProbeSha256"), effectiveAt: iso(input.effectiveAt, "effectiveAt"), countyBoundarySnapshotSha256: String(input.countyBoundarySnapshotSha256 || ""), rights, rightsEvidenceRef: String(input.rightsEvidenceRef || ""), approvalRefs: approvals, requiredGeometryChecks: ["valid", "non-empty", "county-clipped", "exact-count", "stable-id", "zone-taxonomy", "overlap-audit"], checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "capture-authorized" : "blocked" }, "policySha256");
}

export function classifyParcelFloodRisk(input = {}) {
  const fragments = (input.intersections || []).map((item) => ({ sourceFeatureId: required(item.sourceFeatureId, "sourceFeatureId"), intersectionRatio: Number(item.intersectionRatio), containsCentroid: item.containsCentroid === true, zone: normalizeFloodZone(item.zone, item.sfhaFlag) }));
  if (fragments.some((item) => !Number.isFinite(item.intersectionRatio) || item.intersectionRatio < 0 || item.intersectionRatio > 1)) throw new TypeError("intersectionRatio must be between zero and one");
  const grouped = new Map();
  for (const item of fragments) {
    const key = item.zone.canonicalZone;
    const current = grouped.get(key) || { ...item.zone, intersectionRatio: 0, containsCentroid: false, sourceFeatureIds: [] };
    current.intersectionRatio = Math.min(1, Math.round((current.intersectionRatio + item.intersectionRatio) * 1e12) / 1e12);
    current.containsCentroid ||= item.containsCentroid;
    current.sourceFeatureIds.push(item.sourceFeatureId);
    grouped.set(key, current);
  }
  const zones = [...grouped.values()].map((item) => ({ ...item, sourceFeatureIds: [...new Set(item.sourceFeatureIds)].sort() })).sort((a, b) => b.rank - a.rank || Number(b.containsCentroid) - Number(a.containsCentroid) || b.intersectionRatio - a.intersectionRatio || a.canonicalZone.localeCompare(b.canonicalZone));
  const top = zones[0] || null;
  const ambiguous = input.sourceSnapshotCertified !== true || input.parcelGeometryValid !== true || zones.some((zone) => !zone.taxonomyKnown || !zone.sfhaConsistent);
  const core = {
    schemaVersion: COUNTY_PARCEL_FLOOD_CLASSIFICATION_VERSION,
    countyId: required(input.countyId, "countyId"),
    countyParcelId: required(input.countyParcelId, "countyParcelId"),
    sourceSnapshotSha256: required(input.sourceSnapshotSha256, "sourceSnapshotSha256"),
    effectiveAt: iso(input.effectiveAt, "effectiveAt"),
    zones,
    primaryZone: ambiguous ? "" : top?.canonicalZone || "UNMAPPED",
    primaryRiskTier: ambiguous ? "unknown" : top?.riskTier || "unmapped",
    sfha: ambiguous ? null : Boolean(zones.some((zone) => zone.sfha === true)),
    floodway: ambiguous ? null : Boolean(zones.some((zone) => zone.canonicalZone === "FLOODWAY")),
    ambiguous,
    ambiguityReason: input.sourceSnapshotCertified !== true ? "source-snapshot-not-certified" : input.parcelGeometryValid !== true ? "invalid-parcel-geometry" : zones.some((zone) => !zone.taxonomyKnown) ? "unknown-zone" : zones.some((zone) => !zone.sfhaConsistent) ? "sfha-zone-conflict" : "",
    disclaimer: "Screening intelligence only; not a FEMA flood-zone determination or insurance quote.",
  };
  return seal(core, "classificationSha256");
}
