const fs = require("fs");
const path = require("path");

const STATUS_SCHEMA_VERSION = "wr-savant-maintenance-status-v1";
const AGENT_ID = "savant-data-maintenance-agent";
const REQUIRED_PERMIT_SOURCE_IDS = ["e7gq-4sah", "9qet-qt9e"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function iso(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function ageHours(older, newer) {
  const start = new Date(older).getTime();
  const end = new Date(newer).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Number(((end - start) / 3600000).toFixed(2));
}

function unixSecondsToIso(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed * 1000).toISOString() : "";
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.abs(current - previous) / Math.abs(previous);
}

function gate(id, passed, details = {}) {
  return { id, status: passed ? "passed" : "blocked", ...details };
}

function metadataSourceState(root, source) {
  const metadataFile = path.join(root, "data", "permits", "raw", `${source.id}-metadata.json`);
  const metadata = fs.existsSync(metadataFile) ? readJson(metadataFile) : {};
  const sourceUpdatedAt = iso(source.sourceUpdatedAt) || unixSecondsToIso(metadata.rowsUpdatedAt || metadata.metadataUpdatedAt);
  return {
    id: source.id,
    name: source.name,
    sourceUrl: source.sourceUrl,
    rowCount: Number(source.rowCount ?? source.fetchedRows ?? 0),
    fetchedRows: Number(source.fetchedRows ?? source.rowCount ?? 0),
    sourceUpdatedAt,
  };
}

function buildRefreshPlan({ skipFetch = false } = {}) {
  return [
    ...(!skipFetch ? [{ id: "fetch-permits", command: "npm", args: ["run", "permits:fetch"] }] : []),
    { id: "build-permits", command: "npm", args: ["run", "permits:build"] },
    { id: "build-development-signals", command: "npm", args: ["run", "developments:build"] },
    { id: "index-development-signals", command: "npm", args: ["run", "developments:index"] },
    { id: "build-opportunities", command: "npm", args: ["run", "opportunities:build"] },
    { id: "build-savant-radar", command: "npm", args: ["run", "savant:development-path"] },
    { id: "audit-freshness", command: "npm", args: ["run", "freshness:audit"] },
    { id: "test-permit-pipeline", command: "node", args: ["tests/permit-pipeline.test.cjs"] },
    { id: "test-development-intelligence", command: "node", args: ["tests/development-intelligence.test.cjs"] },
    { id: "test-opportunity-intelligence", command: "node", args: ["tests/dallas-parcel-opportunity-intelligence.test.cjs"] },
    { id: "test-savant-tools", command: "node", args: ["tests/savant-tools.test.cjs"] },
  ];
}

function validateSavantArtifacts(root, options = {}) {
  const checkedAt = iso(options.now || new Date().toISOString());
  const policy = {
    maximumSnapshotAgeHours: Number(options.maximumSnapshotAgeHours ?? 36),
    maximumPipelineSkewHours: Number(options.maximumPipelineSkewHours ?? 6),
    maximumUpstreamSourceAgeDays: Number(options.maximumUpstreamSourceAgeDays ?? 45),
    minimumPermitJoinRate: Number(options.minimumPermitJoinRate ?? 0.55),
    maximumJoinRateDrop: Number(options.maximumJoinRateDrop ?? 0.05),
    maximumCandidateCountDrift: Number(options.maximumCandidateCountDrift ?? 0.5),
  };
  const files = {
    sourceManifest: path.join(root, "data", "permits", "raw", "source-manifest.json"),
    permitManifest: path.join(root, "public", "data", "permits", "manifest.json"),
    developmentSummary: path.join(root, "output", "development-intelligence.json"),
    developmentManifest: path.join(root, "public", "data", "developments", "manifest.json"),
    opportunityManifest: path.join(root, "public", "data", "opportunities", "manifest.json"),
    radar: path.join(root, "public", "data", "savant-tools", "development-path-radar.json"),
  };
  const missingFiles = Object.entries(files).filter(([, file]) => !fs.existsSync(file)).map(([name]) => name);
  if (missingFiles.length) {
    return {
      schemaVersion: STATUS_SCHEMA_VERSION,
      agentId: AGENT_ID,
      checkedAt,
      status: "blocked",
      publishAuthorized: false,
      policy,
      gates: [gate("required-artifacts", false, { missingFiles })],
      metrics: {},
      sources: [],
    };
  }

  const sourceManifest = readJson(files.sourceManifest);
  const permit = readJson(files.permitManifest);
  const developmentSummary = readJson(files.developmentSummary);
  const development = readJson(files.developmentManifest);
  const opportunity = readJson(files.opportunityManifest);
  const radar = readJson(files.radar);
  const sources = (sourceManifest.sources || []).map((source) => metadataSourceState(root, source));
  const sourceIds = sources.map((source) => source.id).sort();
  const fetchedRowCountsMatch = sources.every((source) => source.rowCount === source.fetchedRows && source.rowCount > 0);
  const snapshotAgeHours = ageHours(sourceManifest.generatedAt, checkedAt);
  const sourceAgesDays = sources.map((source) => ({
    id: source.id,
    sourceUpdatedAt: source.sourceUpdatedAt,
    ageDays: source.sourceUpdatedAt === "" ? null : Number((ageHours(source.sourceUpdatedAt, checkedAt) / 24).toFixed(2)),
  }));
  const pipelineTimes = [permit.generatedAt, developmentSummary.generatedAt, development.generatedAt, opportunity.generatedAt, radar.generatedAt]
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const pipelineSkewHours = pipelineTimes.length === 5 ? Number(((Math.max(...pipelineTimes) - Math.min(...pipelineTimes)) / 3600000).toFixed(2)) : null;
  const permitCount = Number(permit.permitCount || 0);
  const joinedPermitCount = Number(permit.joinedPermitCount || 0);
  const unmatchedPermitCount = Number(permit.unmatchedPermitCount || 0);
  const joinRate = permitCount ? Number((joinedPermitCount / permitCount).toFixed(6)) : 0;
  const candidateCount = Number(opportunity.candidateCount || 0);
  const radarCandidates = Array.isArray(radar.topCandidates) ? radar.topCandidates : [];
  const uniqueRadarAccounts = new Set(radarCandidates.map((candidate) => candidate.accountNum)).size;
  const radarSorted = radarCandidates.every((candidate, index) => index === 0 || Number(radarCandidates[index - 1].score) >= Number(candidate.score));
  const baseline = options.baseline?.metrics || {};
  const joinRateDrop = Number.isFinite(baseline.permitJoinRate) ? baseline.permitJoinRate - joinRate : null;
  const candidateDrift = percentChange(candidateCount, baseline.opportunityCandidateCount);
  const gates = [
    gate("required-artifacts", true),
    gate("official-source-identities", REQUIRED_PERMIT_SOURCE_IDS.every((id) => sourceIds.includes(id)), { expected: REQUIRED_PERMIT_SOURCE_IDS, observed: sourceIds }),
    gate("source-row-reconciliation", fetchedRowCountsMatch, { sources: sources.map(({ id, rowCount, fetchedRows }) => ({ id, rowCount, fetchedRows })) }),
    gate("source-snapshot-recency", snapshotAgeHours !== null && snapshotAgeHours <= policy.maximumSnapshotAgeHours, { snapshotGeneratedAt: iso(sourceManifest.generatedAt), ageHours: snapshotAgeHours, maximumAgeHours: policy.maximumSnapshotAgeHours }),
    gate("upstream-source-recency", sourceAgesDays.every((source) => source.ageDays !== null && source.ageDays <= policy.maximumUpstreamSourceAgeDays), { sources: sourceAgesDays, maximumAgeDays: policy.maximumUpstreamSourceAgeDays }),
    gate("permit-count-reconciliation", permitCount > 0 && joinedPermitCount + unmatchedPermitCount === permitCount && Number(permit.searchIndexCount) === permitCount, { permitCount, joinedPermitCount, unmatchedPermitCount, searchIndexCount: Number(permit.searchIndexCount || 0) }),
    gate("permit-join-quality", joinRate >= policy.minimumPermitJoinRate && (joinRateDrop === null || joinRateDrop <= policy.maximumJoinRateDrop), { joinRate, minimumJoinRate: policy.minimumPermitJoinRate, previousJoinRate: baseline.permitJoinRate ?? null, joinRateDrop }),
    gate("development-reconciliation", Number(developmentSummary.sourcePermitCount) === permitCount && Number(development.parcelCount) === Number(developmentSummary.parcelCountWithSignals), { sourcePermitCount: Number(developmentSummary.sourcePermitCount || 0), permitCount, developmentParcelCount: Number(development.parcelCount || 0), summaryParcelCount: Number(developmentSummary.parcelCountWithSignals || 0) }),
    gate("opportunity-reconciliation", candidateCount > 0 && candidateCount === Number(radar.opportunityCandidateCount) && candidateCount === Number(radar.analyzedCandidateCount), { candidateCount, radarOpportunityCandidateCount: Number(radar.opportunityCandidateCount || 0), radarAnalyzedCandidateCount: Number(radar.analyzedCandidateCount || 0) }),
    gate("candidate-drift", candidateDrift === null || candidateDrift <= policy.maximumCandidateCountDrift, { previousCandidateCount: baseline.opportunityCandidateCount ?? null, candidateCount, drift: candidateDrift, maximumDrift: policy.maximumCandidateCountDrift }),
    gate("radar-integrity", radarCandidates.length > 0 && radarCandidates.length <= 120 && uniqueRadarAccounts === radarCandidates.length && radarSorted && radarCandidates.every((candidate) => Array.isArray(candidate.reasonCodes) && candidate.reasonCodes.length > 0), { candidateCount: radarCandidates.length, uniqueAccountCount: uniqueRadarAccounts, sortedByScore: radarSorted }),
    gate("pipeline-coherence", pipelineSkewHours !== null && pipelineSkewHours <= policy.maximumPipelineSkewHours, { pipelineSkewHours, maximumSkewHours: policy.maximumPipelineSkewHours, generatedAt: { permit: iso(permit.generatedAt), developmentSummary: iso(developmentSummary.generatedAt), development: iso(development.generatedAt), opportunity: iso(opportunity.generatedAt), radar: iso(radar.generatedAt) } }),
  ];
  const blocked = gates.filter((item) => item.status === "blocked");
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    agentId: AGENT_ID,
    checkedAt,
    status: blocked.length ? "blocked" : "healthy",
    publishAuthorized: blocked.length === 0,
    policy,
    gates,
    metrics: {
      permitCount,
      joinedPermitCount,
      unmatchedPermitCount,
      permitJoinRate: joinRate,
      developmentParcelCount: Number(development.parcelCount || 0),
      opportunityCandidateCount: candidateCount,
      publishedRadarCandidateCount: radarCandidates.length,
      sourceSnapshotAgeHours: snapshotAgeHours,
      pipelineSkewHours,
    },
    sources,
  };
}

module.exports = {
  AGENT_ID,
  REQUIRED_PERMIT_SOURCE_IDS,
  STATUS_SCHEMA_VERSION,
  buildRefreshPlan,
  validateSavantArtifacts,
};
