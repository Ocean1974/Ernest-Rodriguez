import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ARCGIS_COUNTY_SOURCE_ADAPTER_VERSION = "wr-arcgis-county-source-adapter-v1";
export const FILESYSTEM_COUNTY_CAPTURE_STATE_VERSION = "wr-filesystem-county-capture-state-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function digest(value, name) { const normalized = required(value, name).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${name} must be a SHA-256 hex digest`); return normalized; }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }

function safeCaptureRoot(input) {
  const resolved = path.resolve(required(input, "rootDirectory"));
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || resolved === path.resolve(process.cwd())) throw new TypeError("rootDirectory must be a dedicated capture directory, not a filesystem or workspace root");
  return resolved;
}

export function createArcgisCountySourceAdapter({ fetchImpl = globalThis.fetch, allowedHosts = [], sourceRevision, metadataSha256, countResponseSha256, maximumResponseBytes = 256 * 1024 * 1024, timeoutMs = 120_000 } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  const hosts = new Set(allowedHosts.map((item) => required(item, "allowedHosts[]").toLowerCase()));
  if (!hosts.size) throw new TypeError("allowedHosts must not be empty");
  const revision = required(sourceRevision, "sourceRevision");
  const metadataDigest = digest(metadataSha256, "metadataSha256");
  const countDigest = digest(countResponseSha256, "countResponseSha256");
  return Object.freeze({
    schemaVersion: ARCGIS_COUNTY_SOURCE_ADAPTER_VERSION,
    sourceRevision: revision,
    metadataSha256: metadataDigest,
    countResponseSha256: countDigest,
    async fetchPage({ policy, offset, limit } = {}) {
      const base = new URL(required(policy?.sourceUrl, "policy.sourceUrl"));
      if (base.protocol !== "https:" || !hosts.has(base.hostname.toLowerCase())) throw Object.assign(new Error("ArcGIS capture host is not allowlisted"), { code: "WR_COUNTY_CAPTURE_HOST_DENIED" });
      const url = new URL(`${base.toString().replace(/\/$/, "")}/query`);
      const params = {
        where: policy.query.where,
        outFields: policy.query.outFields.join(","),
        returnGeometry: "true",
        outSR: String(policy.query.outputSpatialReference),
        orderByFields: policy.query.orderBy,
        resultOffset: String(Number(offset)),
        resultRecordCount: String(Number(limit)),
        f: "geojson",
      };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 120_000));
      let response;
      try { response = await fetchImpl(url, { method: "GET", redirect: "error", headers: { accept: "application/geo+json, application/json" }, signal: controller.signal }); }
      catch (error) { throw Object.assign(new Error(`ArcGIS page request failed: ${String(error.message || error)}`), { code: error?.name === "AbortError" ? "WR_COUNTY_CAPTURE_TIMEOUT" : "WR_COUNTY_CAPTURE_TRANSPORT_FAILURE" }); }
      finally { clearTimeout(timer); }
      if (response.status !== 200) throw Object.assign(new Error(`ArcGIS page request returned HTTP ${response.status}`), { code: "WR_COUNTY_CAPTURE_HTTP_FAILURE", status: response.status });
      const declaredLength = Number(response.headers?.get?.("content-length") || 0);
      if (declaredLength > maximumResponseBytes) throw Object.assign(new Error("ArcGIS page exceeds maximum response bytes"), { code: "WR_COUNTY_CAPTURE_RESPONSE_TOO_LARGE" });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > maximumResponseBytes) throw Object.assign(new Error("ArcGIS page exceeds maximum response bytes"), { code: "WR_COUNTY_CAPTURE_RESPONSE_TOO_LARGE" });
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); } catch { throw Object.assign(new Error("ArcGIS page is not valid JSON"), { code: "WR_COUNTY_CAPTURE_INVALID_JSON" }); }
      if (payload.error) throw Object.assign(new Error(`ArcGIS query error: ${payload.error.message || "unknown"}`), { code: "WR_COUNTY_CAPTURE_ARCGIS_ERROR" });
      const features = Array.isArray(payload.features) ? payload.features : [];
      if (features.length > Number(limit)) throw Object.assign(new Error("ArcGIS returned more records than requested"), { code: "WR_COUNTY_CAPTURE_PAGE_OVERFLOW" });
      const primaryKey = policy.primarySourceKey;
      const sourceIds = features.map((feature, index) => required(feature?.properties?.[primaryKey] ?? feature?.attributes?.[primaryKey], `features[${index}].${primaryKey}`));
      return {
        body,
        sourceIds,
        sourceRevision: revision,
        requestUrl: url.toString(),
        status: response.status,
        contentType: response.headers?.get?.("content-type") || "application/geo+json",
        etag: response.headers?.get?.("etag") || "",
        lastModified: response.headers?.get?.("last-modified") || "",
        fetchedAt: new Date().toISOString(),
        metadataSha256: metadataDigest,
        countResponseSha256: countDigest,
      };
    },
  });
}

export function createFilesystemCountyCaptureRepository({ rootDirectory } = {}) {
  const captureRoot = safeCaptureRoot(rootDirectory);
  const blobsRoot = path.join(captureRoot, "blobs", "sha256");
  const statePath = path.join(captureRoot, "capture-state.json");
  const blobPath = (ref) => {
    const hash = digest(String(ref || "").replace(/^sha256:\/\//, ""), "blobRef");
    return path.join(blobsRoot, hash.slice(0, 2), `${hash}.bin`);
  };
  const readState = () => {
    if (!fs.existsSync(statePath)) return null;
    const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (value.schemaVersion !== FILESYSTEM_COUNTY_CAPTURE_STATE_VERSION || !Array.isArray(value.pages)) throw Object.assign(new Error("Capture state file is invalid"), { code: "WR_COUNTY_CAPTURE_STATE_INVALID" });
    return value;
  };
  return Object.freeze({
    rootDirectory: captureRoot,
    async has(ref) { return fs.existsSync(blobPath(ref)); },
    async put(ref, body, { expectedSha256 } = {}) {
      const target = blobPath(ref);
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
      const observed = sha(bytes);
      if (observed !== digest(expectedSha256, "expectedSha256") || ref !== `sha256://${observed}`) throw Object.assign(new Error("Blob digest mismatch"), { code: "WR_COUNTY_CAPTURE_BLOB_INTEGRITY_FAILURE" });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        if (sha(fs.readFileSync(target)) !== observed) throw Object.assign(new Error("Existing immutable blob digest mismatch"), { code: "WR_COUNTY_CAPTURE_BLOB_INTEGRITY_FAILURE" });
        return { stored: false, ref };
      }
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes, { flag: "wx" });
      try { fs.renameSync(temporary, target); } catch (error) { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); if (!fs.existsSync(target)) throw error; }
      return { stored: true, ref };
    },
    load() { const state = readState(); return state ? { checkpoint: state.checkpoint, pages: state.pages } : { checkpoint: null, pages: [] }; },
    async compareAndSwap(expectedCheckpoint, nextCheckpoint, pages = []) {
      const current = readState();
      const currentSha = current?.checkpoint?.checkpointSha256 || "";
      const expectedSha = expectedCheckpoint?.checkpointSha256 || "";
      if (currentSha !== expectedSha) throw Object.assign(new Error("Capture checkpoint compare-and-swap conflict"), { code: "WR_COUNTY_CAPTURE_CHECKPOINT_CONFLICT" });
      if (!Array.isArray(pages) || pages.length !== nextCheckpoint.nextPageIndex || pages.at(-1)?.pageSha256 !== nextCheckpoint.finalPageSha256) throw Object.assign(new Error("Capture pages do not match checkpoint"), { code: "WR_COUNTY_CAPTURE_STATE_INVALID" });
      fs.mkdirSync(captureRoot, { recursive: true });
      const state = { schemaVersion: FILESYSTEM_COUNTY_CAPTURE_STATE_VERSION, checkpoint: nextCheckpoint, pages };
      const temporary = `${statePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporary, statePath);
      return { checkpointSha256: nextCheckpoint.checkpointSha256, pageCount: pages.length };
    },
  });
}
