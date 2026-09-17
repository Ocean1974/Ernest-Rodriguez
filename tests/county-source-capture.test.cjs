const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const capture = await import("../src/operations/countySourceCapture.mjs");
  const fixedTimes = ["2026-08-23T12:00:00.000Z", "2026-08-23T12:01:00.000Z", "2026-08-23T12:02:00.000Z", "2026-08-23T12:03:00.000Z", "2026-08-23T12:04:00.000Z"];
  let clockIndex = 0;
  const clock = () => fixedTimes[Math.min(clockIndex++, fixedTimes.length - 1)];
  const sha = capture.countySourceCaptureSha256;
  const policy = capture.createCountySourceCapturePolicy({
    organizationId: "org-a",
    countyId: "tarrant-county-tad",
    countyFips: "48439",
    datasetId: "tad-parcels-2026",
    sourceUrl: "https://example.gov/arcgis/TAD/0",
    expectedFeatureCount: 5,
    pageSize: 2,
    primarySourceKey: "ACCOUNT",
    query: { where: "ACCOUNT IS NOT NULL", orderBy: "OBJECTID", outFields: ["OBJECTID", "ACCOUNT"], outputSpatialReference: 4326 },
    license: { id: "public-records", evidenceRef: "artifact://licenses/tad", evidenceSha256: sha("license"), rights: ["store", "derive", "query"] },
  });
  assert.equal(policy.schemaVersion, capture.COUNTY_SOURCE_CAPTURE_POLICY_VERSION);
  assert.throws(() => capture.createCountySourceCapturePolicy({ ...policy, sourceUrl: "http://insecure.example" }), /HTTPS/);
  assert.throws(() => capture.createCountySourceCapturePolicy({ ...policy, license: { ...policy.license, rights: ["query"] } }), /store, derive, and query/);

  const ids = ["A1", "A2", "A3", "A4", "A5"];
  const sourceAdapter = {
    async fetchPage({ offset, limit, pageIndex }) {
      const sourceIds = ids.slice(offset, offset + limit);
      const body = Buffer.from(JSON.stringify({ features: sourceIds.map((ACCOUNT, index) => ({ attributes: { OBJECTID: offset + index + 1, ACCOUNT } })) }));
      return { body, sourceIds, sourceRevision: "rev-2026-08-23", requestUrl: `https://example.gov/arcgis/TAD/0/query?offset=${offset}&limit=${limit}`, status: 200, contentType: "application/json", etag: `page-${pageIndex}`, fetchedAt: fixedTimes[Math.min(pageIndex, fixedTimes.length - 1)] };
    },
  };
  const blobs = new Map();
  const blobStore = { has: async (ref) => blobs.has(ref), put: async (ref, body, { expectedSha256 }) => { assert.equal(sha(body), expectedSha256); if (blobs.has(ref) && !blobs.get(ref).equals(body)) throw new Error("immutable blob conflict"); blobs.set(ref, Buffer.from(body)); } };
  let storedCheckpoint = null;
  const checkpointStore = { compareAndSwap: async (expected, next) => { assert.deepEqual(expected, storedCheckpoint); storedCheckpoint = next; return { revision: next.revision }; } };
  const runner = capture.createResumableCountySourceCapture({ sourceAdapter, blobStore, checkpointStore, clock });
  const firstRun = await runner.execute({ policy, maximumPages: 1 });
  assert.equal(firstRun.completed, false);
  assert.equal(firstRun.pages.length, 1);
  assert.equal(firstRun.checkpoint.nextOffset, 2);
  assert.equal(blobs.size, 1);
  const resumed = await runner.execute({ policy, priorPages: firstRun.pages, priorCheckpoint: firstRun.checkpoint });
  assert.equal(resumed.completed, true);
  assert.equal(resumed.pages.length, 3);
  assert.equal(resumed.checkpoint.acceptedRecordCount, 5);
  assert.equal(resumed.checkpoint.completed, true);
  assert.equal(blobs.size, 3);
  const pageVerification = capture.verifyCountySourceCapturePages(resumed.pages, policy);
  assert.equal(pageVerification.valid, true);
  assert.equal(pageVerification.totalRecordCount, 5);
  assert.equal(pageVerification.sourceRevision, "rev-2026-08-23");

  const identityAudit = capture.createCountySourceIdentityAudit({ organizationId: "org-a", countyId: policy.countyId, datasetId: policy.datasetId, policySha256: policy.policySha256, pageChainSha256: pageVerification.pageChainSha256, recordCount: 5, nonNullSourceIdCount: 5, uniqueSourceIdCount: 5, duplicateSourceIdCount: 0, orderedSourceIdSha256: sha(ids), uniqueSourceIdSetSha256: sha([...ids].sort()), evidenceRef: "artifact://capture/identity-audit", evidenceSha256: sha("identity-evidence"), evaluatedAt: "2026-08-23T12:05:00.000Z" });
  const manifest = capture.createCountySourceCaptureManifest({ policy, pages: resumed.pages, identityAudit, captureStartedAt: firstRun.checkpoint.startedAt, captureCompletedAt: "2026-08-23T12:05:00.000Z" });
  assert.equal(manifest.status, "certified");
  assert.equal(manifest.capturedRecordCount, 5);
  assert.equal(capture.verifyCountySourceCaptureManifest(manifest, { policy, pages: resumed.pages, identityAudit }).certified, true);
  assert.equal(capture.verifyCountySourceCaptureManifest({ ...manifest, capturedRecordCount: 4 }, { policy, pages: resumed.pages, identityAudit }).certified, false);

  const duplicateAudit = capture.createCountySourceIdentityAudit({ ...identityAudit, uniqueSourceIdCount: 4, duplicateSourceIdCount: 1 });
  const rejected = capture.createCountySourceCaptureManifest({ policy, pages: resumed.pages, identityAudit: duplicateAudit, captureStartedAt: firstRun.checkpoint.startedAt, captureCompletedAt: "2026-08-23T12:05:00.000Z" });
  assert.equal(rejected.status, "rejected");
  assert(rejected.checks.some((item) => item.id === "identity-count" && !item.passed));

  await assert.rejects(() => runner.execute({ policy, priorPages: firstRun.pages, priorCheckpoint: { ...firstRun.checkpoint, nextOffset: 1 } }), (error) => error.code === "WR_COUNTY_CAPTURE_CHECKPOINT_MISMATCH");
  let driftCalls = 0;
  const driftRunner = capture.createResumableCountySourceCapture({ sourceAdapter: { fetchPage: async (input) => ({ ...(await sourceAdapter.fetchPage(input)), sourceRevision: driftCalls++ === 0 ? "rev-a" : "rev-b" }) }, blobStore: { has: async () => true, put: async () => {} }, checkpointStore: { compareAndSwap: async () => {} }, clock: () => "2026-08-23T12:00:00.000Z" });
  await assert.rejects(() => driftRunner.execute({ policy }), (error) => error.code === "WR_COUNTY_CAPTURE_SOURCE_DRIFT");

  const lineageBase = { organizationId: "org-a", countyId: policy.countyId, outputManifestRef: "artifact://outputs/manifest", outputManifestSha256: sha("output-manifest"), expectedOutputCount: 5, observedOutputCount: 5, uniqueCountyParcelIdCount: 5, uniqueSourceParcelIdCount: 5, completeSourceReferenceCount: 5, canonicalIdentityMatchCount: 5, duplicateCountyParcelIdCount: 0, duplicateSourceParcelIdCount: 0, invalidRecordCount: 0, chunkCount: 2, chunkInventorySha256: sha("chunks"), lineageLedgerRootSha256: sha("ledger"), evaluatedAt: "2026-08-23T12:05:00.000Z" };
  const outputOnly = capture.createCountyOutputLineageAudit(lineageBase);
  assert.equal(outputOnly.outputLineageCertified, true);
  assert.equal(outputOnly.sourceToOutputCertified, false);
  assert.equal(outputOnly.rawSourceMatchStatus, "unverified-no-raw-source-manifest");
  assert.equal(capture.verifyCountyOutputLineageAudit(outputOnly).valid, true);
  const sourceMatched = capture.createCountyOutputLineageAudit({ ...lineageBase, rawSourceManifestSha256: manifest.manifestSha256 });
  assert.equal(sourceMatched.sourceToOutputCertified, true);
  assert.equal(capture.verifyCountyOutputLineageAudit({ ...sourceMatched, observedOutputCount: 4 }).valid, false);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/schemas/county-source-capture.schema.json"), "utf8"));
  assert.equal(schema.$defs.policy.properties.schemaVersion.const, capture.COUNTY_SOURCE_CAPTURE_POLICY_VERSION);
  assert.equal(schema.$defs.outputLineageAudit.properties.schemaVersion.const, capture.COUNTY_OUTPUT_LINEAGE_AUDIT_VERSION);
  const app = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
  assert(!app.includes("countySourceCapture"));
  console.log("White Rabbit resumable county source capture, drift containment, exact manifest, and lineage certification tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
