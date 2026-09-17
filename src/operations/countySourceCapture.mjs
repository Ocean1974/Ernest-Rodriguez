import { createHash } from "node:crypto";

export const COUNTY_SOURCE_CAPTURE_POLICY_VERSION = "wr-county-source-capture-policy-v1";
export const COUNTY_SOURCE_CAPTURE_PAGE_VERSION = "wr-county-source-capture-page-v1";
export const COUNTY_SOURCE_CAPTURE_CHECKPOINT_VERSION = "wr-county-source-capture-checkpoint-v1";
export const COUNTY_SOURCE_IDENTITY_AUDIT_VERSION = "wr-county-source-identity-audit-v1";
export const COUNTY_SOURCE_CAPTURE_MANIFEST_VERSION = "wr-county-source-capture-manifest-v1";
export const COUNTY_OUTPUT_LINEAGE_AUDIT_VERSION = "wr-county-output-lineage-audit-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function integer(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  return number;
}

function digest(value, name) {
  const normalized = required(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${name} must be a SHA-256 hex digest`);
  return normalized;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function countySourceCaptureSha256(value) {
  return createHash("sha256").update(Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function seal(core, field) { return Object.freeze({ ...core, [field]: countySourceCaptureSha256(core) }); }
function verifySeal(value, field) { if (!value || typeof value !== "object") return false; const { [field]: observed, ...core } = value; return observed === countySourceCaptureSha256(core); }

export function createCountySourceCapturePolicy(input = {}) {
  const sourceUrl = required(input.sourceUrl, "sourceUrl");
  if (!sourceUrl.startsWith("https://")) throw new TypeError("sourceUrl must use HTTPS");
  const rights = [...new Set((input.license?.rights || []).map(String).filter(Boolean))].sort();
  const requiredRights = ["derive", "query", "store"];
  if (!requiredRights.every((right) => rights.includes(right))) throw new TypeError("license rights must include store, derive, and query");
  const query = {
    where: required(input.query?.where, "query.where"),
    orderBy: required(input.query?.orderBy, "query.orderBy"),
    outFields: [...new Set((input.query?.outFields || []).map(String).filter(Boolean))],
    outputSpatialReference: integer(input.query?.outputSpatialReference || 4326, "query.outputSpatialReference", 1),
  };
  if (!query.outFields.length) throw new TypeError("query.outFields must not be empty");
  const core = {
    schemaVersion: COUNTY_SOURCE_CAPTURE_POLICY_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    countyFips: required(input.countyFips, "countyFips"),
    datasetId: required(input.datasetId, "datasetId"),
    sourceUrl,
    expectedFeatureCount: integer(input.expectedFeatureCount, "expectedFeatureCount"),
    pageSize: Math.min(10_000, integer(input.pageSize || 2_000, "pageSize", 1)),
    primarySourceKey: required(input.primarySourceKey, "primarySourceKey"),
    query,
    querySha256: countySourceCaptureSha256(query),
    license: {
      id: required(input.license?.id, "license.id"),
      evidenceRef: required(input.license?.evidenceRef, "license.evidenceRef"),
      evidenceSha256: digest(input.license?.evidenceSha256, "license.evidenceSha256"),
      rights,
    },
    maximumPageAttempts: Math.max(1, Math.min(10, integer(input.maximumPageAttempts ?? 3, "maximumPageAttempts", 1))),
  };
  if (!/^\d{5}$/.test(core.countyFips)) throw new TypeError("countyFips must contain five digits");
  return seal(core, "policySha256");
}

export function createCountySourceCapturePage(input = {}) {
  const sourceIds = (input.sourceIds || []).map((value, index) => required(value, `sourceIds[${index}]`));
  const recordCount = integer(input.recordCount ?? sourceIds.length, "recordCount");
  if (recordCount !== sourceIds.length) throw new TypeError("recordCount must equal sourceIds length");
  const bodyBytes = integer(input.bodyBytes, "bodyBytes", 1);
  const core = {
    schemaVersion: COUNTY_SOURCE_CAPTURE_PAGE_VERSION,
    policySha256: digest(input.policySha256, "policySha256"),
    countyId: required(input.countyId, "countyId"),
    datasetId: required(input.datasetId, "datasetId"),
    sourceRevision: required(input.sourceRevision, "sourceRevision"),
    pageIndex: integer(input.pageIndex, "pageIndex"),
    offset: integer(input.offset, "offset"),
    requestedLimit: integer(input.requestedLimit, "requestedLimit", 1),
    recordCount,
    firstSourceId: sourceIds[0] || "",
    lastSourceId: sourceIds.at(-1) || "",
    orderedSourceIdSha256: countySourceCaptureSha256(sourceIds),
    bodyBytes,
    bodySha256: digest(input.bodySha256, "bodySha256"),
    blobRef: required(input.blobRef, "blobRef"),
    requestUrl: required(input.requestUrl, "requestUrl"),
    responseStatus: integer(input.responseStatus ?? 200, "responseStatus", 100),
    contentType: required(input.contentType, "contentType"),
    etag: String(input.etag || ""),
    lastModified: String(input.lastModified || ""),
    fetchedAt: iso(input.fetchedAt, "fetchedAt"),
    previousPageSha256: input.previousPageSha256 ? digest(input.previousPageSha256, "previousPageSha256") : "",
  };
  if (core.responseStatus !== 200) throw new TypeError("capture pages require HTTP 200 responses");
  if (!core.requestUrl.startsWith("https://")) throw new TypeError("requestUrl must use HTTPS");
  if (!/json/i.test(core.contentType)) throw new TypeError("capture page contentType must be JSON");
  if (!core.blobRef.startsWith("sha256://")) throw new TypeError("blobRef must be content addressed with sha256://");
  if (core.blobRef !== `sha256://${core.bodySha256}`) throw new TypeError("blobRef digest must match bodySha256");
  return seal(core, "pageSha256");
}

export function verifyCountySourceCapturePages(pages = [], policyInput = null) {
  const policy = policyInput?.schemaVersion === COUNTY_SOURCE_CAPTURE_POLICY_VERSION ? policyInput : null;
  const checks = [];
  let expectedOffset = 0;
  let previousPageSha256 = "";
  let sourceRevision = "";
  const pageIndexes = new Set();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const valid = verifySeal(page, "pageSha256");
    checks.push({ id: `page:${index}:integrity`, passed: valid });
    checks.push({ id: `page:${index}:sequence`, passed: page?.pageIndex === index && page?.offset === expectedOffset && page?.previousPageSha256 === previousPageSha256 && !pageIndexes.has(page?.pageIndex) });
    checks.push({ id: `page:${index}:scope`, passed: !policy || (page?.policySha256 === policy.policySha256 && page?.countyId === policy.countyId && page?.datasetId === policy.datasetId && page?.requestedLimit === policy.pageSize) });
    if (!sourceRevision) sourceRevision = String(page?.sourceRevision || "");
    checks.push({ id: `page:${index}:revision`, passed: Boolean(page?.sourceRevision) && page.sourceRevision === sourceRevision });
    pageIndexes.add(page?.pageIndex);
    expectedOffset += Number(page?.recordCount || 0);
    previousPageSha256 = String(page?.pageSha256 || "");
  }
  return Object.freeze({ valid: checks.every((item) => item.passed), checks, totalRecordCount: expectedOffset, sourceRevision, finalPageSha256: previousPageSha256, pageChainSha256: countySourceCaptureSha256(pages.map((page) => page.pageSha256)) });
}

export function createCountySourceCaptureCheckpoint(input = {}) {
  const pages = input.pages || [];
  const verification = verifyCountySourceCapturePages(pages, input.policy);
  if (!verification.valid) throw new TypeError("Cannot checkpoint an invalid page chain");
  const core = {
    schemaVersion: COUNTY_SOURCE_CAPTURE_CHECKPOINT_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    datasetId: required(input.datasetId, "datasetId"),
    policySha256: digest(input.policy?.policySha256, "policy.policySha256"),
    revision: integer(input.revision ?? 0, "revision"),
    startedAt: iso(input.startedAt, "startedAt"),
    updatedAt: iso(input.updatedAt, "updatedAt"),
    completed: input.completed === true,
    nextPageIndex: pages.length,
    nextOffset: verification.totalRecordCount,
    acceptedRecordCount: verification.totalRecordCount,
    finalPageSha256: verification.finalPageSha256,
    pageChainSha256: verification.pageChainSha256,
    sourceRevision: verification.sourceRevision,
  };
  if (core.organizationId !== input.policy?.organizationId || core.countyId !== input.policy?.countyId || core.datasetId !== input.policy?.datasetId) throw new TypeError("Checkpoint scope does not match capture policy");
  return seal(core, "checkpointSha256");
}

export function createCountySourceIdentityAudit(input = {}) {
  const core = {
    schemaVersion: COUNTY_SOURCE_IDENTITY_AUDIT_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    datasetId: required(input.datasetId, "datasetId"),
    policySha256: digest(input.policySha256, "policySha256"),
    pageChainSha256: digest(input.pageChainSha256, "pageChainSha256"),
    recordCount: integer(input.recordCount, "recordCount"),
    nonNullSourceIdCount: integer(input.nonNullSourceIdCount, "nonNullSourceIdCount"),
    uniqueSourceIdCount: integer(input.uniqueSourceIdCount, "uniqueSourceIdCount"),
    duplicateSourceIdCount: integer(input.duplicateSourceIdCount, "duplicateSourceIdCount"),
    orderedSourceIdSha256: digest(input.orderedSourceIdSha256, "orderedSourceIdSha256"),
    uniqueSourceIdSetSha256: digest(input.uniqueSourceIdSetSha256, "uniqueSourceIdSetSha256"),
    evidenceRef: required(input.evidenceRef, "evidenceRef"),
    evidenceSha256: digest(input.evidenceSha256, "evidenceSha256"),
    evaluatedAt: iso(input.evaluatedAt, "evaluatedAt"),
  };
  return seal(core, "auditSha256");
}

export function createCountySourceCaptureManifest(input = {}) {
  const policy = input.policy;
  if (!verifySeal(policy, "policySha256")) throw new TypeError("Capture policy integrity is invalid");
  const pages = input.pages || [];
  const pageVerification = verifyCountySourceCapturePages(pages, policy);
  const audit = input.identityAudit;
  const checks = [
    { id: "page-chain", passed: pageVerification.valid },
    { id: "exact-count", passed: pageVerification.totalRecordCount === policy.expectedFeatureCount },
    { id: "identity-audit-integrity", passed: verifySeal(audit, "auditSha256") },
    { id: "identity-audit-scope", passed: audit?.organizationId === policy.organizationId && audit?.countyId === policy.countyId && audit?.datasetId === policy.datasetId && audit?.policySha256 === policy.policySha256 && audit?.pageChainSha256 === pageVerification.pageChainSha256 },
    { id: "identity-count", passed: audit?.recordCount === policy.expectedFeatureCount && audit?.nonNullSourceIdCount === policy.expectedFeatureCount && audit?.uniqueSourceIdCount === policy.expectedFeatureCount && audit?.duplicateSourceIdCount === 0 },
    { id: "license-rights", passed: ["store", "derive", "query"].every((right) => policy.license.rights.includes(right)) },
  ];
  const core = {
    schemaVersion: COUNTY_SOURCE_CAPTURE_MANIFEST_VERSION,
    organizationId: policy.organizationId,
    countyId: policy.countyId,
    countyFips: policy.countyFips,
    datasetId: policy.datasetId,
    sourceUrl: policy.sourceUrl,
    sourceRevision: pageVerification.sourceRevision,
    policySha256: policy.policySha256,
    querySha256: policy.querySha256,
    captureStartedAt: iso(input.captureStartedAt, "captureStartedAt"),
    captureCompletedAt: iso(input.captureCompletedAt, "captureCompletedAt"),
    pageCount: pages.length,
    capturedRecordCount: pageVerification.totalRecordCount,
    pageChainSha256: pageVerification.pageChainSha256,
    finalPageSha256: pageVerification.finalPageSha256,
    identityAuditSha256: audit?.auditSha256 || "",
    sourceContentSha256: countySourceCaptureSha256(pages.map((page) => page.bodySha256)),
    pageSha256s: pages.map((page) => page.pageSha256),
    checks,
    status: checks.every((item) => item.passed) ? "certified" : "rejected",
  };
  return seal(core, "manifestSha256");
}

export function verifyCountySourceCaptureManifest(manifest, { policy, pages, identityAudit } = {}) {
  let rebuilt;
  try { rebuilt = createCountySourceCaptureManifest({ policy, pages, identityAudit, captureStartedAt: manifest?.captureStartedAt, captureCompletedAt: manifest?.captureCompletedAt }); }
  catch (error) { return Object.freeze({ valid: false, certified: false, checks: [], error: String(error.message || error) }); }
  const valid = verifySeal(manifest, "manifestSha256") && manifest.manifestSha256 === rebuilt.manifestSha256 && rebuilt.status === "certified";
  return Object.freeze({ valid, certified: valid, checks: rebuilt.checks });
}

export function createCountyOutputLineageAudit(input = {}) {
  const core = {
    schemaVersion: COUNTY_OUTPUT_LINEAGE_AUDIT_VERSION,
    organizationId: required(input.organizationId, "organizationId"),
    countyId: required(input.countyId, "countyId"),
    outputManifestRef: required(input.outputManifestRef, "outputManifestRef"),
    outputManifestSha256: digest(input.outputManifestSha256, "outputManifestSha256"),
    rawSourceManifestSha256: input.rawSourceManifestSha256 ? digest(input.rawSourceManifestSha256, "rawSourceManifestSha256") : "",
    expectedOutputCount: integer(input.expectedOutputCount, "expectedOutputCount"),
    observedOutputCount: integer(input.observedOutputCount, "observedOutputCount"),
    uniqueCountyParcelIdCount: integer(input.uniqueCountyParcelIdCount, "uniqueCountyParcelIdCount"),
    uniqueSourceParcelIdCount: integer(input.uniqueSourceParcelIdCount, "uniqueSourceParcelIdCount"),
    completeSourceReferenceCount: integer(input.completeSourceReferenceCount, "completeSourceReferenceCount"),
    canonicalIdentityMatchCount: integer(input.canonicalIdentityMatchCount, "canonicalIdentityMatchCount"),
    duplicateCountyParcelIdCount: integer(input.duplicateCountyParcelIdCount, "duplicateCountyParcelIdCount"),
    duplicateSourceParcelIdCount: integer(input.duplicateSourceParcelIdCount, "duplicateSourceParcelIdCount"),
    invalidRecordCount: integer(input.invalidRecordCount, "invalidRecordCount"),
    chunkCount: integer(input.chunkCount, "chunkCount"),
    chunkInventorySha256: digest(input.chunkInventorySha256, "chunkInventorySha256"),
    lineageLedgerRootSha256: digest(input.lineageLedgerRootSha256, "lineageLedgerRootSha256"),
    rawSourceMatchStatus: input.rawSourceManifestSha256 ? "verified" : "unverified-no-raw-source-manifest",
    evaluatedAt: iso(input.evaluatedAt, "evaluatedAt"),
  };
  const outputLineageCertified = core.observedOutputCount === core.expectedOutputCount && core.uniqueCountyParcelIdCount === core.expectedOutputCount && core.uniqueSourceParcelIdCount === core.expectedOutputCount && core.completeSourceReferenceCount === core.expectedOutputCount && core.canonicalIdentityMatchCount === core.expectedOutputCount && core.duplicateCountyParcelIdCount === 0 && core.duplicateSourceParcelIdCount === 0 && core.invalidRecordCount === 0;
  return seal({ ...core, outputLineageCertified, sourceToOutputCertified: outputLineageCertified && core.rawSourceMatchStatus === "verified" }, "auditSha256");
}

export function verifyCountyOutputLineageAudit(value) {
  const valid = verifySeal(value, "auditSha256");
  return Object.freeze({ valid, outputLineageCertified: valid && value.outputLineageCertified === true, sourceToOutputCertified: valid && value.sourceToOutputCertified === true });
}

export function createResumableCountySourceCapture({ sourceAdapter, blobStore, checkpointStore, clock = () => new Date().toISOString() } = {}) {
  if (typeof sourceAdapter?.fetchPage !== "function") throw new TypeError("sourceAdapter.fetchPage is required");
  if (typeof blobStore?.put !== "function" || typeof blobStore?.has !== "function") throw new TypeError("blobStore.has and blobStore.put are required");
  if (typeof checkpointStore?.compareAndSwap !== "function") throw new TypeError("checkpointStore.compareAndSwap is required");
  return Object.freeze({
    async execute({ policy, priorPages = [], priorCheckpoint = null, maximumPages = Number.POSITIVE_INFINITY } = {}) {
      if (!verifySeal(policy, "policySha256")) throw new TypeError("Capture policy integrity is invalid");
      const existing = verifyCountySourceCapturePages(priorPages, policy);
      if (!existing.valid) throw new TypeError("Prior capture page chain is invalid");
      if (priorCheckpoint && (!verifySeal(priorCheckpoint, "checkpointSha256") || priorCheckpoint.policySha256 !== policy.policySha256 || priorCheckpoint.nextOffset !== existing.totalRecordCount || priorCheckpoint.pageChainSha256 !== existing.pageChainSha256)) throw Object.assign(new Error("Prior checkpoint does not match the page chain"), { code: "WR_COUNTY_CAPTURE_CHECKPOINT_MISMATCH" });
      const pages = [...priorPages];
      const startedAt = priorCheckpoint?.startedAt || iso(clock(), "startedAt");
      let checkpoint = priorCheckpoint;
      let fetchedThisRun = 0;
      while (existing.totalRecordCount + pages.slice(priorPages.length).reduce((sum, page) => sum + page.recordCount, 0) < policy.expectedFeatureCount && fetchedThisRun < maximumPages) {
        const offset = pages.reduce((sum, page) => sum + page.recordCount, 0);
        const response = await sourceAdapter.fetchPage({ policy, pageIndex: pages.length, offset, limit: policy.pageSize });
        const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || "");
        if (!body.length) throw Object.assign(new Error("Source adapter returned an empty response body"), { code: "WR_COUNTY_CAPTURE_EMPTY_BODY" });
        const bodySha256 = countySourceCaptureSha256(body);
        const blobRef = `sha256://${bodySha256}`;
        if (!(await blobStore.has(blobRef))) await blobStore.put(blobRef, body, { expectedSha256: bodySha256 });
        const page = createCountySourceCapturePage({ policySha256: policy.policySha256, countyId: policy.countyId, datasetId: policy.datasetId, sourceRevision: response.sourceRevision, pageIndex: pages.length, offset, requestedLimit: policy.pageSize, sourceIds: response.sourceIds, recordCount: response.sourceIds?.length, bodyBytes: body.length, bodySha256, blobRef, requestUrl: response.requestUrl, responseStatus: response.status, contentType: response.contentType, etag: response.etag, lastModified: response.lastModified, fetchedAt: response.fetchedAt || clock(), previousPageSha256: pages.at(-1)?.pageSha256 || "" });
        if (pages.length && page.sourceRevision !== pages[0].sourceRevision) throw Object.assign(new Error("Upstream source revision changed during capture"), { code: "WR_COUNTY_CAPTURE_SOURCE_DRIFT" });
        if (page.recordCount === 0) throw Object.assign(new Error("Source ended before the expected feature count"), { code: "WR_COUNTY_CAPTURE_TRUNCATED" });
        pages.push(page);
        const total = pages.reduce((sum, item) => sum + item.recordCount, 0);
        if (total > policy.expectedFeatureCount) throw Object.assign(new Error("Capture exceeded the expected feature count"), { code: "WR_COUNTY_CAPTURE_COUNT_OVERFLOW" });
        const next = createCountySourceCaptureCheckpoint({ organizationId: policy.organizationId, countyId: policy.countyId, datasetId: policy.datasetId, policy, pages, revision: Number(checkpoint?.revision || 0) + 1, startedAt, updatedAt: clock(), completed: total === policy.expectedFeatureCount });
        await checkpointStore.compareAndSwap(checkpoint, next, pages);
        checkpoint = next;
        fetchedThisRun += 1;
        if (page.recordCount < policy.pageSize && total !== policy.expectedFeatureCount) throw Object.assign(new Error("Short page ended before the expected feature count"), { code: "WR_COUNTY_CAPTURE_TRUNCATED" });
      }
      return Object.freeze({ pages, checkpoint, completed: pages.reduce((sum, page) => sum + page.recordCount, 0) === policy.expectedFeatureCount });
    },
  });
}
