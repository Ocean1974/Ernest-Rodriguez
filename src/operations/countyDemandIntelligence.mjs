import { createHash } from "node:crypto";

export const COUNTY_DEMAND_SOURCE_PROBE_VERSION = "wr-county-demand-source-probe-v1";
export const COUNTY_DEMAND_COVERAGE_VERSION = "wr-county-demand-coverage-v1";
export const COUNTY_DEMAND_OBSERVATION_VERSION = "wr-county-demand-observation-v1";
export const COUNTY_DEMAND_FEATURE_DEFINITION_VERSION = "wr-county-demand-feature-definition-v1";
export const COUNTY_DEMAND_POINT_IN_TIME_VECTOR_VERSION = "wr-county-demand-point-in-time-vector-v1";
export const COUNTY_DEMAND_AUDIT_VERSION = "wr-county-demand-audit-v1";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function countyDemandSha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyDemandSha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function digest(value, name) { const text = required(value, name); if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
const ROLES = new Set(["migration-inflow", "migration-outflow", "demographic", "housing", "labor-market", "supply-pipeline"]);
const GEOGRAPHIES = new Set(["county", "place", "tract", "block-group", "parcel"]);
const DOMAINS = new Set(["migration", "demographic", "housing", "labor", "supply"]);
const LOCALIZATIONS = new Set(["source-geography-only", "area-overlay", "parcel-attribution"]);

export function createCountyDemandSourceProbe(input = {}) {
  const sourceRole = required(input.sourceRole, "sourceRole");
  if (!ROLES.has(sourceRole)) throw new TypeError(`Unsupported demand source role: ${sourceRole}`);
  const geographyLevel = required(input.geographyLevel, "geographyLevel");
  if (!GEOGRAPHIES.has(geographyLevel)) throw new TypeError(`Unsupported geographyLevel: ${geographyLevel}`);
  const domain = required(input.domain, "domain");
  if (!DOMAINS.has(domain)) throw new TypeError(`Unsupported domain: ${domain}`);
  const recordCount = integer(input.recordCount ?? 0, "recordCount");
  const blockers = [...new Set((input.blockers || []).map(String).filter(Boolean))].sort();
  const responseSha256 = String(input.responseSha256 || "");
  if (recordCount > 0) digest(responseSha256, "responseSha256");
  const core = {
    schemaVersion: COUNTY_DEMAND_SOURCE_PROBE_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    sourceRole,
    domain,
    geographyLevel,
    geographyId: required(input.geographyId, "geographyId"),
    sourceUrl: required(input.sourceUrl, "sourceUrl"),
    periodStart: required(input.periodStart, "periodStart"),
    periodEnd: required(input.periodEnd, "periodEnd"),
    releasedAt: input.releasedAt ? iso(input.releasedAt, "releasedAt") : "",
    recordCount,
    metricIds: [...new Set((input.metricIds || []).map(String).filter(Boolean))].sort(),
    responseBytes: integer(input.responseBytes ?? 0, "responseBytes"),
    responseSha256,
    contentPersisted: input.contentPersisted === true,
    sourceIdentityUnique: input.sourceIdentityUnique === true,
    reuseRightsCertified: input.reuseRightsCertified === true,
    blockers,
  };
  const metadataReady = core.metricIds.length > 0 && (recordCount > 0 || blockers.length > 0);
  const certificationReady = metadataReady && recordCount > 0 && core.contentPersisted && core.sourceIdentityUnique && core.reuseRightsCertified && blockers.length === 0;
  return seal({ ...core, metadataReady, certificationReady, status: certificationReady ? "certification-ready" : metadataReady ? "metadata-only" : "rejected" }, "probeSha256");
}

export function reconcileCountyDemandCoverage(input = {}) {
  const requiredDomains = [...new Set((input.requiredDomains || []).map(String).filter(Boolean))].sort();
  if (!requiredDomains.length || requiredDomains.some((domain) => !DOMAINS.has(domain))) throw new TypeError("requiredDomains must contain supported demand domains");
  const probes = input.probes || [];
  const discovered = [...new Set(probes.filter((probe) => probe.metadataReady).map((probe) => probe.domain))].sort();
  const observed = [...new Set(probes.filter((probe) => probe.recordCount > 0).map((probe) => probe.domain))].sort();
  const certified = [...new Set(probes.filter((probe) => probe.certificationReady).map((probe) => probe.domain))].sort();
  const core = {
    schemaVersion: COUNTY_DEMAND_COVERAGE_VERSION,
    countyId: required(input.countyId, "countyId"),
    geographyId: required(input.geographyId, "geographyId"),
    requiredDomains,
    discoveredDomains: discovered,
    observedDomains: observed,
    certifiedDomains: certified,
    missingOrUncertifiedDomains: requiredDomains.filter((domain) => !certified.includes(domain)),
    probeSha256s: probes.map((probe) => probe.probeSha256).filter(Boolean).sort(),
    rules: ["returns-never-labeled-people", "exemptions-never-labeled-population", "agi-never-labeled-household-income", "county-observation-never-labeled-parcel-fact", "mixed-periods-never-presented-as-one-vintage"],
  };
  return seal({ ...core, status: core.missingOrUncertifiedDomains.length ? "blocked" : "certified" }, "coverageSha256");
}

export function createCountyDemandObservation(input = {}) {
  const geographyLevel = required(input.geographyLevel, "geographyLevel");
  if (!GEOGRAPHIES.has(geographyLevel)) throw new TypeError(`Unsupported geographyLevel: ${geographyLevel}`);
  const value = finite(input.value, "value");
  const marginOfError = input.marginOfError == null ? null : finite(input.marginOfError, "marginOfError");
  if (marginOfError != null && marginOfError < 0) throw new TypeError("marginOfError must be non-negative");
  const core = {
    schemaVersion: COUNTY_DEMAND_OBSERVATION_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    metricId: required(input.metricId, "metricId"),
    label: required(input.label, "label"),
    value,
    unit: required(input.unit, "unit"),
    geographyLevel,
    geographyId: required(input.geographyId, "geographyId"),
    periodStart: required(input.periodStart, "periodStart"),
    periodEnd: required(input.periodEnd, "periodEnd"),
    releasedAt: iso(input.releasedAt, "releasedAt"),
    marginOfError,
    sourceSnapshotSha256: digest(input.sourceSnapshotSha256, "sourceSnapshotSha256"),
    sourceRecordSha256: digest(input.sourceRecordSha256, "sourceRecordSha256"),
    semantics: required(input.semantics, "semantics"),
    provisional: input.provisional === true,
  };
  return seal(core, "observationSha256");
}

export function createCountyDemandFeatureDefinition(input = {}) {
  const localization = required(input.localization, "localization");
  if (!LOCALIZATIONS.has(localization)) throw new TypeError(`Unsupported localization: ${localization}`);
  const sourceMetricIds = [...new Set((input.sourceMetricIds || []).map(String).filter(Boolean))].sort();
  if (!sourceMetricIds.length) throw new TypeError("sourceMetricIds must not be empty");
  const parcelEvidenceRefs = [...new Set((input.parcelEvidenceRefs || []).map(String).filter(Boolean))].sort();
  if (localization === "parcel-attribution" && parcelEvidenceRefs.length === 0) throw new TypeError("Parcel attribution requires parcel-specific evidence");
  const core = {
    schemaVersion: COUNTY_DEMAND_FEATURE_DEFINITION_VERSION,
    featureId: required(input.featureId, "featureId"),
    featureVersion: required(input.featureVersion, "featureVersion"),
    sourceMetricIds,
    formula: required(input.formula, "formula"),
    outputUnit: required(input.outputUnit, "outputUnit"),
    localization,
    parcelEvidenceRefs,
    explanation: required(input.explanation, "explanation"),
    approvedByRefs: [...new Set((input.approvedByRefs || []).map(String).filter(Boolean))].sort(),
    modelGenerated: false,
  };
  return seal({ ...core, status: core.approvedByRefs.length >= 2 ? "approved" : "draft" }, "definitionSha256");
}

export function createCountyDemandPointInTimeVector(input = {}) {
  const asOf = iso(input.asOf, "asOf");
  const asOfMs = new Date(asOf).getTime();
  const observations = input.observations || [];
  const future = observations.filter((observation) => new Date(observation.releasedAt).getTime() > asOfMs);
  const duplicateMetrics = observations.map((observation) => observation.metricId).filter((id, index, all) => all.indexOf(id) !== index);
  const checks = [
    { id: "point-in-time", passed: future.length === 0 },
    { id: "unique-metrics", passed: duplicateMetrics.length === 0 },
    { id: "source-certification", passed: input.sourceCertificationPassed === true },
    { id: "definition-approval", passed: input.definitionApprovalPassed === true },
    { id: "geography-consistency", passed: observations.every((observation) => observation.geographyId === input.geographyId) },
  ];
  const core = { schemaVersion: COUNTY_DEMAND_POINT_IN_TIME_VECTOR_VERSION, countyId: required(input.countyId, "countyId"), geographyId: required(input.geographyId, "geographyId"), asOf, observationSha256s: observations.map((item) => digest(item.observationSha256, "observationSha256")).sort(), metricIds: observations.map((item) => item.metricId).sort(), futureObservationCount: future.length, checks };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "rejected" }, "vectorSha256");
}

export function createCountyDemandAudit(input = {}) {
  const counts = Object.fromEntries(["sourceRows", "parsedRows", "aggregateRows", "detailRows", "invalidRows", "duplicateRows", "observationCount", "featureCount"].map((field) => [field, integer(input.counts?.[field], `counts.${field}`)]));
  const checks = [
    { id: "parse-partition", passed: counts.sourceRows === counts.parsedRows + counts.invalidRows },
    { id: "row-partition", passed: counts.parsedRows === counts.aggregateRows + counts.detailRows + counts.duplicateRows },
    { id: "observation-lineage", passed: input.observationLineageCertified === true },
    { id: "temporal-alignment", passed: input.temporalAlignmentCertified === true },
    { id: "coverage", passed: input.coverageCertified === true },
    { id: "no-parcel-overclaim", passed: input.parcelOverclaimCount === 0 },
  ];
  const core = { schemaVersion: COUNTY_DEMAND_AUDIT_VERSION, countyId: required(input.countyId, "countyId"), geographyId: required(input.geographyId, "geographyId"), counts, parcelOverclaimCount: integer(input.parcelOverclaimCount ?? 0, "parcelOverclaimCount"), checks, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt") };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "rejected" }, "auditSha256");
}
