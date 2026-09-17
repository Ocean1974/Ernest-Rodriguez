export const DECISION_TOOL_REGISTRY_VERSION = "wr-decision-tool-registry-v1";
export const DECISION_TOOL_LAUNCH_VERSION = "wr-decision-tool-launch-v1";

const DEFINITIONS = Object.freeze([
  {
    id: "assemblage",
    capabilityId: "assemblage-discovery",
    name: "Assemblage discovery",
    action: "open-assemblage-workspace",
    requiredGates: [],
    planned: true,
    detail: "Requires a verified parcel-adjacency engine, ownership grouping, and acquisition-complexity scoring.",
  },
  {
    id: "feasibility",
    capabilityId: "optional-3d-development-analysis",
    name: "Highest & best use",
    action: "open-development-feasibility",
    requiredGates: ["development3dAnalysis"],
    locallyAvailable: true,
    detail: "Compare six parcel-linked use strategies across legal, physical, financial, and maximum-productivity tests.",
  },
  {
    id: "underwriting",
    capabilityId: "scenario-underwriting",
    name: "Scenario underwriting",
    action: "open-scenario-underwriting",
    requiredGates: ["underwriting"],
    locallyAvailable: true,
    detail: "Run a transparent parcel-linked cash-flow model with editable assumptions, IRR, DSCR, exit value, and equity multiple.",
  },
  {
    id: "opportunity-briefs",
    capabilityId: "opportunity-briefs",
    name: "Opportunity briefs",
    action: "open-opportunity-brief",
    requiredGates: ["opportunityBriefs"],
    locallyAvailable: true,
    detail: "Create an evidence-linked investment brief with ownership, site, risk, activity, economics, and source lineage.",
  },
  {
    id: "analyst",
    capabilityId: "explainable-ai-acquisition-analyst",
    name: "AI acquisition analyst",
    action: "open-acquisition-analyst",
    requiredGates: ["propertyIntelligenceQueryService"],
    detail: "Evidence-grounded query contracts are staged; production candidate retrieval, security review, and signed activation are incomplete.",
  },
  {
    id: "monitoring",
    capabilityId: "real-time-monitoring-alerts",
    name: "Monitoring & alerts",
    action: "open-monitoring-alerts",
    requiredGates: ["changeAlerts"],
    detail: "Change detection and durable delivery workers exist, but provider accounts, delivery receipts, and activation approval are not connected.",
  },
  {
    id: "predictive-signals",
    capabilityId: "explainable-predictive-signals",
    name: "Predictive property signals",
    action: "open-predictive-signals",
    requiredGates: ["predictiveSignalExpansion", "pointInTimeFeatures", "predictiveModelValidation"],
    detail: "Surface redevelopment, sale, distress, ownership, permit, and neighborhood-momentum signals with evidence and confidence.",
  },
  {
    id: "crash-resilience",
    capabilityId: "scenario-underwriting",
    name: "Crash-resilience intelligence",
    action: "open-crash-resilience",
    requiredGates: ["underwriting", "scenarioStressTesting"],
    detail: "Stress-test value declines, rent loss, vacancy, refinancing exposure, tax pressure, and distressed-entry scenarios.",
  },
  {
    id: "property-timeline",
    capabilityId: "canonical-property-intelligence",
    name: "Unified property timeline",
    action: "open-property-timeline",
    requiredGates: [],
    locallyAvailable: true,
    detail: "Review the trusted deeds, permits, zoning, ownership, assessment, listing, and development events linked to this parcel.",
  },
  {
    id: "nationwide-parcels",
    capabilityId: "county-expansion",
    name: "Nationwide parcel intelligence",
    action: "open-nationwide-parcel-intelligence",
    requiredGates: ["priorityCountyActivation"],
    detail: "Use one normalized parcel workflow across certified U.S. counties while preserving each source and county lineage.",
  },
  {
    id: "ownership-graph",
    capabilityId: "canonical-property-intelligence",
    name: "Ownership & entity graph",
    action: "open-ownership-entity-graph",
    requiredGates: ["canonicalPropertyGraph", "entityResolution"],
    detail: "Connect owners, companies, addresses, registered agents, related parcels, lenders, transactions, and developers.",
  },
  {
    id: "saved-intelligence",
    capabilityId: "deal-workflow-collaboration",
    name: "Saved searches & watchlists",
    action: "open-saved-intelligence",
    requiredGates: ["savedSearches", "watchlists"],
    detail: "Tenant-scoped persistence is tested locally; production identity, KMS, and signed release approval remain required.",
  },
  {
    id: "collaboration",
    capabilityId: "deal-workflow-collaboration",
    name: "Deal rooms & collaboration",
    action: "open-deal-collaboration",
    requiredGates: ["dealCollaboration", "dealRooms"],
    detail: "Deals, tasks, notes, evidence documents, diligence, and exports are staged behind identity, storage, malware-scan, and approval gates.",
  },
  {
    id: "portfolio-intelligence",
    capabilityId: "deal-workflow-collaboration",
    name: "Portfolio intelligence",
    action: "open-portfolio-intelligence",
    requiredGates: ["assetOperations", "portfolioRollups"],
    detail: "Monitor leases, operations, debt, budgets, projects, anomalies, risk, and performance across a portfolio.",
  },
  {
    id: "natural-language-map-search",
    capabilityId: "explainable-ai-acquisition-analyst",
    name: "Natural-language map search",
    action: "open-natural-language-map-search",
    requiredGates: ["explainableQueryExecution", "searchBarQueryPlanning", "propertyIntelligenceQueryService"],
    detail: "Find parcels using plain-language investment criteria with explainable ranking, sources, and stable results.",
  },
  {
    id: "development-digital-twin",
    capabilityId: "optional-3d-development-analysis",
    name: "Development digital twin",
    action: "open-development-digital-twin",
    requiredGates: ["development3dAnalysis", "developmentMassing", "photorealistic3dContext"],
    detail: "Model zoning-aware buildable envelopes, massing, units, parking, terrain, shadows, utilities, and alternative development scenarios in 3D.",
  },
  {
    id: "valuation-comparables",
    capabilityId: "scenario-underwriting",
    name: "Verified valuation & comparables",
    action: "open-valuation-comparables",
    requiredGates: ["marketComparables", "licensedComparables", "comparableAdjustments"],
    detail: "Explain every selected sale or rent comparable, adjustment, valuation range, source date, and confidence level.",
  },
  {
    id: "climate-insurance",
    capabilityId: "canonical-property-intelligence",
    name: "Climate, insurance & resilience",
    action: "open-climate-insurance-resilience",
    requiredGates: ["climateRiskModels", "insuranceCostEstimates", "resilienceScenarios"],
    detail: "Combine official hazards with dated model projections, insurance-cost scenarios, mitigation options, and uncertainty disclosures.",
  },
  {
    id: "title-debt-history",
    capabilityId: "canonical-property-intelligence",
    name: "Title, debt & transaction history",
    action: "open-title-debt-history",
    requiredGates: ["transactionHistory", "mortgageHistory", "documentEvidenceExtraction"],
    detail: "Trace deeds, mortgages, releases, liens, transfers, loan maturities, and supporting recorded-document evidence through time.",
  },
]);

function gateIsEnabled(gates, gate) {
  return gates?.[gate] === true;
}

export function buildParcelDecisionToolCatalog(gates = {}) {
  return DEFINITIONS.map((definition) => {
    const ready = !definition.planned
      && (definition.locallyAvailable === true
        || (definition.requiredGates.length > 0 && definition.requiredGates.every((gate) => gateIsEnabled(gates, gate))));
    return Object.freeze({
      ...definition,
      registryVersion: DECISION_TOOL_REGISTRY_VERSION,
      ready,
      status: definition.planned ? "Planned" : ready ? "Active" : "Preview gated",
      blockedBy: ready ? [] : definition.planned ? ["implementation-plan"] : definition.requiredGates.filter((gate) => !gateIsEnabled(gates, gate)),
    });
  });
}

export function createDecisionToolLaunchRequest(tool, parcel = {}) {
  if (!tool?.ready) throw Object.assign(new Error("Decision tool is not activation-authorized"), { code: "WR_DECISION_TOOL_GATED" });
  const parcelId = String(parcel.countyParcelId || parcel.accountNum || parcel.gisParcelId || "").trim();
  if (!parcelId) throw Object.assign(new Error("Decision tool requires a stable parcel identity"), { code: "WR_DECISION_TOOL_PARCEL_ID_REQUIRED" });
  return Object.freeze({
    schemaVersion: DECISION_TOOL_LAUNCH_VERSION,
    toolId: tool.id,
    capabilityId: tool.capabilityId,
    action: tool.action,
    parcelId,
    sourceCountyId: String(parcel.sourceCountyId || parcel.dataLineage?.sourceCountyId || ""),
  });
}
