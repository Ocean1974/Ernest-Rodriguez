import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Building2, Map, Network, Radar, TrendingUp, UsersRound, Wrench } from "lucide-react";

type SavantRadarCandidate = {
  accountNum: string;
  address: string;
  ownerName: string;
  category: string;
  score: number;
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
  nextAction: string;
};

type SavantDevelopmentPathRadar = {
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

type SavantMaintenanceStatus = {
  checkedAt: string;
  status: "healthy" | "blocked" | "failed";
  publishAuthorized: boolean;
  gates: Array<{ id: string; status: "passed" | "blocked" }>;
};

const SAVANT_RADAR_URL = "/data/savant-tools/development-path-radar.json";
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

export default function SavantToolsPage({ onBack, onOpenMap, onOpenCrm, logo }: { onBack: () => void; onOpenMap: (query?: string) => void; onOpenCrm: () => void; logo: ReactNode }) {
  const [radar, setRadar] = useState<SavantDevelopmentPathRadar | null>(null);
  const [radarStatus, setRadarStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [maintenanceStatus, setMaintenanceStatus] = useState<SavantMaintenanceStatus | null>(null);
  const [radarPage, setRadarPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(SAVANT_RADAR_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load Savant radar: ${response.status}`);
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
        console.warn("Real Estate Savant Development Path Radar could not be loaded.", error);
        if (!cancelled) setRadarStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
              <button type="button" onClick={() => onOpenMap()} className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-5 py-3 text-sm font-bold text-white hover:bg-cyan-700"><Map size={17} /> Open Parcel Intelligence</button>
              <button type="button" onClick={onOpenCrm} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><UsersRound size={17} /> Open CRM</button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-savant-development-path-radar="true" data-savant-radar-status={radarStatus}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white"><Radar size={19} /></span>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">Development Path Radar</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Off-market parcels, assemblage, growth patterns, and developer control</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Ranks source-backed Dallas candidates where land-value pressure, older improvements, same-area ownership, zoning evidence, or developer/entity control suggest a parcel may be in the path of development.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button type="button" onClick={() => onOpenMap()} className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"><Map size={15} /> Open Map</button>
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

            {maintenanceStatus && !maintenanceStatus.publishAuthorized && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900" role="status" data-savant-maintenance-warning="true">
                These rankings remain advisory. The maintenance agent stopped publication because {maintenanceStatus.gates.filter((item) => item.status === "blocked").map((item) => item.id.replace(/-/g, " ")).join(", ")} did not pass. The last deployed data remains visible while the source is investigated.
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <RadarStat icon={<Building2 size={15} />} label="Source Parcels" value={formatNumber(radar?.sourceParcelFeatureCount)} />
              <RadarStat icon={<TrendingUp size={15} />} label="Candidates" value={formatNumber(radar?.opportunityCandidateCount)} />
              <RadarStat icon={<Network size={15} />} label="Assemblage" value={formatNumber(radar?.reasonCounts.sameBlockAssemblage)} />
              <RadarStat icon={<UsersRound size={15} />} label="Developer Control" value={formatNumber(radar?.reasonCounts.developerSurroundingControl)} />
            </div>

            <div className="mt-5 grid gap-3" data-savant-radar-candidates="true">
              {radarCandidates.map((candidate) => (
                <article key={candidate.accountNum} className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-savant-radar-candidate="true">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{candidate.address || candidate.accountNum}</p>
                      <p className="mt-1 text-xs text-slate-500">{candidate.ownerName}</p>
                    </div>
                    <span className="rounded-full bg-cyan-700 px-2.5 py-1 text-[10px] font-bold text-white">Score {formatNumber(candidate.score)}</span>
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
                  <p className="mt-3 text-xs leading-5 text-slate-600">{candidate.nextAction}</p>
                  <button type="button" onClick={() => onOpenMap(candidate.accountNum)} className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Open this parcel</button>
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
