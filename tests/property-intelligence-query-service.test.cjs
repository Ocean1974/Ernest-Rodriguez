const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { planParcelQuery } = await import("../src/search/parcelQueryPlanner.mjs");
  const { createInMemoryCandidateAdapter } = await import("../src/search/parcelCandidateRetriever.mjs");
  const serviceModule = await import("../src/search/propertyIntelligenceQueryService.mjs");
  const organizationId = "org-white-rabbit";
  const county = "dallas-county-dcad";
  const parcels = ["A1", "A2", "A3"].map((accountNum) => ({ whiteRabbitPropertyId: `wrp:v1:${county}:${accountNum}`, sourceCountyId: county, accountNum, landAreaSize: 10, landAreaUnit: "ACRE" }));
  const candidateAdapter = createInMemoryCandidateAdapter({ parcels, sourceEvidence: [{ sourceCountyId: county, datasetId: "dcad-parcels", sourceVersion: "2026.08.14", sourceUpdatedAt: "2026-08-14", freshnessStatus: "current" }] });
  const calls = [];
  const telemetryEvents = [];
  const graphService = {
    async queryProperty(id, options) {
      calls.push({ id, options });
      if (id.endsWith(":A2")) { const error = new Error("synthetic graph shard outage"); error.code = "WR_GRAPH_SHARD_UNAVAILABLE"; throw error; }
      return { schemaVersion: "wr-property-graph-query-result-v1", nodes: [{ id, nodeType: "property" }], edges: [], ledger: { truncated: false } };
    },
  };
  const clockValues = ["2026-08-14T14:00:00.000Z", "2026-08-14T14:00:00.010Z"];
  const service = serviceModule.createPropertyIntelligenceQueryService({ candidateAdapter, graphService, clock: () => clockValues.shift() || "2026-08-14T14:00:00.010Z", graphConcurrency: 2, telemetrySink: (event) => telemetryEvents.push(event) });
  const request = {
    requestId: "query-1",
    organizationId,
    plan: planParcelQuery("parcels over 5 acres"),
    countyIds: [county],
    asOf: "2026-08-14T14:00:00.000Z",
    candidateBudgets: { pageSize: 3 },
    graph: { enabled: true, maxHydrations: 2, maxDepth: 2, maxNodes: 100 },
  };
  const response = await service.execute(request, { context: { organizationId } });
  assert.equal(response.schemaVersion, "wr-property-intelligence-query-response-v1");
  assert.equal(response.status, "partial");
  assert.equal(response.candidates.results.length, 3);
  assert.equal(response.graph.attempted, 2);
  assert.equal(response.graph.completed, 1);
  assert.equal(response.graph.failed, 1);
  assert.equal(response.graph.errors[0].code, "WR_GRAPH_SHARD_UNAVAILABLE");
  assert.equal(response.executionEvidence.graphHydrationLimited, true);
  assert.equal(response.executionEvidence.visibleUiActivated, false);
  assert.equal(calls.length, 2);
  assert(calls.every((call) => call.options.maxDepth === 2 && call.options.maxNodes === 100));
  assert.equal(telemetryEvents[0].schemaVersion, "wr-service-telemetry-event-v1");
  assert.equal(telemetryEvents[0].status, "partial");
  assert.equal(telemetryEvents[0].attributes.requestClass, "candidate-plus-graph");

  const noGraph = await service.execute({ ...request, requestId: "query-2", graph: { enabled: false } }, { context: { organizationId } });
  assert.equal(noGraph.status, "complete");
  assert.equal(noGraph.graph.status, "not-requested");
  assert.equal(noGraph.graph.attempted, 0);
  assert.equal(telemetryEvents[1].status, "success");
  await assert.rejects(() => service.execute(request, { context: { organizationId: "org-other" } }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  const bounded = serviceModule.createPropertyIntelligenceQueryRequest({ ...request, graph: { enabled: true, maxHydrations: 999, maxDepth: 99, maxNodes: 9999 } });
  assert.equal(bounded.graph.maxHydrations, 25);
  assert.equal(bounded.graph.maxDepth, 3);
  assert.equal(bounded.graph.maxNodes, 500);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "property-intelligence-query.schema.json"), "utf8"));
  assert.equal(schema.oneOf[0].properties.schemaVersion.const, "wr-property-intelligence-query-request-v1");
  assert.equal(schema.oneOf[1].properties.schemaVersion.const, "wr-property-intelligence-query-response-v1");
  console.log("White Rabbit tenant-scoped, bounded property intelligence query service tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
