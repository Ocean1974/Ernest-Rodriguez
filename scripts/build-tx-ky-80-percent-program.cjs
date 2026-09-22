const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const coveragePath = path.join(root, "output", "national-county-intelligence", "national-coverage-manifest.json");
const connectionPath = path.join(root, "output", "county-connection-gate.json");
const migrationDemandCoveragePath = path.join(root, "public", "data", "national", "migration-demand", "coverage-index.json");
const outputDir = path.join(root, "output", "tx-ky-80-percent-program");
const outputJson = path.join(outputDir, "tx-ky-80-percent-program.json");
const outputMarkdown = path.join(outputDir, "tx-ky-80-percent-program.md");

const GROUPS = [
  "identity", "geometry", "address", "owner-contact", "appraisal-values", "land-building",
  "parcel-dimensions", "block-grid", "zoning", "floodplain", "permits-certificates",
  "development-signals", "migration-demand", "source-lineage",
];
const MINIMUM_GROUPS = Math.ceil(GROUPS.length * 0.8);

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Required evidence missing: ${path.relative(root, file)}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function marketKey(record) {
  return `${record.state}|${record.countyName}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
}

const primaryMarkets = new Map(Object.entries({
  "dallas-county-tx": "Dallas", "harris-county-tx": "Houston", "tarrant-county-tx": "Fort Worth–Arlington",
  "bexar-county-tx": "San Antonio", "travis-county-tx": "Austin", "collin-county-tx": "Plano–Frisco–McKinney",
  "denton-county-tx": "Denton–Lewisville", "fort-bend-county-tx": "Sugar Land", "el-paso-county-tx": "El Paso",
  "hidalgo-county-tx": "McAllen–Edinburg", "cameron-county-tx": "Brownsville–Harlingen", "nueces-county-tx": "Corpus Christi",
  "lubbock-county-tx": "Lubbock", "webb-county-tx": "Laredo", "bell-county-tx": "Killeen–Temple",
  "brazoria-county-tx": "Pearland–Lake Jackson", "montgomery-county-tx": "The Woodlands", "williamson-county-tx": "Round Rock–Georgetown",
  "jefferson-county-ky": "Louisville", "fayette-county-ky": "Lexington",
}));
const bigCityOrder = [...primaryMarkets.keys()];

const coverage = readJson(coveragePath);
const connection = readJson(connectionPath);
const migrationDemandCoverage = readJson(migrationDemandCoveragePath);
const connectionByMarket = new Map(connection.counties.map((county) => [marketKey(county), county]));

const counties = coverage.counties.filter((county) => county.state === "TX" || county.state === "KY").map((county) => {
  const gate = connectionByMarket.get(marketKey(county));
  const countyMigrationDemand = migrationDemandCoverage.counties?.[county.fips];
  const countyMigrationDemandReady = countyMigrationDemand?.status === "ready-aggregate-geography-context";
  const readyGroups = GROUPS.filter((group) => (
    gate?.readyDcadLikeGroups?.includes(group)
    || (group === "migration-demand" && countyMigrationDemandReady)
  ));
  const missingGroups = GROUPS.filter((group) => !readyGroups.includes(group));
  const intelligencePercent = Number(((readyGroups.length / GROUPS.length) * 100).toFixed(1));
  const meets80PercentIntelligence = readyGroups.length >= MINIMUM_GROUPS;
  const productionAuthorized = gate?.activationStage === "production-active" && meets80PercentIntelligence;
  let nextAction = "verify-official-sources-and-reuse-rights";
  if (county.stage === "source-found") nextAction = "capture-normalize-and-build-full-parcel-service";
  if (county.stage === "qa") nextAction = "build-missing-intelligence-groups";
  if (gate?.mapSearchReady) nextAction = meets80PercentIntelligence
    ? "certify-freshness-qc-and-production-activation"
    : `build-${missingGroups.slice(0, 3).join("-") || "remaining-intelligence"}`;
  if (productionAuthorized) nextAction = "maintain-production-and-complete-remaining-intelligence";
  return {
    fips: county.fips,
    state: county.state,
    countyId: county.countyId,
    countyName: county.countyName,
    primaryMarket: primaryMarkets.get(county.countyId) || null,
    currentStage: county.stage,
    verifiedParcelCount: county.verifiedParcelCount || 0,
    mapSearchReady: gate?.mapSearchReady === true,
    readyIntelligenceGroupCount: readyGroups.length,
    totalIntelligenceGroupCount: GROUPS.length,
    intelligencePercent,
    meets80PercentIntelligence,
    productionAuthorized,
    readyGroups,
    missingGroups,
    migrationDemandEvidence: countyMigrationDemandReady ? {
      status: countyMigrationDemand.status,
      marketDemandIndex: countyMigrationDemand.marketDemandIndex,
      migrationSignal: countyMigrationDemand.migrationSignal,
      hasIrsMigration: countyMigrationDemand.hasIrsMigration,
      stateFile: countyMigrationDemand.stateFile,
    } : null,
    nextAction,
  };
});

const byId = new Map(counties.map((county) => [county.countyId, county]));
const firstBlock = bigCityOrder.map((id) => byId.get(id)).filter(Boolean);
const firstIds = new Set(firstBlock.map((county) => county.countyId));
const remainder = counties.filter((county) => !firstIds.has(county.countyId)).sort((a, b) => {
  const stateOrder = a.state.localeCompare(b.state);
  if (stateOrder) return stateOrder;
  if (a.currentStage !== b.currentStage) {
    const rank = { live: 0, qa: 1, processing: 2, "source-found": 3, scaffolded: 4 };
    return (rank[a.currentStage] ?? 9) - (rank[b.currentStage] ?? 9);
  }
  return a.fips.localeCompare(b.fips);
});

const blocks = [{
  block: 1,
  name: "big-city-bridge",
  executionStatus: "active",
  purpose: "Connect the largest Texas and Kentucky city markets before expanding through the remaining counties.",
  counties: firstBlock,
}];
for (let offset = 0; offset < remainder.length; offset += 25) {
  blocks.push({
    block: blocks.length + 1,
    name: `state-county-block-${String(blocks.length).padStart(2, "0")}`,
    executionStatus: "queued",
    purpose: "Advance each county independently through official source, parcel service, intelligence, QC, and activation gates.",
    counties: remainder.slice(offset, offset + 25),
  });
}

for (const block of blocks) {
  block.countyCount = block.counties.length;
  block.meets80PercentCount = block.counties.filter((county) => county.meets80PercentIntelligence).length;
  block.mapSearchReadyCount = block.counties.filter((county) => county.mapSearchReady).length;
  block.productionAuthorizedCount = block.counties.filter((county) => county.productionAuthorized).length;
}

function stateSummary(state) {
  const stateCounties = counties.filter((county) => county.state === state);
  return {
    countyCount: stateCounties.length,
    mapSearchReadyCount: stateCounties.filter((county) => county.mapSearchReady).length,
    meets80PercentCount: stateCounties.filter((county) => county.meets80PercentIntelligence).length,
    remainingTo80PercentCount: stateCounties.filter((county) => !county.meets80PercentIntelligence).length,
    productionAuthorizedCount: stateCounties.filter((county) => county.productionAuthorized).length,
    knownVerifiedParcelCount: stateCounties.reduce((sum, county) => sum + county.verifiedParcelCount, 0),
  };
}

const report = {
  schemaVersion: "wr-tx-ky-80-percent-program-v1",
  generatedAt: new Date().toISOString(),
  objective: "Make every Texas and Kentucky county a genuine parcel-intelligence market, beginning with the largest city counties.",
  standard: {
    groupCount: GROUPS.length,
    requestedMinimumPercent: 80,
    minimumPassingGroupCount: MINIMUM_GROUPS,
    actualPassingPercent: Number(((MINIMUM_GROUPS / GROUPS.length) * 100).toFixed(1)),
    groups: GROUPS,
    meaning: "A county must have at least 12 of 14 evidence-backed intelligence groups. Adapter scaffolding does not count as parcel intelligence.",
  },
  activationPolicy: "Fail closed by county. Reaching 12 groups is necessary but not sufficient: full parcel delivery, exact-count reconciliation, official-source lineage, freshness, QC, and explicit activation approval must also pass.",
  cityRankingPolicy: "After a county passes the intelligence and activation gates, each city receives its own source-backed off-market parcel inventory and independently calculated Savant scores from 100 down.",
  summary: {
    totalCountyCount: counties.length,
    activeWorkBlock: 1,
    workBlockCount: blocks.length,
    meets80PercentCount: counties.filter((county) => county.meets80PercentIntelligence).length,
    remainingTo80PercentCount: counties.filter((county) => !county.meets80PercentIntelligence).length,
    mapSearchReadyCount: counties.filter((county) => county.mapSearchReady).length,
    productionAuthorizedCount: counties.filter((county) => county.productionAuthorized).length,
    states: { TX: stateSummary("TX"), KY: stateSummary("KY") },
  },
  blocks,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);

const blockRows = blocks.map((block) => `| ${block.block} | ${block.name} | ${block.executionStatus} | ${block.countyCount} | ${block.mapSearchReadyCount} | ${block.meets80PercentCount} | ${block.productionAuthorizedCount} |`);
const cityRows = firstBlock.map((county) => `| ${county.primaryMarket} | ${county.countyName}, ${county.state} | ${county.readyIntelligenceGroupCount}/14 | ${county.intelligencePercent}% | ${county.mapSearchReady ? "yes" : "no"} | ${county.productionAuthorized ? "yes" : "no"} | ${county.nextAction} |`);
const markdown = `# Texas and Kentucky 80% Parcel-Intelligence Program\n\nGenerated ${report.generatedAt}.\n\n## Standard\n\nThe requested 80% threshold is enforced conservatively as **12 of 14 groups (85.7%)**. A scaffold does not count. Reaching the intelligence threshold does not bypass parcel delivery, exact-count, lineage, freshness, QC, or activation gates.\n\n## Exact baseline\n\n| State | Counties | Map/search ready | At least 12/14 groups | Remaining to threshold | Production authorized | Known verified parcels |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n| Texas | ${report.summary.states.TX.countyCount} | ${report.summary.states.TX.mapSearchReadyCount} | ${report.summary.states.TX.meets80PercentCount} | ${report.summary.states.TX.remainingTo80PercentCount} | ${report.summary.states.TX.productionAuthorizedCount} | ${report.summary.states.TX.knownVerifiedParcelCount.toLocaleString("en-US")} |\n| Kentucky | ${report.summary.states.KY.countyCount} | ${report.summary.states.KY.mapSearchReadyCount} | ${report.summary.states.KY.meets80PercentCount} | ${report.summary.states.KY.remainingTo80PercentCount} | ${report.summary.states.KY.productionAuthorizedCount} | ${report.summary.states.KY.knownVerifiedParcelCount.toLocaleString("en-US")} |\n\n## Work blocks\n\n| Block | Name | Status | Counties | Map/search ready | At threshold | Production authorized |\n| ---: | --- | --- | ---: | ---: | ---: | ---: |\n${blockRows.join("\n")}\n\n## Active Block 1 — big-city bridge\n\n| Market | County | Intelligence | Percent | Map/search | Production | Next action |\n| --- | --- | ---: | ---: | --- | --- | --- |\n${cityRows.join("\n")}\n\n## Connected operating model\n\n1. Capture and certify official parcel/appraisal geometry and stable identifiers.\n2. Build exact-count-reconciled parcel services, viewport delivery, and search shards.\n3. Attach the 14 intelligence groups with explicit source lineage and unmatched-record accounting.\n4. Require at least 12 evidence-backed groups, county QC, freshness, and explicit activation approval.\n5. Generate each city market's own off-market inventory and Savant scores from 100 down.\n6. Advance the next county block without allowing a blocked county to stall its peers.\n`;
fs.writeFileSync(outputMarkdown, markdown);

console.log(`Built ${path.relative(root, outputJson)} for ${counties.length} counties in ${blocks.length} work blocks.`);
