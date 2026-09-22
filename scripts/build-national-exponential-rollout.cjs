const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const coveragePath = path.join(root, "output", "national-county-intelligence", "national-coverage-manifest.json");
const completionPath = path.join(root, "output", "national-county-intelligence", "national-completion-queue.json");
const connectionPath = path.join(root, "output", "county-connection-gate.json");
const outputJson = path.join(root, "output", "national-county-intelligence", "exponential-rollout.json");
const outputMarkdown = path.join(root, "output", "national-county-intelligence", "exponential-rollout.md");

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Required evidence is missing: ${path.relative(root, file)}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function marketKey(county) {
  return `${county.state}|${county.countyName}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
}

const coverage = readJson(coveragePath);
const completion = readJson(completionPath);
const connection = readJson(connectionPath);
const completionByFips = new Map(completion.counties.map((county) => [county.fips, county]));
const connectionByMarket = new Map(connection.counties.map((county) => [marketKey(county), county]));

const stageRank = { live: 0, qa: 1, processing: 2, "source-found": 3, scaffolded: 4 };
const ranked = coverage.counties.map((county) => {
  const queue = completionByFips.get(county.fips);
  const connected = connectionByMarket.get(marketKey(county));
  const productionActive = connected?.activationStage === "production-active";
  const mapSearchReady = connected?.mapSearchReady === true;
  const dcadLikeWindowReady = connected?.dcadLikeWindowReady === true;
  const priority = county.priority != null || connected != null;
  let nextAction = "official-source-discovery";
  if (county.stage === "source-found") nextAction = "capture-normalize-and-build";
  if (county.stage === "processing") nextAction = "finish-parcel-service-build";
  if (county.stage === "qa") nextAction = "close-qc-freshness-and-activation-gates";
  if (mapSearchReady) nextAction = "complete-parcel-intelligence-to-dcad-parity";
  if (dcadLikeWindowReady && !productionActive) nextAction = "certify-freshness-and-production-activation";
  if (productionActive) nextAction = "maintain-production-and-add-missing-intelligence";

  return {
    fips: county.fips,
    state: county.state,
    countyId: county.countyId,
    countyName: county.countyName,
    currentStage: county.stage,
    verifiedParcelCount: county.verifiedParcelCount || 0,
    passedGateCount: queue?.passedGateCount || 0,
    totalGateCount: queue?.totalGateCount || 12,
    nextGate: queue?.nextGate || "officialSource",
    mapSearchReady,
    dcadLikeWindowReady,
    activationAuthorized: productionActive && county.stage === "live",
    priority,
    nextAction,
    _rank: [
      productionActive ? 0 : dcadLikeWindowReady ? 1 : mapSearchReady ? 2 : 3,
      stageRank[county.stage] ?? 9,
      priority ? 0 : 1,
      -(queue?.passedGateCount || 0),
      county.fips,
    ],
  };
}).sort((a, b) => {
  for (let index = 0; index < a._rank.length; index += 1) {
    if (a._rank[index] < b._rank[index]) return -1;
    if (a._rank[index] > b._rank[index]) return 1;
  }
  return 0;
});

const waveTargets = [];
for (let target = 16, assigned = 0; assigned < ranked.length; target *= 2) {
  const size = Math.min(target, ranked.length - assigned);
  waveTargets.push(size);
  assigned += size;
}

let cursor = 0;
const waves = waveTargets.map((size, index) => {
  const counties = ranked.slice(cursor, cursor + size).map(({ _rank, ...county }) => county);
  cursor += size;
  return {
    wave: index + 1,
    executionStatus: index === 0 ? "active-work-block" : "queued-work-block",
    targetCountyCount: size,
    cumulativeCountyCount: cursor,
    growthMultipleFromWave1: Number((size / waveTargets[0]).toFixed(2)),
    readyNow: counties.filter((county) => county.mapSearchReady).length,
    activationAuthorizedNow: counties.filter((county) => county.activationAuthorized).length,
    sourceDiscoveryRequired: counties.filter((county) => county.currentStage === "scaffolded").length,
    statesAndAreas: [...new Set(counties.map((county) => county.state))].sort(),
    counties,
  };
});

const report = {
  schemaVersion: "wr-national-exponential-rollout-v1",
  generatedAt: new Date().toISOString(),
  objective: "Scale parcel intelligence to every United States county equivalent in exponentially larger, independently gated delivery waves.",
  truthBoundary: "A wave is a work assignment, not a coverage claim. No county becomes visible or active until its own official-source, rights, identity, count, geometry, delivery, freshness, QC, and activation gates pass.",
  sourceEvidence: {
    coverageManifest: path.relative(root, coveragePath).replaceAll("\\", "/"),
    completionQueue: path.relative(root, completionPath).replaceAll("\\", "/"),
    connectionGate: path.relative(root, connectionPath).replaceAll("\\", "/"),
  },
  promotionContract: {
    requiredParcelGates: completion.gateOrder,
    intelligenceGroups: [
      "identity", "geometry", "address", "owner-contact", "appraisal-values", "land-building",
      "parcel-dimensions", "block-grid", "zoning", "floodplain", "permits-certificates",
      "development-signals", "migration-demand", "source-lineage",
    ],
    mapSearchMinimum: "Verified full parcel service, viewport chunks or tiles, search shards, exact count reconciliation, and county QC.",
    cityMarketRequirement: "Each city market receives its own source-backed off-market parcel set and independently calculated 100-to-1 Savant ranking; rankings are never copied between cities.",
    activationRule: "Fail closed per county. Planning, source discovery, or a generated adapter never authorizes visible activation.",
  },
  summary: {
    countyEquivalentCount: ranked.length,
    uniqueFipsCount: new Set(ranked.map((county) => county.fips)).size,
    waveCount: waves.length,
    firstWaveCountyCount: waves[0]?.targetCountyCount || 0,
    finalCumulativeCountyCount: waves.at(-1)?.cumulativeCountyCount || 0,
    currentlyMapSearchReady: ranked.filter((county) => county.mapSearchReady).length,
    currentlyDcadLikeWindowReady: ranked.filter((county) => county.dcadLikeWindowReady).length,
    currentlyActivationAuthorized: ranked.filter((county) => county.activationAuthorized).length,
    currentlySourceFoundOrBetter: ranked.filter((county) => county.currentStage !== "scaffolded").length,
    sourceDiscoveryRequired: ranked.filter((county) => county.currentStage === "scaffolded").length,
    activeWorkBlock: 1,
  },
  waves,
};

fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);

const waveRows = waves.map((wave) =>
  `| ${wave.wave} | ${wave.executionStatus} | ${wave.targetCountyCount.toLocaleString("en-US")} | ${wave.cumulativeCountyCount.toLocaleString("en-US")} | ${wave.readyNow} | ${wave.activationAuthorizedNow} | ${wave.sourceDiscoveryRequired.toLocaleString("en-US")} | ${wave.statesAndAreas.length} |`
);
const firstWaveRows = waves[0].counties.map((county) =>
  `| ${county.countyName}, ${county.state} | ${county.fips} | ${county.currentStage} | ${county.passedGateCount}/${county.totalGateCount} | ${county.mapSearchReady ? "yes" : "no"} | ${county.activationAuthorized ? "yes" : "no"} | ${county.nextAction} |`
);
const markdown = `# National Exponential Parcel-Intelligence Rollout\n\nGenerated ${report.generatedAt}.\n\n${report.truthBoundary}\n\n## Current evidence\n\n- Active work block: ${report.summary.activeWorkBlock}. This means pipeline work is authorized; it does not authorize public activation.\n- County equivalents scheduled: ${report.summary.countyEquivalentCount.toLocaleString("en-US")} across ${coverage.summary.stateAreaCount} states/areas.\n- Map/search ready now: ${report.summary.currentlyMapSearchReady}.\n- DCAD-like intelligence window ready now: ${report.summary.currentlyDcadLikeWindowReady}.\n- Production activation authorized now: ${report.summary.currentlyActivationAuthorized}.\n- Official source found or better: ${report.summary.currentlySourceFoundOrBetter.toLocaleString("en-US")}.\n- Official source discovery still required: ${report.summary.sourceDiscoveryRequired.toLocaleString("en-US")}.\n\n## Doubling work blocks\n\n| Block | Execution status | Counties | Cumulative | Map/search ready now | Active now | Source discovery required | States/areas |\n| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${waveRows.join("\n")}\n\n## Block 1 execution queue\n\n| Market | FIPS | Current stage | Gates passed | Map/search | Active | Next action |\n| --- | --- | --- | ---: | --- | --- | --- |\n${firstWaveRows.join("\n")}\n\n## Promotion rule\n\nA county moves independently. It must prove official source and reuse rights, stable parcel identity, exact source/output counts, valid geometry, normalized artifacts, viewport and search delivery, freshness, QC, and explicit activation. City rankings are then built from that market's own evidence and scored from 100 down. No empty county shell is presented as live parcel intelligence.\n`;
fs.writeFileSync(outputMarkdown, markdown);

console.log(`Built ${path.relative(root, outputJson)} with ${report.summary.countyEquivalentCount} counties in ${report.summary.waveCount} waves.`);
