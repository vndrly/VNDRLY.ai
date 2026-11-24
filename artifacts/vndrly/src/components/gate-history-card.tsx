import { aggregateGateSnapshots } from "@/lib/aggregate-gate-snapshots";
import type { ChangeOverState } from "@workspace/gate-booth";
import { GateActivityCard } from "@/components/gate-activity-card";
import { readGateSelection, saveGateSelection, useGateSelection } from "@/lib/gate-selection";
import { GateAreaTraffic } from '@/components/gate-area-traffic';
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
import { sampleGateArrivalDetail } from "@/lib/gate-arrival-preview";
import "@/components/gate-presence-tabs.css";
import { GateReportToolbar, queryGateReportRows, type GateReportRange, type GateReportRecordType } from "@/components/gate-report-toolbar";
import { BrandedInput } from "@/components/work-hub/chrome";
import { GateDropdown } from "./gate-dropdown";
import { useCardNextSteps } from "./card-next-steps";
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

export default function GateHistoryCard({ standalone = false, showActivity = false }: { standalone?: boolean; showActivity?: boolean }) {
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n?.language?.startsWith("es") ? es : en;
  const { user } = useAuth(), cache = useQueryClient();
  const [helpTask, setHelpTask] = useState<"review" | "export">("review");
  const reviewTitle = c("Review Gate Log records", "Revisar registros del acceso");
  const exportTitle = c("Export the Gate Log", "Exportar el registro de acceso");
  const logHelp = useCardNextSteps({
    card: "gate-log",
    task: helpTask,
    enabled: Boolean(user?.userId),
    choices: [
      { id: "review", title: reviewTitle, prepare: () => setHelpTask("review") },
      { id: "export", title: exportTitle, prepare: () => setHelpTask("export") },
    ],
    title: helpTask === "review" ? reviewTitle : exportTitle,
    steps: helpTask === "review"
      ? [c("Choose a gate and date range.", "Elija un acceso y un intervalo."), c("Open a record to review its saved details.", "Abra un registro para ver sus detalles guardados.")]
      : [c("Choose the gate, date range, and records to include.", "Elija el acceso, el intervalo y los registros que desea incluir."), c("Open Export and choose a format or email delivery.", "Abra Exportar y elija un formato o el envío por correo.")],
    target: null,
    prompt: "",
  });
  const canCorrectPresence = canUseOfficeNavigation(user) || ["gatekeeper", "gate_supervisor"].includes(user?.vendorRole ?? "");
  const [checkingOut, setCheckingOut] = useState<string | null>(null), [checkoutError, setCheckoutError] = useState("");
  const checkoutLock = useRef(false), checkoutKeys = useRef(new Map<string, string>());
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [siteId, setSiteId] = useState(initial.get("siteId") ?? initial.get("siteLocationId") ?? readGateSelection(user)?.siteId ?? "");
  const [stationId, setStationId] = useState(initial.get("stationId") ?? (initial.has("siteId") || initial.has("siteLocationId") ? "" : readGateSelection(user)?.stationId) ?? "");
  const [range, setRange] = useState<GateReportRange>((initial.get("range") as GateReportRange) || "current_shift");
  const [customFrom, setCustomFrom] = useState(initial.get("from") ?? ""), [customTo, setCustomTo] = useState(initial.get("to") ?? "");
  const customWindow = range === "custom" && Boolean(customFrom && customTo);
  const [recordType, setRecordType] = useState<GateReportRecordType>((initial.get("recordType") as GateReportRecordType) || "all");
  const [search, setSearch] = useState(initial.get("search") ?? "");
  const [trafficView, setTrafficView] = useState<"arrivals" | "on_site" | "departures" | "all">(() => ["on_site", "visitors_on_site", "employees_on_site", "vehicles_on_site"].includes(recordType) ? "on_site" : recordType === "check_outs" ? "departures" : recordType === "arrivals" ? "arrivals" : "all");
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(initial.get("view") === "record" ? initial.get("recordId") : null);
  const [recordId, setRecordId] = useState<string | null>(initial.get("view") === "record" ? null : initial.get("recordId"));
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    if (!standalone) return;
    const onNativeSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ siteId?: number; stationId?: string }>).detail;
      if (!detail || !Number.isInteger(detail.siteId) || detail.siteId! < 0 || typeof detail.stationId !== "string") return;
      saveGateSelection(user, detail.siteId!, detail.stationId);
      setSiteId(detail.siteId ? String(detail.siteId) : "");
      setStationId(detail.stationId);
      setRecordId(null);
      setFocusedRecordId(null);
    };
    window.addEventListener("gate-native-log-selection", onNativeSelection);
    return () => window.removeEventListener("gate-native-log-selection", onNativeSelection);
  }, [standalone, user]);
  useEffect(() => {
    if (!standalone) return;
    const onNativeQuery = (event: Event) => {
      const detail = (event as CustomEvent<{ field?: string; value?: string }>).detail;
      if (!detail || typeof detail.value !== "string") return;
      if (detail.field === "search") setSearch(detail.value);
      else if (detail.field === "range" && (RANGE_OPTIONS.some(([value]) => value === detail.value) || detail.value === "custom" && customWindow)) setRange(detail.value as GateReportRange);
      else if (detail.field === "recordType" && [...TYPE_OPTIONS.map(([value]) => value), "on_site", "arrivals"].includes(detail.value as GateReportRecordType) && trafficView !== "arrivals") setRecordType(detail.value as GateReportRecordType);
      else return;
      setFocusedRecordId(null);
    };
    window.addEventListener("gate-native-log-query", onNativeQuery);
    return () => window.removeEventListener("gate-native-log-query", onNativeQuery);
  }, [standalone, customWindow, trafficView]);
  const sharedSelection=useGateSelection(user);
  const initialLinkPending=useRef(initial.has("siteId")||initial.has("siteLocationId")||initial.has("stationId"));
  useEffect(()=>{if(sharedSelection&&!initialLinkPending.current){setSiteId(sharedSelection.siteId);setStationId(sharedSelection.stationId);}},[sharedSelection]);
  const requestedPage = (params: URLSearchParams) => Math.max(0, Math.min(999, Math.floor(Number(params.get("page")) || 1) - 1));
  const [page, setPage] = useState(() => requestedPage(initial));
  const pendingPage = useRef<number | null>(requestedPage(initial));
  useEffect(() => {
    const navigate = () => {
      const params = new URLSearchParams(window.location.search);
      initialLinkPending.current = params.has("siteId") || params.has("stationId");
      pendingPage.current = requestedPage(params);
      if (params.has("siteId") || params.has("siteLocationId")) setSiteId(params.get("siteId") ?? params.get("siteLocationId") ?? "");
      setStationId(params.get("stationId") ?? "");
      setRange((params.get("range") as GateReportRange) || "current_shift");
      setCustomFrom(params.get("from") ?? ""); setCustomTo(params.get("to") ?? "");
      const type = (params.get("recordType") as GateReportRecordType) || "all";
      setRecordType(type); setSearch(params.get("search") ?? "");
      setTrafficView(["on_site", "visitors_on_site", "employees_on_site", "vehicles_on_site"].includes(type) ? "on_site" : type === "check_outs" ? "departures" : type === "arrivals" ? "arrivals" : "all");
      setFocusedRecordId(params.get("view") === "record" ? params.get("recordId") : null);
      setRecordId(params.get("view") === "record" ? null : params.get("recordId"));
      setPage(requestedPage(params));
    };
    window.addEventListener("popstate", navigate); return () => window.removeEventListener("popstate", navigate);
  }, []);
  const sites = useQuery({ queryKey: ["change-over-history-sites",user?.userId,user?.activeMembershipId], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites?mode=history"), retry: false });
  const resolvedSiteId = siteId;
  const allSiteIds = sites.data?.sites.map(site => site.id) ?? [];
  const allGates = useQuery({
    queryKey: ["gate-history-all-stations", user?.userId, user?.activeMembershipId, allSiteIds],
    queryFn: async () => (await Promise.all(allSiteIds.map(async siteId => {
      const result = await changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${siteId}&mode=history`);
      return result.stations.map(gate => ({ ...gate, siteId }));
    }))).flat(), enabled: allSiteIds.length > 0, retry: false,
  });
  const stations = useQuery({ queryKey: ["change-over-history-stations",user?.userId,user?.activeMembershipId, resolvedSiteId], queryFn: () => changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${resolvedSiteId}&mode=history`), enabled: Boolean(resolvedSiteId), retry: false });
  const resolvedStationId = stationId || (resolvedSiteId ? stations.data?.stations[0]?.id : "") || "";
    useEffect(()=>{if(initialLinkPending.current&&sites.data&&stations.data&&stations.data.stations.some(g=>g.id===resolvedStationId)){initialLinkPending.current=false;saveGateSelection(user,Number(resolvedSiteId),resolvedStationId);}},[sites.data,stations.data,resolvedSiteId,resolvedStationId]);
  const activityGates = resolvedStationId ? [resolvedStationId] : [...new Map((allGates.data ?? []).map(gate => [gate.siteId, gate.id])).values()];
  const activity = useQuery({
    queryKey: ["gate-log-activity", user?.userId, user?.activeMembershipId, activityGates],
    queryFn: () => Promise.all(activityGates.map(id => changeOverRequest<ChangeOverState>(`/${id}/state`))),
    enabled: showActivity && activityGates.length > 0, retry: false, refetchInterval: resolvedStationId ? 5000 : 30000,
  });
  const activitySnapshot = aggregateGateSnapshots(activity.data ?? []);
  const activityRange = activity.data?.some(state => state.shift) ? "current_shift" : "24h";
  const filters = (resolvedSiteId || allSiteIds.length) ? {
    siteId: Number(resolvedSiteId) || allSiteIds[0], ...(!resolvedSiteId ? { siteIds: allSiteIds } : {}),
    ...(resolvedStationId ? { stationId: resolvedStationId } : {}), range, recordType,
    ...(customWindow ? { from: customFrom, to: customTo } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  } : null;
  const listFilters = filters && focusedRecordId ? { ...filters, recordType: "all" as const, recordId: focusedRecordId } : filters && trafficView === "arrivals" ? { ...filters, recordType: "pending" as const } : filters;
  const rows = useQuery({ queryKey: ["gate-history-report",user?.userId,user?.activeMembershipId, listFilters], queryFn: () => queryGateReportRows<GateHistoryRow>("history", listFilters!), enabled: Boolean(listFilters), retry: false });
  const linkedGates = useLinkedGates(Number(resolvedSiteId) || undefined);
  const arrivals = useGateArrivals(!customWindow && !focusedRecordId && (trafficView === "arrivals" || trafficView === "all" && recordType === "all") ? Number(resolvedSiteId) || allSiteIds[0] : undefined, resolvedSiteId ? linkedGates.data?.siteIds : allSiteIds);
  const selectedRecord = useQuery({
    queryKey: ["gate-history-record", user?.userId, user?.activeMembershipId, resolvedSiteId, resolvedStationId, recordId],
    queryFn: () => queryGateReportRows<GateHistoryRow>("history", { ...filters!, recordType: "all", recordId: recordId! }),
    enabled: Boolean(filters && recordId), retry: false,
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
    if (!standalone) return;
    const params = new URLSearchParams();
    if (resolvedSiteId) params.set("siteId", resolvedSiteId);
    if (resolvedStationId) params.set("stationId", resolvedStationId);
    params.set("range", range); params.set("recordType", recordType);
    if (customWindow) { params.set("from", customFrom); params.set("to", customTo); }
    if (page) params.set("page", String(page + 1));
    if (search.trim()) params.set("search", search.trim());
    if (recordId || focusedRecordId) params.set("recordId", (recordId || focusedRecordId)!);
    if (focusedRecordId) params.set("view", "record");
    if (import.meta.env.DEV && initial.get("sampleArrivals") === "1") params.set("sampleArrivals", "1");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [standalone, range, recordType, resolvedSiteId, resolvedStationId, search, recordId, focusedRecordId, customFrom, customTo, page]);

  const visibleRecords = [
    ...[...new Map((rows.data ?? []).map(row => [row.id, row])).values()].filter(visit => focusedRecordId ? visit.id === focusedRecordId : trafficView === "arrivals" ? visit.admissionStatus === "pending" && !visit.checkOutTime && visit.reconciliationState !== "confirmed_off_site" : trafficView === "on_site" ? visit.admissionStatus !== "pending" && !visit.checkOutTime && visit.reconciliationState !== "confirmed_off_site" : true).map(visit => ({ type: "crossing" as const, visit, time: Date.parse(visit.checkOutTime || visit.checkInTime || "") || 0 })),
    ...((!customWindow && !focusedRecordId && (trafficView === "arrivals" || trafficView === "all" && recordType === "all")) ? arrivals.data?.arrivals.filter(run => !search.trim() || [run.driverName, run.companyName, run.vehicleLabel, run.ticketNumber, run.title, run.destinationName].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))).map(run => ({ type: "arrival" as const, run, time: Date.parse(run.observedAt || "") || 0 })) ?? [] : []),
  ].sort((a, b) => b.time - a.time);
  useEffect(() => { const requested = pendingPage.current; pendingPage.current = null; setPage(requested ?? 0); }, [resolvedSiteId, resolvedStationId, range, recordType, trafficView, search, customFrom, customTo]);
  const pageSize = 25;
  const lastPage = Math.max(0, Math.ceil(visibleRecords.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageStart = currentPage * pageSize;
  const pageRecords = visibleRecords.slice(pageStart, pageStart + pageSize);
  const displayPlate = (state?: string | null, plate?: string | null) => formatPlateForDisplay(state, plate, t("gatekeeper.plateStateUnconfirmed"));
  return (
    <div className={standalone ? FIELD_OPS_PAGE_CLASS : "min-w-0 space-y-6"} data-guidance-scope={logHelp.scopeId} data-testid={standalone ? "gate-history-page" : "gate-history-card"} data-site-id={resolvedSiteId} data-station-id={resolvedStationId} data-range={range} data-from={customFrom} data-to={customTo} data-page={currentPage + 1} data-record-count={visibleRecords.length} data-loading={rows.isPending || rows.isFetching} data-error={rows.isError}>
      {standalone && <div id="gate-log-header-native-slot" data-title={t("gatekeeper.historyTitle")} data-subtitle="Review and export Gate activity for the selected shift or date range." className="flex items-center gap-3">
        <ContentPaneBackLink href={resolvedSiteId ? `/gate/change-over?${new URLSearchParams({ siteId: resolvedSiteId, ...(resolvedStationId ? { stationId: resolvedStationId } : {}) })}` : "/gate/change-over"} ariaLabel={t("gatekeeper.backToGate")} testId="button-back" />
        <History aria-hidden="true" data-testid="gate-history-header-icon" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
        <div><h1 className="text-2xl font-bold tracking-tight text-foreground">{t("gatekeeper.historyTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">Review and export Gate activity for the selected shift or date range.</p></div>
      </div>}
      {showActivity && <div data-testid="gate-log-activity" id={standalone ? "gate-activity-native-slot" : undefined} data-snapshot={standalone ? JSON.stringify(activitySnapshot) : undefined} data-history-base-href={standalone ? `/gate/history?${new URLSearchParams({ siteId: resolvedSiteId, stationId: resolvedStationId, range: activityRange })}` : undefined} data-activity-window={standalone && activityRange === "24h" ? "24h" : undefined} data-scope-label={standalone && !resolvedSiteId ? c("All gates", "Todos los accesos") : undefined}>
        <GateActivityCard snapshot={activitySnapshot} scopeLabel={!resolvedSiteId ? c("All gates", "Todos los accesos") : undefined}
          liveScope={`${user?.userId}:${user?.activeMembershipId}:${resolvedSiteId}:${resolvedStationId}`}
          activityWindow={activityRange === "24h" ? "24h" : undefined}
          historyBaseHref={`/gate/history?${new URLSearchParams({ siteId: resolvedSiteId, stationId: resolvedStationId, range: activityRange })}`} />
      </div>}
      <Card className={`min-h-[24rem] ${CARD_SURFACE_CLASS}`}>
        <div id={standalone ? "gate-log-card-heading-native-slot" : undefined} data-title={standalone ? c("Gate Log", "Registro de accesos") : undefined}><ContentCardHeader title="Gate Log" spanish="Registro de accesos" /></div>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div id={standalone ? "gate-log-select-native-slot" : undefined} data-sites={standalone ? JSON.stringify((sites.data?.sites ?? []).map(site => ({ id: site.id, name: site.name }))) : undefined} data-gates={standalone ? JSON.stringify((allGates.data ?? []).map(gate => ({ id: gate.id, name: gate.name, siteId: gate.siteId }))) : undefined} data-site-id={standalone ? Number(resolvedSiteId) : undefined} data-gate-id={standalone ? resolvedStationId : undefined} data-gate-name={standalone ? allGates.data?.find(row => row.id === resolvedStationId)?.name ?? "" : undefined} className="min-w-0 max-w-full"><GateSiteGateSelect history showGps={false} allOptionLabel={c("All gates", "Todos los accesos")} gateOptions={allGates.data} sites={sites.data?.sites ?? []} siteId={Number(resolvedSiteId)}
              gate={allGates.data?.find(row => row.id === resolvedStationId)}
              onChange={(nextSite, nextGate) => { saveGateSelection(user, nextSite, nextGate); setSiteId(nextSite ? String(nextSite) : ""); setStationId(nextGate); setRecordId(null); setFocusedRecordId(null); }} /></div>
            <div id={standalone ? "gate-log-export-native-slot" : undefined} data-filters={standalone ? JSON.stringify(filters) : undefined} data-disabled={standalone ? rows.isLoading ? "1" : "0" : undefined}><GateReportToolbar dropdown reportKind="history" filters={filters} disabled={rows.isLoading} /></div>
          </div>
          {resolvedSiteId && <details id={standalone ? "gate-log-movements-native-slot" : undefined} data-site-id={standalone ? Number(resolvedSiteId) : undefined} data-gate-id={standalone ? resolvedStationId : undefined} className="gate-panel-disclosure"><summary>{c("Current site movements (separate from the report)", "Movimientos actuales del sitio (separados del informe)")}</summary><p className="text-xs text-muted-foreground">{c("Live operations. Report date, search and export filters below do not apply to this section.", "Operaciones en vivo. Los filtros de fecha, búsqueda y exportación no se aplican a esta sección.")}</p><GateAreaTraffic siteId={Number(resolvedSiteId)||undefined} gateId={resolvedStationId} view="all" history /></details>}
          <div id={standalone ? "gate-log-filter-native-slot" : undefined} data-view={standalone ? trafficView : undefined} className="gate-history-filters" aria-label="Gate activity filters">
            {([['arrivals','Arrivals'],['on_site','On Site'],['departures','Departures'],['all','All']] as const).map(([type,label]) =>
              <button type="button" key={type} className="gate-history-filter" aria-pressed={trafficView === type} onClick={() => {
                setTrafficView(type); setRunId(null); setFocusedRecordId(null);
                setRecordType(type === 'on_site' ? 'on_site' : type === 'departures' ? 'check_outs' : type === 'arrivals' ? 'arrivals' : 'all');
              }}>{label}</button>)}
          </div>
          <div id={standalone ? "gate-log-query-native-slot" : undefined} data-search={standalone ? search : undefined} data-range={standalone ? range : undefined} data-record-type={standalone ? recordType : undefined} data-record-type-disabled={standalone ? trafficView === "arrivals" ? "1" : "0" : undefined} data-custom-window={standalone && customWindow ? `${new Date(customFrom).toLocaleString("en-US", { timeZone: "America/Chicago" })} – ${new Date(customTo).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT` : undefined} className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem_13rem]">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><BrandedInput value={search} onChange={(event) => { setSearch(event.target.value); setFocusedRecordId(null); }} placeholder={t("gatekeeper.historySearch")} aria-label={t("gatekeeper.historySearch")} className="pl-9" data-testid="input-gate-history-search" /></div>
            <GateDropdown aria-label="History range" value={range}
              onValueChange={value => { setRange(value as GateReportRange); setFocusedRecordId(null); }}
              options={[...(customWindow ? [{ value: "custom", label: c("Requested time window", "Período solicitado") }] : []), ...RANGE_OPTIONS.map(([value, label]) => ({ value, label }))]} />
            {customWindow && <p aria-label="Requested time window" className="text-xs text-muted-foreground">{new Date(customFrom).toLocaleString("en-US", { timeZone: "America/Chicago" })} – {new Date(customTo).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT</p>}
            <GateDropdown aria-label="Record type" value={recordType} disabled={trafficView === "arrivals"}
              onValueChange={value => { setRecordType(value as GateReportRecordType); setFocusedRecordId(null); }}
              options={[...TYPE_OPTIONS.map(([value, label]) => ({ value, label })), { value: "on_site", label: "On site" }, { value: "arrivals", label: "Incoming arrivals" }]} />
          </div>
          {<div className="space-y-3" aria-label="Gate traffic records">
            <div id={standalone ? "gate-log-status-native-slot" : undefined} data-loading={standalone ? rows.isLoading ? "1" : "0" : undefined} data-messages={standalone ? JSON.stringify([
              checkoutError && { text: checkoutError, tone: "error" },
              rows.isError && { text: t("gatekeeper.historyLoadFailed"), tone: "error" },
              (trafficView === "arrivals" || trafficView === "all" && recordType === "all") && arrivals.isError && { text: t("gatekeeper.arrivalsLoadFailed"), tone: "error" },
              !rows.isLoading && !rows.isError && !visibleRecords.length && !((trafficView === "arrivals" || trafficView === "all" && recordType === "all") && arrivals.isLoading) && { text: c("No records match the selected range and filters.", "Ningún registro coincide con el período y los filtros seleccionados."), tone: "muted" },
              (trafficView === "arrivals" || trafficView === "all") && arrivals.preview && { text: c("Sample arrivals · approval preview", "Llegadas de ejemplo · vista previa de aprobación"), tone: "muted" },
            ].filter(Boolean)) : undefined}>
            {checkoutError && <p role="alert" className="text-sm text-destructive">{checkoutError}</p>}
            {rows.isLoading && <Loader2 className="animate-spin text-muted-foreground" />}
            {rows.isError && <p role="alert" className="text-sm text-destructive">{t("gatekeeper.historyLoadFailed")}</p>}
            {(trafficView === "arrivals" || trafficView === "all" && recordType === "all") && arrivals.isError && <p role="alert" className="text-sm text-destructive">{t("gatekeeper.arrivalsLoadFailed")}</p>}
            {!rows.isLoading && !rows.isError && !visibleRecords.length && !((trafficView === "arrivals" || trafficView === "all" && recordType === "all") && arrivals.isLoading) && <p className="text-sm text-muted-foreground">{c("No records match the selected range and filters.", "Ningún registro coincide con el período y los filtros seleccionados.")}</p>}
            {(trafficView === "arrivals" || trafficView === "all") && arrivals.preview && <p className="text-xs text-muted-foreground">{c("Sample arrivals · approval preview", "Llegadas de ejemplo · vista previa de aprobación")}</p>}
            </div>
            {pageRecords.map(item => {
              if (item.type === "arrival") {
                const run = item.run;
                const approved = arrivals.preview && (run.id.endsWith("-2") || run.id.endsWith("-4") || arrivals.previewApprovedIds.has(run.id));
                return <div key={`arrival:${run.id}`} data-gate-log-native-arrival data-arrival-id={run.id} data-native-arrival={JSON.stringify({
                  id: run.id,
                  runId: run.runId,
                  siteId: run.siteLocationId,
                  name: run.driverName || run.title,
                  description: [run.companyName, run.vehicleLabel].filter(Boolean).join(" · "),
                  status: t("gatekeeper.arriving"),
                  flags: gateRecordFlags(run, i18n?.language?.startsWith("es")),
                  footer: arrivals.preview ? approved ? c("Approved · Drive through", "Aprobado · Pase directo") : c("Waiting on booth approval", "Esperando aprobación de la caseta") : null,
                  detail: run.ticketNumber ? `#${run.ticketNumber}` : run.title,
                  eta: run.etaMinutes == null ? t("gatekeeper.etaUnavailable") : t("gatekeeper.arrivalEta", { minutes: Math.ceil(run.etaMinutes) }),
                  actionLabel: arrivals.preview && !approved ? c("Approve", "Aprobar") : null,
                  isNew: arrivals.newInboundIds.has(run.id),
                  previewDetail: arrivals.preview && run.runId.startsWith("sample-inbound-") ? sampleGateArrivalDetail(run.siteLocationId, run.runId) ?? null : null,
                })}><GateArrivalCard run={run} query={arrivals} onOpen={setRunId} /></div>;
              }
              const visit = item.visit;
              const departed = Boolean(visit.checkOutTime) || visit.reconciliationState === "confirmed_off_site";
              const pending = visit.admissionStatus === "pending" && !departed;
              const cleared = pending && isGateEntryCleared(visit);
              const dwell = onSiteDwell({ checkInTime: visit.checkInTime || "", expectedDurationMinutes: visit.expectedMinutes });
              const elapsed = visit.checkInTime && visit.checkOutTime ? Math.max(0, Math.floor((Date.parse(visit.checkOutTime) - Date.parse(visit.checkInTime)) / 60000)) : null;
              return <div key={visit.id} data-testid="gate-history-row" data-gate-log-native-record data-record-id={visit.id} data-native-record={JSON.stringify({
                id: visit.id,
                name: visit.name || c("Gate record", "Registro de acceso"),
                description: [visit.company, displayPlate(visit.plateState, visit.vehiclePlate)].filter(Boolean).join(" · "),
                status: departed ? c("Departures", "Salidas") : cleared ? c("Admitted", "Autorizado") : pending ? t("gatekeeper.pendingAdmit") : t("gatekeeper.onSiteTab"),
                overdue: !departed && !pending && dwell.overdue,
                flags: gateRecordFlags(visit, i18n?.language?.startsWith("es")),
                footer: visit.reconciliationState === "confirmed_off_site" ? c("Checked out · departure time unknown", "Salida registrada · hora de salida desconocida") : cleared ? c("Cleared to enter · awaiting arrival", "Puede entrar · esperando llegada") : pending ? t("gatekeeper.pendingAdmit") : null,
                actionLabel: canCorrectPresence && /^visit:[1-9]\d*$/.test(visit.id) && !departed && !pending ? checkingOut === visit.id ? c("Saving…", "Guardando…") : t("gatekeeper.checkOut") : c("View", "Ver"),
                actionDisabled: canCorrectPresence && /^visit:[1-9]\d*$/.test(visit.id) && !departed && !pending && checkingOut !== null,
                checkedIn: visit.checkInTime ? `${t("gatekeeper.historyCheckedIn")} · ${new Date(visit.checkInTime).toLocaleString()}` : null,
                checkedOut: visit.checkOutTime ? `${t("gatekeeper.historyCheckedOut")} · ${new Date(visit.checkOutTime).toLocaleString()}` : null,
                duration: departed && elapsed != null ? `${c("Time On Site", "Tiempo en el sitio")}: ${gateDurationHHMM(elapsed * 60000)}` : null,
              })} data-person={visit.name} data-entry={visit.checkInTime} data-exit={visit.checkOutTime}><GateTrafficRecord
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
          <nav id={standalone ? "gate-log-pages-native-slot" : undefined} data-start={standalone ? visibleRecords.length ? pageStart + 1 : 0 : undefined} data-end={standalone ? Math.min(pageStart + pageSize, visibleRecords.length) : undefined} data-total={standalone ? visibleRecords.length : undefined} data-page={standalone ? currentPage : undefined} data-last-page={standalone ? lastPage : undefined} aria-label={c("Gate Log pages", "Páginas del registro de acceso")} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-white/10 pt-3">
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
