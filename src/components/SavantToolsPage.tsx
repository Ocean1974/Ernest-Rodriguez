import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Building2, Map as MapIcon, Network, Radar, TrendingUp, UsersRound, Wrench } from "lucide-react";

type SavantRadarCandidate = {
  rank: number;
  accountNum: string;
  address: string;
  ownerName: string;
  category: string;
  score: number;
  evidenceScore?: number;
  reasonCodes: string[];
  ownerPortfolioCount: number;
  sameBlockCandidateCount: number;
  ownerBlockControlCount: number;
  metrics: {
    landAreaAcres: number;
    landValue: number;
    improvementValue: number;
    totalValue: number;
    yearBuilt: string | number;
  };
  zoningLabel: string;
  pathOfGrowth?: {
    score: number;
    nearbyActivityCount: number;
    recentActivityCount: number;
    nearestMiles: number | null;
    direction: string;
  };
  nextAction: string;
};

type SavantDevelopmentPathRadar = {
  marketId: string;
  marketName: string;
  coverageLabel: string;
  sourceParcelFeatureCount: number;
  scoredUniqueAccountCount: number;
  opportunityCandidateCount: number;
  analyzedCandidateCount: number;
  reasonCounts: {
    offMarketDevelopmentPath: number;
    sameBlockAssemblage: number;
    growthPattern: number;
    developerSurroundingControl: number;
  };
  topCandidates: SavantRadarCandidate[];
};

type SavantMarketSummary = {
  id: string;
  name: string;
  stateCode: string;
  stateName: string;
  coverageLabel: string;
  sourceCountyId: string;
  status: "ready" | "building" | "blocked";
  radar: string;
  sourceParcelFeatureCount: number;
  candidateCount: number;
  highestScore: number;
};

type SavantMarketIndex = {
  defaultMarketId: string;
  rankingContract: string;
  markets: SavantMarketSummary[];
};

type SavantMaintenanceStatus = {
  checkedAt: string;
  status: "healthy" | "blocked" | "failed";
  publishAuthorized: boolean;
  gates: Array<{ id: string; status: "passed" | "blocked" }>;
};

const SAVANT_MARKET_INDEX_URL = "/data/savant-tools/market-index.json";
const SAVANT_MAINTENANCE_STATUS_URL = "/data/savant-tools/maintenance-status.json";
const RADAR_PAGE_SIZE = 5;

function formatNumber(value: number | string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("en-US").format(parsed) : "0";
}

function formatMoney(value: number | string | undefined) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Value pending";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsed);
}

function reasonLabel(reasonCode: string) {
  return reasonCode.replace(/^off-market-/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RadarStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="text-cyan-700">{icon}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export default function SavantToolsPage({ onBack, onOpenMap, onOpenCrm, logo }: { onBack: () => void; onOpenMap: (query?: string, sourceCountyId?: string) => void; onOpenCrm: () => void; logo: ReactNode }) {
  const [radar, setRadar] = useState<SavantDevelopmentPathRadar | null>(null);
  const [radarStatus, setRadarStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [marketIndex, setMarketIndex] = useState<SavantMarketIndex | null>(null);
  const [selectedStateCode, setSelectedStateCode] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [maintenanceStatus, setMaintenanceStatus] = useState<SavantMaintenanceStatus | null>(null);
  const [radarPage, setRadarPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(SAVANT_MARKET_INDEX_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load Savant market index: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) {
          setMarketIndex(payload);
          const defaultMarket = payload.markets?.find((market: SavantMarketSummary) => market.id === payload.defaultMarketId) || payload.markets?.[0];
          setSelectedStateCode(defaultMarket?.stateCode || "");
          setSelectedMarketId(defaultMarket?.id || "");
        }
      })
      .catch((error) => {
        console.warn("Real Estate Savant market index could not be loaded.", error);
        if (!cancelled) setRadarStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const market = marketIndex?.markets.find((item) => item.id === selectedMarketId);
    if (!market) return;
    let cancelled = false;
    setRadarStatus("loading");
    setRadar(null);
    fetch(`/data/savant-tools/${market.radar}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${market.name} Savant radar: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) {
          setRadar(payload);
          setRadarPage(0);
          setRadarStatus("ready");
        }
      })
      .catch((error) => {
        console.warn(`Real Estate Savant ${market.name} Development Path Radar could not be loaded.`, error);
        if (!cancelled) setRadarStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [marketIndex, selectedMarketId]);

  useEffect(() => {
    let cancelled = false;
    fetch(SAVANT_MAINTENANCE_STATUS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load Savant maintenance status: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setMaintenanceStatus(payload);
      })
      .catch((error) => console.warn("Real Estate Savant maintenance status could not be loaded.", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const allRadarCandidates = useMemo(() => radar?.topCandidates || [], [radar]);
  const radarPageCount = Math.max(1, Math.ceil(allRadarCandidates.length / RADAR_PAGE_SIZE));
  const radarCandidates = useMemo(
    () => allRadarCandidates.slice(radarPage * RADAR_PAGE_SIZE, (radarPage + 1) * RADAR_PAGE_SIZE),
    [allRadarCandidates, radarPage],
  );
  const firstCandidateNumber = allRadarCandidates.length ? radarPage * RADAR_PAGE_SIZE + 1 : 0;
  const lastCandidateNumber = Math.min((radarPage + 1) * RADAR_PAGE_SIZE, allRadarCandidates.length);
  const selectedMarket = marketIndex?.markets.find((market) => market.id === selectedMarketId) || null;
  const stateGroups = useMemo(() => {
    const groups = new Map<string, { code: string; name: string; markets: SavantMarketSummary[] }>();
    for (const market of marketIndex?.markets || []) {
      const code = market.stateCode || "OTHER";
      const group = groups.get(code) || { code, name: market.stateName || code, markets: [] };
      group.markets.push(market);
      groups.set(code, group);
    }
    return [...groups.values()];
  }, [marketIndex]);
  const selectedState = stateGroups.find((state) => state.code === selectedStateCode) || stateGroups[0] || null;

  function selectState(stateCode: string) {
    const state = stateGroups.find((item) => item.code === stateCode);
    if (!state) return;
    setSelectedStateCode(stateCode);
    if (!state.markets.some((market) => market.id === selectedMarketId)) {
      const nextMarket = state.markets.find((market) => market.status === "ready") || state.markets[0];
      setSelectedMarketId(nextMarket?.id || "");
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-950" data-page="savant-tools">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back to Real Estate Savant" className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"><ArrowLeft size={16} /></button>
          {logo}
          <div><p className="text-sm font-bold">Savant Tools</p><p className="text-[10px] font-semibold uppercase text-slate-400">Real Estate Savant workspace</p></div>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenCrm} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">CRM</button>
          <button onClick={onOpenMap} className="rounded-md bg-cyan-600 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-700">Open Map</button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid w-full max-w-6xl gap-4">
          <section className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-savant-tools-entry="true">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-600 text-white"><Wrench size={25} /></span>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">Savant Tools</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Intelligence where you need it</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">Savant capabilities are integrated directly into parcel intelligence, listings, and the CRM. They appear in context instead of being presented as a separate catalog of ideas.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => onOpenMap()} className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-5 py-3 text-sm font-bold text-white hover:bg-cyan-700"><MapIcon size={17} /> Open Parcel Intelligence</button>
              <button type="button" onClick={onOpenCrm} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><UsersRound size={17} /> Open CRM</button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-savant-development-path-radar="true" data-savant-radar-status={radarStatus}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white"><Radar size={19} /></span>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">Development Path Radar</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Off-market parcels, assemblage, growth patterns, and developer control</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Each city has its own source-backed candidate pool and its own ranking from score 100 downward. City rankings never mix.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button type="button" onClick={() => onOpenMap()} className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"><MapIcon size={15} /> Open Map</button>
                {maintenanceStatus && (
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${maintenanceStatus.publishAuthorized ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                    data-savant-maintenance-health={maintenanceStatus.status}
                  >
                    {maintenanceStatus.publishAuthorized ? "Data refresh verified" : "Data refresh blocked"}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 border-y border-slate-200 py-4" data-savant-market-groups="true">
              <div className="flex flex-wrap items-center gap-2" data-savant-state-groups="true">
                <span className="mr-1 w-20 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">State</span>
                {stateGroups.map((state) => (
                  <button
                    key={state.code}
                    type="button"
                    onClick={() => selectState(state.code)}
                    aria-pressed={selectedState?.code === state.code}
                    data-savant-state-code={state.code}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${selectedState?.code === state.code ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                  >
                    {state.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2" data-savant-city-groups="true">
                <span className="mr-1 w-20 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">City market</span>
                {(selectedState?.markets || []).map((market) => (
                  <button
                    key={market.id}
                    type="button"
                    onClick={() => setSelectedMarketId(market.id)}
                    disabled={market.status !== "ready"}
                    aria-pressed={selectedMarketId === market.id}
                    data-savant-market-id={market.id}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${selectedMarketId === market.id ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {market.name} · {formatNumber(market.candidateCount)}
                  </button>
                ))}
                {selectedMarket && <span className="ml-auto text-xs font-semibold text-slate-500">{selectedMarket.coverageLabel}</span>}
              </div>
            </div>

            {maintenanceStatus && !maintenanceStatus.publishAuthorized && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900" role="status" data-savant-maintenance-warning="true">
                These rankings remain advisory. The maintenance agent stopped publication because {maintenanceStatus.gates.filter((item) => item.status === "blocked").map((item) => item.id.replace(/-/g, " ")).join(", ")} did not pass. The last deployed data remains visible while the source is investigated.
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <RadarStat icon={<Building2 size={15} />} label="Source Parcels" value={formatNumber(radar?.sourceParcelFeatureCount)} />
              <RadarStat icon={<TrendingUp size={15} />} label="Candidates" value={formatNumber(radar?.opportunityCandidateCount)} />
              <RadarStat icon={<Network size={15} />} label="Assemblage" value={formatNumber(radar?.reasonCounts.sameBlockAssemblage)} />
              <RadarStat icon={<TrendingUp size={15} />} label="Path of Growth" value={formatNumber(radar?.reasonCounts.growthPattern)} />
            </div>

            <div className="mt-5 grid gap-3" data-savant-radar-candidates="true">
              {radarCandidates.map((candidate) => (
                <article key={candidate.accountNum} className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-savant-radar-candidate="true">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{candidate.address || candidate.accountNum}</p>
                      <p className="mt-1 text-xs text-slate-500">{candidate.ownerName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600">#{formatNumber(candidate.rank)}</span>
                      <span className="rounded-full bg-cyan-700 px-2.5 py-1 text-[10px] font-bold text-white">Market score {formatNumber(candidate.score)}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-slate-600">
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-1">{candidate.category}</span>
                    {candidate.reasonCodes.slice(0, 3).map((reason) => <span key={reason} className="rounded-full border border-slate-300 bg-white px-2 py-1">{reasonLabel(reason)}</span>)}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
                    <span>{formatMoney(candidate.metrics.totalValue)}</span>
                    <span>{candidate.metrics.yearBuilt ? `Built ${candidate.metrics.yearBuilt}` : "Year pending"}</span>
                    <span>{formatNumber(candidate.sameBlockCandidateCount)} area candidates</span>
                    <span>{formatNumber(candidate.ownerPortfolioCount)} owner candidates</span>
                  </div>
                  {candidate.pathOfGrowth && (
                    <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-950" data-savant-path-of-growth="true">
                      <span className="font-bold">Path of Growth {formatNumber(candidate.pathOfGrowth.score)}/100</span>
                      <span className="ml-2">{formatNumber(candidate.pathOfGrowth.nearbyActivityCount)} nearby signals · {candidate.pathOfGrowth.direction} corridor{candidate.pathOfGrowth.nearestMiles !== null ? ` · nearest ${candidate.pathOfGrowth.nearestMiles} mi` : ""}</span>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-600">{candidate.nextAction}</p>
                  <button type="button" onClick={() => onOpenMap(candidate.accountNum, selectedMarket?.sourceCountyId)} className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Open this parcel</button>
                </article>
              ))}
              {radarStatus === "loading" && <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Loading Development Path Radar...</p>}
              {radarStatus === "failed" && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Development Path Radar data is not available yet.</p>}
            </div>

            {radarStatus === "ready" && allRadarCandidates.length > 0 && (
              <nav className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4" aria-label="Development Path Radar pages" data-savant-radar-pagination="true">
                <p className="text-xs font-semibold text-slate-500">
                  Showing {formatNumber(firstCandidateNumber)}-{formatNumber(lastCandidateNumber)} of {formatNumber(allRadarCandidates.length)} ranked parcels
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRadarPage((page) => Math.max(0, page - 1))}
                    disabled={radarPage === 0}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="min-w-20 text-center text-xs font-semibold text-slate-600" aria-live="polite">
                    Page {formatNumber(radarPage + 1)} of {formatNumber(radarPageCount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRadarPage((page) => Math.min(radarPageCount - 1, page + 1))}
                    disabled={radarPage >= radarPageCount - 1}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </nav>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
