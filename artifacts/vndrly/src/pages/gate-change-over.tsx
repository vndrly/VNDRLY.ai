import WorkdayControls from "@/components/workday-controls";
import GateHandoffDesk from "@/components/gate-handoff-desk";
import DashboardTasks from "@/components/work-hub/dashboard-tasks";
import { WorkspacePanel, WorkspaceRow } from "@/components/work-hub/workspace-panel";
import "@/components/gate-dashboard.css";
import GateWatchSummary from "@/components/gate-watch-summary";
import GateGpsSelector from "@/components/gate-gps-selector";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ClipboardList, LayoutDashboard, LogIn, LogOut, Users, UserCheck, Car, Clock3, AlertTriangle, Shield } from "lucide-react";
import {
  type ChangeOverState,
  type ChangeOverSnapshot,
  type ShiftNotesResponse,
  evaluateGpsFence,
} from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import BrandPillButton from "@/components/brand-pill-button";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { BrandedInput, BrandedSelect } from "@/components/work-hub/chrome";
import { GateReportToolbar, type GateReportRange } from "@/components/gate-report-toolbar";
import { Card, CardContent, CARD_SURFACE_CLASS } from "@/components/ui/card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { changeOverRequest as request } from "@/lib/change-over-api";

export function ShiftSnapshotView({
  snapshot,
  historyBaseHref,
  activityWindow,
}: {
  snapshot: ChangeOverSnapshot | null;
  historyBaseHref?: string;
  activityWindow?: "24h";
}) {
  const { t, i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const metricRecordType: Record<string, string> = {
    checkIns: "check_ins",
    checkOuts: "check_outs",
    onSiteVisitorRecords: "visitors_on_site",
    onSiteEmployeeRecords: "employees_on_site",
    onSiteVehicles: "vehicles_on_site",
    pendingAdmission: "pending",
  };
  if (historyBaseHref) {
    const metric = (key: keyof ChangeOverSnapshot["metrics"], icon: typeof LogIn) => <WorkspaceRow key={key} icon={icon} label={t(`changeOver.${key}`)} value={snapshot ? String(snapshot.metrics[key]) : c("Unavailable", "No disponible")} href={`${historyBaseHref}&recordType=${metricRecordType[key]}`} testId={`dashboard-metric-${key}`} />;
    const unavailable = c("Site records unavailable.", "Registros del sitio no disponibles.");
    return <>
      <WorkspacePanel title={c("Gate activity", "Actividad del acceso")} subtitle={snapshot ? `${activityWindow === "24h" ? c("Last 24 hours", "Últimas 24 horas") + " · " : ""}${t("changeOver.asOf")} ${new Date(snapshot.generatedAt).toLocaleString()}` : unavailable} icon={LogIn}>
        {metric("checkIns", LogIn)}{metric("checkOuts", LogOut)}{metric("pendingAdmission", Clock3)}
        <details className="gate-panel-disclosure"><summary><AlertTriangle aria-hidden="true" /><span>{t("changeOver.exceptions")}</span><small>{snapshot?.exceptions.length ?? "—"}</small></summary><div className="gate-panel-detail">{!snapshot ? <p>{unavailable}</p> : snapshot.exceptions.length ? snapshot.exceptions.map(e => <p key={`${e.sourceId}:${e.code}`}>{e.text}</p>) : <p>{t("changeOver.none")}</p>}</div></details>
      </WorkspacePanel>
      <WorkspacePanel title={c("On site", "En el sitio")} subtitle={c("Recorded presence across this site", "Presencia registrada en este sitio")} icon={Users}>
        {metric("onSiteVisitorRecords", Users)}{metric("onSiteEmployeeRecords", UserCheck)}{metric("onSiteVehicles", Car)}
        <details className="gate-panel-disclosure"><summary><ClipboardList aria-hidden="true" /><span>{t("changeOver.outstanding")}</span><small>{snapshot?.outstanding.length ?? "—"}</small></summary><div className="gate-panel-detail">{!snapshot ? <p>{unavailable}</p> : snapshot.outstanding.length ? snapshot.outstanding.map(row => <div key={row.id}><strong>{row.name || row.id}</strong><p>{row.company} · {row.plate} · {new Date(row.checkIn).toLocaleString()}</p>{row.notes && <p className="whitespace-pre-wrap">{row.notes}</p>}</div>) : <p>{t("changeOver.none")}</p>}<p>{t("changeOver.coverage")}</p></div></details>
      </WorkspacePanel>
    </>;
  }
  if (!snapshot) return null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("changeOver.asOf")} {new Date(snapshot.generatedAt).toLocaleString()}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Object.entries(snapshot.metrics).map(([key, value]) => historyBaseHref ? (
          <a
            href={`${historyBaseHref}&recordType=${metricRecordType[key] ?? "all"}`}
            className="rounded-lg border-2 border-gray-300 p-3 text-inherit transition-colors hover:border-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary)] hover:text-white"
            key={key}
            data-testid={`dashboard-metric-${key}`}
          >
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm">{t(`changeOver.${key}`)}</div>
          </a>
        ) : (
          <div className="rounded-lg border-2 border-[color:var(--brand-primary)] p-3" key={key}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm">{t(`changeOver.${key}`)}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("changeOver.coverage")}
      </p>
      <h3 className="font-bold">{t("changeOver.outstanding")}</h3>
      {snapshot.outstanding.length === 0 ? (
        <p>{t("changeOver.none")}</p>
      ) : (
        <ul className="space-y-2">
          {snapshot.outstanding.map((row) => (
            <li key={row.id} className="rounded border p-2">
              <strong>{row.name || row.id}</strong> · {row.company} ·{" "}
              {row.plate}
              <br />
              <span className="text-sm">
                {row.id} · {new Date(row.checkIn).toLocaleString()}
              </span>
              {row.notes && <p className="whitespace-pre-wrap">{row.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-bold">{t("changeOver.exceptions")}</h3>
      {snapshot.exceptions.length === 0 ? (
        <p>{t("changeOver.none")}</p>
      ) : (
        <ul>
          {snapshot.exceptions.map((e) => (
            <li key={`${e.sourceId}:${e.code}`}>{e.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GateChangeOverPage({
  history = false,
}: {
  history?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [onDuty, setOnDuty] = useState(false);
  const [selectedSite, setSelectedSite] = useState(
    () => new URLSearchParams(window.location.search).get("siteId") ?? "",
  );
  const [selectedStation, setSelectedStation] = useState(
    () => new URLSearchParams(window.location.search).get("stationId") ?? "",
  );
  const [notes, setNotes] = useState("");
  const [itemText, setItemText] = useState("");
  const [reason, setReason] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [recoveryTarget, setRecoveryTarget] = useState("self");
  const [pendingRecovery, setPendingRecovery] = useState<{ stationId: string; body: { expectedShiftId: string; reason: string; acknowledged: true; targetMembershipId?: number } } | null>(null);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);
  const [before, setBefore] = useState("");
  const [gpsPosition,setGpsPosition]=useState<{latitude:number;longitude:number}|null>(null);
  useEffect(()=>{
    if(history || !navigator.geolocation)return;
    const id=navigator.geolocation.watchPosition(p=>setGpsPosition({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>setGpsPosition(null),{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
    return ()=>navigator.geolocation.clearWatch(id);
  },[history]);
  const sites = useQuery({
    queryKey: ["change-over-sites", user?.userId, history],
    queryFn: () =>
      request<{ sites: { id: number; name: string; supervisor: boolean; latitude?:number|null;longitude?:number|null }[] }>(
        history ? "/sites?mode=history" : "/sites",
      ),
    retry: false,
  });
  const siteId = selectedSite || String(sites.data?.sites[0]?.id ?? "");
  const stations = useQuery({
    queryKey: ["change-over-stations", user?.userId, siteId, history],
    queryFn: () =>
      request<{ stations: { id: string; name: string;latitude?:number|null;longitude?:number|null;geofenceRadiusM?:number|null }[] }>(
        `/stations?siteId=${siteId}${history ? "&mode=history" : ""}`,
      ),
    enabled: Boolean(siteId),
    retry: false,
  });
  const stationId = selectedStation || stations.data?.stations[0]?.id || "";
  const gpsSite=sites.data?.sites.find(s=>String(s.id)===siteId),gpsGate=stations.data?.stations.find(s=>s.id===stationId);
  const latitude=gpsGate?.latitude??gpsSite?.latitude,longitude=gpsGate?.longitude??gpsSite?.longitude;
  const gpsFence=evaluateGpsFence({gps:gpsPosition?"locked":"unavailable",origin:gpsPosition,site:latitude!=null&&longitude!=null?{latitude,longitude,siteRadiusMeters:gpsGate?.geofenceRadiusM??500}:null});
  const gpsStatus=gpsFence.milesToSite==null?"unavailable":gpsFence.insideFence?"verified":"mismatch";
  const gpsLabel=t(gpsStatus==="verified"?"gatekeeper.gpsAtSelectedLocation":gpsStatus==="mismatch"?"gatekeeper.gpsOutsideGeofence":"gatekeeper.gpsUnavailable");
  const state = useQuery({
    queryKey: ["change-over-state", user?.userId, stationId],
    queryFn: () => request<ChangeOverState>(`/${stationId}/state`),
    enabled: Boolean(stationId) && !history,
    retry: false,
    refetchInterval: 15000,
    networkMode: "always",
  });
  const log = useQuery({
    queryKey: ["shift-notes", user?.userId, stationId, search, days, before],
    queryFn: () =>
      request<ShiftNotesResponse>(
        `/${stationId}/notes?${new URLSearchParams({ days: String(days), search, ...(before ? { before } : {}) })}`,
      ),
    enabled: Boolean(stationId) && history,
    retry: false,
    networkMode: "always",
  });
  const current = state.data;
  const replacements = useQuery({
    queryKey: ["gate-recovery-operators", user?.userId, user?.activeMembershipId, stationId],
    queryFn: () => request<{ operators: { userId: number; membershipId: number; name: string; companyName: string }[] }>(`/${stationId}/recovery-operators`),
    enabled: Boolean(!history && current?.supervisor && current.shift && current.shift.operator_id !== user?.userId),
    retry: false,
  });
  const prep = current?.preparation;
  const revision = current?.snapshot?.revision ?? "";
  const ownShift = current?.shift?.operator_id === user?.userId;
  useEffect(() => {
    setPendingWatch(null);
    setNotes("");
    setItemText("");
    setItemNotes({});
    setReason("");
    setRecoveryReason("");
    setRecoveryTarget("self");
    setPendingRecovery(null);
    setError("");
    setBefore("");
  }, [stationId, user?.userId]);
  useEffect(() => {
    setNotes(prep?.notes ?? "");
  }, [prep?.id, current?.shift?.id]);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine)
        void cache.invalidateQueries({ queryKey: ["change-over-state"] });
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [cache]);
  const act = async (work: () => Promise<void>) => {
    if (!online || busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? "code" in e && typeof e.code === "string"
            ? t(`errors.${e.code}`, { defaultValue: e.message })
            : e.message
          : t("changeOver.failed"),
      );
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, body: unknown) => {
    await request(`/${stationId}/${path}`, body);
    await state.refetch();
  };
  const [pendingWatch, setPendingWatch] = useState<{stationId:string; body:{operationId:string; source:"web"|"ios"; preparationId?:string; reviewedRevision?:string; acknowledged?:boolean}} | null>(null);
  const assumeWatch = async (reviewed = false) => {
    const command = pendingWatch ?? { stationId, body: { operationId: crypto.randomUUID(), source: "web" as const, ...((current?.shift && !ownShift)||current?.releasedWatch ? { preparationId: prep?.id, reviewedRevision: revision, acknowledged: reviewed } : {}) } };
    setPendingWatch(command);
    try { await request(`/${command.stationId}/watch/assume`, command.body); }
    catch (error) {
      const status = (error as {status?:number}).status;
      if (status && status >= 400 && status < 500) { setPendingWatch(null); void state.refetch(); }
      throw error;
    }
    await watchSaved();
  };
  const watchSaved = async () => {
    setPendingWatch(null);
    await cache.invalidateQueries({ queryKey: ["gate-watch-own-duty"] });
    await cache.invalidateQueries({ queryKey: ["gate-watch-previous-notes"] });
    await cache.invalidateQueries({ queryKey: ["gate-active-watches"] });
    await state.refetch();
  };
  const recoverWatch = async () => {
    if (!pendingWatch) return;
    const result = await request<{ receipt: unknown }>(`/${pendingWatch.stationId}/watch/operations/${pendingWatch.body.operationId}`);
    if (result.receipt) await watchSaved();
    else if (result.receipt === null) await assumeWatch();
    else throw new Error(t("handoffDesk.outcomeUnknown"));
  };
  useEffect(() => {
    if (!pendingWatch || !online) return;
    let active = true;
    void request<{receipt:unknown}>(`/${pendingWatch.stationId}/watch/operations/${pendingWatch.body.operationId}`).then(result => {
      if (active && result.receipt) void watchSaved();
    }).catch(() => { /* Retain the immutable original command for explicit retry. */ });
    return () => { active = false; };
  }, [pendingWatch, online, state.dataUpdatedAt]);
  const recoverAbandonedWatch = async () => {
    if ((!current?.shift && !pendingRecovery) || pendingWatch) return;
    const command = pendingRecovery ?? { stationId, body: {
      expectedShiftId: current!.shift!.id, reason: recoveryReason.trim(), acknowledged: true as const,
      ...(recoveryTarget !== "self" ? { targetMembershipId: Number(recoveryTarget) } : {}),
    } };
    setPendingRecovery(command);
    try { await request(`/${command.stationId}/recover`, command.body); }
    catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500) { setPendingRecovery(null); void state.refetch(); }
      throw error;
    }
    setPendingRecovery(null);
    setRecoveryReason("");
    setRecoveryTarget("self");
    await watchSaved();
    await cache.invalidateQueries({ queryKey: ["work-hub-workforce"] });
  };
  const releaseWatch=async()=>{
    if(!current?.shift||!ownShift)return;
    await request(`/${stationId}/watch/release`,{expectedShiftId:current.shift.id,notes});
    await watchSaved();
  };
  const openWatch=()=>{
    if(current?.shift||current?.releasedWatch)document.querySelector(".gate-handoff-desk")?.scrollIntoView({behavior:"smooth",block:"start"});
    else void act(assumeWatch);
  };
  const loading =
    sites.isLoading ||
    stations.isLoading ||
    (history ? log.isLoading : state.isLoading);
  const loadError =
    sites.error || stations.error || (history ? log.error : state.error);
  const locationSelectors = (
    <div className={history ? "flex flex-wrap gap-3" : "gate-dashboard-location-selectors"}>
      <label className="min-w-36 space-y-1 text-sm font-medium">
        {t("changeOver.site")}
        <BrandedSelect
          aria-label={t("changeOver.site")}
          className={history ? "min-w-36" : "gate-dashboard-location-select"}
          value={siteId}
          onChange={(e) => {
            setSelectedSite(e.target.value);
            setSelectedStation("");
          }}
        >
          <option value="">{t("changeOver.choose")}</option>
          {sites.data?.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </BrandedSelect>
      </label>
      <label className="min-w-36 space-y-1 text-sm font-medium">
        {t("changeOver.gate")}
        <GateGpsSelector status={gpsStatus} label={gpsLabel}>
        <BrandedSelect
          aria-label={t("changeOver.gate")}
          className={history ? "min-w-36" : "gate-dashboard-location-select"}
          value={stationId}
          onChange={(e) => setSelectedStation(e.target.value)}
        >
          <option value="">{t("changeOver.choose")}</option>
          {stations.data?.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </BrandedSelect>
        </GateGpsSelector>
      </label>
    </div>
  );
  return (
    <div className={`${FIELD_OPS_PAGE_CLASS} space-y-5 ${history ? "" : "gate-dashboard"}`}>
      <div className="flex items-center gap-3">
        {history
          ? <ContentPaneBackLink href="/gate/change-over" ariaLabel={t("changeOver.title")} testId="button-back" />
          : <ContentPaneBackLink href="/work-hub" ariaLabel={t("changeOver.title")} testId="button-back" />}
        {history && <ClipboardList aria-hidden="true" data-testid="shift-notes-header-icon" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />}
        {!history && <LayoutDashboard aria-hidden="true" data-testid="gate-dashboard-header-icon" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t(history ? "changeOver.shiftNotes" : "changeOver.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(history ? "changeOver.historyIntro" : "changeOver.intro")}</p>
        </div>
      </div>
      {!history && <WorkdayControls watchControl={locationSelectors} onShiftChange={setOnDuty} />}
      {!history && current?.shift && !ownShift && !prep && <p role="status">{t("watch.waiting")}</p>}
      <div
        className={history
          ? `min-h-[24rem] space-y-5 p-5 ${CARD_SURFACE_CLASS}`
          : "space-y-5"}
        data-testid={history ? "shift-notes-main-card" : undefined}
      >
      {history && locationSelectors}
      {!online && <p role="status">{t("changeOver.offline")}</p>}
      {loading && <p role="status">{t("changeOver.loading")}</p>}
      {(error || loadError) && (
        <p role="alert" className="text-destructive">
          {error || (loadError as Error).message}
        </p>
      )}
      {!loading && sites.data?.sites.length === 0 && (
        <p>{t("changeOver.noSites")}</p>
      )}
      {history ? (
        <>
          <GateReportToolbar
            reportKind="shift_notes"
            filters={siteId ? {
              siteId: Number(siteId),
              ...(stationId ? { stationId } : {}),
              range: (days === 365 ? "1y" : `${days}d`) as GateReportRange,
              recordType: "all",
              ...(search.trim() ? { search: search.trim() } : {}),
            } : null}
            disabled={log.isLoading}
          />
          <div className="flex flex-wrap gap-3">
            <BrandedInput
              aria-label={t("changeOver.search")}
              placeholder={t("changeOver.search")}
              className="min-w-56"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setBefore("");
              }}
            />
            <BrandedSelect
              aria-label={t("changeOver.range")}
              className="min-w-36"
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setBefore("");
              }}
            >
              {[7, 30, 90, 365].map((n) => (
                <option key={n} value={n}>
                  {n} {t("changeOver.days")}
                </option>
              ))}
            </BrandedSelect>
          </div>
          {log.data?.rows.length === 0 && <p>{t("changeOver.noNotes")}</p>}
          <div className="gate-notes-records">
          {log.data?.rows.map((row) => (
            <WorkspacePanel key={row.id} title={new Date(row.acknowledged_at).toLocaleString()} subtitle={`${row.outgoing_name} → ${row.incoming_name}`} icon={ClipboardList}>
              <div className="gate-panel-body">
                <p>{t("changeOver.acknowledged")}</p>
                <ul>
                  {row.summary.facts.map((f) => (
                    <li key={f.id}>{f.text}</li>
                  ))}
                </ul>
                <p className="whitespace-pre-wrap">{row.notes}</p>
                {row.snapshot.openItems.map((i) => (
                  <p key={i.id}>
                    {t("changeOver.carryForward")}: {i.text}
                  </p>
                ))}
                <details>
                  <summary>{t("changeOver.snapshot")}</summary>
                  <ShiftSnapshotView snapshot={row.snapshot} />
                </details>
              </div>
            </WorkspacePanel>
          ))}
          </div>
          {log.data?.nextBefore && (
            <BrandPillButton onClick={() => setBefore(log.data!.nextBefore!)}>
              {t("changeOver.older")}
            </BrandPillButton>
          )}
          {!!log.data?.actions.length && (
            <Card>
              <CardContent className="space-y-2 p-5">
                <h2 className="font-bold">{t("changeOver.audit")}</h2>
                {log.data.actions.map((a) => (
                  <p key={a.id} className="gate-audit-row">
                    {new Date(a.created_at).toLocaleString()} · {a.actor_name} ·{" "}
                    {a.kind}: {a.text}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
      </div>
      {!history && current && (
          <div className="gate-dashboard-panels">
            <GateWatchSummary stationId={stationId} current={current} onAssume={openWatch} onHandoff={()=>void act(releaseWatch)} assumeDisabled={busy || !online || Boolean(pendingWatch) || state.isError} />
            <DashboardTasks />
            <ShiftSnapshotView snapshot={current.snapshot} activityWindow={current.shift ? undefined : "24h"} historyBaseHref={`/gate/history?${new URLSearchParams({ siteId, stationId, range: current.shift ? "current_shift" : "24h" })}`} />
            <GateHandoffDesk key={`${user?.userId}:${stationId}:${current.shift?.id ?? "none"}`} current={current} ownWatch={ownShift} gatekeeperOnDuty={onDuty && (user?.vendorRole === "gatekeeper" || user?.vendorRole === "gate_supervisor" || Boolean(user?.managedSubcontractor?.siteGrants.some(grant=>grant.siteId===Number(siteId))))} busy={busy} online={online} readError={state.isError}
              notes={notes} onNotesChange={setNotes} itemText={itemText} onItemTextChange={setItemText}
              itemNotes={itemNotes} onItemNoteChange={(id, text) => setItemNotes(value => ({ ...value, [id]: text }))}
              onItemAction={(itemId, kind) => void act(async () => {
                await mutate("items", { itemId, kind, text: itemNotes[itemId]?.trim() ?? "" });
                setItemNotes(value => ({ ...value, [itemId]: "" }));
              })}
              onAddItem={() => void act(async () => {
                await mutate("items", { itemId: crypto.randomUUID(), kind: "open", text: itemText });
                setItemText("");
              })}
              onSave={() => void act(() => mutate("prepare", { notes }))}
              onAssumeReviewed={() => void act(() => assumeWatch(true))}
              pendingWatch={Boolean(pendingWatch)} onRecoverWatch={() => void act(recoverWatch)}
              reason={reason} onReasonChange={setReason} onWithdraw={() => void act(() => mutate("cancel", { reason }))}
            />
            {current.supervisor && current.shift && !ownShift && (
              <WorkspacePanel title={t("changeOver.supervisor")} subtitle={t("changeOver.gate")} icon={Shield}>
                <div className="gate-panel-body space-y-3">
                  {current.shift && !ownShift && (
                    <>
                      <p>{t("changeOver.recoverExplanation")}</p>
                      <BrandedInput
                        aria-label={t("changeOver.reason")}
                        placeholder={t("changeOver.reason")}
                        maxLength={2000}
                        value={recoveryReason}
                        disabled={busy || Boolean(pendingRecovery)}
                        onChange={(e) => setRecoveryReason(e.target.value)}
                      />
                      <label className="block space-y-1">
                        <span>{t("changeOver.recoveryReplacement")}</span>
                        <BrandedSelect aria-label={t("changeOver.recoveryReplacement")} value={recoveryTarget}
                          disabled={busy || Boolean(pendingRecovery)} onChange={e => setRecoveryTarget(e.target.value)}>
                          <option value="self">{t("changeOver.recoverySelf")}</option>
                          {replacements.data?.operators.filter(operator => operator.userId !== current.shift!.operator_id && operator.userId !== user?.userId).map(operator =>
                            <option key={operator.membershipId} value={operator.membershipId}>{operator.name} · {operator.companyName}</option>)}
                        </BrandedSelect>
                      </label>
                      {replacements.isError && <p role="status">{t("changeOver.recoveryRosterUnavailable")}</p>}
                      <p>{t("changeOver.recoveryEffect")}</p>
                      {pendingRecovery && <p role="status">{t("changeOver.recoveryUnconfirmed")}</p>}
                      <BrandPillButton
                        disabled={busy || !online || Boolean(pendingWatch) || (!pendingRecovery && (!recoveryReason.trim() || state.isError))}
                        onClick={() => void act(recoverAbandonedWatch)}>
                        {t(pendingRecovery ? "changeOver.recoveryRetry" : "changeOver.recover")}
                      </BrandPillButton>
                    </>
                  )}
                </div>
              </WorkspacePanel>
            )}
          </div>
      )}
    </div>
  );
}
export function GateShiftNotesPage() {
  return <GateChangeOverPage history />;
}
