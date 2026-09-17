const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "data", "kentucky-county-source-registry.json");
const outputDir = path.join(root, "output", "kentucky-source-audit");
const rawRoot = path.join(root, "data", "raw", "kentucky-source-probes");

function parseArgs(argv) {
  const result = { concurrency: 4, countyIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--concurrency") result.concurrency = Number(argv[index + 1]);
    if (argv[index] === "--counties") result.countyIds = String(argv[index + 1] || "").split(",").map((value) => value.trim()).filter(Boolean);
  }
  if (!Number.isSafeInteger(result.concurrency) || result.concurrency < 1 || result.concurrency > 8) throw new TypeError("--concurrency must be an integer from 1 through 8");
  return result;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stableJson(value));
}

async function fetchBytes(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { Accept: "application/json", "User-Agent": "WhiteRabbit/1.0 Kentucky official-source-probe" },
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${bytes.toString("utf8", 0, 300)}`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchArcgisJson(url) {
  const bytes = await fetchBytes(url);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`Non-JSON response from ${url}`); }
  if (value.error) throw new Error(`ArcGIS error ${value.error.code || ""}: ${value.error.message || "unknown"}`.trim());
  return { bytes, value, sha256: sha256(bytes) };
}

function queryUrl(base, parameters) {
  const url = new URL(`${base.replace(/\/$/, "")}/query`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return url.toString();
}

function chooseIdentityField(source, metadata) {
  const fields = new Map((metadata.fields || []).map((field) => [String(field.name).toUpperCase(), field]));
  for (const candidate of source.identityCandidates || []) {
    const field = fields.get(String(candidate).toUpperCase());
    if (field) return field.name;
  }
  return metadata.objectIdField || metadata.objectIdFieldName || "";
}

async function probeSource(source, observedAt) {
  const countyDir = path.join(rawRoot, observedAt, source.countyId);
  const metadataUrl = `${source.sourceUrl}?f=pjson`;
  const metadata = await fetchArcgisJson(metadataUrl);
  const countUrl = queryUrl(source.sourceUrl, { where: "1=1", returnCountOnly: "true", f: "json" });
  const count = await fetchArcgisJson(countUrl);
  const identityField = chooseIdentityField(source, metadata.value);
  const sampleFields = [...new Set([metadata.value.objectIdField, metadata.value.objectIdFieldName, identityField].filter(Boolean))];
  const sampleUrl = queryUrl(source.sourceUrl, {
    where: "1=1",
    outFields: sampleFields.join(",") || "*",
    returnGeometry: "false",
    resultRecordCount: "1",
    orderByFields: metadata.value.objectIdField || metadata.value.objectIdFieldName || identityField,
    f: "json",
  });
  const sample = await fetchArcgisJson(sampleUrl);
  writeJson(path.join(countyDir, "metadata.json"), metadata.value);
  writeJson(path.join(countyDir, "count.json"), count.value);
  writeJson(path.join(countyDir, "identity-sample.json"), sample.value);
  const capabilities = String(metadata.value.capabilities || "");
  const advanced = metadata.value.advancedQueryCapabilities || {};
  return {
    countyId: source.countyId,
    adapterId: source.adapterId,
    countyName: source.countyName,
    countyFips: source.countyFips,
    publisher: source.publisher,
    sourceUrl: source.sourceUrl,
    status: "official-source-probed",
    observedAt,
    exactFeatureCount: Number(count.value.count),
    geometryType: metadata.value.geometryType || "",
    spatialReference: metadata.value.extent?.spatialReference || metadata.value.sourceSpatialReference || {},
    objectIdField: metadata.value.objectIdField || metadata.value.objectIdFieldName || "",
    identityCandidate: identityField,
    identityUniqueness: "unverified-until-full-identity-audit",
    fieldCount: Array.isArray(metadata.value.fields) ? metadata.value.fields.length : 0,
    fields: (metadata.value.fields || []).map((field) => ({ name: field.name, alias: field.alias, type: field.type, length: field.length || 0 })),
    maxRecordCount: Number(metadata.value.maxRecordCount || 0),
    supportsQuery: /\bQuery\b/i.test(capabilities),
    supportsPagination: advanced.supportsPagination === true,
    supportedQueryFormats: String(metadata.value.supportedQueryFormats || ""),
    responseEvidence: {
      metadata: { url: metadataUrl, sha256: metadata.sha256, bytes: metadata.bytes.length },
      count: { url: countUrl, sha256: count.sha256, bytes: count.bytes.length },
      identitySample: { url: sampleUrl, sha256: sample.sha256, bytes: sample.bytes.length },
    },
    rawEvidenceDirectory: path.relative(root, countyDir).replace(/\\/g, "/"),
    captureAuthorized: false,
    rightsStatus: source.rightsStatus,
    nextStep: "Record official store, derive, and query rights; then run the resumable raw capture.",
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { results[index] = await worker(items[index]); }
      catch (error) {
        results[index] = {
          countyId: items[index].countyId,
          adapterId: items[index].adapterId,
          countyName: items[index].countyName,
          countyFips: items[index].countyFips,
          publisher: items[index].publisher,
          sourceUrl: items[index].sourceUrl,
          status: "probe-failed",
          error: String(error.message || error),
          captureAuthorized: false,
          rightsStatus: items[index].rightsStatus,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function markdown(report) {
  const rows = report.counties.map((county) => `| ${county.countyName} | ${county.status} | ${Number.isSafeInteger(county.exactFeatureCount) ? county.exactFeatureCount.toLocaleString("en-US") : "n/a"} | ${county.geometryType || "n/a"} | ${county.identityCandidate || "n/a"} | ${county.supportsPagination === true ? "yes" : "no"} | ${county.rightsStatus} |`);
  return [
    "# Kentucky Verified Parcel Source Probe",
    "",
    `Observed: ${report.observedAt}`,
    "",
    `- Sources attempted: ${report.summary.attempted}`,
    `- Sources successfully probed: ${report.summary.succeeded}`,
    `- Exact combined features observed: ${report.summary.exactCombinedFeatureCount.toLocaleString("en-US")}`,
    `- Full raw captures authorized: ${report.summary.captureAuthorized}`,
    `- Bounded concurrency: ${report.concurrency}`,
    "",
    "| County | Status | Exact features | Geometry | Identity candidate | Pagination | Rights gate |",
    "| --- | --- | ---: | --- | --- | --- | --- |",
    ...rows,
    "",
    "A successful probe verifies the official endpoint, count response, schema, and a sample identifier. It does not prove identifier uniqueness, grant redistribution rights, or activate the county in White Rabbit.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = readJson(registryPath);
  let sources = registry.sources || [];
  if (args.countyIds.length) {
    const requested = new Set(args.countyIds);
    sources = sources.filter((source) => requested.has(source.countyId));
    const missing = args.countyIds.filter((countyId) => !sources.some((source) => source.countyId === countyId));
    if (missing.length) throw new Error(`Unknown county ids: ${missing.join(", ")}`);
  }
  const observedAt = new Date().toISOString().slice(0, 10);
  const counties = await mapConcurrent(sources, args.concurrency, (source) => probeSource(source, observedAt));
  const succeeded = counties.filter((county) => county.status === "official-source-probed");
  const report = {
    schemaVersion: "wr-kentucky-verified-source-probe-v1",
    generatedAt: new Date().toISOString(),
    observedAt,
    concurrency: args.concurrency,
    registryPath: path.relative(root, registryPath).replace(/\\/g, "/"),
    uiChanged: false,
    productionActivationAuthorized: false,
    summary: {
      attempted: counties.length,
      succeeded: succeeded.length,
      failed: counties.length - succeeded.length,
      exactCombinedFeatureCount: succeeded.reduce((sum, county) => sum + county.exactFeatureCount, 0),
      captureAuthorized: counties.filter((county) => county.captureAuthorized).length,
    },
    counties,
  };
  writeJson(path.join(outputDir, "kentucky-verified-source-probe.json"), report);
  fs.writeFileSync(path.join(outputDir, "kentucky-verified-source-probe.md"), markdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.failed) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exit(1); });
