const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const captureRoot = path.join(root, "data", "raw", "tarrant", "tad-parcels");
const licensePath = path.join(root, "data", "licenses", "tarrant-tad-public-records-license-evidence.json");
const readinessPath = path.join(root, "output", "tarrant", "source-capture-readiness", "tarrant-source-capture-readiness.json");
const sourceAuditPath = path.join(root, "data", "county-adapters", "tarrant", "tarrant-county-tad-source-manifest.json");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

function requiredLicenseEvidence() {
  if (!fs.existsSync(licensePath)) throw Object.assign(new Error("Tarrant raw capture requires data/licenses/tarrant-tad-public-records-license-evidence.json with explicit store, derive, and query rights."), { code: "WR_TARRANT_LICENSE_EVIDENCE_REQUIRED" });
  const bytes = fs.readFileSync(licensePath);
  const evidence = JSON.parse(bytes.toString("utf8"));
  const rights = new Set((evidence.rights || []).map(String));
  if (!["store", "derive", "query"].every((right) => rights.has(right)) || evidence.officialSourceUrl !== "https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/MapServer/0") throw Object.assign(new Error("Tarrant license evidence is missing required rights or official source scope."), { code: "WR_TARRANT_LICENSE_EVIDENCE_INVALID" });
  return { evidence, bytes, sha256: sha(bytes) };
}

(async () => {
  const license = requiredLicenseEvidence();
  if (!fs.existsSync(readinessPath)) throw new Error("Run npm run tarrant:source:probe before capture");
  const readiness = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
  const sourceAudit = JSON.parse(fs.readFileSync(sourceAuditPath, "utf8"));
  if (readiness.officialSource.currentAccountFeatureCount !== 758633 || readiness.officialSource.countDrift !== 0) throw Object.assign(new Error("Tarrant live count has drifted; regenerate and review readiness before capture."), { code: "WR_TARRANT_SOURCE_COUNT_DRIFT" });
  const capture = await import("../src/operations/countySourceCapture.mjs");
  const arcgis = await import("../src/operations/arcgisCountySourceCapture.mjs");
  const policy = capture.createCountySourceCapturePolicy({
    organizationId: "white-rabbit-platform",
    countyId: "tarrant-county-tad",
    countyFips: "48439",
    datasetId: `tad-parcels-${readiness.responseEvidence.sourceRevision}`,
    sourceUrl: readiness.officialSource.baseUrl,
    expectedFeatureCount: readiness.capturePlan.expectedFeatureCount,
    pageSize: readiness.capturePlan.pageSize,
    primarySourceKey: readiness.capturePlan.primarySourceKey,
    query: { where: sourceAudit.query.primary_where, orderBy: readiness.capturePlan.orderBy, outFields: sourceAudit.query.out_fields, outputSpatialReference: sourceAudit.query.geometry_out_sr },
    license: { id: String(license.evidence.id || "tarrant-tad-public-records"), evidenceRef: "data/licenses/tarrant-tad-public-records-license-evidence.json", evidenceSha256: license.sha256, rights: license.evidence.rights },
    maximumPageAttempts: 3,
  });
  const adapter = arcgis.createArcgisCountySourceAdapter({ allowedHosts: ["mapit.tarrantcounty.com"], sourceRevision: readiness.responseEvidence.sourceRevision, metadataSha256: readiness.responseEvidence.metadata.sha256, countResponseSha256: readiness.responseEvidence.count.sha256, maximumResponseBytes: 256 * 1024 * 1024, timeoutMs: 180_000 });
  const repository = arcgis.createFilesystemCountyCaptureRepository({ rootDirectory: captureRoot });
  const prior = repository.load();
  const full = process.argv.includes("--full");
  const pageArgument = process.argv.find((value) => /^--pages=\d+$/.test(value));
  const maximumPages = full ? Number.POSITIVE_INFINITY : pageArgument ? Number(pageArgument.split("=")[1]) : 1;
  if (!full && (!Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > 10)) throw new TypeError("--pages must be between 1 and 10 unless --full is explicitly supplied");
  const runner = capture.createResumableCountySourceCapture({ sourceAdapter: adapter, blobStore: repository, checkpointStore: repository });
  const result = await runner.execute({ policy, priorPages: prior.pages, priorCheckpoint: prior.checkpoint, maximumPages });
  const progress = { schemaVersion: "wr-tarrant-raw-source-capture-progress-v1", generatedAt: new Date().toISOString(), countyId: policy.countyId, policy, completed: result.completed, capturedPageCount: result.pages.length, capturedRecordCount: result.checkpoint?.acceptedRecordCount || 0, expectedFeatureCount: policy.expectedFeatureCount, expectedPageCount: readiness.capturePlan.expectedPageCount, checkpoint: result.checkpoint, productionActivationAuthorized: false, pageDesignChanged: false };
  fs.mkdirSync(captureRoot, { recursive: true });
  fs.writeFileSync(path.join(captureRoot, "capture-progress.json"), `${JSON.stringify(progress, null, 2)}\n`);
  console.log(`Tarrant raw capture ${result.completed ? "complete" : "checkpointed"}: ${progress.capturedRecordCount.toLocaleString()}/${policy.expectedFeatureCount.toLocaleString()} records across ${progress.capturedPageCount} pages.`);
})().catch((error) => { console.error(`${error.code || "WR_TARRANT_CAPTURE_FAILURE"}: ${error.message || error}`); process.exit(1); });
