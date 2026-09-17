import { createHash } from "node:crypto";

export const COUNTY_TILE_SOURCE_BUNDLE_VERSION = "wr-county-tile-source-bundle-v1";
export const COUNTY_TILE_PROPERTY_POLICY_VERSION = "wr-county-tile-property-policy-v1";
export const COUNTY_TILE_BUILD_PLAN_VERSION = "wr-county-tile-build-plan-v1";
export const COUNTY_TILE_ARTIFACT_AUDIT_VERSION = "wr-county-tile-artifact-audit-v1";
export const COUNTY_TILE_PUBLICATION_DECISION_VERSION = "wr-county-tile-publication-decision-v1";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function countyTileSha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyTileSha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function digest(value, name) { const text = required(value, name); if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
const FORBIDDEN_FIELDS = Object.freeze(["ownerName", "ownerName2", "ownerMailingAddress", "ownerMailingAddress2", "ownerPhone", "ownerEmail", "sourceReferences"]);

export function createCountyTileSourceBundle(input = {}) {
  const counts = Object.fromEntries(["official", "manifest", "chunks", "search"].map((field) => [field, integer(input.counts?.[field], `counts.${field}`)]));
  const chunkCount = integer(input.chunkCount, "chunkCount");
  const checks = [
    { id: "count-parity", passed: new Set(Object.values(counts)).size === 1 },
    { id: "chunks-present", passed: chunkCount > 0 },
    { id: "output-lineage", passed: input.outputLineageCertified === true },
    { id: "source-to-output-lineage", passed: input.sourceToOutputCertified === true },
    { id: "manifest-integrity", passed: /^[a-f0-9]{64}$/.test(String(input.parcelManifestSha256 || "")) },
    { id: "chunk-inventory-integrity", passed: /^[a-f0-9]{64}$/.test(String(input.chunkInventorySha256 || "")) },
  ];
  const core = {
    schemaVersion: COUNTY_TILE_SOURCE_BUNDLE_VERSION,
    countyId: required(input.countyId, "countyId"),
    countyFips: required(input.countyFips, "countyFips"),
    parcelManifestPath: required(input.parcelManifestPath, "parcelManifestPath"),
    parcelManifestSha256: digest(input.parcelManifestSha256, "parcelManifestSha256"),
    searchIndexSha256: digest(input.searchIndexSha256, "searchIndexSha256"),
    chunkInventorySha256: digest(input.chunkInventorySha256, "chunkInventorySha256"),
    lineageLedgerRootSha256: digest(input.lineageLedgerRootSha256, "lineageLedgerRootSha256"),
    counts,
    chunkCount,
    searchShardCount: integer(input.searchShardCount, "searchShardCount"),
    bounds: Object.freeze({ minLng: Number(input.bounds?.minLng), minLat: Number(input.bounds?.minLat), maxLng: Number(input.bounds?.maxLng), maxLat: Number(input.bounds?.maxLat) }),
    sourceMode: "viewport-chunk-stream",
    checks,
  };
  if (!Object.values(core.bounds).every(Number.isFinite) || core.bounds.minLng >= core.bounds.maxLng || core.bounds.minLat >= core.bounds.maxLat) throw new TypeError("bounds are invalid");
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "blocked" }, "bundleSha256");
}

export function createCountyTilePropertyPolicy(input = {}) {
  const includedFields = [...new Set((input.includedFields || []).map(String).filter(Boolean))].sort();
  if (!includedFields.includes("countyParcelId")) throw new TypeError("countyParcelId must be included");
  const forbiddenIncluded = includedFields.filter((field) => FORBIDDEN_FIELDS.includes(field));
  const checks = [
    { id: "identity", passed: includedFields.includes("countyParcelId") },
    { id: "no-owner-contact", passed: forbiddenIncluded.length === 0 },
    { id: "bounded-field-count", passed: includedFields.length <= integer(input.maximumFieldCount ?? 16, "maximumFieldCount") },
    { id: "independent-approval", passed: [...new Set(input.approvalRefs || [])].length >= 2 },
  ];
  const core = { schemaVersion: COUNTY_TILE_PROPERTY_POLICY_VERSION, countyId: required(input.countyId, "countyId"), includedFields, forbiddenFields: FORBIDDEN_FIELDS, forbiddenIncluded, maximumFieldCount: integer(input.maximumFieldCount ?? 16, "maximumFieldCount"), approvalRefs: [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort(), checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "approved" : "draft" }, "policySha256");
}

export function createCountyTileBuildPlan(input = {}) {
  const minZoom = integer(input.minZoom, "minZoom");
  const maxZoom = integer(input.maxZoom, "maxZoom");
  if (minZoom > maxZoom || maxZoom > 24) throw new TypeError("zoom range is invalid");
  const checks = [
    { id: "source-bundle", passed: input.sourceBundleCertified === true },
    { id: "property-policy", passed: input.propertyPolicyApproved === true },
    { id: "reuse-rights", passed: input.reuseRightsCertified === true },
    { id: "tippecanoe", passed: input.tippecanoeVerified === true && Boolean(input.tippecanoeVersion) },
    { id: "output-guard", passed: input.outputPathGuarded === true },
  ];
  const core = { schemaVersion: COUNTY_TILE_BUILD_PLAN_VERSION, countyId: required(input.countyId, "countyId"), sourceBundleSha256: digest(input.sourceBundleSha256, "sourceBundleSha256"), propertyPolicySha256: digest(input.propertyPolicySha256, "propertyPolicySha256"), sourceMode: "viewport-chunk-stream", streamCommand: required(input.streamCommand, "streamCommand"), tileTool: "tippecanoe", tippecanoeVersion: String(input.tippecanoeVersion || ""), layerId: required(input.layerId, "layerId"), minZoom, maxZoom, outputPath: required(input.outputPath, "outputPath"), artifactManifestPath: required(input.artifactManifestPath, "artifactManifestPath"), checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "build-authorized" : "blocked" }, "planSha256");
}

export function createCountyTileArtifactAudit(input = {}) {
  const counts = Object.fromEntries(["sourceFeatures", "streamedFeatures", "tiledFeatures", "excludedFeatures", "invalidFeatures"].map((field) => [field, integer(input.counts?.[field], `counts.${field}`)]));
  const checks = [
    { id: "stream-partition", passed: counts.sourceFeatures === counts.streamedFeatures + counts.invalidFeatures },
    { id: "tile-partition", passed: counts.streamedFeatures === counts.tiledFeatures + counts.excludedFeatures },
    { id: "artifact", passed: input.artifactPresent === true && integer(input.artifactBytes ?? 0, "artifactBytes") > 127 && /^[a-f0-9]{64}$/.test(String(input.artifactSha256 || "")) },
    { id: "pmtiles-header", passed: input.pmtilesHeaderVerified === true },
    { id: "decoded-sample", passed: input.decodedSampleVerified === true },
    { id: "properties", passed: input.propertyPolicyVerified === true },
  ];
  const core = { schemaVersion: COUNTY_TILE_ARTIFACT_AUDIT_VERSION, countyId: required(input.countyId, "countyId"), buildPlanSha256: digest(input.buildPlanSha256, "buildPlanSha256"), counts, artifactPath: required(input.artifactPath, "artifactPath"), artifactBytes: integer(input.artifactBytes ?? 0, "artifactBytes"), artifactSha256: String(input.artifactSha256 || ""), checks, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt") };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "rejected" }, "auditSha256");
}

export function createCountyTilePublicationDecision(input = {}) {
  const approvals = [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort();
  const checks = [
    { id: "artifact-audit", passed: input.artifactAuditCertified === true },
    { id: "http-range-delivery", passed: input.httpRangeDeliveryCertified === true },
    { id: "immutable-url", passed: /^https:\/\/.+\/[a-f0-9]{12,}[^/]*\.pmtiles(?:$|\?)/.test(String(input.pmtilesUrl || "")) },
    { id: "fallback", passed: input.viewportFallbackCertified === true },
    { id: "independent-approvals", passed: approvals.length >= 2 },
    { id: "county-release", passed: input.countyReleaseAuthorized === true },
  ];
  const core = { schemaVersion: COUNTY_TILE_PUBLICATION_DECISION_VERSION, countyId: required(input.countyId, "countyId"), artifactAuditSha256: digest(input.artifactAuditSha256, "artifactAuditSha256"), pmtilesUrl: String(input.pmtilesUrl || ""), fallbackRuntime: "viewport-geojson-service", approvalRefs: approvals, checks, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt") };
  const activationAuthorized = checks.every((check) => check.passed);
  return seal({ ...core, activationAuthorized, status: activationAuthorized ? "authorized" : "rejected" }, "decisionSha256");
}
