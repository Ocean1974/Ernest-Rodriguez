import { createHash } from "node:crypto";

export const COUNTY_DEVELOPMENT_FEED_BINDING_VERSION = "wr-county-development-feed-binding-v1";
export const COUNTY_DEVELOPMENT_COVERAGE_VERSION = "wr-county-development-coverage-v1";
export const COUNTY_DEVELOPMENT_CLASSIFICATION_RULE_VERSION = "wr-county-development-classification-rule-v1";
export const NORMALIZED_COUNTY_DEVELOPMENT_EVENT_VERSION = "wr-normalized-county-development-event-v1";
export const COUNTY_DEVELOPMENT_SIGNAL_AUDIT_VERSION = "wr-county-development-signal-audit-v1";
export const COUNTY_DEVELOPMENT_INDEX_MANIFEST_VERSION = "wr-county-development-index-manifest-v1";

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
export function countyDevelopmentSha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function seal(core, field) { return Object.freeze({ ...core, [field]: countyDevelopmentSha256(core) }); }
function required(value, name) { const text = String(value || "").trim(); if (!text) throw new TypeError(`${name} is required`); return text; }
function digest(value, name) { const text = required(value, name); if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${name} must be a SHA-256 digest`); return text; }
function integer(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`); return number; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
const FEED_ROLES = new Set(["permit-event", "zoning-case", "plat-case", "demolition-event", "occupancy-event", "capital-project"]);
const STAGES = new Set(["intent", "entitlement", "approved", "site-prep", "construction", "completion", "withdrawn", "unknown"]);
const LINK_STATUSES = new Set(["direct", "address-spatial", "spatial", "unmatched", "ambiguous", "conflict"]);
const OPERATORS = new Set(["equals", "in", "contains", "matches", "exists", "gte", "lte"]);

export function createCountyDevelopmentFeedBinding(input = {}) {
  const feedRole = required(input.feedRole, "feedRole");
  if (!FEED_ROLES.has(feedRole)) throw new TypeError(`Unsupported development feed role: ${feedRole}`);
  const candidateRecordCount = integer(input.candidateRecordCount, "candidateRecordCount");
  const jurisdictionIds = [...new Set((input.jurisdictionIds || []).map(String).filter(Boolean))].sort();
  if (!jurisdictionIds.length) throw new TypeError("jurisdictionIds must not be empty");
  const checks = [
    { id: "upstream-capture", passed: input.upstreamCaptureCertified === true },
    { id: "upstream-normalization", passed: input.upstreamNormalizationCertified === true },
    { id: "jurisdiction-boundary", passed: input.jurisdictionBoundaryCertified === true },
    { id: "reuse-rights", passed: input.reuseRightsCertified === true },
  ];
  const core = {
    schemaVersion: COUNTY_DEVELOPMENT_FEED_BINDING_VERSION,
    countyId: required(input.countyId, "countyId"),
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    feedRole,
    jurisdictionIds,
    temporalCoverage: required(input.temporalCoverage, "temporalCoverage"),
    upstreamContractVersion: required(input.upstreamContractVersion, "upstreamContractVersion"),
    upstreamProbeSha256: digest(input.upstreamProbeSha256, "upstreamProbeSha256"),
    candidateRecordCount,
    candidateRecordsAreSignals: false,
    checks,
    capturedRecordCount: 0,
    emittedSignalCount: 0,
  };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "feed-certified" : "candidate-only" }, "bindingSha256");
}

export function reconcileCountyDevelopmentCoverage(input = {}) {
  const universe = [...new Set((input.jurisdictionUniverseIds || []).map(String).filter(Boolean))].sort();
  if (!universe.length) throw new TypeError("jurisdictionUniverseIds must not be empty");
  const known = new Set(universe);
  const bindings = input.bindings || [];
  const discovered = [...new Set(bindings.flatMap((binding) => binding.jurisdictionIds || []).filter((id) => known.has(id)))].sort();
  const certified = [...new Set(bindings.filter((binding) => binding.status === "feed-certified").flatMap((binding) => binding.jurisdictionIds).filter((id) => known.has(id)))].sort();
  const core = {
    schemaVersion: COUNTY_DEVELOPMENT_COVERAGE_VERSION,
    countyId: required(input.countyId, "countyId"),
    jurisdictionUniverseIds: universe,
    bindingSha256s: bindings.map((binding) => binding.bindingSha256).filter(Boolean).sort(),
    discoveredJurisdictionIds: discovered,
    certifiedJurisdictionIds: certified,
    uncoveredOrUncertifiedJurisdictionIds: universe.filter((id) => !certified.includes(id)),
    candidateRecordCount: bindings.reduce((sum, binding) => sum + integer(binding.candidateRecordCount, "binding.candidateRecordCount"), 0),
    emittedSignalCount: 0,
    rules: ["candidate-record-never-equals-signal", "permit-never-proves-project-without-explicit-classification", "zoning-case-never-proves-construction", "rolling-window-never-labeled-full-history", "municipal-feed-never-labeled-countywide"],
  };
  return seal({ ...core, status: core.uncoveredOrUncertifiedJurisdictionIds.length ? "blocked" : "certified" }, "coverageSha256");
}

export function createCountyDevelopmentClassificationRule(input = {}) {
  const feedRole = required(input.feedRole, "feedRole");
  if (!FEED_ROLES.has(feedRole)) throw new TypeError(`Unsupported development feed role: ${feedRole}`);
  const lifecycleStage = required(input.lifecycleStage, "lifecycleStage");
  if (!STAGES.has(lifecycleStage)) throw new TypeError(`Unsupported lifecycleStage: ${lifecycleStage}`);
  const conditions = (input.conditions || []).map((condition, index) => {
    const operator = required(condition.operator, `conditions[${index}].operator`);
    if (!OPERATORS.has(operator)) throw new TypeError(`Unsupported condition operator: ${operator}`);
    return Object.freeze({ field: required(condition.field, `conditions[${index}].field`), operator, value: condition.value ?? null });
  });
  if (!conditions.length) throw new TypeError("At least one explicit classification condition is required");
  const exclusions = (input.exclusions || []).map((condition, index) => Object.freeze({ field: required(condition.field, `exclusions[${index}].field`), operator: OPERATORS.has(condition.operator) ? condition.operator : (() => { throw new TypeError(`Unsupported condition operator: ${condition.operator}`); })(), value: condition.value ?? null }));
  const core = {
    schemaVersion: COUNTY_DEVELOPMENT_CLASSIFICATION_RULE_VERSION,
    ruleId: required(input.ruleId, "ruleId"),
    ruleVersion: required(input.ruleVersion, "ruleVersion"),
    feedRole,
    signalType: required(input.signalType, "signalType"),
    lifecycleStage,
    conditions,
    exclusions,
    officialDefinitionRef: required(input.officialDefinitionRef, "officialDefinitionRef"),
    approvedByRefs: [...new Set((input.approvedByRefs || []).map(String).filter(Boolean))].sort(),
    modelGenerated: false,
  };
  return seal({ ...core, status: core.approvedByRefs.length >= 2 ? "approved" : "draft" }, "ruleSha256");
}

export function createNormalizedCountyDevelopmentEvent(input = {}) {
  const lifecycleStage = required(input.lifecycleStage, "lifecycleStage");
  if (!STAGES.has(lifecycleStage)) throw new TypeError(`Unsupported lifecycleStage: ${lifecycleStage}`);
  const parcelLinkStatus = required(input.parcelLinkStatus, "parcelLinkStatus");
  if (!LINK_STATUSES.has(parcelLinkStatus)) throw new TypeError(`Unsupported parcelLinkStatus: ${parcelLinkStatus}`);
  const countyParcelId = String(input.countyParcelId || "");
  if (["direct", "address-spatial", "spatial"].includes(parcelLinkStatus) && !countyParcelId) throw new TypeError("Linked events require countyParcelId");
  if (!["direct", "address-spatial", "spatial"].includes(parcelLinkStatus) && countyParcelId) throw new TypeError("Unresolved links cannot carry countyParcelId");
  const certificationChecks = [
    { id: "source-snapshot", passed: input.sourceSnapshotCertified === true },
    { id: "normalization", passed: input.normalizationCertified === true },
    { id: "classification-rule", passed: input.classificationRuleApproved === true },
    { id: "parcel-link", passed: ["direct", "address-spatial", "spatial"].includes(parcelLinkStatus) && input.parcelLinkCertified === true },
  ];
  const core = {
    schemaVersion: NORMALIZED_COUNTY_DEVELOPMENT_EVENT_VERSION,
    countyId: required(input.countyId, "countyId"),
    jurisdictionId: required(input.jurisdictionId, "jurisdictionId"),
    sourceId: required(input.sourceId, "sourceId"),
    sourceRecordId: required(input.sourceRecordId, "sourceRecordId"),
    sourceSnapshotSha256: digest(input.sourceSnapshotSha256, "sourceSnapshotSha256"),
    sourceRecordSha256: digest(input.sourceRecordSha256, "sourceRecordSha256"),
    classificationRuleSha256: digest(input.classificationRuleSha256, "classificationRuleSha256"),
    signalType: required(input.signalType, "signalType"),
    lifecycleStage,
    occurredAt: iso(input.occurredAt, "occurredAt"),
    projectKey: String(input.projectKey || ""),
    parcelLinkStatus,
    countyParcelId,
    certificationChecks,
    evidenceRefs: [...new Set((input.evidenceRefs || []).map(String).filter(Boolean))].sort(),
  };
  const eligibleAsSignal = certificationChecks.every((check) => check.passed) && core.evidenceRefs.length > 0;
  if (input.activate === true && !eligibleAsSignal) throw new TypeError("Uncertified development events cannot be activated as signals");
  return seal({ ...core, eligibleAsSignal, status: eligibleAsSignal ? "certified-signal" : "evidence-incomplete" }, "eventSha256");
}

export function createCountyDevelopmentSignalAudit(input = {}) {
  const names = ["candidateRecords", "normalizedEvents", "ineligibleRecords", "duplicateRecords", "invalidRecords", "linkedEvents", "unmatchedEvents", "ambiguousEvents", "conflictEvents", "emittedSignals", "suppressedLinkedEvents"];
  const counts = Object.fromEntries(names.map((name) => [name, integer(input.counts?.[name], `counts.${name}`)]));
  const checks = [
    { id: "candidate-partition", passed: counts.candidateRecords === counts.normalizedEvents + counts.ineligibleRecords + counts.duplicateRecords + counts.invalidRecords },
    { id: "link-partition", passed: counts.normalizedEvents === counts.linkedEvents + counts.unmatchedEvents + counts.ambiguousEvents + counts.conflictEvents },
    { id: "signal-partition", passed: counts.linkedEvents === counts.emittedSignals + counts.suppressedLinkedEvents },
    { id: "source-capture", passed: input.sourceCaptureCertified === true },
    { id: "classification-rules", passed: input.classificationRulesCertified === true },
    { id: "parcel-links", passed: input.parcelLinksCertified === true },
    { id: "lineage", passed: input.lineageCertified === true },
  ];
  const core = { schemaVersion: COUNTY_DEVELOPMENT_SIGNAL_AUDIT_VERSION, countyId: required(input.countyId, "countyId"), jurisdictionId: required(input.jurisdictionId, "jurisdictionId"), counts, checks, evaluatedAt: iso(input.evaluatedAt, "evaluatedAt") };
  return seal({ ...core, status: checks.every((check) => check.passed) ? "certified" : "rejected" }, "auditSha256");
}

export function createCountyDevelopmentIndexManifest(input = {}) {
  const activationChecks = [
    { id: "signal-audit", passed: input.signalAuditCertified === true },
    { id: "parcel-manifest", passed: /^[a-f0-9]{64}$/.test(String(input.parcelManifestSha256 || "")) },
    { id: "event-lineage", passed: input.eventLineageCertified === true },
    { id: "coverage", passed: input.coverageCertified === true },
    { id: "independent-approvals", passed: [...new Set(input.approvalRefs || [])].length >= 2 },
  ];
  const core = {
    schemaVersion: COUNTY_DEVELOPMENT_INDEX_MANIFEST_VERSION,
    countyId: required(input.countyId, "countyId"),
    parcelManifestSha256: String(input.parcelManifestSha256 || ""),
    signalAuditSha256: digest(input.signalAuditSha256, "signalAuditSha256"),
    parcelCount: integer(input.parcelCount, "parcelCount"),
    signalCount: integer(input.signalCount, "signalCount"),
    approvalRefs: [...new Set((input.approvalRefs || []).map(String).filter(Boolean))].sort(),
    activationChecks,
  };
  const activationAuthorized = activationChecks.every((check) => check.passed);
  return seal({ ...core, activationAuthorized, status: activationAuthorized ? "activation-authorized" : "blocked" }, "manifestSha256");
}
