import { planParcelQuery } from "./parcelQueryPlanner.mjs";
import { createPropertyIntelligenceQueryService } from "./propertyIntelligenceQueryService.mjs";

export const COUNTY_ARTIFACT_QUERY_RUNTIME_VERSION = "wr-county-artifact-query-runtime-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function denied(code, message) { const value = new Error(message); value.code = code; return value; }

export function createCountyArtifactQueryRuntime({
  candidateAdapter,
  allowedCountyIds = [],
  releaseDecision = null,
  verifyReleaseDecision = null,
  graphService = null,
  clock = () => new Date().toISOString(),
  telemetrySink = null,
} = {}) {
  if (!candidateAdapter?.fetchCandidatePage) throw new TypeError("candidateAdapter.fetchCandidatePage is required");
  const counties = new Set(allowedCountyIds.map(String).filter(Boolean));
  if (!counties.size) throw new TypeError("At least one allowedCountyId is required");
  let releaseVerification = { valid: false, activationAuthorized: false };
  if (releaseDecision && typeof verifyReleaseDecision === "function") {
    try { releaseVerification = verifyReleaseDecision(releaseDecision) || releaseVerification; } catch {}
  }
  const activationAuthorized = releaseDecision?.schemaVersion === "wr-capability-release-decision-v1"
    && releaseDecision?.capabilityId === "explainable-ai-acquisition-analyst"
    && releaseDecision?.activationAuthorized === true
    && releaseVerification.valid === true
    && releaseVerification.activationAuthorized === true;
  const service = createPropertyIntelligenceQueryService({ candidateAdapter, graphService, clock, telemetrySink });
  return Object.freeze({
    schemaVersion: COUNTY_ARTIFACT_QUERY_RUNTIME_VERSION,
    activationAuthorized,
    async execute(input = {}, execution = {}) {
      if (!activationAuthorized) throw denied("WR_QUERY_RUNTIME_INACTIVE", "County artifact query runtime is not release-authorized");
      const principal = execution.principal;
      const organizationId = required(principal?.organizationId, "principal.organizationId");
      required(principal?.subject, "principal.subject");
      if (!new Set(principal?.permissions || []).has("property-intelligence:query")) throw denied("WR_QUERY_PERMISSION_DENIED", "Principal lacks property-intelligence:query permission");
      if (input.organizationId && String(input.organizationId) !== organizationId) throw denied("WR_TENANT_ISOLATION_VIOLATION", "Request tenant does not match authenticated tenant");
      const countyIds = [...new Set((input.countyIds || []).map(String).filter(Boolean))];
      if (countyIds.length !== 1 || !counties.has(countyIds[0])) throw denied("WR_QUERY_COUNTY_NOT_ALLOWED", "Exactly one release-authorized county is required");
      const rawQuery = required(input.rawQuery, "rawQuery");
      if (rawQuery.length > 500) throw denied("WR_QUERY_TOO_LONG", "rawQuery exceeds 500 characters");
      const asOf = new Date(input.asOf || clock()).toISOString();
      return service.execute({
        requestId: required(input.requestId, "requestId"),
        organizationId,
        plan: planParcelQuery(rawQuery),
        countyIds,
        bounds: input.bounds || null,
        cursor: String(input.cursor || ""),
        candidateBudgets: input.candidateBudgets || {},
        candidatePolicies: { ...(input.candidatePolicies || {}), staleSource: "reject", unknownSource: "reject" },
        graph: input.graph || { enabled: false },
        asOf,
      }, { context: { organizationId }, evaluationContext: execution.evaluationContext || {}, signal: execution.signal || null, traceId: execution.traceId || input.requestId, validation: execution.validation || {} });
    },
  });
}
