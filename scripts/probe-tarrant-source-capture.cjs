const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "output", "tarrant", "source-capture-readiness");
const baseUrl = "https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/MapServer/0";
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function request(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (response.status !== 200) throw new Error(`Official TAD request failed with HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const value = JSON.parse(body.toString("utf8"));
  if (value.error) throw new Error(`Official TAD error: ${value.error.message || "unknown"}`);
  return { response, body, value, sha256: sha(body) };
}

(async () => {
  const metadataUrl = `${baseUrl}?f=json`;
  const countUrl = `${baseUrl}/query?where=ACCOUNT%20IS%20NOT%20NULL&returnCountOnly=true&f=json`;
  const [metadata, count] = await Promise.all([request(metadataUrl), request(countUrl)]);
  const priorAudit = JSON.parse(fs.readFileSync(path.join(root, "data/county-adapters/tarrant/tarrant-county-tad-source-manifest.json"), "utf8"));
  const oidField = metadata.value.objectIdField || metadata.value.fields?.find((field) => field.type === "esriFieldTypeOID")?.name || "";
  const supportsPagination = metadata.value.advancedQueryCapabilities?.supportsPagination === true;
  const supportsOrderBy = metadata.value.advancedQueryCapabilities?.supportsOrderBy === true;
  const currentCount = Number(count.value.count);
  const auditedCount = Number(priorAudit.verified_counts.parcel_geometry_features);
  const probedAt = new Date().toISOString();
  const sourceRevision = `tad:${sha(Buffer.concat([metadata.body, Buffer.from("\n"), count.body]))}`;
  const licenseEvidencePath = path.join(root, "data/licenses/tarrant-tad-public-records-license-evidence.json");
  const readiness = {
    schemaVersion: "wr-tarrant-source-capture-readiness-v1",
    probedAt,
    countyId: "tarrant-county-tad",
    countyFips: "48439",
    officialSource: { baseUrl, metadataUrl, countUrl, layerName: metadata.value.name, layerType: metadata.value.type, objectIdField: oidField, maximumRecordCount: Number(metadata.value.maxRecordCount), supportsPagination, supportsOrderBy, currentAccountFeatureCount: currentCount, priorAuditedAccountFeatureCount: auditedCount, countDrift: currentCount - auditedCount },
    responseEvidence: { metadata: { bytes: metadata.body.length, sha256: metadata.sha256, etag: metadata.response.headers.get("etag") || "", lastModified: metadata.response.headers.get("last-modified") || "" }, count: { bytes: count.body.length, sha256: count.sha256, etag: count.response.headers.get("etag") || "", lastModified: count.response.headers.get("last-modified") || "" }, sourceRevision },
    capturePlan: { pageSize: Math.min(10_000, Number(metadata.value.maxRecordCount) || 2_000), expectedPageCount: Math.ceil(currentCount / Math.min(10_000, Number(metadata.value.maxRecordCount) || 2_000)), expectedFeatureCount: currentCount, orderBy: oidField || priorAudit.query.order_by, primarySourceKey: "ACCOUNT", outputSpatialReference: 4326, contentAddressedBlobRoot: "data/raw/tarrant/tad-parcels/blobs/sha256/", checkpointPath: "data/raw/tarrant/tad-parcels/capture-state.json" },
    gates: { officialHttpsSource: baseUrl.startsWith("https://"), exactCountStable: currentCount === auditedCount, paginationSupported: supportsPagination, deterministicOrderFieldPresent: Boolean(oidField), licenseEvidencePresent: fs.existsSync(licenseEvidencePath), rawCapturePresent: fs.existsSync(path.join(root, "data/raw/tarrant/tad-parcels/capture-state.json")) },
    captureReady: false,
    captureStarted: false,
    blocker: "Store/derive/query license evidence has not been recorded. The full raw capture remains intentionally unstarted.",
    pageDesignChanged: false,
    productionActivationAuthorized: false,
  };
  readiness.captureReady = Object.values(readiness.gates).slice(0, 5).every(Boolean);
  if (readiness.captureReady) readiness.blocker = "";
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "official-layer-metadata.json"), metadata.body);
  fs.writeFileSync(path.join(outputDirectory, "official-count-response.json"), count.body);
  fs.writeFileSync(path.join(outputDirectory, "tarrant-source-capture-readiness.json"), `${JSON.stringify(readiness, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "tarrant-source-capture-readiness.md"), [
    "# Tarrant Source Capture Readiness",
    "",
    `Probed: ${probedAt}`,
    "",
    `- Official layer: ${readiness.officialSource.layerName} (${readiness.officialSource.layerType})`,
    `- Current ACCOUNT feature count: **${currentCount.toLocaleString()}**`,
    `- Prior audited feature count: **${auditedCount.toLocaleString()}**`,
    `- Count drift: **${readiness.officialSource.countDrift}**`,
    `- Maximum page size: **${readiness.capturePlan.pageSize.toLocaleString()}**`,
    `- Expected pages: **${readiness.capturePlan.expectedPageCount}**`,
    `- Pagination supported: **${supportsPagination ? "yes" : "no"}**`,
    `- Deterministic order field: \`${readiness.capturePlan.orderBy}\``,
    `- Metadata SHA-256: \`${metadata.sha256}\``,
    `- Count response SHA-256: \`${count.sha256}\``,
    `- Capture ready: **${readiness.captureReady ? "yes" : "no"}**`,
    `- Capture started: **no**`,
    "",
    "## Blocker",
    "",
    readiness.blocker || "None.",
    "",
    "No raw parcel pages were downloaded, no county activation occurred, and no White Rabbit page design changed.",
    "",
  ].join("\n"));
  console.log(`Official TAD count ${currentCount.toLocaleString()}; ${readiness.capturePlan.expectedPageCount} planned pages; capture ready: ${readiness.captureReady}.`);
})().catch((error) => { console.error(error); process.exit(1); });
