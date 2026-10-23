import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { GateArrivalDetail, GateArrivalsResponse } from "@workspace/api-zod";
import { Feather } from "@expo/vector-icons";
import { onSiteDwell } from "@workspace/gate-booth";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, type AuthScope } from "@/lib/auth";
import { createGateArrivalTracker } from "@/lib/gate-arrival-alerts";
import GateArrivalSignal from "@/components/GateArrivalSignal";
import { apiFetch } from "@/lib/api";
import type { ActiveVisit } from "@/lib/guest";
import { formatPlateForDisplay } from "@/lib/plate-display";

type Selection = { kind: "run"; id: string } | { kind: "visit"; id: number };

type GateRecordsPanelProps = {
  siteId: number | null; active: ActiveVisit[]; recent: ActiveVisit[]; loading: boolean; error?: boolean; recentLoading?: boolean; recentError?: boolean;
  busy: boolean; onRefresh: () => void; onAdmit: (id: number) => void; onCheckout: (id: number) => void;
};
/** Remounted for each original sign-in/site so details cannot cross contexts. */
export default function GateRecordsPanel(props: GateRecordsPanelProps) {
  const { user, activeMembershipId } = useAuth();
  const scope = captureAuthScope();
  return <GateRecordsContent key={`${user?.id}:${activeMembershipId}:${scope.generation}:${props.siteId}`} {...props} authScope={scope} />;
}
function GateRecordsContent({ siteId, active, recent, loading, error, recentLoading = false, recentError = false, busy, onRefresh, onAdmit, onCheckout, authScope }: GateRecordsPanelProps & { authScope: AuthScope }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { user, activeMembershipId } = useAuth();
  const [tab, setTab] = useState<"arrivals" | "onsite" | "departures">("onsite");
  const [selection, setSelection] = useState<Selection | null>(null);
  const scope = [user?.id, activeMembershipId, authScope.generation, siteId];
  const queryClient = useQueryClient();
  const observe = useRef(createGateArrivalTracker());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [refreshHover, setRefreshHover] = useState(false);
  const listLoading = tab === "departures" ? recentLoading : loading;
  const listError = tab === "departures" ? recentError : error;
  const arrivals = useQuery({
    queryKey: ["gate-arrivals", ...scope],
    queryFn: ({ signal }) => apiFetch<GateArrivalsResponse>(`/api/gate-arrivals?siteLocationId=${siteId}`, { signal }, authScope),
    enabled: Boolean(user && siteId && tab === "arrivals"), retry: false, refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!arrivals.data) return;
    const ids = arrivals.data.arrivals.map(run => run.id);
    const incoming = observe.current(ids);
    setFreshIds(previous => {
      const next = new Set([...previous].filter(id => ids.includes(id)));
      for (const id of incoming) next.add(id);
      return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next;
    });
  }, [arrivals.data]);
  useEffect(() => {
    if (!freshIds.size) return;
    const timer = setTimeout(() => setFreshIds(new Set()), 5000);
    return () => clearTimeout(timer);
  }, [freshIds]);
  const text = { color: colors.foreground };
  const muted = { color: colors.mutedForeground, fontSize: 12 };
  const rows = tab === "departures"
    ? recent.filter(visit => visit.siteLocationId === siteId && visit.checkOutTime).sort((a,b) => Date.parse(b.checkOutTime!) - Date.parse(a.checkOutTime!))
    : active.filter(visit => visit.siteLocationId === siteId && !visit.checkOutTime);
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View accessibilityRole="tablist" style={{ flex: 1, flexDirection: "row" }}>
        {(["arrivals", "onsite", "departures"] as const).map(value => <Pressable key={value} testID={`gate-tab-${value}`} accessibilityRole="tab" aria-selected={tab === value} accessibilityState={{ selected: tab === value }} onPress={() => { setTab(value); setSelection(null); setFreshIds(new Set()); }} style={{ flex: 1, paddingVertical: 12, borderBottomWidth: tab === value ? 2 : 0, borderBottomColor: colors.primary }}>
          <Text style={{ ...text, textAlign: "center", fontWeight: tab === value ? "700" : "400" }}>{t(`gatekeeper.${value === "onsite" ? "onSite" : value}Tab`)}</Text>
        </Pressable>)}
      </View>
      <Pressable testID="gate-record-refresh" accessibilityRole="button" accessibilityLabel={t("common.refresh")} accessibilityState={{ busy: tab === "arrivals" ? arrivals.isFetching : listLoading }} onHoverIn={() => setRefreshHover(true)} onHoverOut={() => setRefreshHover(false)} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", backgroundColor: "transparent", borderRadius: 6, opacity: pressed ? 0.7 : 1 })} onPress={() => {
        onRefresh();
        if (selection) {
          void queryClient.invalidateQueries({ queryKey: ["gate-record-detail", ...scope, selection.kind, selection.id] });
          if (selection.kind === "visit") void queryClient.invalidateQueries({ queryKey: ["gate-visit-runs", ...scope, selection.id] });
        }
        if (tab === "arrivals" && siteId) void arrivals.refetch();
      }}>{({ pressed }) => <Feather name="refresh-cw" size={18} color={pressed || refreshHover ? colors.primary : colors.mutedForeground} />}</Pressable>
    </View>
    {selection && siteId ? <GateRecordDetails authScope={authScope} key={`${selection.kind}:${selection.id}`} siteId={siteId} selection={selection} onOpen={setSelection} onClose={() => setSelection(null)} /> : tab === "arrivals" ? <>
      {arrivals.isLoading ? <ActivityIndicator color={colors.primary} /> : arrivals.isError ? <Text accessibilityRole="alert" style={muted}>{t("gatekeeper.arrivalsLoadFailed")}</Text> : <>
        {!arrivals.data?.arrivals.length && <Text style={muted}>{t("gatekeeper.noArrivals")}</Text>}
        {arrivals.data?.arrivals.map(run => <Pressable accessibilityRole="button" testID={`gate-arrival-${run.runId}`} key={run.id} onPress={() => { setFreshIds(new Set()); setSelection({ kind: "run", id: run.runId }); }} style={{ borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><Text style={{ ...text, fontWeight: "700", flex: 1 }}>{run.driverName || run.title}</Text><GateArrivalSignal fresh={freshIds.has(run.id)} /></View>
          <Text style={muted}>{[run.companyName, run.vehicleLabel].filter(Boolean).join(" · ")}</Text>
          <Text style={muted}>{run.ticketNumber ? `#${run.ticketNumber}` : run.title}</Text>
          <Text style={muted}>{run.etaMinutes == null ? t("gatekeeper.etaUnavailable") : t("gatekeeper.arrivalEta", { minutes: Math.ceil(run.etaMinutes) })}</Text>
        </Pressable>)}
        {arrivals.data?.truncated && <Text style={muted}>{t("gatekeeper.arrivalsTruncated")}</Text>}
      </>}
    </> : listLoading ? <ActivityIndicator color={colors.primary} /> : listError ? <Text accessibilityRole="alert" style={muted}>{t("gatekeeper.recordLoadFailed")}</Text> : <>
      {!rows.length && <Text style={muted}>{t(tab === "departures" ? "gatekeeper.noDepartures" : "gatekeeper.noActive")}</Text>}
      {rows.map(visit => {
        const dwell = onSiteDwell({ checkInTime: visit.checkInTime, expectedDurationMinutes: visit.expectedDurationMinutes, ...(visit.checkOutTime ? { nowMs: Date.parse(visit.checkOutTime) } : {}) });
        return <View key={visit.id} style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 8 }}>
          <Pressable accessibilityRole="button" testID={`gate-visit-${visit.id}`} onPress={() => setSelection({ kind: "visit", id: visit.id })} style={{ flex: 1, gap: 4 }}>
            <Text style={{ ...text, fontWeight: "700" }}>{visit.firstName} {visit.lastName}{visit.reconciliationState === "observed" || visit.reconciliationState === "needs_supervisor_review" ? ` · ${t(visit.reconciliationState === "observed" ? "gatekeeper.reconciliationObserved" : "gatekeeper.reconciliationReview")}` : ""}</Text>
            <Text style={muted}>{[visit.company, formatPlateForDisplay(visit.plateState, visit.vehiclePlate, t("gatekeeper.plateStateUnconfirmed")), visit.siteName].filter(Boolean).join(" · ")}</Text>
            <Text style={muted}>{new Date(visit.checkOutTime || visit.checkInTime).toLocaleString()}</Text>
            {!visit.checkOutTime && <Text style={muted}>{t("gatekeeper.minutesOnSite", { minutes: dwell.minutesOnSite })}{dwell.overdue ? ` · ${t("gatekeeper.overdue", { minutes: dwell.overdueMinutes })}` : ""}</Text>}
          </Pressable>
          {!visit.checkOutTime && <TogglePillButton testID={`gate-${visit.admissionStatus === "pending" ? "admit" : "checkout"}-${visit.id}`} disabled={busy} onPress={() => visit.admissionStatus === "pending" ? onAdmit(visit.id) : onCheckout(visit.id)}>{t(visit.admissionStatus === "pending" ? "gatekeeper.admit" : "gatekeeper.historyCheckedOut")}</TogglePillButton>}
        </View>;
      })}
    </>}
  </View>;
}

function GateRecordDetails({ siteId, selection, onOpen, onClose, authScope }: { authScope: AuthScope; siteId: number; selection: Selection; onOpen: (selection: Selection) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { user, activeMembershipId } = useAuth();
  const record = useQuery<ActiveVisit | GateArrivalDetail>({
    queryKey: ["gate-record-detail", user?.id, activeMembershipId, authScope.generation, siteId, selection.kind, selection.id],
    queryFn: ({ signal }) => selection.kind === "run"
      ? apiFetch<GateArrivalDetail>(`/api/gate-arrivals/${encodeURIComponent(selection.id)}?siteLocationId=${siteId}`, { signal }, authScope)
      : apiFetch<ActiveVisit>(`/api/visits/${selection.id}`, { signal }, authScope), retry: false,
  });
  const visit = selection.kind === "visit" ? record.data as ActiveVisit | undefined : undefined;
  const run = selection.kind === "run" ? record.data as GateArrivalDetail | undefined : undefined;
  const links = useQuery({
    queryKey: ["gate-visit-runs", user?.id, activeMembershipId, authScope.generation, siteId, visit?.id],
    queryFn: ({ signal }) => apiFetch<{ runs: GateArrivalDetail[] }>(`/api/gate-arrivals/visit/${visit!.id}?siteLocationId=${siteId}`, { signal }, authScope),
    enabled: Boolean(visit?.id && visit.siteLocationId === siteId), retry: false,
  });
  const text = { color: colors.foreground };
  const fact = (label: string, value: string | null | undefined, testID?: string) => value ? <View key={label} testID={testID} style={{ gap: 3 }}><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t(label)}</Text><Text style={text}>{value}</Text></View> : null;
  const elapsed = visit ? Math.max(0, Math.floor(((visit.checkOutTime ? Date.parse(visit.checkOutTime) : Date.now()) - Date.parse(visit.checkInTime)) / 60000)) : 0;
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}><Text accessibilityRole="header" style={{ ...text, fontWeight: "700", flex: 1 }}>{run?.title ?? t(visit ? "gatekeeper.recordDetails" : "gatekeeper.runDetails")}</Text><TogglePillButton onPress={onClose}>{t("common.close")}</TogglePillButton></View>
    {record.isLoading ? <ActivityIndicator color={colors.primary} /> : record.isError || (visit && visit.siteLocationId !== siteId) ? <Text accessibilityRole="alert" style={text}>{t("gatekeeper.recordLoadFailed")}</Text> : run ? <>
      {fact("gatekeeper.runRecord", run.ticketNumber ? `#${run.ticketNumber}` : null)}
      {fact("gatekeeper.driver", run.driverName)}
      {fact("gatekeeper.company", run.companyName)}
      {fact("gatekeeper.vehiclePlate", run.vehicleLabel)}
      {fact("changeOver.site", run.destinationName)}
      {fact("gatekeeper.recordState", t(run.runComplete ? "gatekeeper.runComplete" : "gatekeeper.runPartial"))}
      {fact("gatekeeper.lastGpsReport", run.observedAt ? new Date(run.observedAt).toLocaleString() : t("gatekeeper.etaUnavailable"))}
      {run.loads.map(load => <Text key={load.id} style={text}>{[load.commodity, load.quantity, load.unit].join(" · ")}{load.deliveredAt ? ` · ${new Date(load.deliveredAt).toLocaleString()}` : ""}</Text>)}
      {run.events.map((event, i) => <View key={`${event.type}:${i}`} style={{ gap: 3 }}><Text style={text}>{t(`gatekeeper.runEvents.${event.type}`, { defaultValue: event.type.replace(/_/g, " ") })}</Text><Text style={text}>{new Date(event.recordedAt).toLocaleString()}</Text></View>)}
      {run.linkedVisitIds.map(id => <TogglePillButton key={id} testID={`gate-linked-visit-${id}`} onPress={() => onOpen({ kind: "visit", id })}>{t("gatekeeper.gateRecordNumber", { id })}</TogglePillButton>)}
    </> : visit ? <>
      <Text style={{ ...text, fontWeight: "700" }}>{visit.firstName} {visit.lastName}</Text>
      {fact("gatekeeper.company", visit.company)}
      {fact("gatekeeper.vehiclePlate", formatPlateForDisplay(visit.plateState, visit.vehiclePlate, t("gatekeeper.plateStateUnconfirmed")))}
      {fact("changeOver.site", visit.siteName)}
      {fact("gatekeeper.historyCheckedIn", new Date(visit.checkInTime).toLocaleString(), "gate-record-check-in")}
      {fact("gatekeeper.historyCheckedOut", visit.checkOutTime ? new Date(visit.checkOutTime).toLocaleString() : t("gatekeeper.onSiteTab"), "gate-record-check-out")}
      {fact("gatekeeper.timeOnSite", t("gatekeeper.minutesOnSite", { minutes: elapsed }))}
      {fact("gatekeeper.purpose", visit.purpose)}
      {fact("gatekeeper.notes", visit.notes)}
      {links.data?.runs.map(link => <TogglePillButton key={link.id} testID={`gate-linked-run-${link.runId}`} onPress={() => onOpen({ kind: "run", id: link.runId })}>{link.title} · #{link.ticketNumber}</TogglePillButton>)}
      {links.isError && <Text accessibilityRole="alert" style={text}>{t("gatekeeper.linkedRunsUnavailable")}</Text>}
    </> : null}
  </View>;
}
