const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const coveragePath = path.join(root, "output", "national-county-intelligence", "national-coverage-manifest.json");
const planPath = path.join(root, "data", "platform-program-plan.json");
const sourceAuditPath = path.join(root, "data", "county-source-audits", "tx-priority-tranche-001-official-sources.json");
const outputDirectory = path.join(root, "output", "national-county-intelligence");
const outputJson = path.join(outputDirectory, "national-completion-queue.json");
const outputMarkdown = path.join(outputDirectory, "national-completion-queue.md");
const batchSize = 25;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function status(value, evidence = "") {
  return { status: value, evidence };
}

const coverage = readJson(coveragePath);
const plan = readJson(planPath);
const sourceAudit = readJson(sourceAuditPath);
const immediateOrder = new Map(plan.immediateCountyTranche.map((countyId, index) => [countyId, index]));
const auditedSources = new Map(sourceAudit.counties.map((county) => [county.countyId, county]));

function gatesFor(county) {
  const audit = auditedSources.get(county.countyId);
  const live = county.stage === "live";
  const hasSource = county.stage !== "scaffolded";
  const hasCount = Number(county.verifiedParcelCount || 0) > 0;
  const schemaEvidence = fs.existsSync(path.join(root, "output", county.countyId, "schema-report.json"));
  const geometryEvidence = audit?.keyAuditSummary?.missingGeometry === 0;

  return {
    adapterScaffold: status("passed", county.adapterPath),
    officialSource: status(hasSource ? "passed" : "unverified", hasSource ? county.stageReasons.join("; ") : "official source discovery required"),
    rights: status(live ? "passed" : audit?.rightsVerified === false ? "failed" : "unverified", live ? "production adapter" : audit ? "county source audit" : "rights evidence required"),
    schemaMapped: status(live || schemaEvidence ? "passed" : "unverified", live ? "production adapter" : schemaEvidence ? `output/${county.countyId}/schema-report.json` : "schema report required"),
    stableIdentity: status(live ? "passed" : audit?.keyAuditStatus?.startsWith("completed-no-production") ? "failed" : "unverified", live ? "production adapter" : audit?.keyAuditStatus || "join-key audit required"),
    exactCount: status(live || hasCount ? "passed" : "unverified", hasCount ? String(county.verifiedParcelCount) : "exact source count required"),
    geometryQuality: status(live || geometryEvidence ? "passed" : "unverified", live ? "production adapter" : geometryEvidence ? "zero missing geometries observed in publishing service" : "geometry QA required"),
    normalizedArtifacts: status(live ? "passed" : "unverified", live ? "production adapter" : "universal parcel artifacts required"),
    searchAndViewportDelivery: status(live ? "passed" : "unverified", live ? "production adapter" : "search shards and viewport delivery required"),
    freshness: status(live ? "passed" : county.countyId === "montgomery-county-tx" ? "failed" : "unverified", live ? "production adapter" : county.countyId === "montgomery-county-tx" ? "uniform 2021 EditDate cannot certify freshness" : "freshness evidence required"),
    countyQa: status(live ? "passed" : county.stage === "qa" ? "in-progress" : "unverified", county.qc?.path || "county QA required"),
    activation: status(live ? "passed" : "blocked", live ? "production-enabled" : "all gates must pass independently"),
  };
}

function nextGate(gates) {
  const order = ["officialSource", "rights", "schemaMapped", "stableIdentity", "exactCount", "geometryQuality", "normalizedArtifacts", "searchAndViewportDelivery", "freshness", "countyQa", "activation"];
  return order.find((gate) => gates[gate].status !== "passed") || "complete";
}

function priorityRank(county) {
  if (immediateOrder.has(county.countyId)) return 0;
  if (county.stage === "qa") return 1;
  if (county.priority) return 2;
  if (county.stage === "processing") return 3;
  if (county.stage === "source-found") return 4;
  if (county.stage === "scaffolded") return 5;
  return 6;
}

const counties = coverage.counties.map((county) => {
  const gates = gatesFor(county);
  const gateValues = Object.values(gates);
  return {
    ...county,
    gates,
    passedGateCount: gateValues.filter((gate) => gate.status === "passed").length,
    totalGateCount: gateValues.length,
    nextGate: nextGate(gates),
    workstream: immediateOrder.has(county.countyId) ? "immediate-tranche" : county.priority ? "priority-county" : "national-backlog",
  };
});

const workQueue = counties
  .filter((county) => county.stage !== "live")
  .sort((a, b) => priorityRank(a) - priorityRank(b)
    || (immediateOrder.get(a.countyId) ?? Number.MAX_SAFE_INTEGER) - (immediateOrder.get(b.countyId) ?? Number.MAX_SAFE_INTEGER)
    || (a.priority?.wave ?? Number.MAX_SAFE_INTEGER) - (b.priority?.wave ?? Number.MAX_SAFE_INTEGER)
    || (a.priority?.sequence ?? Number.MAX_SAFE_INTEGER) - (b.priority?.sequence ?? Number.MAX_SAFE_INTEGER)
    || a.fips.localeCompare(b.fips))
  .map((county, index) => ({
    queuePosition: index + 1,
    batchNumber: Math.floor(index / batchSize) + 1,
    countyId: county.countyId,
    countyName: county.countyName,
    state: county.state,
    fips: county.fips,
    stage: county.stage,
    workstream: county.workstream,
    passedGateCount: county.passedGateCount,
    totalGateCount: county.totalGateCount,
    nextGate: county.nextGate,
  }));

const gateSummary = {};
for (const gateName of Object.keys(counties[0].gates)) {
  gateSummary[gateName] = ["passed", "in-progress", "failed", "unverified", "blocked"].reduce((summary, gateStatus) => {
    summary[gateStatus] = counties.filter((county) => county.gates[gateName].status === gateStatus).length;
    return summary;
  }, {});
}

const stateSummary = coverage.states.map((state) => {
  const stateCounties = counties.filter((county) => county.state === state.state);
  return {
    state: state.state,
    countyEquivalentCount: stateCounties.length,
    complete: stateCounties.filter((county) => county.stage === "live").length,
    incomplete: stateCounties.filter((county) => county.stage !== "live").length,
    nextOfficialSource: stateCounties.filter((county) => county.nextGate === "officialSource").length,
    nextRights: stateCounties.filter((county) => county.nextGate === "rights").length,
  };
});

const report = {
  schemaVersion: "wr-national-county-completion-queue-v1",
  generatedAt: new Date().toISOString(),
  policy: "Every county is tracked through independent evidence gates. Queue placement does not authorize data capture, redistribution, frontend visibility, or production activation.",
  gateOrder: ["adapterScaffold", "officialSource", "rights", "schemaMapped", "stableIdentity", "exactCount", "geometryQuality", "normalizedArtifacts", "searchAndViewportDelivery", "freshness", "countyQa", "activation"],
  summary: {
    countyEquivalentCount: counties.length,
    completeCountyCount: counties.filter((county) => county.stage === "live").length,
    incompleteCountyCount: workQueue.length,
    stateAreaCount: stateSummary.length,
    batchSize,
    batchCount: Math.ceil(workQueue.length / batchSize),
    immediateTrancheCount: plan.immediateCountyTranche.length,
  },
  gateSummary,
  stateSummary,
  workQueue,
  counties,
};

const markdown = [
  "# White Rabbit National County Completion Queue",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  `- County equivalents: ${report.summary.countyEquivalentCount}`,
  `- Complete/live: ${report.summary.completeCountyCount}`,
  `- Remaining: ${report.summary.incompleteCountyCount}`,
  `- Work batches: ${report.summary.batchCount} at up to ${report.summary.batchSize} counties`,
  `- States/areas: ${report.summary.stateAreaCount}`,
  "",
  "## First 25 queued counties",
  "",
  "| Queue | County | State | FIPS | Stage | Gates passed | Next gate |",
  "| ---: | --- | --- | --- | --- | ---: | --- |",
  ...workQueue.slice(0, 25).map((county) => `| ${county.queuePosition} | ${county.countyName} | ${county.state} | ${county.fips} | ${county.stage} | ${county.passedGateCount}/${county.totalGateCount} | ${county.nextGate} |`),
  "",
  "## Release rule",
  "",
  report.policy,
  "",
].join("\n");

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(outputMarkdown, markdown);
console.log(JSON.stringify(report.summary, null, 2));
