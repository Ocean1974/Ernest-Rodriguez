import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, Bell, BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Filter, Inbox, ListTodo, Mail, MapPinned, Phone, Plus, Search, Settings, SlidersHorizontal, Trash2, Upload, UserPlus, Users, X } from "lucide-react";
import { importCrmLeadsFromCsv, sanitizeCrmLead } from "../crm/importLeads.mjs";
import { enqueueSavantEvent } from "../agents/savantEventQueue.mjs";
import AgentControlCenter from "./AgentControlCenter";
import MemberExchange from "./MemberExchange";

const STORAGE_KEY = "real-estate-savant:crm:v1";
const STAGES = ["Lead", "Qualified", "Underwriting", "Due diligence", "Offer", "Closed"];
const CONTACT_ROLES = ["Unspecified", "Interested buyer", "Interested seller", "Buyer and seller"];
const CORE_EXPORT_COLUMNS = new Set(["Property Name", "Property Type", "APN", "Address", "City", "Zip Code", "State", "County", "Sale Date", "Sold Price", "Contact Name", "Phone 1", "Phone 2", "Phone 3", "Phone 4", "Phone 5", "Email 1", "Email 2", "Email 3", "Email 4", "Email 5"]);

type CrmOpportunity = {
  id: string; name: string; address: string; contact: string; email: string;
  emails?: string[]; phone?: string; phones?: string[]; agent?: string; source?: string; value: number; stage: string;
  nextAction: string; followUp: string; createdAt: string; lastActivity?: string;
  propertyLink?: string; propertyType?: string; apn?: string; unit?: string; city?: string; zipCode?: string;
  state?: string; county?: string; saleDate?: string; soldPrice?: number; importedFields?: Record<string, string>;
  contactRole?: string;
};
type CrmDraft = Omit<CrmOpportunity, "id" | "createdAt" | "lastActivity" | "value"> & { value: string };

const EMPTY_DRAFT: CrmDraft = { name: "", address: "", contact: "", email: "", phone: "", agent: "", source: "", value: "", stage: "Lead", nextAction: "", followUp: "" };

function loadOpportunities(): CrmOpportunity[] {
  if (typeof window === "undefined") return [];
  try { const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(parsed) ? parsed.map(sanitizeCrmLead).filter(hasMeaningfulLeadInfo) : []; } catch { return []; }
}
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0); }
function shortDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
function initials(value: string) { return String(value || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"; }
function contactValues(primary?: string, values?: string[]) {
  return (values?.length ? values : String(primary || "").split(" · "))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);
}
function hasMeaningfulLeadInfo(item: Partial<CrmOpportunity>) {
  const realName = String(item.contact || item.name || "").trim();
  const hasRealName = Boolean(realName && !/^(imported\s+lead|lead)$/i.test(realName));
  const hasImportedData = Object.values(item.importedFields || {}).some((value) => String(value || "").trim());
  return Boolean(hasRealName || String(item.address || "").trim() || contactValues(item.phone, item.phones).length || contactValues(item.email, item.emails).length || item.propertyType || item.apn || item.city || item.county || item.state || item.zipCode || item.saleDate || item.soldPrice || hasImportedData);
}
function EmptyState({ icon: Icon, title, detail }: { icon: typeof BriefcaseBusiness; title: string; detail: string }) {
  return <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Icon aria-hidden="true" size={20} /></div><p className="mt-3 text-sm font-semibold text-slate-900">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{detail}</p></div>;
}

export default function CrmPage({ onBack, onOpenMap, logo }: { onBack: () => void; onOpenMap: (query?: string) => void; logo: React.ReactNode }) {
  const [opportunities, setOpportunities] = useState<CrmOpportunity[]>(loadOpportunities);
  const [activeView, setActiveView] = useState("people");
  const [query, setQuery] = useState("");
  const [smartList, setSmartList] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<CrmDraft>(EMPTY_DRAFT);
  const [importStatus, setImportStatus] = useState("");
  const [importIssues, setImportIssues] = useState<Array<{ row: number; reason: string }>>([]);
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState({ phones: true, emails: true, property: true, export: true, workflow: true });
  const [lastDeletedLead, setLastDeletedLead] = useState<CrmOpportunity | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opportunities)); }, [opportunities]);
  useEffect(() => {
    setOpportunities((current) => current.map(sanitizeCrmLead).filter(hasMeaningfulLeadInfo));
  }, []);
  useEffect(() => {
    if (!selectedLeadId) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedLeadId(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedLeadId]);

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const needle = query.trim().toLowerCase();
    return opportunities.filter((item) => {
      const matchesQuery = !needle || [item.name, item.address, item.contact, item.email, item.phone, item.agent, item.source, item.stage, item.nextAction, ...Object.values(item.importedFields || {})].join(" ").toLowerCase().includes(needle);
      if (!matchesQuery) return false;
      if (smartList === "needs-contact") return !item.nextAction.trim();
      if (smartList === "follow-up-due") return Boolean(item.followUp && item.followUp <= today);
      if (smartList === "active-deals") return item.stage !== "Closed";
      return true;
    });
  }, [opportunities, query, smartList]);

  const contacts = useMemo(() => {
    const unique = new Map<string, CrmOpportunity>();
    opportunities.filter((item) => item.contact || item.email || item.phone).forEach((item) => unique.set(`${item.contact}|${item.email}|${item.phone}`.toLowerCase(), item));
    return Array.from(unique.values());
  }, [opportunities]);
  const tasks = filtered.filter((item) => item.nextAction || item.followUp);
  const openOpportunities = opportunities.filter((item) => item.stage !== "Closed");
  const pipelineValue = openOpportunities.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const followUpCount = opportunities.filter((item) => item.followUp).length;
  const today = new Date().toISOString().slice(0, 10);
  const dueFollowUps = opportunities.filter((item) => item.followUp && item.followUp <= today).sort((a, b) => a.followUp.localeCompare(b.followUp));
  const needsContactCount = opportunities.filter((item) => !item.nextAction.trim()).length;
  const selectedLead = opportunities.find((item) => item.id === selectedLeadId) || null;
  const exportColumns = useMemo(() => {
    const columns = new Set<string>();
    opportunities.forEach((item) => Object.keys(item.importedFields || {}).forEach((column) => { if (!CORE_EXPORT_COLUMNS.has(column)) columns.add(column); }));
    return Array.from(columns);
  }, [opportunities]);
  const tableColumns = ["Name", ...(columnVisibility.phones ? ["Phone 1", "Phone 2", "Phone 3", "Phone 4", "Phone 5"] : []), ...(columnVisibility.emails ? ["Email 1", "Email 2", "Email 3", "Email 4", "Email 5"] : []), ...(columnVisibility.property ? ["Property type", "APN", "Property address", "City", "County", "State", "ZIP", "Sold date", "Sold price"] : []), ...(columnVisibility.export ? exportColumns : []), ...(columnVisibility.workflow ? ["Price", "Created", "Last activity", "Agent", "Stage / source", "Follow-up"] : [])];

  const updateStage = (id: string, stage: string) => setOpportunities((current) => current.map((item) => item.id === id ? { ...item, stage, lastActivity: new Date().toISOString() } : item));
  const updateOpportunity = (id: string, updates: Partial<CrmOpportunity>) => { setOpportunities((current) => current.map((item) => item.id === id ? { ...item, ...updates, lastActivity: new Date().toISOString() } : item)); if (updates.followUp && updates.followUp <= new Date().toISOString().slice(0, 10)) enqueueSavantEvent({ eventId: id, eventType: "crm.followup.due", createdAt: new Date().toISOString() }); };
  const postponeFollowUp = (id: string, days: number) => { const date = new Date(); date.setDate(date.getDate() + days); updateOpportunity(id, { followUp: date.toISOString().slice(0, 10) }); };
  const completeFollowUp = (id: string) => updateOpportunity(id, { followUp: "", nextAction: "" });
  const updateContactValue = (id: string, kind: "phone" | "email", index: number, value: string) => setOpportunities((current) => current.map((item) => {
    if (item.id !== id) return item;
    const plural = kind === "phone" ? "phones" : "emails";
    const values = Array.from({ length: 5 }, (_, position) => contactValues(item[kind], item[plural])[position] || "");
    values[index] = value;
    const cleaned = values.map((entry) => entry.trim()).filter(Boolean);
    return { ...item, [kind]: cleaned.join(" · "), [plural]: cleaned, lastActivity: new Date().toISOString() };
  }));
  const deleteLead = (lead: CrmOpportunity) => { setLastDeletedLead(lead); setOpportunities((current) => current.filter((item) => item.id !== lead.id)); setSelectedLeadId(null); };
  const restoreDeletedLead = () => { if (!lastDeletedLead) return; setOpportunities((current) => [lastDeletedLead, ...current.filter((item) => item.id !== lastDeletedLead.id)]); setLastDeletedLead(null); };
  const createOpportunity = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() && !draft.address.trim()) return;
    const createdAt = new Date().toISOString();
    setOpportunities((current) => [{ ...draft, id: `crm-${Date.now()}`, name: draft.name.trim() || draft.address.trim(), address: draft.address.trim(), contact: draft.contact.trim(), email: draft.email.trim(), phone: draft.phone?.trim(), agent: draft.agent?.trim(), source: draft.source?.trim(), value: Math.max(0, Number(draft.value) || 0), createdAt, lastActivity: createdAt }, ...current]);
    setDraft(EMPTY_DRAFT); setShowCreate(false); setActiveView("people");
  };
  const openSmartList = (id: string) => { setSmartList(id); setActiveView("people"); };
  const importLeads = async (file?: File) => {
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith(".csv") || ["text/csv", "application/vnd.ms-excel"].includes(file.type);
    if (!isCsv) { setImportIssues([]); setImportStatus("Please choose a CSV file."); return; }
    if (file.size > 10 * 1024 * 1024) { setImportIssues([]); setImportStatus("The CSV is larger than 10 MB. Split it into smaller files and try again."); return; }
    try {
      const result = importCrmLeadsFromCsv(await file.text(), opportunities);
      if (result.error) { setImportIssues(result.issues || []); setImportStatus(result.error); return; }
      setOpportunities(result.records.filter(hasMeaningfulLeadInfo));
      setImportIssues(result.issues || []);
      setActiveView("people");
      setSmartList("all");
      setImportStatus(`${result.imported} lead${result.imported === 1 ? "" : "s"} imported${result.updated ? ` · ${result.updated} existing lead${result.updated === 1 ? "" : "s"} updated` : ""}${result.skipped ? ` · ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped` : ""}${result.invalid ? ` · ${result.invalid} empty row${result.invalid === 1 ? "" : "s"} ignored` : ""}`);
    } catch {
      setImportIssues([]); setImportStatus("The CSV could not be read. Check the file and try again.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  const dropLeadCsv = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingCsv(false);
    importLeads(event.dataTransfer.files?.[0]);
  };
  const navButton = (id: string, label: string, Icon: typeof Users, action?: () => void) => <button key={id} type="button" onClick={action || (() => setActiveView(id))} className={`inline-flex h-12 items-center gap-1.5 border-b-2 px-2.5 text-[11px] font-semibold transition ${activeView === id ? "border-cyan-400 text-white" : "border-transparent text-slate-300 hover:text-white"}`} aria-pressed={activeView === id}><Icon aria-hidden="true" size={13} />{label}</button>;

  return (
    <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-[#f4f6f8] text-slate-950" data-page="crm" data-crm-storage="local-device">
      <header className="flex h-12 shrink-0 items-center border-b border-slate-700 bg-[#26323d] px-3 shadow-sm">
        <button type="button" onClick={onBack} className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Back to Real Estate Savant"><ArrowLeft aria-hidden="true" size={16} /></button>
        <div className="mr-4 flex items-center gap-2 text-white">{logo}<span className="hidden text-xs font-bold sm:inline">Savant CRM</span></div>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="CRM primary navigation">
          {navButton("people", "People", Users)}{navButton("inbox", "Members", Inbox)}{navButton("tasks", "Tasks", ListTodo)}{navButton("calendar", "Calendar", CalendarDays)}{navButton("listings", "Listings", MapPinned, () => onOpenMap())}{navButton("pipeline", "Deals", BriefcaseBusiness)}{navButton("reporting", "Reporting", BarChart3)}{navButton("admin", "Admin", Settings)}
        </nav>
        <label className="relative ml-3 hidden w-56 lg:block"><Search aria-hidden="true" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="h-8 w-full rounded-full border-0 bg-white pl-8 pr-3 text-xs outline-none" /></label>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block" aria-label="CRM smart lists">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><span className="text-sm font-bold">People</span><button type="button" onClick={() => setShowCreate(true)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Add person or opportunity"><UserPlus size={15} /></button></div>
          <div className="p-2">
            <button type="button" onClick={() => openSmartList("all")} className={`flex w-full items-center justify-between rounded px-3 py-2 text-xs ${smartList === "all" && activeView === "people" ? "bg-cyan-50 font-semibold text-cyan-800" : "text-slate-600 hover:bg-slate-50"}`}><span className="flex items-center gap-2"><Users size={13} />All People</span><span className="text-[10px] text-slate-400">{opportunities.length}</span></button>
            <p className="px-3 pb-1 pt-4 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Assigned collections</p>
            <button type="button" onClick={() => openSmartList("needs-contact")} className="flex w-full items-center justify-between rounded px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><span>Needs Contact</span><span className="text-[10px] text-slate-400">{needsContactCount}</span></button>
            <button type="button" onClick={() => openSmartList("follow-up-due")} className="flex w-full items-center justify-between rounded px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><span>Follow-up Due</span><span className="text-[10px] text-slate-400">{followUpCount}</span></button>
            <button type="button" onClick={() => openSmartList("active-deals")} className="flex w-full items-center justify-between rounded px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><span>Active Opportunities</span><span className="text-[10px] text-slate-400">{openOpportunities.length}</span></button>
            <p className="px-3 pb-1 pt-4 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Deal stages</p>
            {STAGES.map((stage) => <button key={stage} type="button" onClick={() => { setActiveView("pipeline"); setSmartList("all"); }} className="flex w-full items-center justify-between rounded px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><span>{stage}</span><span className="text-[10px] text-slate-400">{opportunities.filter((item) => item.stage === stage).length}</span></button>)}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-700">Relationship intelligence</p><h1 className="mt-0.5 text-xl font-semibold tracking-tight">{activeView === "people" ? "All People" : activeView === "pipeline" ? "Deal Pipeline" : activeView === "inbox" ? "Member Exchange" : activeView.charAt(0).toUpperCase() + activeView.slice(1)}</h1></div><div className="flex items-center gap-2"><input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose lead CSV file" onChange={(event) => importLeads(event.target.files?.[0])} /><button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Upload aria-hidden="true" size={14} /> Import leads</button><button type="button" onClick={() => onOpenMap()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open map</button><button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700"><Plus aria-hidden="true" size={14} /> New opportunity</button></div></div>
            {importStatus && <div className="mt-3 flex items-center justify-between rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-900" role="status"><span>{importStatus}</span><button type="button" onClick={() => setImportStatus("")} className="rounded p-1 hover:bg-cyan-100" aria-label="Dismiss import status"><X size={13} /></button></div>}
            {importIssues.length > 0 && <details className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950" data-crm-import-report="true"><summary className="cursor-pointer font-bold">Import review report · {importIssues.length} row{importIssues.length === 1 ? "" : "s"}</summary><div className="mt-2 max-h-40 overflow-y-auto"><table className="w-full text-left"><thead><tr><th className="py-1 pr-3">CSV row</th><th className="py-1">Reason</th></tr></thead><tbody>{importIssues.map((issue, index) => <tr key={`${issue.row}-${index}`} className="border-t border-amber-200"><td className="py-1 pr-3 font-semibold">{issue.row}</td><td className="py-1">{issue.reason}</td></tr>)}</tbody></table></div></details>}
            {lastDeletedLead && <div className="mt-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950" role="status" data-crm-delete-recovery="true"><span>{lastDeletedLead.contact || lastDeletedLead.name} was removed.</span><div className="flex items-center gap-2"><button type="button" onClick={restoreDeletedLead} className="font-bold text-amber-800 hover:underline">Undo</button><button type="button" onClick={() => setLastDeletedLead(null)} aria-label="Dismiss deletion notice" className="rounded p-1 hover:bg-amber-100"><X size={13} /></button></div></div>}
            {dueFollowUps.length > 0 && <button type="button" onClick={() => setActiveView("tasks")} className="mt-3 flex w-full items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-xs text-amber-950" data-crm-follow-up-reminder="true"><span className="flex items-center gap-2 font-semibold"><Bell size={15} className="text-amber-600" />{dueFollowUps.length} buyer or seller follow-up reminder{dueFollowUps.length === 1 ? "" : "s"} due</span><span className="font-bold text-amber-700">Review reminders →</span></button>}
            <div
              className={`mt-3 flex cursor-pointer items-center justify-center gap-3 rounded-md border border-dashed px-4 py-3 text-center transition ${isDraggingCsv ? "border-cyan-500 bg-cyan-50 text-cyan-900" : "border-slate-300 bg-slate-50/70 text-slate-600 hover:border-cyan-400 hover:bg-cyan-50/50"}`}
              role="button"
              tabIndex={0}
              aria-label="Drag and drop a CSV file to import CRM leads"
              data-crm-csv-dropzone="true"
              onClick={() => importInputRef.current?.click()}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); importInputRef.current?.click(); } }}
              onDragEnter={(event) => { event.preventDefault(); setIsDraggingCsv(true); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setIsDraggingCsv(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingCsv(false); }}
              onDrop={dropLeadCsv}
            >
              <Upload aria-hidden="true" size={17} className="shrink-0 text-cyan-700" />
              <div><p className="text-xs font-semibold">Drop a CSV here to load leads into the CRM</p><p className="mt-0.5 text-[10px] text-slate-400">Or click to browse · Follow Up Boss-style columns are recognized · 10 MB maximum</p></div>
            </div>
            <label className="relative mt-3 block lg:hidden"><Search aria-hidden="true" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, properties, or contacts" className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-cyan-500" /></label>
          </div>

          {activeView === "people" && (
            <section className="p-4 sm:p-6" data-crm-view="people">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <p className="text-xs text-slate-500">Showing <span className="font-semibold text-slate-800">{filtered.length}</span> people</p>
                  <div className="flex items-center gap-1"><details className="relative" data-crm-column-selector="true"><summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded border border-slate-200 px-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"><SlidersHorizontal size={12} /> Columns</summary><div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"><p className="mb-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">Show column groups</p>{([['phones', 'Phone 1–5'], ['emails', 'Email 1–5'], ['property', 'Property and sale'], ['export', 'Complete export'], ['workflow', 'CRM workflow']] as const).map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={columnVisibility[key]} onChange={() => setColumnVisibility((current) => ({ ...current, [key]: !current[key] }))} />{label}</label>)}</div></details><button type="button" className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-200 px-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"><Filter size={12} /> Filters</button></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[3600px] border-collapse text-left" style={{ minWidth: `${3600 + exportColumns.length * 150}px` }} aria-label="People and relationship activity" data-crm-complete-export-columns="true">
                    <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr>{tableColumns.map((label, index) => <th key={label} className={`whitespace-nowrap border-b border-slate-200 px-3 py-2.5 ${index === 0 ? "sticky left-0 z-10 bg-slate-50 shadow-[2px_0_0_#e2e8f0]" : ""}`}>{label}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 text-[11px]">
                      {filtered.map((item) => { const phones = contactValues(item.phone, item.phones); const emails = contactValues(item.email, item.emails); return <tr key={item.id} className="hover:bg-cyan-50/40">
                        <td className="sticky left-0 z-[1] bg-white px-3 py-3 shadow-[2px_0_0_#e2e8f0]"><div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[9px] font-bold text-cyan-800">{initials(item.contact || item.name)}</span><div><button type="button" onClick={() => setSelectedLeadId(item.id)} className="text-left font-semibold text-slate-900 hover:text-cyan-700 hover:underline" data-action="open-lead-profile">{item.contact || item.name}</button><p className="max-w-44 truncate text-[9px] text-slate-400">{item.name}{item.address ? ` · ${item.address}` : ""}</p></div></div></td>
                        {columnVisibility.phones && [0, 1, 2, 3, 4].map((index) => <td key={`phone-${index}`} className="whitespace-nowrap px-3 py-3 text-slate-600">{phones[index] ? <a href={`tel:${phones[index].replace(/[^+\d]/g, "")}`} aria-label={`Call ${item.contact || item.name} at ${phones[index]}`} title={`Call ${phones[index]}`} data-action="call-lead" className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-50 hover:underline"><Phone size={11} className="shrink-0 text-emerald-500" />{phones[index]}</a> : "—"}</td>)}
                        {columnVisibility.emails && [0, 1, 2, 3, 4].map((index) => <td key={`email-${index}`} className="px-3 py-3 text-slate-600">{emails[index] ? <a href={`mailto:${emails[index]}`} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-sky-700 hover:underline"><Mail size={11} className="shrink-0 text-sky-500" />{emails[index]}</a> : "—"}</td>)}
                        {columnVisibility.property && <><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.propertyType || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.apn || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.address || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.city || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.county || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.state || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.zipCode || "—"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{item.saleDate || "—"}</td><td className="whitespace-nowrap px-3 py-3 font-medium text-slate-700">{item.soldPrice ? money(item.soldPrice) : "—"}</td></>}
                        {columnVisibility.export && exportColumns.map((column) => <td key={column} className="max-w-64 whitespace-nowrap px-3 py-3 text-slate-600"><span className="block max-w-64 overflow-hidden text-ellipsis" title={item.importedFields?.[column] || ""}>{column === "Property Link" && item.importedFields?.[column] ? <a href={item.importedFields[column]} target="_blank" rel="noreferrer" className="font-semibold text-cyan-700 hover:underline">Open record</a> : item.importedFields?.[column] || "—"}</span></td>)}
                        {columnVisibility.workflow && <><td className="px-3 py-3 font-medium text-slate-700">{item.value ? money(item.value) : "—"}</td><td className="px-3 py-3 text-slate-500">{shortDate(item.createdAt)}</td><td className="px-3 py-3"><p className="font-medium text-slate-700">{item.nextAction || "No activity"}</p><p className="mt-0.5 text-[9px] text-slate-400">{shortDate(item.lastActivity || item.createdAt)}</p></td><td className="px-3 py-3 text-slate-600">{item.agent || "Unassigned"}</td><td className="px-3 py-3"><select value={item.stage} onChange={(event) => updateStage(item.id, event.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px]" aria-label={`Stage for ${item.name}`}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select><p className="mt-1 text-[9px] text-slate-400">{item.source || "Direct"}</p></td><td className="px-3 py-3"><p className="text-slate-600">{shortDate(item.followUp)}</p>{item.address && <button type="button" onClick={() => onOpenMap(item.address)} className="mt-1 text-[9px] font-semibold text-cyan-700 hover:text-cyan-900">View parcel →</button>}</td></>}
                      </tr>; })}
                      {!filtered.length && <tr><td colSpan={tableColumns.length} className="px-6 py-16 text-center"><Users className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold text-slate-700">No people yet</p><p className="mt-1 text-xs text-slate-400">Create an opportunity to add the first relationship record.</p></td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeView === "pipeline" && <section className="p-4 sm:p-6" data-crm-view="pipeline"><div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="CRM summary">{[[BriefcaseBusiness, "Open opportunities", openOpportunities.length], [MapPinned, "Pipeline value", money(pipelineValue)], [Users, "Contacts", contacts.length], [Clock3, "Follow-ups", followUpCount]].map(([Icon, label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-slate-500">{String(label)}</p><Icon aria-hidden="true" size={14} className="text-slate-400" /></div><p className="mt-2 text-lg font-semibold">{String(value)}</p></div>)}</div><div className="overflow-x-auto pb-3"><div className="grid min-w-[1120px] grid-cols-6 gap-3">{STAGES.map((stage) => { const records = filtered.filter((item) => item.stage === stage); return <div key={stage} className="rounded-lg border border-slate-200 bg-slate-100/80 p-2.5"><div className="flex items-center justify-between px-1 py-1"><h2 className="text-xs font-bold text-slate-700">{stage}</h2><span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500">{records.length}</span></div><div className="mt-2 space-y-2">{records.map((item) => <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><p className="text-xs font-semibold">{item.name}</p><p className="mt-1 text-[10px] text-slate-500">{item.address || "No property address yet"}</p>{item.value > 0 && <p className="mt-2 text-xs font-semibold">{money(item.value)}</p>}<select value={item.stage} onChange={(event) => updateStage(item.id, event.target.value)} className="mt-3 w-full rounded border border-slate-200 px-2 py-1.5 text-[10px]" aria-label={`Stage for ${item.name}`}>{STAGES.map((option) => <option key={option}>{option}</option>)}</select></article>)}{!records.length && <p className="rounded-lg border border-dashed border-slate-300 px-2 py-5 text-center text-[10px] text-slate-400">No opportunities</p>}</div></div>; })}</div></div></section>}
          {activeView === "tasks" && <section className="p-4 sm:p-6" data-crm-view="tasks">{tasks.length ? <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">{tasks.map((item) => { const isDue = Boolean(item.followUp && item.followUp <= today); return <div key={item.id} className={`flex flex-wrap items-center gap-4 border-b p-4 last:border-0 ${isDue ? "border-amber-200 bg-amber-50/60" : "border-slate-100"}`}><Bell size={18} className={isDue ? "text-amber-600" : "text-slate-300"} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{item.nextAction || "Follow up"}</p><p className="mt-1 truncate text-[10px] text-slate-500">{item.contact || item.name} · {item.contactRole || "Buyer or seller"} · {item.address || "No property address"}</p></div><time className={`text-[10px] font-bold ${isDue ? "text-amber-700" : "text-slate-500"}`}>{isDue ? "Due " : ""}{shortDate(item.followUp)}</time><div className="flex items-center gap-1"><button type="button" onClick={() => postponeFollowUp(item.id, 1)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">Tomorrow</button><button type="button" onClick={() => postponeFollowUp(item.id, 7)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">In 7 days</button><button type="button" onClick={() => completeFollowUp(item.id)} className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"><CheckCircle2 size={11} />Done</button></div></div>; })}</div> : <EmptyState icon={ListTodo} title="No follow-ups yet" detail="Open a buyer or seller profile to schedule the next follow-up reminder." />}</section>}
          {activeView === "inbox" && <MemberExchange />}
          {activeView === "calendar" && <section className="p-4 sm:p-6">{tasks.length ? <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">{tasks.map((item) => <div key={item.id} className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-0"><CalendarDays size={16} className="text-cyan-600" /><time className="w-24 text-[10px] font-semibold text-slate-500">{shortDate(item.followUp)}</time><div><p className="text-xs font-semibold">{item.nextAction || "Follow up"}</p><p className="text-[10px] text-slate-400">{item.contact || item.name}</p></div></div>)}</div> : <EmptyState icon={CalendarDays} title="No scheduled activity" detail="Follow-up dates from relationship records will appear on this calendar." />}</section>}
          {activeView === "reporting" && <section className="p-4 sm:p-6"><div className="grid gap-3 md:grid-cols-3">{[["Pipeline value", money(pipelineValue)], ["Open deals", openOpportunities.length], ["Scheduled follow-ups", followUpCount]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-3 text-2xl font-semibold">{String(value)}</p></div>)}</div></section>}
          {activeView === "admin" && <AgentControlCenter />}
        </main>
      </div>

      {selectedLead && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="lead-profile-title" data-crm-lead-profile="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLeadId(null); }}>
        <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700">Lead profile</p><h2 id="lead-profile-title" className="mt-1 text-xl font-semibold text-slate-950">{selectedLead.contact || selectedLead.name}</h2></div><button type="button" onClick={() => setSelectedLeadId(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close lead profile"><X size={19} /></button></div>
          <div className="space-y-5 p-5">
            <section className="rounded-xl border border-slate-200 p-4"><h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Contact information</h3><div className="mt-3 grid gap-4 sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase text-slate-400">Phone numbers</p><div className="mt-2 space-y-2">{contactValues(selectedLead.phone, selectedLead.phones).map((phone, index) => <a key={`${index}-${phone}`} href={`tel:${phone.replace(/[^+\d]/g, "")}`} aria-label={`Call ${selectedLead.contact || selectedLead.name} at ${phone}`} title={`Call ${phone}`} data-action="call-lead" className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 hover:underline"><Phone size={14} className="mt-0.5 shrink-0" /><span><span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Phone {index + 1}:</span>{phone}</span></a>)}{!contactValues(selectedLead.phone, selectedLead.phones).length && <p className="text-sm text-slate-400">None provided</p>}</div></div><div><p className="text-[10px] font-bold uppercase text-slate-400">Email addresses</p><div className="mt-2 space-y-2">{contactValues(selectedLead.email, selectedLead.emails).map((email, index) => <a key={`${index}-${email}`} href={`mailto:${email}`} className="flex items-start gap-2 break-all text-sm font-semibold text-sky-700 hover:underline"><Mail size={14} className="mt-0.5 shrink-0" /><span><span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Email {index + 1}:</span>{email}</span></a>)}{!contactValues(selectedLead.email, selectedLead.emails).length && <p className="text-sm text-slate-400">None provided</p>}</div></div></div></section>
            <section className="rounded-xl border border-slate-200 p-4"><h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Property and opportunity</h3><dl className="mt-3 grid gap-4 sm:grid-cols-2">{[["Opportunity", selectedLead.name], ["Property address", selectedLead.address], ["Estimated value", selectedLead.value ? money(selectedLead.value) : "—"], ["Source", selectedLead.source || "Direct"], ["Assigned agent", selectedLead.agent || "Unassigned"], ["Created", shortDate(selectedLead.createdAt)], ["Last activity", shortDate(selectedLead.lastActivity || selectedLead.createdAt)], ["Follow-up", shortDate(selectedLead.followUp)], ["Next action", selectedLead.nextAction || "None scheduled"]].map(([label, value]) => <div key={label}><dt className="text-[10px] font-bold uppercase text-slate-400">{label}</dt><dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd></div>)}</dl></section>
            <details className="rounded-xl border border-slate-200 p-4" data-crm-lead-editor="true"><summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.12em] text-cyan-700">Edit lead information</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">{[["contact", "Contact name"], ["name", "Opportunity / property name"], ["address", "Property address"], ["propertyType", "Property type"], ["apn", "APN"], ["city", "City"], ["county", "County"], ["state", "State"], ["zipCode", "ZIP"], ["agent", "Assigned agent"]].map(([key, label]) => <label key={key} className="block"><span className="text-[10px] font-bold uppercase text-slate-400">{label}</span><input value={String(selectedLead[key as keyof CrmOpportunity] || "")} onChange={(event) => updateOpportunity(selectedLead.id, { [key]: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-xs" /></label>)}<div className="sm:col-span-2"><p className="text-[10px] font-bold uppercase text-slate-400">Phone numbers</p><div className="mt-1 grid gap-2 sm:grid-cols-2">{[0, 1, 2, 3, 4].map((index) => <input key={index} aria-label={`Phone ${index + 1}`} value={contactValues(selectedLead.phone, selectedLead.phones)[index] || ""} onChange={(event) => updateContactValue(selectedLead.id, "phone", index, event.target.value)} placeholder={`Phone ${index + 1}`} className="h-9 rounded-md border border-slate-300 px-3 text-xs" />)}</div></div><div className="sm:col-span-2"><p className="text-[10px] font-bold uppercase text-slate-400">Email addresses</p><div className="mt-1 grid gap-2 sm:grid-cols-2">{[0, 1, 2, 3, 4].map((index) => <input key={index} type="email" aria-label={`Email ${index + 1}`} value={contactValues(selectedLead.email, selectedLead.emails)[index] || ""} onChange={(event) => updateContactValue(selectedLead.id, "email", index, event.target.value)} placeholder={`Email ${index + 1}`} className="h-9 rounded-md border border-slate-300 px-3 text-xs" />)}</div></div></div></details>
            {selectedLead.importedFields && Object.keys(selectedLead.importedFields).length > 0 && <section className="rounded-xl border border-slate-200 p-4" data-crm-export-details="true"><h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Complete export details</h3><p className="mt-1 text-[10px] text-slate-400">Every populated field retained from the imported CSV.</p><dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">{Object.entries(selectedLead.importedFields).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-800">{label === "Property Link" ? <a href={value} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline">Open property record</a> : value}</dd></div>)}</dl></section>}
            <section className="rounded-xl border border-slate-200 p-4" data-crm-follow-up-editor="true"><div className="flex items-center gap-2"><Bell size={15} className="text-amber-600" /><h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Follow-up reminder</h3></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block"><span className="text-[10px] font-bold uppercase text-slate-400">Relationship</span><select value={selectedLead.contactRole || "Unspecified"} onChange={(event) => updateOpportunity(selectedLead.id, { contactRole: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold">{CONTACT_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label><label className="block"><span className="text-[10px] font-bold uppercase text-slate-400">Reminder date</span><input type="date" value={selectedLead.followUp || ""} onChange={(event) => updateOpportunity(selectedLead.id, { followUp: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold" /></label><label className="block sm:col-span-2"><span className="text-[10px] font-bold uppercase text-slate-400">Next action</span><input type="text" value={selectedLead.nextAction || ""} onChange={(event) => updateOpportunity(selectedLead.id, { nextAction: event.target.value })} placeholder="Call, email, send details, or schedule a showing" className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label><label className="block sm:col-span-2"><span className="text-[10px] font-bold uppercase text-slate-400">Deal stage</span><select value={selectedLead.stage} onChange={(event) => updateStage(selectedLead.id, event.target.value)} className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold">{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label></div></section>
            {selectedLead.address && <button type="button" onClick={() => onOpenMap(selectedLead.address)} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700"><MapPinned size={16} /> View parcel on map</button>}
            <button type="button" onClick={() => deleteLead(selectedLead)} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"><Trash2 size={16} /> Remove lead</button>
          </div>
        </aside>
      </div>}

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="new-opportunity-title"><form onSubmit={createOpportunity} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-700">Relationship record</p><h2 id="new-opportunity-title" className="mt-1 text-lg font-semibold">New person and opportunity</h2></div><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[["contact", "Contact or company", "Owner or organization"], ["name", "Opportunity name", "Acquisition opportunity"], ["phone", "Phone", "(555) 555-0123"], ["email", "Email", "contact@example.com"], ["address", "Property address", "Street address"], ["value", "Estimated value", "0"], ["agent", "Assigned agent", "Team member"], ["source", "Source", "Referral, listing, parcel search"], ["nextAction", "Next action", "Call owner"]].map(([key, label, placeholder]) => <label key={key} className="block"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</span><input type={key === "email" ? "email" : key === "value" ? "number" : "text"} min={key === "value" ? "0" : undefined} value={String(draft[key as keyof CrmDraft] || "")} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-xs outline-none focus:border-cyan-500" /></label>)}<label className="block"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Stage</span><select value={draft.stage} onChange={(event) => setDraft((current) => ({ ...current, stage: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-xs">{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label className="block"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Follow-up date</span><input type="date" value={draft.followUp} onChange={(event) => setDraft((current) => ({ ...current, followUp: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-xs" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button><button type="submit" disabled={!draft.name.trim() && !draft.address.trim()} className="rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Create opportunity</button></div></form></div>}
    </div>
  );
}
