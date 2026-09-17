const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const { PARCEL_AGENTS, PARCEL_AGENT_VERSION, buildParcelAgentContext, runLocalParcelAgent } = await import("../src/agents/parcelAgentRuntime.mjs");
  assert.equal(PARCEL_AGENT_VERSION, "wr-parcel-agents-v1");
  assert.deepEqual(PARCEL_AGENTS.map((agent) => agent.id), ["acquisition", "highest-best-use", "underwriting", "due-diligence"]);

  const context = buildParcelAgentContext({
    parcel: {
      countyParcelId: "dallas:123",
      accountNum: "123",
      address: "1610 S ERVAY ST",
      ownerName: "GANO HOLDINGS LLC",
      landAreaSqFt: 106086,
      totalValue: 3446400,
      landValue: 2200000,
      sourceCountyId: "dallas-county-dcad",
    },
    zoning: { zoningSummary: { label: "PD 317" } },
    permits: [{ permitType: "Building", status: "Issued", issueDate: "2026-01-01" }],
    highestBestUse: {
      status: "comparative-screen-complete-evidence-required",
      scenarios: [{
        name: "Retail",
        tests: { legallyPermissible: "indeterminate", financiallyFeasible: "fail" },
        metrics: { grossBuildableSqFt: 33947, yieldOnCostPct: 5.2, residualLandValue: 585439 },
        missingEvidence: ["zoning:permitted-use"],
      }],
    },
    underwriting: { status: "modeled-positive-spread", metrics: { firstYearNoi: 250000, capRatePct: 7.25, irrPct: 12, equityMultiple: 1.8, debtServiceCoverageRatio: 1.4, grossExitValue: 4000000 }, warnings: [] },
  });

  assert.equal(context.parcel.address, "1610 S ERVAY ST");
  assert.equal(context.evidence.zoningVerified, true);
  assert.equal(context.evidence.permitCount, 1);
  const acquisition = runLocalParcelAgent({ agentId: "acquisition", message: "Assess it", context });
  assert.equal(acquisition.mode, "local-tools");
  assert(acquisition.summary.includes("1610 S ERVAY ST"));
  assert(acquisition.sources.some((source) => source.label === "Parcel record"));
  const hbu = runLocalParcelAgent({ agentId: "highest-best-use", message: "Best use?", context });
  assert(hbu.summary.includes("Retail"));
  assert(hbu.findings.some((finding) => finding.includes("Legal test")));
  const diligence = runLocalParcelAgent({ agentId: "due-diligence", message: "Checklist", context });
  assert(diligence.nextActions.length >= 4);

  const root = path.resolve(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  const vite = fs.readFileSync(path.join(root, "vite.config.mts"), "utf8");
  const middleware = fs.readFileSync(path.join(root, "server", "whiteRabbitAgentMiddleware.mjs"), "utf8");
  assert(app.includes('["agents", "Agents"]'), "Parcel workspace must expose the Agents tab");
  assert(app.includes('data-parcel-agent-workspace="active"'), "Agent workspace must expose a stable UI hook");
  assert(vite.includes("createWhiteRabbitAgentPlugin()"), "Vite must register the server-side agent endpoint");
  assert(middleware.includes("process.env.OPENAI_API_KEY"), "API credentials must remain server-side");
  assert(!app.includes("OPENAI_API_KEY"), "Browser code must never contain the API credential reference");
  assert(middleware.includes('store: false'), "Agent responses must default to non-persistent API calls");

  console.log("White Rabbit parcel-agent runtime tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
