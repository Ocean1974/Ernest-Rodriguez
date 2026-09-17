import { createHash } from "node:crypto";

export const COUNTY_LAYER_SOURCE_EVIDENCE_VERSION = "wr-county-layer-source-evidence-v1";
export const COUNTY_JURISDICTION_UNIVERSE_VERSION = "wr-county-jurisdiction-universe-v1";
export const COUNTY_LAYER_COVERAGE_PLAN_VERSION = "wr-county-layer-coverage-plan-v1";
export const COUNTY_LAYER_COVERAGE_REPORT_VERSION = "wr-county-layer-coverage-report-v1";

const LAYERS = new Set(["zoning", "permits", "floodplain", "development", "demand"]);
const SCOPES = new Set(["countywide", "municipality", "unincorporated", "etj"]);
const JOIN_METHODS = new Set(["source-parcel-key", "normalized-address", "point-in-polygon", "parcel-intersection", "county-boundary-clip"]);

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function sha(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

function https(value, name) {
  const url = required(value, name);
  if (!url.startsWith("https://")) throw new TypeError(`${name} must use HTTPS`);
  return url;
}

function seal(core, field) { return Object.freeze({ ...core, [field]: sha(core) }); }

export function createCountyLayerSourceEvidence(input = {}) {
  const layer = required(input.layer, "layer");
  const coverageScope = required(input.coverageScope, "coverageScope");
  if (!LAYERS.has(layer)) throw new TypeError(`Unsupported layer: ${layer}`);
  if (!SCOPES.has(coverageScope)) throw new TypeError(`Unsupported coverageScope: ${coverageScope}`);
  const jurisdictionIds = [...new Set((input.jurisdictionIds || []).map(String).filter(Boolean))].sort();
  if (coverageScope !== "countywide" && jurisdictionIds.length === 0) throw new TypeError("Non-countywide evidence requires jurisdictionIds");
  const rights = [...new Set((input.rights || []).map(String).filter(Boolean))].sort();
  const captureAuthorized = ["store", "derive", "query"].every((right) => rights.includes(right)) && Boolean(input.rightsEvidenceRef);
  const core = {
    schemaVersion: COUNTY_LAYER_SOURCE_EVIDENCE_VERSION,
    sourceId: required(input.sourceId, "sourceId"),
    publisher: required(input.publisher, "publisher"),
    officialPageUrl: https(input.officialPageUrl, "officialPageUrl"),
    machineEndpointUrl: https(input.machineEndpointUrl, "machineEndpointUrl"),
    layer,
    coverageScope,
    jurisdictionIds,
    sourceSpatialReference: required(input.sourceSpatialReference, "sourceSpatialReference"),
    joinMethods: [...new Set((input.joinMethods || []).map(String).filter(Boolean))].sort(),
    metadataObservedAt: new Date(input.metadataObservedAt).toISOString(),
    metadataFacts: Object.freeze({ ...(input.metadataFacts || {}) }),
    rights,
    rightsEvidenceRef: String(input.rightsEvidenceRef || ""),
    captureAuthorized,
    status: captureAuthorized ? "capture-authorized" : "discovery-only",
  };
  if (!core.joinMethods.length || core.joinMethods.some((method) => !JOIN_METHODS.has(method))) throw new TypeError("joinMethods must use supported methods");
  return seal(core, "evidenceSha256");
}

export function createCountyJurisdictionUniverse(input = {}) {
  const jurisdictions = (input.jurisdictions || []).map((item, index) => Object.freeze({
    id: required(item.id, `jurisdictions[${index}].id`),
    name: required(item.name, `jurisdictions[${index}].name`),
    type: required(item.type, `jurisdictions[${index}].type`),
  }));
  const ids = jurisdictions.map((item) => item.id);
  if (!jurisdictions.length || new Set(ids).size !== ids.length) throw new TypeError("Jurisdiction IDs must be non-empty and unique");
  const core = {
    schemaVersion: COUNTY_JURISDICTION_UNIVERSE_VERSION,
    countyId: required(input.countyId, "countyId"),
    countyFips: required(input.countyFips, "countyFips"),
    sourceUrl: https(input.sourceUrl, "sourceUrl"),
    sourceObservedAt: new Date(input.sourceObservedAt).toISOString(),
    jurisdictions,
  };
  if (!/^\d{5}$/.test(core.countyFips)) throw new TypeError("countyFips must contain five digits");
  return seal(core, "universeSha256");
}

export function createCountyLayerCoveragePlan({ universe, layer, evidence = [], boundaryEvidenceRef = "", boundaryEvidenceSha256 = "" } = {}) {
  if (universe?.schemaVersion !== COUNTY_JURISDICTION_UNIVERSE_VERSION) throw new TypeError("A jurisdiction universe is required");
  if (!LAYERS.has(layer)) throw new TypeError(`Unsupported layer: ${layer}`);
  const universeIds = universe.jurisdictions.map((item) => item.id);
  const known = new Set(universeIds);
  const authorized = evidence.filter((item) => item?.layer === layer && item.captureAuthorized === true);
  const covered = new Set();
  const conflicts = [];
  for (const source of authorized) {
    const claimed = source.coverageScope === "countywide" ? universeIds : source.jurisdictionIds;
    for (const id of claimed) {
      if (!known.has(id)) conflicts.push({ sourceId: source.sourceId, jurisdictionId: id, reason: "outside-universe" });
      else if (covered.has(id)) conflicts.push({ sourceId: source.sourceId, jurisdictionId: id, reason: "overlapping-authorized-claim" });
      else covered.add(id);
    }
  }
  const boundaryReady = Boolean(boundaryEvidenceRef) && /^[a-f0-9]{64}$/.test(String(boundaryEvidenceSha256));
  const coveredJurisdictionIds = [...covered].sort();
  const uncoveredJurisdictionIds = universeIds.filter((id) => !covered.has(id)).sort();
  const checks = [
    { id: "source-evidence", passed: evidence.length > 0 },
    { id: "capture-authorization", passed: authorized.length > 0 },
    { id: "jurisdiction-boundaries", passed: boundaryReady },
    { id: "claim-conflicts", passed: conflicts.length === 0 },
    { id: "complete-coverage", passed: uncoveredJurisdictionIds.length === 0 },
  ];
  const core = {
    schemaVersion: COUNTY_LAYER_COVERAGE_PLAN_VERSION,
    countyId: universe.countyId,
    countyFips: universe.countyFips,
    universeSha256: universe.universeSha256,
    layer,
    evidenceSha256s: evidence.map((item) => item.evidenceSha256).filter(Boolean).sort(),
    boundaryEvidenceRef: String(boundaryEvidenceRef || ""),
    boundaryEvidenceSha256: String(boundaryEvidenceSha256 || ""),
    coveredJurisdictionIds,
    uncoveredJurisdictionIds,
    conflicts,
    checks,
    status: checks.every((check) => check.passed) ? "certified" : "blocked",
  };
  return seal(core, "planSha256");
}

export function createCountyLayerCoverageReport({ universe, plans = [], generatedAt } = {}) {
  const layerPlans = Object.fromEntries(plans.map((plan) => [plan.layer, plan]));
  const requiredLayers = ["zoning", "permits", "floodplain", "development", "demand"];
  const complete = requiredLayers.every((layer) => layerPlans[layer]?.status === "certified");
  const core = {
    schemaVersion: COUNTY_LAYER_COVERAGE_REPORT_VERSION,
    countyId: universe.countyId,
    universeSha256: universe.universeSha256,
    jurisdictionCount: universe.jurisdictions.length,
    plans: requiredLayers.map((layer) => layerPlans[layer] || null),
    complete,
    activationAuthorized: false,
    generatedAt: new Date(generatedAt).toISOString(),
  };
  return seal(core, "reportSha256");
}
