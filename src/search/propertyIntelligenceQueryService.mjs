import { retrieveParcelCandidates } from "./parcelCandidateRetriever.mjs";
import { createServiceTelemetryEvent } from "../operations/serviceObservability.mjs";

export const PROPERTY_INTELLIGENCE_QUERY_REQUEST_VERSION = "wr-property-intelligence-query-request-v1";
export const PROPERTY_INTELLIGENCE_QUERY_RESPONSE_VERSION = "wr-property-intelligence-query-response-v1";
export const PROPERTY_INTELLIGENCE_QUERY_SERVICE_VERSION = "wr-property-intelligence-query-service-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function createPropertyIntelligenceQueryRequest(input = {}) {
  if (input.plan?.schemaVersion !== "wr-parcel-query-plan-v1") throw new TypeError("request.plan must be a wr-parcel-query-plan-v1");
  const graph = {
    enabled: input.graph?.enabled === true,
    maxHydrations: boundedInteger(input.graph?.maxHydrations, 10, 0, 25),
    maxDepth: boundedInteger(input.graph?.maxDepth, 1, 0, 3),
    maxNodes: boundedInteger(input.graph?.maxNodes, 100, 1, 500),
    pageSize: boundedInteger(input.graph?.pageSize, 250, 1, 1000),
    maxEventsPerProperty: boundedInteger(input.graph?.maxEventsPerProperty, 2500, 1, 5000),
  };
  return Object.freeze({
    schemaVersion: PROPERTY_INTELLIGENCE_QUERY_REQUEST_VERSION,
    requestId: required(input.requestId, "requestId"),
    organizationId: required(input.organizationId, "organizationId"),
    plan: structuredClone(input.plan),
    countyIds: [...new Set((input.countyIds || []).map(String).filter(Boolean))],
    bounds: input.bounds || null,
    cursor: String(input.cursor || ""),
    candidateBudgets: structuredClone(input.candidateBudgets || {}),
    candidatePolicies: structuredClone(input.candidatePolicies || {}),
    graph,
    asOf: new Date(input.asOf).toISOString(),
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function propertyId(result) { return String(result?.parcel?.whiteRabbitPropertyId || ""); }

export function createPropertyIntelligenceQueryService({ candidateAdapter, graphService = null, clock = () => new Date().toISOString(), graphConcurrency = 4, telemetrySink = null } = {}) {
  if (!candidateAdapter?.fetchCandidatePage) throw new TypeError("candidateAdapter.fetchCandidatePage is required");
  return Object.freeze({
    schemaVersion: PROPERTY_INTELLIGENCE_QUERY_SERVICE_VERSION,
    async execute(input = {}, execution = {}) {
      const request = createPropertyIntelligenceQueryRequest(input);
      const context = execution.context;
      if (!context?.organizationId || context.organizationId !== request.organizationId) {
        const error = new Error(`Query tenant ${request.organizationId} does not match authenticated tenant ${context?.organizationId || "<missing>"}`);
        error.code = "WR_TENANT_ISOLATION_VIOLATION";
        throw error;
      }
      if (request.graph.enabled && !graphService?.queryProperty) throw new TypeError("graphService.queryProperty is required when graph hydration is enabled");
      const startedAt = clock();
      const candidates = await retrieveParcelCandidates({
        plan: request.plan,
        adapter: candidateAdapter,
        countyIds: request.countyIds,
        bounds: request.bounds,
        context: execution.evaluationContext || {},
        cursor: request.cursor,
        budgets: request.candidateBudgets,
        policies: request.candidatePolicies,
        signal: execution.signal || null,
      });
      const hydrationTargets = request.graph.enabled ? candidates.results.slice(0, request.graph.maxHydrations) : [];
      const graphErrors = [];
      const neighborhoods = await mapWithConcurrency(hydrationTargets, boundedInteger(graphConcurrency, 4, 1, 8), async (candidate) => {
        const id = propertyId(candidate);
        try {
          const result = await graphService.queryProperty(id, { at: request.asOf, maxDepth: request.graph.maxDepth, maxNodes: request.graph.maxNodes, pageSize: request.graph.pageSize, limit: request.graph.maxEventsPerProperty, signal: execution.signal || null, validation: execution.validation || {} });
          return { whiteRabbitPropertyId: id, status: result.ledger?.truncated ? "truncated" : "complete", result };
        } catch (error) {
          graphErrors.push({ whiteRabbitPropertyId: id, code: String(error.code || "WR_GRAPH_QUERY_ERROR"), message: String(error.message || error) });
          return { whiteRabbitPropertyId: id, status: "error", result: null };
        }
      });
      const graphTruncated = neighborhoods.filter((item) => item.status === "truncated").length;
      const graphStatus = !request.graph.enabled ? "not-requested" : graphErrors.length || graphTruncated ? "partial" : "complete";
      const candidatePartial = !["complete"].includes(candidates.status);
      const response = {
        schemaVersion: PROPERTY_INTELLIGENCE_QUERY_RESPONSE_VERSION,
        requestId: request.requestId,
        organizationId: request.organizationId,
        status: candidatePartial || graphStatus === "partial" ? "partial" : "complete",
        generatedAt: clock(),
        startedAt,
        asOf: request.asOf,
        candidates,
        graph: { status: graphStatus, requested: request.graph.enabled, attempted: hydrationTargets.length, completed: neighborhoods.filter((item) => item.status === "complete").length, truncated: graphTruncated, failed: graphErrors.length, neighborhoods, errors: graphErrors },
        executionEvidence: {
          candidateSourceCount: candidates.sourceEvidence?.length || 0,
          candidateResultCount: candidates.results?.length || 0,
          graphHydrationLimited: request.graph.enabled && candidates.results.length > hydrationTargets.length,
          graphConcurrency: boundedInteger(graphConcurrency, 4, 1, 8),
          visibleUiActivated: false,
        },
      };
      if (telemetrySink) {
        const sourceLags = (candidates.sourceEvidence || []).map((source) => new Date(request.asOf).getTime() - new Date(source.sourceUpdatedAt || request.asOf).getTime()).filter(Number.isFinite).map((value) => Math.max(0, value));
        const event = createServiceTelemetryEvent({
          organizationId: request.organizationId,
          serviceName: "property-intelligence-query",
          operation: "execute",
          traceId: String(execution.traceId || request.requestId),
          spanId: `query:${request.requestId}`,
          startedAt,
          endedAt: response.generatedAt,
          status: response.status === "complete" ? "success" : "partial",
          errorCode: response.status === "complete" ? "" : "WR_QUERY_PARTIAL",
          measurements: { records: candidates.results.length, sourceLagMs: sourceLags.length ? Math.max(...sourceLags) : null, saturationPct: request.graph.maxHydrations ? hydrationTargets.length / request.graph.maxHydrations * 100 : 0, cacheHit: false },
          attributes: { requestClass: request.graph.enabled ? "candidate-plus-graph" : "candidate-only" },
        });
        try { typeof telemetrySink === "function" ? telemetrySink(event) : telemetrySink.record(event); } catch {}
      }
      return response;
    },
  });
}
