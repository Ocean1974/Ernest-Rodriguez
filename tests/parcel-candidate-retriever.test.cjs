const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { planParcelQuery } = await import("../src/search/parcelQueryPlanner.mjs");
  const retrieval = await import("../src/search/parcelCandidateRetriever.mjs");
  const plan = planParcelQuery("parcels over 5 acres");
  const county = "dallas-county-dcad";
  const parcels = ["A3", "A1", "A2"].map((accountNum) => ({ whiteRabbitPropertyId: `wrp:v1:${county}:${accountNum}`, sourceCountyId: county, accountNum, landAreaSize: 10, landAreaUnit: "ACRE" }));
  const sourceV1 = [{ sourceCountyId: county, datasetId: "dcad-parcels", sourceVersion: "2026.08.01", sourceUpdatedAt: "2026-08-01", freshnessStatus: "current" }];
  const adapter = retrieval.createInMemoryCandidateAdapter({ parcels, sourceEvidence: sourceV1 });
  const first = await retrieval.retrieveParcelCandidates({ plan, adapter, countyIds: [county], budgets: { pageSize: 2 }, policies: { staleSource: "warn" } });
  assert.equal(first.schemaVersion, "wr-production-parcel-query-result-v1");
  assert.equal(first.status, "complete");
  assert.deepEqual(first.results.map((item) => item.parcel.accountNum), ["A1", "A2"], "equal ranks must use stable canonical-ID ordering");
  assert(first.results.every((item) => item.ranking.rule && item.ranking.components.filters > 0));
  assert(first.nextCursor.startsWith("wrc:v1:"));
  const second = await retrieval.retrieveParcelCandidates({ plan, adapter, countyIds: [county], cursor: first.nextCursor, budgets: { pageSize: 2 } });
  assert.deepEqual(second.results.map((item) => item.parcel.accountNum), ["A3"]);
  assert.equal(second.nextCursor, "");

  const otherPlan = planParcelQuery("parcels over 8 acres");
  const invalidCursor = await retrieval.retrieveParcelCandidates({ plan: otherPlan, adapter, cursor: first.nextCursor });
  assert.equal(invalidCursor.status, "invalid-cursor");
  const sourceV2 = sourceV1.map((item) => ({ ...item, sourceVersion: "2026.08.13" }));
  const staleCursor = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels, sourceEvidence: sourceV2 }), cursor: first.nextCursor });
  assert.equal(staleCursor.status, "stale-cursor");

  const staleSource = sourceV1.map((item) => ({ ...item, freshnessStatus: "stale" }));
  const rejected = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels, sourceEvidence: staleSource }), policies: { staleSource: "reject" } });
  assert.equal(rejected.status, "stale-source-rejected");
  assert.equal(rejected.results.length, 0);
  const unknownRejected = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels, sourceEvidence: sourceV1.map((item) => ({ ...item, freshnessStatus: "unknown" })) }), policies: { unknownSource: "reject" } });
  assert.equal(unknownRejected.status, "unknown-source-rejected");
  assert.equal(unknownRejected.results.length, 0);

  const many = Array.from({ length: 30 }, (_, index) => ({ whiteRabbitPropertyId: `wrp:v1:${county}:P${String(index).padStart(2, "0")}`, sourceCountyId: county, landAreaSize: 10, landAreaUnit: "ACRE" }));
  const partial = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels: many, sourceEvidence: sourceV1, failAtPage: 2 }), budgets: { adapterPageSize: 25, maxCandidates: 100 } });
  assert.equal(partial.status, "partial-results");
  assert.equal(partial.totals.uniqueCandidates, 25);
  assert(partial.errors.some((error) => error.code === "SYNTHETIC_FAILURE"));
  const budgeted = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels: many, sourceEvidence: sourceV1 }), budgets: { maxCandidates: 2 } });
  assert.equal(budgeted.status, "partial-results");
  assert(budgeted.warnings.some((warning) => warning.includes("query budget")));

  const timedOut = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels, sourceEvidence: sourceV1, delayMs: 100 }), budgets: { timeoutMs: 50 } });
  assert.equal(timedOut.status, "timed-out");
  assert(timedOut.errors.some((error) => error.code === "WR_QUERY_TIMEOUT"));
  const abortController = new AbortController(); abortController.abort();
  const aborted = await retrieval.retrieveParcelCandidates({ plan, adapter, signal: abortController.signal });
  assert.equal(aborted.status, "aborted");

  const invalidIdentity = await retrieval.retrieveParcelCandidates({ plan, adapter: retrieval.createInMemoryCandidateAdapter({ parcels: [...parcels, { accountNum: "LEGACY", landAreaSize: 10, landAreaUnit: "ACRE" }], sourceEvidence: sourceV1 }) });
  assert.equal(invalidIdentity.totals.invalidIdentity, 1);
  const compatible = retrieval.compareSearchCompatibility({ query: "A", legacyResults: [parcels[1], parcels[2]], productionResults: first.results, minimumOverlapPct: 100 });
  assert.equal(compatible.schemaVersion, "wr-search-compatibility-v1");
  assert.equal(compatible.status, "compatible");
  assert.equal(compatible.overlapPct, 100);
  const incompatible = retrieval.compareSearchCompatibility({ query: "A", legacyResults: parcels, productionResults: first.results, minimumOverlapPct: 80 });
  assert.equal(incompatible.status, "incompatible");
  assert.deepEqual(retrieval.compareSearchCompatibility({ legacyResults: [], productionResults: [] }).overlapPct, 100);

  let posted;
  const httpAdapter = retrieval.createHttpCandidateAdapter({ endpoint: "/api/candidates", fetchImpl: async (url, options) => { posted = { url, options }; return { ok: true, status: 200, json: async () => ({ schemaVersion: "wr-parcel-candidate-page-v1", candidates: parcels, nextCursor: "", scannedRecords: 3, sourceEvidence: sourceV1, partial: false, errors: [] }) }; } });
  const httpPage = await httpAdapter.fetchCandidatePage({ plan, countyIds: [county], limit: 2 });
  assert.equal(posted.url, "/api/candidates");
  assert.equal(JSON.parse(posted.options.body).schemaVersion, "wr-parcel-candidate-request-v1");
  assert.equal(httpPage.candidates.length, 2, "HTTP adapter must enforce the requested page limit");
  const badHttp = retrieval.createHttpCandidateAdapter({ endpoint: "/api/candidates", fetchImpl: async () => ({ ok: true, json: async () => ({ schemaVersion: "unknown" }) }) });
  await assert.rejects(() => badHttp.fetchCandidatePage({ plan }), (error) => error.code === "WR_CANDIDATE_CONTRACT_ERROR");

  const resultSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "production-parcel-query-result.schema.json"), "utf8"));
  const compatibilitySchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "search-compatibility.schema.json"), "utf8"));
  assert.equal(resultSchema.properties.schemaVersion.const, "wr-production-parcel-query-result-v1");
  assert.equal(compatibilitySchema.properties.schemaVersion.const, "wr-search-compatibility-v1");
  console.log("White Rabbit production candidate retrieval and search compatibility tests passed.");
  require("./county-artifact-candidate-adapter.test.cjs");
})().catch((error) => { console.error(error); process.exit(1); });
