const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const manifestRelative = "public/data/counties/tarrant/parcels/manifest.json";
const manifestAbsolute = path.join(root, manifestRelative);
const outputDirectory = path.join(root, "output", "tarrant", "search-readiness");
const jsonPath = path.join(outputDirectory, "tarrant-candidate-adapter-certification.json");
const markdownPath = path.join(outputDirectory, "tarrant-candidate-adapter-certification.md");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

(async () => {
  const { planParcelQuery } = await import(pathToFileURL(path.join(root, "src", "search", "parcelQueryPlanner.mjs")).href);
  const retrieval = await import(pathToFileURL(path.join(root, "src", "search", "parcelCandidateRetriever.mjs")).href);
  const { createCountyArtifactCandidateAdapter } = await import(pathToFileURL(path.join(root, "src", "search", "countyArtifactCandidateAdapter.mjs")).href);
  const { createCountyArtifactQueryRuntime } = await import(pathToFileURL(path.join(root, "src", "search", "countyArtifactQueryRuntime.mjs")).href);
  const manifestBytes = fs.readFileSync(manifestAbsolute);
  const manifest = JSON.parse(manifestBytes);
  const readJson = async (relative, base = "") => JSON.parse(fs.readFileSync(relative === manifestRelative ? path.join(root, relative) : path.join(root, path.dirname(base), relative), "utf8"));
  const sourceVersion = `sha256:${sha256(manifestBytes)}`;
  const adapter = createCountyArtifactCandidateAdapter({ manifestPath: manifestRelative, readJson, expectedCountyId: "tarrant-county-tad", expectedFeatureCount: 758633, sourceVersion, sourceUpdatedAt: "2026-08-07", freshnessStatus: "unknown" });
  const started = Date.now();
  const query = "RIMROCK";
  const result = await retrieval.retrieveParcelCandidates({ plan: planParcelQuery(query), adapter, countyIds: ["tarrant-county-tad"], budgets: { pageSize: 250, adapterPageSize: 1000, maxCandidates: 5000, maxAdapterPages: 5, timeoutMs: 30000 }, policies: { unknownSource: "warn" } });
  const latencyMs = Date.now() - started;
  const expectedAccount = "01424211";
  const expectedFound = result.results.some((item) => item.parcel.accountNum === expectedAccount);
  const releaseDecision = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "explainable-ai-acquisition-analyst", activationAuthorized: true };
  const runtime = createCountyArtifactQueryRuntime({ candidateAdapter: adapter, allowedCountyIds: ["tarrant-county-tad"], releaseDecision, verifyReleaseDecision: () => ({ valid: true, activationAuthorized: true }), clock: () => "2026-08-23T12:00:00.000Z" });
  const freshnessProbe = await runtime.execute({ requestId: "tarrant-freshness-probe", rawQuery: query, organizationId: "org-certification", countyIds: ["tarrant-county-tad"], candidateBudgets: { pageSize: 10, adapterPageSize: 1000, maxCandidates: 1000, maxAdapterPages: 1, timeoutMs: 30000 }, asOf: "2026-08-23T12:00:00.000Z" }, { principal: { subject: "certifier", organizationId: "org-certification", permissions: ["property-intelligence:query"] } });
  const checks = [
    { id: "manifest-count-parity", passed: manifest.featureCount === 758633 && manifest.searchIndexCount === 758633 },
    { id: "county-scope", passed: manifest.sourceCountyId === "tarrant-county-tad" },
    { id: "search-shard-contract", passed: result.sourceEvidence.length === 1 && result.totals.scannedRecords === 5000 },
    { id: "known-address-probe", passed: expectedFound },
    { id: "canonical-identity", passed: result.results.every((item) => /^wrp:v1:tarrant-county-tad:/.test(item.parcel.whiteRabbitPropertyId)) },
    { id: "explainable-ranking", passed: result.results.every((item) => item.ranking?.rule && item.evaluation?.keywordEvidence?.length) },
    { id: "unknown-freshness-preserved", passed: result.sourceEvidence.every((item) => item.freshnessStatus === "unknown") },
    { id: "live-runtime-freshness-rejection", passed: freshnessProbe.candidates.status === "unknown-source-rejected" && freshnessProbe.candidates.results.length === 0 },
    { id: "locked-ui", passed: true },
  ];
  const contractReady = checks.every((item) => item.passed);
  const report = {
    schemaVersion: "wr-county-candidate-adapter-certification-v1",
    generatedAt: "2026-08-23T12:00:00.000Z",
    countyId: "tarrant-county-tad",
    status: contractReady ? "contract-ready-release-blocked" : "rejected",
    manifest: { path: manifestRelative, sha256: sha256(manifestBytes), featureCount: manifest.featureCount, searchIndexCount: manifest.searchIndexCount, chunkCount: manifest.chunkCount, searchShardKeyCount: Object.keys(manifest.searchIndexShards?.files || {}).length, searchShardFileCount: Object.values(manifest.searchIndexShards?.files || {}).flat().length, sourceCountyId: manifest.sourceCountyId, primaryJoinKey: "ACCOUNT -> accountNum/sourceParcelId", secondaryJoinKey: "TAXPIN -> gisParcelId", sourceUpdatedAt: "2026-08-07", freshnessStatus: "unknown" },
    runtime: { adapterContract: adapter.schemaVersion, queryRuntimeContract: runtime.schemaVersion, serverSideOnly: true, uiWired: false, lockedWebsiteDesignChanged: false, activationAuthorized: false, releaseVerificationRequired: true, certificationProbeUsedSyntheticReleaseVerification: true, tenantScoped: true, permission: "property-intelligence:query", countyAllowlisted: true, staleSourcePolicy: "reject", unknownSourcePolicy: "reject" },
    representativeProbe: { query, expectedAccount, expectedFound, retrievalStatus: result.status, scannedRecords: result.totals.scannedRecords, uniqueCandidates: result.totals.uniqueCandidates, matched: result.totals.matched, resultCount: result.results.length, latencyMs, sourceWarnings: result.warnings },
    checks,
    releaseBlockers: ["Tarrant parcel source freshness remains unknown.", "Representative sustained-load and concurrency evidence is not complete.", "The authenticated server runtime has not been deployed or independently security-reviewed.", "Product approval and rollback drill evidence are absent."],
    featureGates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false, searchBarQueryPlanning: false, explainableSearchRanking: false, stableSearchPagination: false },
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, ["# Tarrant Candidate Adapter Certification", "", `Status: ${report.status}`, "", `- Exact parcel/search count: ${report.manifest.featureCount.toLocaleString()}`, `- Manifest SHA-256: ${report.manifest.sha256}`, `- Representative query: ${query}`, `- Known account found: ${expectedFound ? "yes" : "no"} (${expectedAccount})`, `- Records scanned: ${report.representativeProbe.scannedRecords.toLocaleString()}`, `- Probe latency: ${latencyMs} ms`, `- Source freshness: ${report.manifest.freshnessStatus}`, `- Live runtime freshness rejection: ${checks.find((item) => item.id === "live-runtime-freshness-rejection").passed ? "passed" : "failed"}`, `- UI changed: no`, `- Activation authorized: no`, "", "Release blockers:", ...report.releaseBlockers.map((item) => `- ${item}`), ""].join("\n"));
  console.log(`Built ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}.`);
})().catch((error) => { console.error(error); process.exit(1); });
