const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { planParcelQuery } = await import("../src/search/parcelQueryPlanner.mjs");
  const { retrieveParcelCandidates } = await import("../src/search/parcelCandidateRetriever.mjs");
  const { createCountyArtifactCandidateAdapter } = await import("../src/search/countyArtifactCandidateAdapter.mjs");
  const countyId = "fixture-county";
  const manifestPath = "fixture/manifest.json";
  const files = new Map([
    [manifestPath, { sourceCountyId: countyId, featureCount: 3, searchIndexCount: 3, bounds: { minLng: -98, minLat: 32, maxLng: -97, maxLat: 33 }, chunks: [{ file: "chunks/0.json", bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 } }, { file: "chunks/1.json", bounds: { minX: 50, minY: 50, maxX: 100, maxY: 100 } }], searchIndexShards: { keyLength: 2, fields: ["accountNum", "address", "ownerName", "chunkId"], files: { ri: "search/ri.json" }, counts: { ri: 2 } } }],
    ["fixture/search/ri.json", { fields: ["accountNum", "address", "ownerName", "chunkId"], parcels: [["A1", "10 RIMROCK CT", "ALPHA LLC", "0"], ["A2", "20 RIMROCK CT", "BETA INC", "0"]] }],
    ["fixture/chunks/0.json", { parcels: [{ accountNum: "A1", address: "10 RIMROCK CT", landAreaSqFt: 500000 }, { accountNum: "A2", address: "20 RIMROCK CT", landAreaSqFt: 10000 }] }],
    ["fixture/chunks/1.json", { parcels: [{ accountNum: "A3", address: "30 LAKE CT", landAreaSqFt: 600000 }] }],
  ]);
  const readJson = async (relative, base = "") => {
    const resolved = relative === manifestPath ? relative : path.posix.join(path.posix.dirname(base.replace(/\\/g, "/")), String(relative).replace(/\\/g, "/"));
    if (!files.has(resolved)) throw new Error(`Missing fixture ${resolved}`);
    return structuredClone(files.get(resolved));
  };
  const adapter = createCountyArtifactCandidateAdapter({ manifestPath, readJson, expectedCountyId: countyId, expectedFeatureCount: 3, sourceVersion: "fixture-v1", sourceUpdatedAt: "2026-08-01", freshnessStatus: "unknown", maxBoundedChunks: 1 });
  assert.equal(adapter.schemaVersion, "wr-county-artifact-candidate-adapter-v1");
  const keywordPlan = planParcelQuery("rimrock");
  const first = await adapter.fetchCandidatePage({ plan: keywordPlan, countyIds: [countyId], limit: 1 });
  assert.equal(first.candidates[0].whiteRabbitPropertyId, "wrp:v1:fixture-county:A1");
  assert(first.nextCursor.startsWith("wrac:v1:"));
  const second = await adapter.fetchCandidatePage({ plan: keywordPlan, countyIds: [countyId], cursor: first.nextCursor, limit: 1 });
  assert.equal(second.candidates[0].accountNum, "A2");
  assert.equal(second.nextCursor, "");
  await assert.rejects(() => adapter.fetchCandidatePage({ plan: keywordPlan, countyIds: ["other-county"] }), (error) => error.code === "WR_CANDIDATE_COUNTY_SCOPE_VIOLATION");
  await assert.rejects(() => adapter.fetchCandidatePage({ plan: keywordPlan, cursor: "wrac:v1:%7Bbad" }), (error) => error.code === "WR_ARTIFACT_CURSOR_INVALID");

  const traversalFiles = new Map([["bad/manifest.json", { sourceCountyId: countyId, featureCount: 1, searchIndexCount: 1, bounds: { minLng: -98, minLat: 32, maxLng: -97, maxLat: 33 }, chunks: [], searchIndexShards: { keyLength: 2, fields: [], files: { ri: "../../secret.json" }, counts: { ri: 1 } } }]]);
  const traversal = createCountyArtifactCandidateAdapter({ manifestPath: "bad/manifest.json", readJson: async (relative) => traversalFiles.get(relative), expectedCountyId: countyId, expectedFeatureCount: 1, sourceVersion: "bad-v1", sourceUpdatedAt: "2026-08-01" });
  await assert.rejects(() => traversal.fetchCandidatePage({ plan: keywordPlan }), (error) => error.code === "WR_ARTIFACT_PATH_INVALID");

  const filterPlan = planParcelQuery("parcels over 5 acres");
  const blocked = await adapter.fetchCandidatePage({ plan: filterPlan });
  assert.equal(blocked.partial, true);
  assert.equal(blocked.errors[0].code, "WR_BOUNDED_QUERY_REQUIRED");
  const bounds = { west: -98, south: 32.51, east: -97.51, north: 33 };
  const viewport = await adapter.fetchCandidatePage({ plan: filterPlan, bounds, limit: 5 });
  assert.equal(viewport.candidates.length, 2);
  const rejectedUnknown = await retrieveParcelCandidates({ plan: filterPlan, adapter, countyIds: [countyId], bounds, policies: { unknownSource: "reject" } });
  assert.equal(rejectedUnknown.status, "unknown-source-rejected");
  const permittedUnknown = await retrieveParcelCandidates({ plan: filterPlan, adapter, countyIds: [countyId], bounds, policies: { unknownSource: "warn" } });
  assert.deepEqual(permittedUnknown.results.map((item) => item.parcel.accountNum), ["A1"]);

  const root = path.join(__dirname, "..");
  const tarrantManifest = "public/data/counties/tarrant/parcels/manifest.json";
  const diskReader = async (relative, base = "") => JSON.parse(fs.readFileSync(relative === tarrantManifest ? path.join(root, relative) : path.join(root, path.dirname(base), relative), "utf8"));
  const tarrant = createCountyArtifactCandidateAdapter({ manifestPath: tarrantManifest, readJson: diskReader, expectedCountyId: "tarrant-county-tad", expectedFeatureCount: 758633, sourceVersion: "manifest-5daadcce359f", sourceUpdatedAt: "2026-08-07", freshnessStatus: "unknown" });
  const real = await retrieveParcelCandidates({ plan: planParcelQuery("RIMROCK"), adapter: tarrant, countyIds: ["tarrant-county-tad"], budgets: { pageSize: 250, adapterPageSize: 1000, maxCandidates: 5000, maxAdapterPages: 5, timeoutMs: 30000 }, policies: { unknownSource: "warn" } });
  assert(real.results.some((item) => item.parcel.accountNum === "01424211"), "verified Tarrant search shard should return 5405 RIMROCK CT");
  assert(real.sourceEvidence.every((item) => item.freshnessStatus === "unknown"));
  assert(real.warnings.some((warning) => warning.includes("unknown freshness")));
  console.log("White Rabbit county artifact candidate adapter and fail-closed freshness tests passed.");
  require("./county-artifact-query-runtime.test.cjs");
})().catch((error) => { console.error(error); process.exit(1); });
