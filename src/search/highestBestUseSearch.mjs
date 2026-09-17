import { analyzeHighestBestUse, createHighestBestUseDefaults } from "../features/highestBestUseEngine.mjs";

export const HBU_SEARCH_VERSION = "wr-hbu-search-v1";

const USE_ALIASES = Object.freeze([
  { id: "multifamily", label: "Multifamily", pattern: /\b(multifamily|multi[- ]family|apartments?|residential units?)\b/i },
  { id: "industrial", label: "Industrial / logistics", pattern: /\b(industrial|logistics|warehouse|distribution)\b/i },
  { id: "retail", label: "Retail", pattern: /\b(retail|shopping|storefront)\b/i },
  { id: "office", label: "Office", pattern: /\b(office|workplace)\b/i },
  { id: "mixed-use", label: "Mixed-use", pattern: /\b(mixed[- ]use|mixed use)\b/i },
  { id: "self-storage", label: "Self-storage", pattern: /\b(self[- ]storage|self storage|storage facility)\b/i },
]);

const HBU_TRIGGER = /\b(highest\s*(?:&|and)\s*best\s*use|highest\s+best\s+use|hbu|best\s+use|development\s+feasibility|development\s+potential)\b/i;

function cleanLocationQuery(query, matchedUse) {
  let cleaned = String(query || "");
  cleaned = cleaned.replace(/\b(highest\s*(?:&|and)\s*best\s*use|highest\s+best\s+use|hbu|best\s+use|development\s+feasibility|development\s+potential)\b/gi, " ");
  if (matchedUse) cleaned = cleaned.replace(matchedUse.pattern, " ");
  cleaned = cleaned
    .replace(/\b(the|find|show|best|rank|compare|analyze|analyse|evaluate|run|open|sites?|parcels?|properties|opportunities|candidates)\b/gi, " ")
    .replace(/^\s*(?:for|at|on|near|in)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
    .trim();
  return cleaned;
}

export function parseHighestBestUseSearch(query) {
  const sourceQuery = String(query || "").trim();
  if (!sourceQuery) return null;
  const matchedUse = USE_ALIASES.find((entry) => entry.pattern.test(sourceQuery)) || null;
  const useRankingIntent = matchedUse && /\b(best|rank|compare|feasibility|potential)\b/i.test(sourceQuery) && /\b(sites?|parcels?|properties|opportunities|candidates)\b/i.test(sourceQuery);
  if (!HBU_TRIGGER.test(sourceQuery) && !useRankingIntent) return null;
  const locationQuery = cleanLocationQuery(sourceQuery, matchedUse);
  return {
    schemaVersion: HBU_SEARCH_VERSION,
    sourceQuery,
    useId: matchedUse?.id || "",
    useLabel: matchedUse?.label || "All use strategies",
    locationQuery,
    mode: locationQuery ? "parcel-analysis" : "viewport-ranking",
    scopeLabel: locationQuery ? "matched parcel" : "loaded map viewport",
  };
}

export function rankParcelsForHighestBestUse(parcels = [], useId = "", options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const candidates = [];
  const seen = new Set();
  for (const parcel of parcels || []) {
    const parcelId = String(parcel?.countyParcelId || parcel?.accountNum || parcel?.accountNumber || parcel?.gisParcelId || "");
    if (!parcelId || seen.has(parcelId)) continue;
    seen.add(parcelId);
    const defaults = createHighestBestUseDefaults(parcel);
    if (!defaults.site.landAreaSqFt) continue;
    const useCandidates = useId ? defaults.candidates.filter((candidate) => candidate.id === useId) : defaults.candidates;
    if (!useCandidates.length) continue;
    const analysis = analyzeHighestBestUse({ site: defaults.site, candidates: useCandidates });
    const scenario = analysis.scenarios[0];
    if (!scenario?.metrics) continue;
    candidates.push({
      ...parcel,
      highestBestUseSearch: {
        schemaVersion: HBU_SEARCH_VERSION,
        requestedUseId: useId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        rank: 0,
        scope: "loaded-map-viewport",
        financiallyFeasible: scenario.tests.financiallyFeasible === "pass",
        residualLandValue: scenario.metrics.residualLandValue,
        residualLandValuePerLandSqFt: scenario.metrics.residualLandValue / defaults.site.landAreaSqFt,
        yieldOnCostPct: scenario.metrics.yieldOnCostPct,
        grossBuildableSqFt: scenario.metrics.grossBuildableSqFt,
        evidenceStatus: analysis.status,
      },
    });
  }
  candidates.sort((left, right) => {
    const a = left.highestBestUseSearch;
    const b = right.highestBestUseSearch;
    if (a.financiallyFeasible !== b.financiallyFeasible) return a.financiallyFeasible ? -1 : 1;
    if (a.yieldOnCostPct !== b.yieldOnCostPct) return b.yieldOnCostPct - a.yieldOnCostPct;
    if (a.residualLandValuePerLandSqFt !== b.residualLandValuePerLandSqFt) {
      return b.residualLandValuePerLandSqFt - a.residualLandValuePerLandSqFt;
    }
    if (a.residualLandValue !== b.residualLandValue) return b.residualLandValue - a.residualLandValue;
    return b.grossBuildableSqFt - a.grossBuildableSqFt;
  });
  return candidates.slice(0, limit).map((parcel, index) => ({
    ...parcel,
    highestBestUseSearch: { ...parcel.highestBestUseSearch, rank: index + 1 },
  }));
}
