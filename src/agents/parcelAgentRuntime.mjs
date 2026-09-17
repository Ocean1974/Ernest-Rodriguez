export const PARCEL_AGENT_VERSION = "wr-parcel-agents-v1";

export const PARCEL_AGENTS = Object.freeze([
  {
    id: "acquisition",
    name: "Acquisition Analyst",
    shortName: "Acquisition",
    description: "Frames the opportunity, pricing basis, and next acquisition questions.",
    starter: "Give me an acquisition read on this parcel.",
  },
  {
    id: "highest-best-use",
    name: "Highest & Best Use Analyst",
    shortName: "HBU",
    description: "Explains use alternatives, constraints, economics, and missing evidence.",
    starter: "Explain the strongest use and what still needs verification.",
  },
  {
    id: "underwriting",
    name: "Underwriting Analyst",
    shortName: "Underwriting",
    description: "Reviews the current scenario and identifies the assumptions that matter most.",
    starter: "Review the current underwriting assumptions and sensitivities.",
  },
  {
    id: "due-diligence",
    name: "Due Diligence Analyst",
    shortName: "Diligence",
    description: "Builds an evidence-based diligence plan from parcel, zoning, flood, and permit facts.",
    starter: "Build a prioritized due-diligence checklist for this parcel.",
  },
]);

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  const parsed = number(value);
  return parsed === null ? "not verified" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsed);
}

function integer(value) {
  const parsed = number(value);
  return parsed === null ? "not verified" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(parsed);
}

export function buildParcelAgentContext({ parcel = {}, zoning = null, floodplain = null, permits = [], highestBestUse = null, underwriting = null, opportunityBrief = null } = {}) {
  const hbuLeader = highestBestUse?.scenarios?.[0] || null;
  return {
    schemaVersion: PARCEL_AGENT_VERSION,
    parcel: {
      id: text(parcel.countyParcelId || parcel.accountNum || parcel.accountNumber || parcel.gisParcelId),
      account: text(parcel.accountNum || parcel.accountNumber),
      address: text(parcel.address || parcel.propertyAddress),
      owner: text(parcel.ownerName || parcel.propertyName),
      zoning: text(zoning?.zoningSummary?.label || parcel.zoning),
      landUse: text(parcel.landUseDescription || parcel.landUse),
      landAreaSqFt: number(parcel.landAreaSqFt || parcel.landAreaSize),
      totalValue: number(parcel.totalValue || parcel.marketValue),
      landValue: number(parcel.landValue || parcel.landValuationAmount),
      improvementValue: number(parcel.improvementValue),
      frontageFt: number(parcel.frontage || parcel.dimensions?.frontageFt),
      floodplain: text(floodplain?.floodplainSummary?.label || parcel.floodplain),
      sourceCountyId: text(parcel.sourceCountyId || parcel.dataLineage?.sourceCountyId),
    },
    evidence: {
      zoningVerified: Boolean(zoning?.zoningSummary),
      floodplainChecked: Boolean(floodplain || parcel.floodplain),
      permitCount: Array.isArray(permits) ? permits.length : 0,
      permitRecords: (Array.isArray(permits) ? permits : []).slice(0, 12).map((permit) => ({
        type: text(permit.type || permit.permitType || permit.workType),
        status: text(permit.status),
        date: text(permit.date || permit.issuedDate || permit.applicationDate),
      })),
      missing: [
        !zoning?.zoningSummary ? "verified zoning standards" : "",
        !(floodplain || parcel.floodplain) ? "parcel flood determination" : "",
        !parcel.frontage && !parcel.dimensions?.frontageFt ? "verified frontage" : "",
      ].filter(Boolean),
    },
    highestBestUse: hbuLeader ? {
      status: highestBestUse.status,
      leadingUse: hbuLeader.name,
      legallyPermissible: hbuLeader.tests?.legallyPermissible,
      financiallyFeasible: hbuLeader.tests?.financiallyFeasible,
      buildableSqFt: hbuLeader.metrics?.grossBuildableSqFt,
      yieldOnCostPct: hbuLeader.metrics?.yieldOnCostPct,
      residualLandValue: hbuLeader.metrics?.residualLandValue,
      missingEvidence: hbuLeader.missingEvidence || [],
    } : null,
    underwriting: underwriting?.metrics ? {
      status: underwriting.status,
      noi: underwriting.metrics.firstYearNoi,
      capRatePct: underwriting.metrics.capRatePct,
      irrPct: underwriting.metrics.irrPct,
      equityMultiple: underwriting.metrics.equityMultiple,
      dscr: underwriting.metrics.debtServiceCoverageRatio,
      exitValue: underwriting.metrics.grossExitValue,
      warnings: underwriting.warnings || [],
    } : null,
    opportunityBrief: opportunityBrief ? {
      status: opportunityBrief.status,
      completenessPct: opportunityBrief.evidenceSummary?.completenessPct,
    } : null,
  };
}

function commonSources(context) {
  return [
    { label: "Parcel record", detail: `${context.parcel.sourceCountyId || "county source"} · ${context.parcel.id || "parcel ID unavailable"}` },
    context.evidence.zoningVerified ? { label: "Zoning evidence", detail: context.parcel.zoning } : null,
    context.evidence.floodplainChecked ? { label: "Flood evidence", detail: context.parcel.floodplain || "checked; no mapped label returned" } : null,
    context.evidence.permitCount ? { label: "Permit evidence", detail: `${context.evidence.permitCount} parcel-linked record(s)` } : null,
  ].filter(Boolean);
}

function acquisitionResponse(context) {
  const parcel = context.parcel;
  const hbu = context.highestBestUse;
  return {
    summary: `${parcel.address || "This parcel"} is a ${integer(parcel.landAreaSqFt)} SF site with a county value basis of ${money(parcel.totalValue)}. ${hbu ? `The current model's financial leader is ${hbu.leadingUse}, but its conclusion is ${hbu.status}.` : "Run HBU before treating the site as an acquisition candidate."}`,
    findings: [
      `Ownership: ${parcel.owner || "not verified"}.`,
      `Current zoning label: ${parcel.zoning || "not verified"}.`,
      `Land-to-total value: ${parcel.landValue !== null && parcel.totalValue ? `${Math.round(parcel.landValue / parcel.totalValue * 100)}%` : "not calculable from loaded facts"}.`,
      hbu ? `Modeled residual land value: ${money(hbu.residualLandValue)}; yield on cost: ${hbu.yieldOnCostPct ?? "not solved"}%.` : "No HBU model result is loaded.",
    ],
    nextActions: ["Verify seller authority and title", "Confirm zoning entitlements and dimensional standards", "Replace default rent, cap-rate, and construction assumptions with market evidence"],
  };
}

function hbuResponse(context) {
  const hbu = context.highestBestUse;
  if (!hbu) return { summary: "The HBU engine needs a valid land area before it can compare use alternatives.", findings: [], nextActions: ["Verify parcel land area"] };
  return {
    summary: `${hbu.leadingUse} is the current financial leader at ${integer(hbu.buildableSqFt)} modeled buildable SF, ${hbu.yieldOnCostPct ?? "unresolved"}% yield on cost, and ${money(hbu.residualLandValue)} residual land value. This is an assumption-based screen, not a final entitlement conclusion.`,
    findings: [
      `Legal test: ${hbu.legallyPermissible || "indeterminate"}.`,
      `Financial test: ${hbu.financiallyFeasible || "indeterminate"}.`,
      `Model status: ${hbu.status}.`,
      `Missing evidence: ${hbu.missingEvidence?.join(", ") || "none reported by the model"}.`,
    ],
    nextActions: ["Confirm permitted use", "Enter verified FAR, coverage, and height", "Validate rents, vacancy, exit cap, hard costs, parking, and site-work assumptions"],
  };
}

function underwritingResponse(context) {
  const model = context.underwriting;
  if (!model) return { summary: "The current underwriting scenario is incomplete. Annual income assumptions are required before returns can be solved.", findings: [], nextActions: ["Enter annual gross rent", "Confirm purchase price and financing"] };
  return {
    summary: `The current scenario produces ${money(model.noi)} first-year NOI, a ${model.capRatePct ?? "not solved"}% cap rate, and ${model.irrPct === null ? "no solved" : `${model.irrPct}%`} levered IRR.`,
    findings: [
      `Equity multiple: ${model.equityMultiple === null ? "not solved" : `${model.equityMultiple}x`}.`,
      `DSCR: ${model.dscr === null ? "not solved" : `${model.dscr}x`}.`,
      `Gross exit value: ${money(model.exitValue)}.`,
      `Warnings: ${model.warnings?.join(", ") || "none"}.`,
    ],
    nextActions: ["Stress vacancy and rent", "Stress exit cap and interest rate", "Replace starting assumptions with dated comparable evidence"],
  };
}

function diligenceResponse(context) {
  const parcel = context.parcel;
  return {
    summary: `Diligence should begin with land-use authority and site constraints for ${parcel.address || parcel.id || "this parcel"}. The loaded evidence has ${context.evidence.missing.length ? `${context.evidence.missing.length} material gap(s)` : "no basic parcel-profile gaps"}.`,
    findings: [
      `Zoning: ${context.evidence.zoningVerified ? parcel.zoning : "requires verification"}.`,
      `Floodplain: ${context.evidence.floodplainChecked ? parcel.floodplain || "checked; no mapped label returned" : "requires verification"}.`,
      `Permits: ${context.evidence.permitCount} parcel-linked record(s).`,
      `Frontage: ${parcel.frontageFt === null ? "requires verification" : `${integer(parcel.frontageFt)} FT`}.`,
    ],
    nextActions: ["Order title and survey review", "Confirm zoning and overlays with the authority having jurisdiction", "Review utilities, access, environmental conditions, easements, and recorded restrictions", "Validate parcel-linked permits and certificates of occupancy"],
  };
}

export function runLocalParcelAgent({ agentId = "acquisition", message = "", context } = {}) {
  if (!context?.parcel) throw new Error("Parcel agent requires a parcel context");
  const selectedAgent = PARCEL_AGENTS.find((agent) => agent.id === agentId) || PARCEL_AGENTS[0];
  const response = selectedAgent.id === "highest-best-use"
    ? hbuResponse(context)
    : selectedAgent.id === "underwriting"
      ? underwritingResponse(context)
      : selectedAgent.id === "due-diligence"
        ? diligenceResponse(context)
        : acquisitionResponse(context);
  return {
    schemaVersion: PARCEL_AGENT_VERSION,
    agentId: selectedAgent.id,
    agentName: selectedAgent.name,
    mode: "local-tools",
    userMessage: text(message),
    ...response,
    sources: commonSources(context),
    missingEvidence: context.evidence.missing,
    disclaimer: "Decision-support output only. Verify legal, physical, market, financial, title, and environmental evidence before acting.",
  };
}

export async function requestParcelAgent({ agentId, message, context, signal } = {}) {
  try {
    const response = await fetch("/api/agents/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: PARCEL_AGENT_VERSION, agentId, message, context }),
      signal,
    });
    if (response.ok) return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
  }
  return runLocalParcelAgent({ agentId, message, context });
}
