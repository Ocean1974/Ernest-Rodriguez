import { evaluateParcelQueryPlan } from "./parcelQueryExecutor.mjs";

export const CANDIDATE_PAGE_VERSION = "wr-parcel-candidate-page-v1";
export const PRODUCTION_QUERY_RESULT_VERSION = "wr-production-parcel-query-result-v1";
export const SEARCH_COMPATIBILITY_VERSION = "wr-search-compatibility-v1";
export const SEARCH_CURSOR_VERSION = "wrc:v1";

function hash(seed) {
  let value = 2166136261;
  for (const character of String(seed)) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(36);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function planFingerprint(plan) { return `plan_${hash(canonicalJson(plan || {}))}`; }

function propertyId(parcel) { return String(parcel?.whiteRabbitPropertyId || ""); }

function encodeCursor(payload) { return `${SEARCH_CURSOR_VERSION}:${encodeURIComponent(JSON.stringify(payload))}`; }

function decodeCursor(value) {
  if (!value) return null;
  const prefix = `${SEARCH_CURSOR_VERSION}:`;
  if (!String(value).startsWith(prefix)) throw new TypeError("Search cursor version is invalid");
  try { return JSON.parse(decodeURIComponent(String(value).slice(prefix.length))); } catch { throw new TypeError("Search cursor payload is invalid"); }
}

function normalizedBudget(input = {}) {
  return {
    pageSize: Math.max(1, Math.min(250, Math.trunc(Number(input.pageSize ?? 50)))),
    adapterPageSize: Math.max(25, Math.min(1000, Math.trunc(Number(input.adapterPageSize ?? 500)))),
    maxCandidates: Math.max(1, Math.min(25000, Math.trunc(Number(input.maxCandidates ?? 5000)))),
    maxScannedRecords: Math.max(1, Math.min(500000, Math.trunc(Number(input.maxScannedRecords ?? 250000)))),
    maxAdapterPages: Math.max(1, Math.min(100, Math.trunc(Number(input.maxAdapterPages ?? 20)))),
    timeoutMs: Math.max(50, Math.min(30000, Math.trunc(Number(input.timeoutMs ?? 5000)))),
  };
}

function normalizeSourceEvidence(input = {}) {
  return {
    sourceCountyId: String(input.sourceCountyId || ""),
    datasetId: String(input.datasetId || ""),
    sourceVersion: String(input.sourceVersion || ""),
    sourceUpdatedAt: String(input.sourceUpdatedAt || ""),
    freshnessStatus: ["current", "stale", "unknown"].includes(input.freshnessStatus) ? input.freshnessStatus : "unknown",
    partial: Boolean(input.partial),
  };
}

function sourceFingerprint(sources) {
  return `sources_${hash(canonicalJson([...sources].sort((a, b) => `${a.sourceCountyId}|${a.datasetId}`.localeCompare(`${b.sourceCountyId}|${b.datasetId}`))))}`;
}

function rankCandidate(plan, parcel, evaluation, freshnessStatus) {
  const matchedFilters = evaluation.filterEvidence.filter((item) => item.status === "matched").length;
  const unknownFilters = evaluation.filterEvidence.filter((item) => item.status === "unknown").length;
  const matchedKeywords = evaluation.keywordEvidence.filter((item) => item.status === "matched").length;
  const unmatchedKeywords = evaluation.keywordEvidence.filter((item) => item.status === "not-matched").length;
  const exactId = [parcel.whiteRabbitPropertyId, parcel.countyParcelId, parcel.accountNum, parcel.accountNumber, parcel.gisParcelId].some((value) => String(value || "").toLowerCase() === String(plan.rawQuery || "").trim().toLowerCase());
  const components = {
    status: evaluation.status === "matched" ? 1000 : 500,
    filters: matchedFilters * 40,
    keywords: matchedKeywords * 15,
    exactIdentifier: exactId ? 300 : 0,
    planConfidence: Math.round(Number(plan.confidence || 0) * 100),
    evidencePenalty: unknownFilters * -25 + unmatchedKeywords * -10,
    freshness: freshnessStatus === "current" ? 10 : freshnessStatus === "stale" ? -20 : -5,
  };
  return { score: Object.values(components).reduce((sum, value) => sum + value, 0), components, matchedFilters, unknownFilters, matchedKeywords, unmatchedKeywords, freshnessStatus, rule: "status + filter evidence + keyword evidence + exact identifier + plan confidence - evidence gaps + source freshness" };
}

function pageTimeout(promise, timeoutMs, controller) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(`Candidate retrieval timed out after ${timeoutMs}ms`); error.code = "WR_QUERY_TIMEOUT"; reject(error); controller.abort(); }, timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function retrieveParcelCandidates({ plan, adapter, countyIds = [], bounds = null, context = {}, cursor = "", budgets = {}, policies = {}, signal = null } = {}) {
  if (!plan || plan.schemaVersion !== "wr-parcel-query-plan-v1") throw new TypeError("A wr-parcel-query-plan-v1 plan is required");
  if (!adapter || typeof adapter.fetchCandidatePage !== "function") throw new TypeError("adapter.fetchCandidatePage is required");
  const budget = normalizedBudget(budgets);
  const fingerprint = planFingerprint(plan);
  const decodedCursor = decodeCursor(cursor);
  if (decodedCursor && decodedCursor.planFingerprint !== fingerprint) return { schemaVersion: PRODUCTION_QUERY_RESULT_VERSION, status: "invalid-cursor", planFingerprint: fingerprint, results: [], nextCursor: "", warnings: ["Cursor belongs to a different query plan."], errors: [], sourceEvidence: [], totals: { adapterPages: 0, scannedRecords: 0, uniqueCandidates: 0, evaluated: 0, matched: 0, indeterminate: 0, rejected: 0, invalidIdentity: 0 }, budget };
  const controller = new AbortController();
  if (signal?.aborted) controller.abort();
  else if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
  const deadline = Date.now() + budget.timeoutMs;
  const candidates = new Map();
  const sources = new Map();
  const errors = [];
  const warnings = [];
  let adapterCursor = "";
  let adapterPages = 0;
  let scannedRecords = 0;
  let partial = false;
  let invalidIdentity = 0;
  let terminalStatus = "complete";
  try {
    while (adapterPages < budget.maxAdapterPages && candidates.size < budget.maxCandidates && scannedRecords < budget.maxScannedRecords) {
      if (controller.signal.aborted) { terminalStatus = "aborted"; partial = candidates.size > 0; break; }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) { terminalStatus = "timed-out"; partial = candidates.size > 0; break; }
      const page = await pageTimeout(Promise.resolve(adapter.fetchCandidatePage({ plan, countyIds, bounds, cursor: adapterCursor, limit: Math.min(budget.adapterPageSize, budget.maxCandidates - candidates.size), signal: controller.signal })), remainingMs, controller);
      adapterPages += 1;
      const records = Array.isArray(page?.candidates) ? page.candidates : [];
      scannedRecords += Math.max(records.length, Number(page?.scannedRecords || 0));
      for (const item of page?.sourceEvidence || []) { const normalized = normalizeSourceEvidence(item); sources.set(`${normalized.sourceCountyId}|${normalized.datasetId}`, normalized); }
      for (const error of page?.errors || []) errors.push({ code: String(error.code || "ADAPTER_ERROR"), message: String(error.message || error) });
      if (page?.partial || page?.errors?.length) partial = true;
      for (const parcel of records) {
        const id = propertyId(parcel);
        if (!/^wrp:v1:[^:]+:.+$/.test(id)) { invalidIdentity += 1; continue; }
        if (!candidates.has(id)) candidates.set(id, parcel);
        if (candidates.size >= budget.maxCandidates) break;
      }
      adapterCursor = String(page?.nextCursor || "");
      if (!adapterCursor) break;
    }
  } catch (error) {
    errors.push({ code: String(error.code || "ADAPTER_ERROR"), message: String(error.message || error) });
    terminalStatus = error.code === "WR_QUERY_TIMEOUT" ? "timed-out" : controller.signal.aborted ? "aborted" : "adapter-error";
    partial = candidates.size > 0;
  }
  if (adapterCursor && (adapterPages >= budget.maxAdapterPages || candidates.size >= budget.maxCandidates || scannedRecords >= budget.maxScannedRecords)) { partial = true; warnings.push("Candidate retrieval stopped at a configured query budget."); }
  const sourceEvidence = [...sources.values()];
  const currentSourceFingerprint = sourceFingerprint(sourceEvidence);
  if (decodedCursor?.sourceFingerprint && decodedCursor.sourceFingerprint !== currentSourceFingerprint) return { schemaVersion: PRODUCTION_QUERY_RESULT_VERSION, status: "stale-cursor", planFingerprint: fingerprint, results: [], nextCursor: "", warnings: ["Source versions changed after this cursor was issued; restart pagination."], errors, sourceEvidence, totals: { adapterPages, scannedRecords, uniqueCandidates: candidates.size, evaluated: 0, matched: 0, indeterminate: 0, rejected: 0, invalidIdentity: 0 }, budget };
  const staleSources = sourceEvidence.filter((item) => item.freshnessStatus === "stale");
  const unknownSources = sourceEvidence.filter((item) => item.freshnessStatus === "unknown");
  if (staleSources.length && policies.staleSource === "reject") return { schemaVersion: PRODUCTION_QUERY_RESULT_VERSION, status: "stale-source-rejected", planFingerprint: fingerprint, results: [], nextCursor: "", warnings: ["One or more candidate sources are stale."], errors, sourceEvidence, totals: { adapterPages, scannedRecords, uniqueCandidates: candidates.size, evaluated: 0, matched: 0, indeterminate: 0, rejected: 0, invalidIdentity: 0 }, budget };
  if (staleSources.length) warnings.push(`${staleSources.length} source(s) are stale.`);
  if (unknownSources.length && policies.unknownSource === "reject") return { schemaVersion: PRODUCTION_QUERY_RESULT_VERSION, status: "unknown-source-rejected", planFingerprint: fingerprint, results: [], nextCursor: "", warnings: ["One or more candidate sources have unknown freshness."], errors, sourceEvidence, totals: { adapterPages, scannedRecords, uniqueCandidates: candidates.size, evaluated: 0, matched: 0, indeterminate: 0, rejected: 0, invalidIdentity: 0 }, budget };
  if (unknownSources.length) warnings.push(`${unknownSources.length} source(s) have unknown freshness.`);
  const freshnessByCounty = new Map(sourceEvidence.map((item) => [item.sourceCountyId, item.freshnessStatus]));
  const evaluated = [...candidates.values()].map((parcel) => {
    const evaluation = evaluateParcelQueryPlan(plan, parcel, context);
    const freshnessStatus = freshnessByCounty.get(String(parcel.sourceCountyId || "")) || "unknown";
    return { parcel, evaluation, ranking: rankCandidate(plan, parcel, evaluation, freshnessStatus) };
  });
  const matches = evaluated.filter((item) => item.evaluation.status === "matched");
  const indeterminate = evaluated.filter((item) => item.evaluation.status === "indeterminate");
  let eligible = [...matches, ...(policies.includeIndeterminate ? indeterminate : [])].sort((a, b) => b.ranking.score - a.ranking.score || propertyId(a.parcel).localeCompare(propertyId(b.parcel)));
  if (decodedCursor) eligible = eligible.filter((item) => item.ranking.score < decodedCursor.lastScore || (item.ranking.score === decodedCursor.lastScore && propertyId(item.parcel) > decodedCursor.lastPropertyId));
  const results = eligible.slice(0, budget.pageSize);
  const last = results[results.length - 1];
  const nextCursor = eligible.length > results.length && last ? encodeCursor({ planFingerprint: fingerprint, sourceFingerprint: currentSourceFingerprint, lastScore: last.ranking.score, lastPropertyId: propertyId(last.parcel) }) : "";
  const status = terminalStatus !== "complete" ? (partial ? "partial-results" : terminalStatus) : partial ? "partial-results" : "complete";
  return { schemaVersion: PRODUCTION_QUERY_RESULT_VERSION, status, planFingerprint: fingerprint, results, nextCursor, warnings, errors, sourceEvidence, unsupported: plan.unsupported || [], totals: { adapterPages, scannedRecords, uniqueCandidates: candidates.size, evaluated: evaluated.length, matched: matches.length, indeterminate: indeterminate.length, rejected: evaluated.length - matches.length - indeterminate.length, invalidIdentity }, budget, executionEvidence: { adapterCursorRemaining: Boolean(adapterCursor), timedOut: terminalStatus === "timed-out", aborted: terminalStatus === "aborted", partial } };
}

export function compareSearchCompatibility({ query = "", legacyResults = [], productionResults = [], topK = 20, minimumOverlapPct = 80 } = {}) {
  const legacyIds = legacyResults.map((item) => propertyId(item.parcel || item)).filter(Boolean).slice(0, topK);
  const productionIds = productionResults.map((item) => propertyId(item.parcel || item)).filter(Boolean).slice(0, topK);
  const legacySet = new Set(legacyIds);
  const productionSet = new Set(productionIds);
  const overlapIds = legacyIds.filter((id) => productionSet.has(id));
  const missingLegacyIds = legacyIds.filter((id) => !productionSet.has(id));
  const addedProductionIds = productionIds.filter((id) => !legacySet.has(id));
  const denominator = Math.min(topK, legacyIds.length);
  const overlapPct = denominator === 0 ? (productionIds.length === 0 ? 100 : 0) : Number((overlapIds.length / denominator * 100).toFixed(1));
  const rankDisplacements = overlapIds.map((id) => ({ whiteRabbitPropertyId: id, legacyRank: legacyIds.indexOf(id) + 1, productionRank: productionIds.indexOf(id) + 1, displacement: productionIds.indexOf(id) - legacyIds.indexOf(id) }));
  return { schemaVersion: SEARCH_COMPATIBILITY_VERSION, query: String(query), topK, minimumOverlapPct, status: overlapPct >= minimumOverlapPct ? "compatible" : "incompatible", overlapPct, overlapIds, missingLegacyIds, addedProductionIds, rankDisplacements, legacyCount: legacyIds.length, productionCount: productionIds.length };
}

export function createInMemoryCandidateAdapter({ parcels = [], sourceEvidence = [], scannedRecordsPerPage = null, delayMs = 0, failAtPage = 0 } = {}) {
  let calls = 0;
  return {
    async fetchCandidatePage({ cursor = "", limit = 500, signal } = {}) {
      calls += 1;
      const pageIndex = Number(cursor || 0);
      if (delayMs) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, delayMs); signal?.addEventListener("abort", () => { clearTimeout(timer); const error = new Error("aborted"); error.code = "ABORT_ERR"; reject(error); }, { once: true }); });
      if (failAtPage && calls === failAtPage) { const error = new Error("Synthetic adapter failure"); error.code = "SYNTHETIC_FAILURE"; throw error; }
      const candidates = parcels.slice(pageIndex, pageIndex + limit);
      const nextCursor = pageIndex + candidates.length < parcels.length ? String(pageIndex + candidates.length) : "";
      return { schemaVersion: CANDIDATE_PAGE_VERSION, candidates, nextCursor, scannedRecords: scannedRecordsPerPage ?? candidates.length, sourceEvidence, partial: false, errors: [] };
    },
  };
}

export function createHttpCandidateAdapter({ endpoint, fetchImpl = globalThis.fetch, headers = {} } = {}) {
  const url = String(endpoint || "").trim();
  if (!url) throw new TypeError("Candidate retrieval endpoint is required");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
  return {
    async fetchCandidatePage({ plan, countyIds = [], bounds = null, cursor = "", limit = 500, signal } = {}) {
      const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ schemaVersion: "wr-parcel-candidate-request-v1", plan, countyIds, bounds, cursor, limit }), signal });
      if (!response?.ok) { const error = new Error(`Candidate retrieval service returned ${response?.status || "an unknown status"}`); error.code = "WR_CANDIDATE_SERVICE_ERROR"; error.status = Number(response?.status || 0); throw error; }
      const payload = await response.json();
      if (payload?.schemaVersion !== CANDIDATE_PAGE_VERSION) { const error = new Error("Candidate service returned an unsupported page contract"); error.code = "WR_CANDIDATE_CONTRACT_ERROR"; throw error; }
      return { schemaVersion: CANDIDATE_PAGE_VERSION, candidates: Array.isArray(payload.candidates) ? payload.candidates.slice(0, limit) : [], nextCursor: String(payload.nextCursor || ""), scannedRecords: Math.max(0, Number(payload.scannedRecords || 0)), sourceEvidence: Array.isArray(payload.sourceEvidence) ? payload.sourceEvidence : [], partial: Boolean(payload.partial), errors: Array.isArray(payload.errors) ? payload.errors : [] };
    },
  };
}
