import { ContentCardHeader } from "@/components/ui/card";
import { useLinkedGates } from "@/hooks/use-linked-gates";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import ContentPaneBackLink from "@/components/content-pane-back-link";
import SphereBackButton from "@/components/sphere-back-button";
import GateSiteGateSelect from "@/components/gate-site-gate-select";
import "@/components/gate-dashboard.css";
import { GateArrivalCard, useGateArrivals } from "@/components/gate-arrivals-panel";
import { onSiteDwell } from "@workspace/gate-booth";
import { GateTrafficRecord } from "@/components/gate-traffic-record";
import { GateArrivalDetails } from "@/components/gate-arrival-details";
import "@/components/gate-presence-tabs.css";
import { GateReportToolbar, queryGateReportRows, type GateReportRange, type GateReportRecordType } from "@/components/gate-report-toolbar";
import { BrandedInput, BrandedSelect } from "@/components/work-hub/chrome";
import { Card, CardContent, CARD_SURFACE_CLASS } from "@/components/ui/card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { changeOverRequest } from "@/lib/change-over-api";
import { gateRecordFlags, gateDurationHHMM } from "@/lib/gate-record-flags";
import { isGateEntryCleared } from "@/lib/gate-entry-clearance";
import { formatPlateForDisplay } from "@/lib/plate-display";
import { visitsApi } from "@/lib/visits-api";
import { useAuth } from "@/hooks/use-auth";
import { canUseOfficeNavigation } from "@/lib/office-navigation";
import GateHistoryRecordDetails, { type GateHistoryRecord } from "@/components/gate-history-record-details";

type GateHistoryRow = GateHistoryRecord;

const RANGE_OPTIONS: Array<[GateReportRange, string]> = [
  ["current_shift", "Current shift"], ["previous_shift", "Previous shift"], ["24h", "Last 24 hours"],
  ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["90d", "90 days"], ["1y", "1 year"],
];
const TYPE_OPTIONS: Array<[GateReportRecordType, string]> = [
  ["all", "All records"], ["check_ins", "Check-ins"], ["check_outs", "Check-outs"],
  ["visitors_on_site", "Visitors on site"], ["employees_on_site", "Employees on site"],
  ["vehicles_on_site", "Vehicles on site"], ["pending", "Pending admission"], ["needs_review", "Needs review"],
];

export default function GateHistoryPage() {
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n?.language?.startsWith("es") ? es : en;
  const { user } = useAuth(), cache = useQueryClient();
  const canCorrectPresence = canUseOfficeNavigation(user) || ["gatekeeper", "gate_supervisor"].includes(user?.vendorRole ?? "");
  const [checkingOut, setCheckingOut] = useState<string | null>(null), [checkoutError, setCheckoutError] = useState("");
  const checkoutLock = useRef(false), checkoutKeys = useRef(new Map<string, string>());
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [siteId, setSiteId] = useState(initial.get("siteId") ?? initial.get("siteLocationId") ?? "");
  const [stationId, setStationId] = useState(initial.get("stationId") ?? "");
  const [range, setRange] = useState<GateReportRange>((initial.get("range") as GateReportRange) || "current_shift");
  const [recordType, setRecordType] = useState<GateReportRecordType>((initial.get("recordType") as GateReportRecordType) || "all");
  const [search, setSearch] = useState(initial.get("search") ?? "");
  const [trafficView, setTrafficView] = useState<"arrivals" | "on_site" | "departures" | "all">(() => ["on_site", "visitors_on_site", "employees_on_site", "vehicles_on_site"].includes(recordType) ? "on_site" : recordType === "check_outs" ? "departures" : recordType === "arrivals" ? "arrivals" : "all");
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(initial.get("view") === "record" ? initial.get("recordId") : null);
  const [recordId, setRecordId] = useState<string | null>(initial.get("view") === "record" ? null : initial.get("recordId"));
  const [runId, setRunId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const sites = useQuery({ queryKey: ["change-over-history-sites"], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites?mode=history"), retry: false });
  const resolvedSiteId = siteId || String(sites.data?.sites[0]?.id ?? "");
  const stations = useQuery({ queryKey: ["change-over-history-stations", resolvedSiteId], queryFn: () => changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${resolvedSiteId}&mode=history`), enabled: Boolean(resolvedSiteId), retry: false });
  const resolvedStationId = stationId || stations.data?.stations[0]?.id || "";
  const filters = resolvedSiteId ? {
    siteId: Number(resolvedSiteId), ...(resolvedStationId ? { stationId: resolvedStationId } : {}), range, recordType,
    ...(search.trim() ? { search: search.trim() } : {}),
  } : null;
  const listFilters = filters && focusedRecordId ? { ...filters, recordType: "all" as const, recordId: focusedRecordId } : filters && trafficView === "arrivals" ? { ...filters, recordType: "pending" as const } : filters;
  const rows = useQuery({ queryKey: ["gate-history-report", listFilters], queryFn: () => queryGateReportRows<GateHistoryRow>("history", listFilters!), enabled: Boolean(listFilters), retry: false });
  const linkedGates = useLinkedGates(Number(resolvedSiteId) || undefined);
  const arrivals = useGateArrivals(!focusedRecordId && (trafficView === "arrivals" || trafficView === "all" && recordType === "all") ? Number(resolvedSiteId) || undefined : undefined, linkedGates.data?.siteIds);
  const selectedRecord = useQuery({
    queryKey: ["gate-history-record", user?.userId, user?.activeMembershipId, resolvedSiteId, resolvedStationId, recordId],
    queryFn: () => queryGateReportRows<GateHistoryRow>("history", { siteId: Number(resolvedSiteId), ...(resolvedStationId ? {stationId:resolvedStationId} : {}), range, recordType: "all", recordId: recordId! }),
    enabled: Boolean(resolvedSiteId && recordId), retry: false,
  });
  async function correctPresence(visit: GateHistoryRow) {
    if (checkoutLock.current || !canCorrectPresence || !/^visit:[1-9]\d*$/.test(visit.id)) return;
    checkoutLock.current = true; setCheckingOut(visit.id); setCheckoutError("");
    let key = checkoutKeys.current.get(visit.id);
    if (!key) { key = crypto.randomUUID(); checkoutKeys.current.set(visit.id, key); }
    try {
      await visitsApi.correctGatePresence(Number(visit.id.slice(6)), key);
      await Promise.all(["gate-history-report", "gate-history-record", "gatekeeper-visits", "gatekeeper-recent-visits", "gatekeeper-departures", "change-over-state"].map(query => cache.invalidateQueries({ queryKey: [query] })));
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : c("Checkout correction could not be saved.", "No se pudo guardar la corrección de salida."));
    } finally { checkoutLock.current = false; setCheckingOut(null); }
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (resolvedSiteId) params.set("siteId", resolvedSiteId);
    if (resolvedStationId) params.set("stationId", resolvedStationId);
    params.set("range", range); params.set("recordType", recordType);
    if (search.trim()) params.set("search", search.trim());
    if (recordId || focusedRecordId) params.set("recordId", (recordId || focusedRecordId)!);
    if (focusedRecordId) params.set("view", "record");
    if (import.meta.env.DEV && initial.get("sampleArrivals") === "1") params.set("sampleArrivals", "1");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [range, recordType, resolvedSiteId, resolvedStationId, search, recordId, focusedRecordId]);

  const visibleRecords = [
    ...(rows.data ?? []).filter(visit => focusedRecordId ? visit.id === focusedRecordId : trafficView === "arrivals" ? visit.admissionStatus === "pending" && !visit.checkOutTime && visit.reconciliationState !== "confirmed_off_site" : trafficView === "on_site" ? visit.admissionStatus !== "pending" && !visit.checkOutTime && visit.reconciliationState !== "confirmed_off_site" : true).map(visit => ({ type: "crossing" as const, visit, time: Date.parse(visit.checkOutTime || visit.checkInTime || "") || 0 })),
    ...((!focusedRecordId && (trafficView === "arrivals" || trafficView === "all" && recordType === "all")) ? arrivals.data?.arrivals.filter(run => !search.trim() || [run.driverName, run.companyName, run.vehicleLabel, run.ticketNumber, run.title, run.destinationName].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))).map(run => ({ type: "arrival" as const, run, time: Date.parse(run.observedAt || "") || 0 })) ?? [] : []),
  ].sort((a, b) => b.time - a.time);
  useEffect(() => setPage(0), [resolvedSiteId, resolvedStationId, range, recordType, trafficView, search]);
  const pageSize = 25;
  const lastPage = Math.max(0, Math.ceil(visibleRecords.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageStart = currentPage * pageSize;
  const pageRecords = visibleRecords.slice(pageStart, pageStart + pageSize);
  const displayPlate = (state?: string | null, plate?: string | null) => formatPlateForDisplay(state, plate, t("gatekeeper.plateStateUnconfirmed"));
  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="gate-history-page">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href="/gate/change-over" ariaLabel={t("gatekeeper.backToGate")} testId="button-back" />
        <History aria-hidden="true" data-testid="gate-history-header-icon" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
        <div><h1 className="text-2xl font-bold tracking-tight text-foreground">{t("gatekeeper.historyTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">Review and export Gate activity for the selected shift or date range.</p></div>
      </div>
      <Card className={`min-h-[24rem] ${CARD_SURFACE_CLASS}`}>
        <ContentCardHeader title="Gate Log" spanish="Registro de accesos" />
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 max-w-full"><GateSiteGateSelect history showGps={false} sites={sites.data?.sites ?? []} siteId={Number(resolvedSiteId)}
              gate={stations.data?.stations.find(row => row.id === resolvedStationId)}
              onChange={(nextSite, nextGate) => { setSiteId(String(nextSite)); setStationId(nextGate); setRecordId(null); setFocusedRecordId(null); }} /></div>
            <GateReportToolbar dropdown reportKind="history" filters={filters} disabled={rows.isLoading} />
          </div>
          <div className="gate-history-filters" aria-label="Gate activity filters">
            {([['arrivals','Arrivals'],['on_site','On Site'],['departures','Departures'],['all','All']] as const).map(([type,label]) =>
              <button type="button" key={type} className="gate-history-filter" aria-pressed={trafficView === type} onClick={() => {
                setTrafficView(type); setRunId(null); setFocusedRecordId(null);
                setRecordType(type === 'on_site' ? 'on_site' : type === 'departures' ? 'check_outs' : type === 'arrivals' ? 'arrivals' : 'all');
              }}>{label}</button>)}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem_13rem]">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><BrandedInput value={search} onChange={(event) => { setSearch(event.target.value); setFocusedRecordId(null); }} placeholder={t("gatekeeper.historySearch")} aria-label={t("gatekeeper.historySearch")} className="pl-9" data-testid="input-gate-history-search" /></div>
            <BrandedSelect aria-label="History range" value={range} onChange={(event) => { setRange(event.target.value as GateReportRange); setFocusedRecordId(null); }}>{RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</BrandedSelect>
            <BrandedSelect aria-label="Record type" value={recordType} disabled={trafficView === 'arrivals'} onChange={(event) => { setRecordType(event.target.value as GateReportRecordType); setFocusedRecordId(null); }}>{TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="on_site">On site</option><option value="arrivals">Incoming arrivals</option></BrandedSelect>
          </div>
          {checkoutError && <p role="alert" className="text-sm text-destructive">{checkoutError}</p>}
          {<div className="space-y-3" aria-label="Gate traffic records">
            {rows.isLoading && <Loader2 className="animate-spin text-muted-foreground" />}
            {rows.isError && <p role="alert" className="text-sm text-destructive">{t("gatekeeper.historyLoadFailed")}</p>}
            {(trafficView === "arrivals" || trafficView === "all" && recordType === "all") && arrivals.isError && <p role="alert" className="text-sm text-destructive">{t("gatekeeper.arrivalsLoadFailed")}</p>}
            {!rows.isLoading && !rows.isError && !visibleRecords.length && !((trafficView === "arrivals" || trafficView === "all" && recordType === "all") && arrivals.isLoading) && <p className="text-sm text-muted-foreground">{t("gatekeeper.historyEmpty")}</p>}
            {(trafficView === "arrivals" || trafficView === "all") && arrivals.preview && <p className="text-xs text-muted-foreground">{c("Sample arrivals · approval preview", "Llegadas de ejemplo · vista previa de aprobación")}</p>}
            {pageRecords.map(item => {
              if (item.type === "arrival") return <GateArrivalCard key={`arrival:${item.run.id}`} run={item.run} query={arrivals} onOpen={setRunId} />;
              const visit = item.visit;
              const departed = Boolean(visit.checkOutTime) || visit.reconciliationState === "confirmed_off_site";
              const pending = visit.admissionStatus === "pending" && !departed;
              const cleared = pending && isGateEntryCleared(visit);
              const dwell = onSiteDwell({ checkInTime: visit.checkInTime || "", expectedDurationMinutes: visit.expectedMinutes });
              const elapsed = visit.checkInTime && visit.checkOutTime ? Math.max(0, Math.floor((Date.parse(visit.checkOutTime) - Date.parse(visit.checkInTime)) / 60000)) : null;
              return <div key={visit.id} data-testid="gate-history-row"><GateTrafficRecord
                name={visit.name || c("Gate record", "Registro de acceso")} description={[visit.company, displayPlate(visit.plateState, visit.vehiclePlate)].filter(Boolean).join(" · ")}
                onOpen={() => setRecordId(visit.id)} overdue={!departed && !pending && dwell.overdue}
                flags={gateRecordFlags(visit, i18n?.language?.startsWith("es"))}
                status={departed ? c("Departures", "Salidas") : cleared ? c("Admitted", "Autorizado") : pending ? t("gatekeeper.pendingAdmit") : t("gatekeeper.onSiteTab")}
                className={cleared ? "gate-traffic-approved" : pending ? "gate-traffic-pending" : ""}
                footer={visit.reconciliationState === "confirmed_off_site" ? c("Checked out · departure time unknown", "Salida registrada · hora de salida desconocida") : cleared ? c("Cleared to enter · awaiting arrival", "Puede entrar · esperando llegada") : pending ? t("gatekeeper.pendingAdmit") : null}
                action={canCorrectPresence && /^visit:[1-9]\d*$/.test(visit.id) && !departed && !pending
                  ? <button type="button" className="gate-history-filter" disabled={checkingOut !== null} onClick={() => void correctPresence(visit)} aria-label={`${c("Check out", "Registrar salida")}: ${visit.name || visit.vehiclePlate || visit.id}`} title={c("Correct a missed checkout; the actual departure time remains unknown.", "Corregir una salida omitida; la hora real de salida sigue siendo desconocida.")}>{checkingOut === visit.id ? c("Saving…", "Guardando…") : t("gatekeeper.checkOut")}</button>
                  : <button type="button" className="gate-history-filter" aria-label={`${c("View", "Ver")}: ${visit.name || visit.id}`} onClick={() => setRecordId(visit.id)}>{c("View", "Ver")}</button>}>
                {visit.checkInTime && <span className="text-xs text-muted-foreground">{t("gatekeeper.historyCheckedIn")} · {new Date(visit.checkInTime).toLocaleString()}</span>}
                {visit.checkOutTime && <span className="text-xs text-muted-foreground">{t("gatekeeper.historyCheckedOut")} · {new Date(visit.checkOutTime).toLocaleString()}</span>}
                {departed && elapsed != null && <span className="text-xs text-muted-foreground">{c("Time On Site", "Tiempo en el sitio")}: {gateDurationHHMM(elapsed * 60000)}</span>}
              </GateTrafficRecord></div>;
            })}
            {(trafficView === "arrivals" || trafficView === "all") && arrivals.data?.truncated && <p className="text-xs text-muted-foreground">{t("gatekeeper.arrivalsTruncated")}</p>}
          </div>}
          <nav aria-label={c("Gate Log pages", "Páginas del registro de acceso")} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-white/10 pt-3">
            <button type="button" className="group inline-flex disabled:cursor-default disabled:opacity-35" aria-label={c("Previous records", "Registros anteriores")} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><SphereBackButton direction="left" size={32} /></button>
            <span role="status" className="text-center text-sm text-muted-foreground">{visibleRecords.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, visibleRecords.length)} {c("of", "de")} {visibleRecords.length} {c("Records", "registros")}</span>
            <button type="button" className="group inline-flex disabled:cursor-default disabled:opacity-35" aria-label={c("Next records", "Registros siguientes")} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><SphereBackButton direction="right" size={32} /></button>
          </nav>
          <GateArrivalDetails siteId={arrivals.data?.arrivals.find(row => row.runId === runId)?.siteLocationId ?? Number(resolvedSiteId)} runId={runId} onClose={() => setRunId(null)} />
        </CardContent>
      </Card>
      <GateHistoryRecordDetails open={recordId !== null} record={selectedRecord.data?.[0]} loading={selectedRecord.isLoading} failed={selectedRecord.isError} onClose={() => setRecordId(null)} />
    </div>
  );
}
