const fs = require("fs");
const path = require("path");
const { freshnessStatus } = require("./property-identity.cjs");

const root = path.join(__dirname, "..");
const adaptersRoot = path.join(root, "data", "county-adapters");
const outputJson = path.join(root, "output", "source-freshness-audit.json");
const outputMarkdown = path.join(root, "output", "source-freshness-audit.md");
const generatedAt = new Date().toISOString();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function manifestPath(publicRoot) {
  const normalized = String(publicRoot || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) return "";
  return path.join(root, "public", ...normalized.split("/"), "manifest.json");
}

function serviceAudit(adapter, layer, publicRoot) {
  const file = manifestPath(publicRoot);
  if (!file || !fs.existsSync(file)) {
    return { layer, status: "manifest-missing", manifest: file ? path.relative(root, file).replace(/\\/g, "/") : "", sourceUpdatedAt: "", serviceGeneratedAt: "", freshnessStatus: "unknown", freshnessAgeDays: null };
  }
  const manifest = readJson(file);
  const sourceUpdatedAt = String(manifest.sourceUpdatedAt || manifest.lineageContract?.sourceUpdatedAt || adapter.sourceUpdatedAt || "");
  const serviceGeneratedAt = String(manifest.generatedAt || generatedAt);
  const maxAgeDays = Number(manifest.lineageContract?.freshnessMaxAgeDays || adapter.freshnessPolicy?.maxAgeDays || 120);
  const freshness = freshnessStatus(sourceUpdatedAt, serviceGeneratedAt, maxAgeDays);
  return {
    layer,
    status: "manifest-present",
    manifest: path.relative(root, file).replace(/\\/g, "/"),
    sourceUpdatedAt,
    serviceGeneratedAt,
    freshnessStatus: freshness.status,
    freshnessAgeDays: freshness.ageDays,
    freshnessMaxAgeDays: maxAgeDays,
    freshnessReason: freshness.reason,
  };
}

const adapters = [];
for (const entry of fs.readdirSync(adaptersRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(adaptersRoot, entry.name, "adapter.json");
  if (!fs.existsSync(file)) continue;
  const adapter = readJson(file);
  const roots = adapter.publicDataRoots || adapter.dataRoots || {};
  const services = ["parcels", "permits", "zoning", "floodplain", "developments"]
    .filter((layer) => roots[layer])
    .map((layer) => serviceAudit(adapter, layer, roots[layer]));
  adapters.push({
    id: adapter.id || entry.name,
    countyName: adapter.countyName || "",
    status: adapter.status || "unknown",
    sourceUpdatedAt: String(adapter.sourceUpdatedAt || ""),
    freshnessMaxAgeDays: Number(adapter.freshnessPolicy?.maxAgeDays || 120),
    services,
  });
}

const services = adapters.flatMap((adapter) => adapter.services.map((service) => ({ adapterId: adapter.id, adapterStatus: adapter.status, ...service })));
const summary = {
  adapterCount: adapters.length,
  adaptersWithSourceUpdatedAt: adapters.filter((adapter) => adapter.sourceUpdatedAt).length,
  serviceCount: services.length,
  manifestsPresent: services.filter((service) => service.status === "manifest-present").length,
  manifestsMissing: services.filter((service) => service.status === "manifest-missing").length,
  current: services.filter((service) => service.freshnessStatus === "current").length,
  stale: services.filter((service) => service.freshnessStatus === "stale").length,
  unknown: services.filter((service) => service.freshnessStatus === "unknown").length,
};

const report = {
  schemaVersion: "wr-source-freshness-audit-v1",
  generatedAt,
  pageDesignChanged: false,
  rule: "Service generation time is not treated as upstream source update time.",
  summary,
  adapters,
};
fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

const priority = services.filter((service) => ["active", "pilot", "production-active", "map-search-pilot-ready"].includes(service.adapterStatus));
const rows = priority.length ? priority : services.filter((service) => service.status === "manifest-present").slice(0, 30);
const markdown = [
  "# White Rabbit Source Freshness Audit",
  "",
  `Generated: ${generatedAt}`,
  "",
  "- Page design changed: no",
  `- County adapters inspected: ${summary.adapterCount.toLocaleString()}`,
  `- Service manifests present: ${summary.manifestsPresent.toLocaleString()}`,
  `- Service manifests missing: ${summary.manifestsMissing.toLocaleString()}`,
  `- Current: ${summary.current.toLocaleString()}`,
  `- Stale: ${summary.stale.toLocaleString()}`,
  `- Unknown: ${summary.unknown.toLocaleString()}`,
  "",
  "White Rabbit does not treat an artifact build timestamp as proof that the upstream county or municipal source is current.",
  "",
  "## Connected/Priority Services",
  "",
  "| Adapter | Layer | Manifest | Source updated | Freshness |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.adapterId} | ${row.layer} | ${row.status} | ${row.sourceUpdatedAt || "not published"} | ${row.freshnessStatus} |`),
  "",
].join("\n");
fs.writeFileSync(outputMarkdown, markdown);

console.log(`Wrote ${path.relative(root, outputJson)}`);
console.log(`Wrote ${path.relative(root, outputMarkdown)}`);
console.log(`Adapters: ${summary.adapterCount}; manifests: ${summary.manifestsPresent}; unknown freshness: ${summary.unknown}`);
