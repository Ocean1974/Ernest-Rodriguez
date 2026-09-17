import { activeCountyDataset } from "../data/countyConfig";
import { loadFloodplainRecordsForParcel, loadParcelFloodplainSummary, type FloodplainSourceHit, type ParcelFloodplainRecord } from "./loadFloodplain";
import { loadParcelZoningSummary, loadZoningRecordsForParcel, type ParcelZoningRecord, type ZoningRecord } from "./loadZoning";

export type ParcelIntelligenceLayerStatus = "matched" | "not-found" | "error";

export type ParcelIntelligenceSummary = {
  sourceCountyId: string;
  parcelId: string;
  countyParcelId: string;
  accountNum: string;
  gisParcelId: string;
  status: {
    zoning: ParcelIntelligenceLayerStatus;
    floodplain: ParcelIntelligenceLayerStatus;
  };
  labels: {
    zoning: string;
    floodplain: string;
  };
  zoning: ParcelZoningRecord | null;
  floodplain: ParcelFloodplainRecord | null;
  sourceHits?: {
    zoning: ZoningRecord[];
    floodplain: FloodplainSourceHit[];
  };
  errors: string[];
};

export type ParcelIntelligenceOptions = {
  includeSourceHits?: boolean;
  maxSourceHits?: number;
};

function cleanParcelId(value: unknown): string {
  return String(value || "").trim();
}

function stableCountyParcelId(parcelId: string, zoning: ParcelZoningRecord | null, floodplain: ParcelFloodplainRecord | null): string {
  const fromLayer = cleanParcelId(zoning?.countyParcelId || floodplain?.countyParcelId);
  if (fromLayer) return fromLayer;
  if (parcelId.includes(":")) return parcelId;
  return `${activeCountyDataset.id}:${parcelId}`;
}

function firstAccountId(parcelId: string, zoning: ParcelZoningRecord | null, floodplain: ParcelFloodplainRecord | null): string {
  return cleanParcelId(zoning?.accountNum || floodplain?.accountNum || parcelId.split(":").pop() || parcelId);
}

function firstGisParcelId(zoning: ParcelZoningRecord | null, floodplain: ParcelFloodplainRecord | null): string {
  return cleanParcelId(zoning?.gisParcelId || floodplain?.gisParcelId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown parcel intelligence error");
}

export async function loadParcelIntelligenceSummary(parcelAccountOrCountyId: string, options: ParcelIntelligenceOptions = {}): Promise<ParcelIntelligenceSummary | null> {
  const parcelId = cleanParcelId(parcelAccountOrCountyId);
  if (!parcelId) return null;

  const [zoningResult, floodplainResult] = await Promise.allSettled([
    loadParcelZoningSummary(parcelId),
    loadParcelFloodplainSummary(parcelId),
  ]);

  const zoning = zoningResult.status === "fulfilled" ? zoningResult.value : null;
  const floodplain = floodplainResult.status === "fulfilled" ? floodplainResult.value : null;
  const errors = [
    zoningResult.status === "rejected" ? `zoning: ${errorMessage(zoningResult.reason)}` : "",
    floodplainResult.status === "rejected" ? `floodplain: ${errorMessage(floodplainResult.reason)}` : "",
  ].filter(Boolean);

  const summary: ParcelIntelligenceSummary = {
    sourceCountyId: activeCountyDataset.id,
    parcelId,
    countyParcelId: stableCountyParcelId(parcelId, zoning, floodplain),
    accountNum: firstAccountId(parcelId, zoning, floodplain),
    gisParcelId: firstGisParcelId(zoning, floodplain),
    status: {
      zoning: zoningResult.status === "rejected" ? "error" : zoning ? "matched" : "not-found",
      floodplain: floodplainResult.status === "rejected" ? "error" : floodplain ? "matched" : "not-found",
    },
    labels: {
      zoning: cleanParcelId(zoning?.zoningSummary?.label),
      floodplain: cleanParcelId(floodplain?.floodplainSummary?.label),
    },
    zoning,
    floodplain,
    errors,
  };

  if (options.includeSourceHits) {
    const maxSourceHits = options.maxSourceHits ?? 250;
    const [zoningHitsResult, floodplainHitsResult] = await Promise.allSettled([
      loadZoningRecordsForParcel(parcelId, maxSourceHits),
      loadFloodplainRecordsForParcel(parcelId, maxSourceHits),
    ]);
    summary.sourceHits = {
      zoning: zoningHitsResult.status === "fulfilled" ? zoningHitsResult.value : [],
      floodplain: floodplainHitsResult.status === "fulfilled" ? floodplainHitsResult.value : [],
    };
    if (zoningHitsResult.status === "rejected") summary.errors.push(`zoning source hits: ${errorMessage(zoningHitsResult.reason)}`);
    if (floodplainHitsResult.status === "rejected") summary.errors.push(`floodplain source hits: ${errorMessage(floodplainHitsResult.reason)}`);
  }

  return summary;
}
