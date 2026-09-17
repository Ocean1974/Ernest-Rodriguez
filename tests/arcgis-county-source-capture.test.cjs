const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const capture = await import("../src/operations/countySourceCapture.mjs");
  const arcgis = await import("../src/operations/arcgisCountySourceCapture.mjs");
  const sha = capture.countySourceCaptureSha256;
  const policy = capture.createCountySourceCapturePolicy({ organizationId: "org-a", countyId: "tarrant-county-tad", countyFips: "48439", datasetId: "tad", sourceUrl: "https://official.example/arcgis/layer/0", expectedFeatureCount: 3, pageSize: 2, primarySourceKey: "ACCOUNT", query: { where: "ACCOUNT IS NOT NULL", orderBy: "OBJECTID", outFields: ["OBJECTID", "ACCOUNT"], outputSpatialReference: 4326 }, license: { id: "public", evidenceRef: "artifact://license", evidenceSha256: sha("license"), rights: ["store", "derive", "query"] } });
  const requests = [];
  const fakeFetch = async (url) => {
    requests.push(url.toString());
    const offset = Number(url.searchParams.get("resultOffset"));
    const ids = ["A1", "A2", "A3"].slice(offset, offset + 2);
    return new Response(JSON.stringify({ type: "FeatureCollection", features: ids.map((ACCOUNT, index) => ({ type: "Feature", properties: { OBJECTID: offset + index + 1, ACCOUNT }, geometry: null })) }), { status: 200, headers: { "content-type": "application/geo+json", etag: `p-${offset}` } });
  };
  const adapter = arcgis.createArcgisCountySourceAdapter({ fetchImpl: fakeFetch, allowedHosts: ["official.example"], sourceRevision: "rev-1", metadataSha256: sha("metadata"), countResponseSha256: sha("count") });
  const page = await adapter.fetchPage({ policy, offset: 0, limit: 2 });
  assert.deepEqual(page.sourceIds, ["A1", "A2"]);
  assert.equal(page.sourceRevision, "rev-1");
  assert(requests[0].includes("returnGeometry=true"));
  assert(requests[0].includes("orderByFields=OBJECTID"));
  assert(requests[0].includes("resultOffset=0"));
  const deniedPolicy = { ...policy, sourceUrl: "https://evil.example/arcgis/0" };
  await assert.rejects(() => adapter.fetchPage({ policy: deniedPolicy, offset: 0, limit: 2 }), (error) => error.code === "WR_COUNTY_CAPTURE_HOST_DENIED");

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wr-county-capture-"));
  const repository = arcgis.createFilesystemCountyCaptureRepository({ rootDirectory: path.join(tempDirectory, "capture") });
  const runner = capture.createResumableCountySourceCapture({ sourceAdapter: adapter, blobStore: repository, checkpointStore: repository, clock: (() => { let minute = 0; return () => `2026-08-23T12:0${Math.min(minute++, 9)}:00.000Z`; })() });
  const first = await runner.execute({ policy, maximumPages: 1 });
  assert.equal(first.completed, false);
  const persisted = repository.load();
  assert.equal(persisted.pages.length, 1);
  assert.equal(persisted.checkpoint.nextOffset, 2);
  const completed = await runner.execute({ policy, priorPages: persisted.pages, priorCheckpoint: persisted.checkpoint });
  assert.equal(completed.completed, true);
  assert.equal(repository.load().pages.length, 2);
  const firstBlob = completed.pages[0].blobRef;
  assert.equal(await repository.has(firstBlob), true);
  await assert.rejects(() => repository.put(firstBlob, Buffer.from("tampered"), { expectedSha256: sha("tampered") }), (error) => error.code === "WR_COUNTY_CAPTURE_BLOB_INTEGRITY_FAILURE");
  await assert.rejects(() => repository.compareAndSwap(null, completed.checkpoint, completed.pages), (error) => error.code === "WR_COUNTY_CAPTURE_CHECKPOINT_CONFLICT");
  fs.rmSync(tempDirectory, { recursive: true, force: true });
  assert.throws(() => arcgis.createFilesystemCountyCaptureRepository({ rootDirectory: process.cwd() }), /dedicated capture directory/);
  const app = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
  assert(!app.includes("arcgisCountySourceCapture"));
  console.log("White Rabbit allowlisted ArcGIS capture adapter, immutable blob store, and atomic checkpoint tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
