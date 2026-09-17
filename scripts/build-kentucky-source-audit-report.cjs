const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const queueBuilder = path.join(root, "scripts", "build-tx-ky-verification-queues.cjs");
const queuePath = path.join(root, "output", "tx-ky-verification-queues", "tx-ky-verification-queues.json");
const outputDir = path.join(root, "output", "kentucky-source-audit");
const verifiedProbePath = path.join(outputDir, "kentucky-verified-source-probe.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function compact(value) {
  return String(value ?? "").trim();
}

function isVerifiedValue(value) {
  const text = compact(value);
  return Boolean(text) && !/source-needed|unresolved|not verified|not-verified/i.test(text);
}

function officialCandidates(adapter) {
  const candidates = [];
  const add = (label, value) => {
    const url = compact(value);
    if (!/^https:\/\//i.test(url) || candidates.some((item) => item.url === url)) return;
    candidates.push({ label, url });
  };
  add("Official site", adapter.verifiedDiscovery?.officialSite);
  add("Property search", adapter.verifiedDiscovery?.propertySearch);
  add("Interactive map", adapter.verifiedDiscovery?.interactiveMap);
  for (const [key, value] of Object.entries(adapter.sourceFiles || {})) add(key, value);
  return candidates;
}

function auditCounty(entry, batchNumber, verifiedProbeByCountyId) {
  const adapterFile = path.join(root, entry.adapterPath);
  const adapter = readJson(adapterFile);
  const verified = adapter.verifiedCounts || {};
  const parcelCount = Number(verified.parcelGeometryFeatures || 0);
  const chunkCount = Number(verified.appParcelChunks || 0);
  const shardCount = Number(verified.parcelSearchShards || 0);
  const parcelManifest = `public/data/counties/${adapter.id}/parcels/manifest.json`;
  const manifestPresent = fs.existsSync(path.join(root, parcelManifest));
  const manifest = manifestPresent ? readJson(path.join(root, parcelManifest)) : null;
  const sourceProbe = verifiedProbeByCountyId.get(entry.countyId) || null;
  const candidates = officialCandidates(adapter);
  if (sourceProbe?.sourceUrl && !candidates.some((item) => item.url === sourceProbe.sourceUrl)) {
    candidates.push({ label: "Verified parcel feature service", url: sourceProbe.sourceUrl });
  }
  const identityVerified = isVerifiedValue(adapter.uniqueGisKey) && isVerifiedValue(adapter.parcelIdField);
  const ownerReady = isVerifiedValue(adapter.ownerEnrichment?.officialJoinKey) && isVerifiedValue(adapter.ownerEnrichment?.fields?.ownerName);
  const mapSearchBuilt = parcelCount > 0 && manifestPresent && (chunkCount > 0 || shardCount > 0);
  const remainingBlockers = [];
  if (!candidates.length) remainingBlockers.push("official appraisal/PVA or county GIS source audit not started");
  if (!parcelCount) remainingBlockers.push("exact parcel geometry feature count not verified");
  if (!identityVerified) remainingBlockers.push("complete duplicate-safe parcel identity not verified");
  if (!ownerReady) remainingBlockers.push("owner/appraisal source and join not verified");
  if (!manifestPresent) remainingBlockers.push("full viewport parcel service not built");
  if (!shardCount) remainingBlockers.push("parcel search shards not built or not locked in adapter counts");
  remainingBlockers.push("county activation review not passed");

  let auditStatus = "source-queue-not-yet-audited";
  if (candidates.length) auditStatus = "source-discovery-started";
  if (parcelCount && identityVerified) auditStatus = "official-source-and-identity-verified";
  if (mapSearchBuilt) auditStatus = "map-search-pilot-built";

  return {
    sequence: entry.sequence,
    batch: batchNumber,
    countyId: entry.countyId,
    adapterId: entry.adapterId,
    countyName: entry.countyName,
    state: "KY",
    adapterPath: entry.adapterPath,
    auditStatus,
    safeVisibleActivation: "do-not-activate-until-county-gate-passes",
    exactCounts: {
      parcelGeometryFeatures: parcelCount,
      emittedParcelFeatures: Number(manifest?.featureCount || 0),
      geometrySkipped: Number(manifest?.skipped || Math.max(0, parcelCount - Number(manifest?.featureCount || parcelCount))),
      viewportChunks: chunkCount,
      searchShards: shardCount,
    },
    identityVerified,
    ownerAppraisalReady: ownerReady,
    parcelManifest,
    parcelManifestPresent: manifestPresent,
    sourceProbe: sourceProbe ? {
      status: sourceProbe.status,
      observedAt: sourceProbe.observedAt,
      exactFeatureCount: Number(sourceProbe.exactFeatureCount || 0),
      geometryType: sourceProbe.geometryType || "",
      identityCandidate: sourceProbe.identityCandidate || "",
      identityUniqueness: sourceProbe.identityUniqueness || "unverified",
      supportsPagination: sourceProbe.supportsPagination === true,
      rawEvidenceDirectory: sourceProbe.rawEvidenceDirectory || "",
      captureAuthorized: sourceProbe.captureAuthorized === true,
      rightsStatus: sourceProbe.rightsStatus || "unverified",
    } : null,
    officialCandidates: candidates,
    remainingBlockers,
  };
}

function markdownFor(title, report) {
  return [
    `# ${title}`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.completionRule,
    "",
    `- Counties: ${report.summary.countyCount}`,
    `- Map/search pilots built: ${report.summary.mapSearchPilotBuilt}`,
    `- Official source and identity verified: ${report.summary.officialSourceAndIdentityVerified}`,
    `- Source discovery started: ${report.summary.sourceDiscoveryStarted}`,
    `- Not yet audited: ${report.summary.notYetAudited}`,
    "",
    "| County | Audit status | Captured source features | Live probed features | Emitted features | Skipped | Chunks | Shards | Official candidates | Remaining blockers |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...report.counties.map((county) => `| ${county.countyName} | ${county.auditStatus} | ${county.exactCounts.parcelGeometryFeatures} | ${county.sourceProbe?.exactFeatureCount || 0} | ${county.exactCounts.emittedParcelFeatures} | ${county.exactCounts.geometrySkipped} | ${county.exactCounts.viewportChunks} | ${county.exactCounts.searchShards} | ${county.officialCandidates.map((item) => item.label).join(", ") || "none"} | ${county.remainingBlockers.join(", ")} |`),
    "",
    "Every county remains disabled until its own evidence and activation gates pass. No frontend behavior is changed by this audit.",
    "",
  ].join("\n");
}

function summarize(counties) {
  return {
    countyCount: counties.length,
    mapSearchPilotBuilt: counties.filter((county) => county.auditStatus === "map-search-pilot-built").length,
    officialSourceAndIdentityVerified: counties.filter((county) => county.auditStatus === "official-source-and-identity-verified").length,
    sourceDiscoveryStarted: counties.filter((county) => county.auditStatus === "source-discovery-started").length,
    notYetAudited: counties.filter((county) => county.auditStatus === "source-queue-not-yet-audited").length,
  };
}

function main() {
  execFileSync("node", [queueBuilder], { cwd: root, stdio: "pipe" });
  const queue = readJson(queuePath);
  const kentucky = queue.states.find((state) => state.state === "KY");
  if (!kentucky) throw new Error("Kentucky verification queue is missing.");
  const generatedAt = new Date().toISOString();
  const verifiedProbe = fs.existsSync(verifiedProbePath) ? readJson(verifiedProbePath) : { counties: [] };
  const verifiedProbeByCountyId = new Map((verifiedProbe.counties || []).map((county) => [county.countyId, county]));
  const completionRule = "Source discovery is evidence, not completion. Exact counts, duplicate-safe identity, owner/appraisal fields, full viewport/search outputs, QC, and an individual activation review are required.";
  const batchReports = kentucky.batches.map((batch) => {
    const counties = batch.counties.map((county) => auditCounty(county, batch.batch, verifiedProbeByCountyId));
    const report = {
      version: "wr-kentucky-source-audit-v1",
      generatedAt,
      batch: batch.batch,
      completionRule,
      summary: summarize(counties),
      counties,
    };
    const slug = `ky-batch-${String(batch.batch).padStart(3, "0")}-source-audit`;
    writeJson(path.join(outputDir, `${slug}.json`), report);
    fs.writeFileSync(path.join(outputDir, `${slug}.md`), markdownFor(`Kentucky Batch ${String(batch.batch).padStart(3, "0")} Source Audit`, report));
    return report;
  });
  const counties = batchReports.flatMap((report) => report.counties);
  const aggregate = {
    version: "wr-kentucky-source-audit-v1",
    generatedAt,
    source: "output/tx-ky-verification-queues/tx-ky-verification-queues.json",
    completionRule,
    uiConstraint: "Do not redesign, restyle, or activate White Rabbit pages while Kentucky source evidence advances.",
    batchCount: batchReports.length,
    summary: summarize(counties),
    counties,
  };
  writeJson(path.join(outputDir, "kentucky-source-audit.json"), aggregate);
  fs.writeFileSync(path.join(outputDir, "kentucky-source-audit.md"), markdownFor("Kentucky Source Audit", aggregate));
  console.log(JSON.stringify({ batchCount: aggregate.batchCount, ...aggregate.summary }, null, 2));
}

main();
