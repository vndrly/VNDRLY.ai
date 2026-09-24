import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  Switch,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  mayTransferHandoff,
  type ChangeOverState,
  type ChangeOverSnapshot,
  type IncomingHandoffAuth,
  type ShiftNotesResponse,
} from "@workspace/gate-booth";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import TogglePillButton from "@/components/TogglePillButton";
import GateDutyCard from "@/components/GateDutyCard";
import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, apiFetchRaw } from "@/lib/api";
import type { StoredUser } from "@/lib/auth";
import {
  changeOverRequest as request,
  acceptChangeOverSession,
} from "@/lib/change-over-api";
import {
  isVisibleGateReportRecipient,
  type GateReportRecipient,
} from "@/lib/gate-report-recipients";

function Snapshot({ snapshot }: { snapshot: ChangeOverSnapshot }) {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.mutedForeground }}>
        {t("changeOver.asOf")} {new Date(snapshot.generatedAt).toLocaleString()}
      </Text>
      {Object.entries(snapshot.metrics).map(([key, value]) => (
        <Text key={key} style={{ color: colors.foreground, fontSize: 17 }}>
          {t(`changeOver.${key}`)}: {value}
        </Text>
      ))}
      <Text style={{ color: colors.mutedForeground }}>
        {t("changeOver.coverage")}
      </Text>
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>
        {t("changeOver.outstanding")}
      </Text>
      {snapshot.outstanding.length === 0 && (
        <Text style={{ color: colors.foreground }}>{t("changeOver.none")}</Text>
      )}
      {snapshot.outstanding.map((r) => (
        <View
          key={r.id}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            padding: 10,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: colors.foreground }}>
            {r.name || r.id} · {r.company} · {r.plate}
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            {r.id} · {new Date(r.checkIn).toLocaleString()}
          </Text>
          {r.notes && (
            <Text style={{ color: colors.foreground }}>{r.notes}</Text>
          )}
        </View>
      ))}
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>
        {t("changeOver.exceptions")}
      </Text>
      {snapshot.exceptions.map((e) => (
        <Text
          key={`${e.sourceId}:${e.code}`}
          style={{ color: colors.foreground }}
        >
          {e.text}
        </Text>
      ))}
    </View>
  );
}
export default function GateChangeOver({
  history = false,
}: {
  history?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const wideLandscape = width >= 768 && width > height;
  const { user } = useAuth();
  const cache = useQueryClient();
  const params = useLocalSearchParams<{
    siteId?: string;
    stationId?: string;
    workHubShiftId?: string;
    gateMode?: string;
  }>();
  const [selectedSite, setSite] = useState<number | null>(
    params.siteId ? Number(params.siteId) : null,
  );
  const [selectedGate, setGate] = useState(params.stationId ?? "");
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [gateMenuOpen, setGateMenuOpen] = useState(false);
  useEffect(() => {
    if (params.siteId && params.stationId) {
      setSite(Number(params.siteId));
      setGate(params.stationId);
    }
  }, [params.siteId, params.stationId]);
  const [notes, setNotes] = useState("");
  const [newItem, setNewItem] = useState("");
  const [itemView, setItemView] = useState<"open" | "resolved">("open");
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState<IncomingHandoffAuth | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [reportFormat, setReportFormat] = useState<"pdf" | "excel" | "word" | null>(null);
  const [visibleNoteCount, setVisibleNoteCount] = useState(10);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const lastNotesEndHeight = useRef<number | null>(null);
  const notesPageRequest = useRef<object | null>(null);
  const [newGate, setNewGate] = useState("");
  const [reportRecipientIds, setReportRecipientIds] = useState<number[]>([]);
  const sites = useQuery({
    queryKey: ["change-over-sites", user?.id],
    queryFn: () =>
      request<{ sites: { id: number; name: string; supervisor: boolean }[] }>(
        "/sites",
      ),
    retry: false,
    networkMode: "always",
  });
  const siteId = selectedSite ?? sites.data?.sites[0]?.id;
  const stations = useQuery({
    queryKey: ["change-over-stations", user?.id, siteId],
    queryFn: () =>
      request<{ stations: { id: string; name: string }[] }>(
        `/stations?siteId=${siteId}`,
      ),
    enabled: Boolean(siteId),
    retry: false,
    networkMode: "always",
  });
  const stationId = selectedGate || stations.data?.stations[0]?.id || "";
  const reportRange = days === 7 ? "7d" : days === 30 ? "30d" : days === 90 ? "90d" : "1y";
  const reportFilters = siteId ? { siteId, ...(stationId ? { stationId } : {}), range: reportRange, recordType: "all", ...(search.trim() ? { search: search.trim() } : {}) } : null;
  const reportRecipients = useQuery({
    queryKey: ["shift-notes-report-recipients", reportFilters],
    queryFn: () => apiFetch<{ recipients: GateReportRecipient[] }>(`/api/gate-report/recipients?${new URLSearchParams({ reportKind: "shift_notes", siteId: String(siteId), stationId, range: reportRange, recordType: "all", search })}`),
    enabled: history && Boolean(siteId), retry: false,
  });
  useEffect(() => {
    const visibleRecipients = reportRecipients.data?.recipients.filter(isVisibleGateReportRecipient) ?? [];
    const visibleIds = new Set(visibleRecipients.map((entry) => entry.userId));
    setReportRecipientIds((current) => {
      const retained = current.filter((id) => visibleIds.has(id));
      if (retained.length) return retained;
      return user?.id && visibleIds.has(user.id) ? [user.id] : [];
    });
  }, [reportRecipients.data, user?.id]);
  const state = useQuery({
    queryKey: ["change-over-state", user?.id, stationId],
    queryFn: () => request<ChangeOverState>(`/${stationId}/state`),
    enabled: Boolean(stationId) && !history,
    retry: false,
    networkMode: "always",
    refetchInterval: 15000,
  });
  const log = useInfiniteQuery({
    queryKey: ["shift-notes", user?.id, stationId, 60],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      request<ShiftNotesResponse>(
        `/${stationId}/notes?${new URLSearchParams({ days: "60", ...(pageParam ? { before: pageParam } : {}) })}`,
      ),
    getNextPageParam: (page) => page.nextBefore || undefined,
    enabled: Boolean(stationId) && history,
    retry: false,
    networkMode: "always",
  });
  const noteRows = Array.from(new Map(
    (log.data?.pages.flatMap((page) => page.rows) ?? []).map((row) => [row.id, row]),
  ).values());
  const revealOlderNotes = async (contentHeight: number) => {
    // Native/web scroll-end callbacks can repeat for the same visible content.
    if (lastNotesEndHeight.current === contentHeight || notesPageRequest.current) return;
    lastNotesEndHeight.current = contentHeight;
    if (visibleNoteCount < noteRows.length) {
      setVisibleNoteCount((count) => Math.min(count + 10, noteRows.length));
    } else if (log.hasNextPage) {
      const requestId = {};
      notesPageRequest.current = requestId;
      const next = await log.fetchNextPage({ cancelRefetch: false });
      if (notesPageRequest.current !== requestId) return;
      notesPageRequest.current = null;
      if (next.isError) lastNotesEndHeight.current = null;
      else setVisibleNoteCount((count) => count + 10);
    }
  };
  const current = state.data;
  const prep = current?.preparation;
  const revision = current?.snapshot?.revision ?? "";
  const ownShift = current?.shift?.operator_id === user?.id;
  const loadError =
    sites.error || stations.error || (history ? log.error : state.error);
  const online = !loadError;
  const resetReview = () => {
    setAuth(null);
    setAcknowledged(false);
    setReviewedRevision("");
    setPassword("");
  };
  useEffect(() => {
    resetReview();
    setNotes("");
    setError("");
    setVisibleNoteCount(10);
    setExpandedNoteId(null);
    lastNotesEndHeight.current = null;
    notesPageRequest.current = null;
  }, [stationId, user?.id]);
  useEffect(() => {
    resetReview();
  }, [revision, prep?.id, current?.stale, online]);
  useEffect(() => {
    if (prep) setNotes(prep.notes);
  }, [prep?.id]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (value) => {
      if (value === "active") {
        resetReview();
        void state.refetch();
        if (history) void log.refetch();
      }
    });
    return () => sub.remove();
  }, [stationId, history]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
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
      resetReview();
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, body: unknown) => {
    await request(`/${stationId}/${path}`, body);
    resetReview();
    await state.refetch();
  };
  const fieldStyle = {
    color: colors.foreground,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
  };
  const cardStyle = {
    backgroundColor: colors.card,
    borderColor: colors.primary,
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  };
  const label = (text: string) => (
    <Text style={{ color: colors.foreground }}>{text}</Text>
  );
  const sectionHeading = (text: string) => (
    <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{text}</Text>
  );
  const button = (
    text: string,
    action: () => Promise<void>,
    disabled = false,
    inactive = false,
  ) => (
    <TogglePillButton
      disabled={busy || disabled}
      inactive={inactive}
      askVInactiveStyle={inactive}
      onPress={() => void act(action)}
    >
      {text}
    </TogglePillButton>
  );
  const exportShiftNotes = async () => {
    if (!reportFilters || !reportFormat) throw new Error(t("gateHistory.noFormat"));
    const format = reportFormat;
    const response = await apiFetchRaw("/api/gate-report/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "shift_notes", format, filters: reportFilters }) });
    const extension = format === "excel" ? "csv" : format === "word" ? "doc" : "pdf";
    const filename = `vndrly-shift-notes.${extension}`;
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return;
    }
    if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error(t("gateHistory.shareUnavailable"));
    const uri = `${FileSystem.cacheDirectory}${filename}`;
    const bytes = new Uint8Array(await response.arrayBuffer()); let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await FileSystem.writeAsStringAsync(uri, globalThis.btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(uri, { dialogTitle: t("gateHistory.share") });
  };
  const emailShiftNotes = async () => {
    if (!reportFilters || !reportFormat) throw new Error(t("gateHistory.noFormat"));
    if (!reportRecipientIds.length) throw new Error(t("gateHistory.noRecipients"));
    await apiFetch("/api/gate-report/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "shift_notes", format: reportFormat, recipientUserIds: reportRecipientIds, filters: reportFilters }) });
    setError(t("gateHistory.emailed"));
  };
  const canTransfer = mayTransferHandoff({
    online,
    acknowledged,
    proof: auth?.proof ?? "",
    reviewedRevision,
    currentRevision: revision,
    stale: current?.stale ?? true,
  });
  return (
    <ScreenSafeArea>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <BrandTitleRow subtitle="iOS Portal" logoTestId="change-over-company-logo" platformLogoTestId="change-over-vndrly-logo" />
        <View style={{ alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" }}>
          <View style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 }}>
            <SphereBackButton
              onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)" as never)}
              size={40}
              testID={history ? "shift-notes-page-back" : "dashboard-page-back"}
            />
            <Text
              accessibilityRole="header"
              style={{ color: colors.foreground, flexShrink: 1, fontSize: 20, fontWeight: "700" }}
            >
              {t(history ? "changeOver.shiftNotes" : "changeOver.title")}
            </Text>
          </View>
          <AskVVoiceIndicator inline />
        </View>
        {label(t(history ? "changeOver.historyIntro" : "changeOver.intro"))}
        {params.gateMode === "1" && (
          <TogglePillButton onPress={() => router.replace("/(tabs)" as never)}>
            {t("gateDuty.returnToAdmin")}
          </TogglePillButton>
        )}
        {!history ? (
          <View
            testID="dashboard-blank-card"
            style={[cardStyle, { backgroundColor: "#28282a", minHeight: 120 }]}
          >
            <View testID="dashboard-site-gate-layout" style={{ flexDirection: wideLandscape ? "row" : "column", gap: 12 }}>
            <View style={{ flex: 1, gap: 8 }}>
            {sectionHeading(t("changeOver.site"))}
            {sites.data?.sites.filter((site) => site.id === siteId).map((s) => (
              <TogglePillButton
                key={`blank-site-${s.id}`}
                solid
                accessibilityState={{ expanded: siteMenuOpen }}
                onPress={() => {
                  if ((sites.data?.sites.length ?? 0) > 1) setSiteMenuOpen((open) => !open);
                }}
              >
                {s.name}
              </TogglePillButton>
            ))}
            {siteMenuOpen && sites.data?.sites.filter((site) => site.id !== siteId).map((s) => (
              <TogglePillButton
                key={`blank-site-option-${s.id}`}
                onPress={() => {
                  setSite(s.id);
                  setGate("");
                  setSiteMenuOpen(false);
                  setGateMenuOpen(false);
                }}
              >
                {s.name}
              </TogglePillButton>
            ))}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
            {sectionHeading(t("changeOver.gate"))}
            {stations.data?.stations.filter((station) => station.id === stationId).map((s) => (
              <TogglePillButton
                key={`blank-gate-${s.id}`}
                solid
                accessibilityState={{ expanded: gateMenuOpen }}
                onPress={() => {
                  if ((stations.data?.stations.length ?? 0) > 1) setGateMenuOpen((open) => !open);
                }}
              >
                {s.name}
              </TogglePillButton>
            ))}
            {gateMenuOpen && stations.data?.stations.filter((station) => station.id !== stationId).map((s) => (
              <TogglePillButton
                key={`blank-gate-option-${s.id}`}
                onPress={() => {
                  setGate(s.id);
                  setGateMenuOpen(false);
                }}
              >
                {s.name}
              </TogglePillButton>
            ))}
            </View>
            </View>
          </View>
        ) : null}
        {history ? <View testID="shift-notes-browser-card" style={[cardStyle, { backgroundColor: "#28282a" }]}>
          {sectionHeading(t("changeOver.shiftNotes"))}
          {!log.isLoading && noteRows.length === 0 && label(t("changeOver.noNotes"))}
          <ScrollView nestedScrollEnabled style={{ maxHeight: 520 }} onScroll={({ nativeEvent }) => {
            const nearBottom = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 24;
            if (nearBottom) void revealOlderNotes(nativeEvent.contentSize.height);
          }} scrollEventThrottle={80}>
            <View style={{ gap: 8 }}>
              {noteRows.slice(0, visibleNoteCount).map((row) => {
                const expanded = expandedNoteId === String(row.id);
                return <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpandedNoteId(expanded ? null : String(row.id))} style={{ borderColor: colors.primary, borderWidth: 2, borderRadius: 10, padding: 12, gap: 6 }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{new Date(row.acknowledged_at).toLocaleString()} · {row.outgoing_name} → {row.incoming_name}</Text>
                  {expanded ? <><Text style={{ color: colors.foreground }}>{row.notes}</Text>{row.summary.facts.map((fact) => <Text key={fact.id} style={{ color: colors.foreground }}>{fact.text}</Text>)}{row.snapshot.openItems.map((item) => <Text key={item.id} style={{ color: colors.foreground }}>{t("changeOver.carryForward")}: {item.text}</Text>)}<Snapshot snapshot={row.snapshot} /></> : null}
                </Pressable>;
              })}
            </View>
          </ScrollView>
        </View> : null}
        {sites.isLoading && label(t("changeOver.loading"))}
        {sites.data?.sites.length === 0 && label(t("changeOver.noSites"))}
        {Boolean(loadError) && (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {t("changeOver.offline")} {(loadError as Error).message}
          </Text>
        )}
        {Boolean(error) && (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {error}
          </Text>
        )}
        {button(t("changeOver.refresh"), async () => {
          resetReview();
          await sites.refetch();
          if (siteId) await stations.refetch();
          if (stationId) {
            if (history) await log.refetch();
            else await state.refetch();
          }
        }, false, true)}
        {!history && stationId ? (
          <GateDutyCard
            stationId={stationId}
            workHubShiftId={params.workHubShiftId}
            onStartShift={current && !current.shift ? () => void mutate("start", {}) : undefined}
            startShiftDisabled={!online}
          />
        ) : null}
        {history ? (
          <>
            <View testID="shift-notes-report-card" style={[cardStyle, { backgroundColor: "#28282a", gap: 14 }]}>
            {sectionHeading(t("gateHistory.sendReports", { defaultValue: "Send Reports" }))}
            <View style={{ backgroundColor: colors.border, height: 1 }} />
            <View testID="shift-notes-report-selectors" style={{ flexDirection: wideLandscape ? "row" : "column", gap: 12 }}>
              <View style={{ flex: 1, gap: 8 }}>
                {sectionHeading(t("changeOver.site"))}
                {sites.data?.sites.filter((site) => site.id === siteId).map((site) => <TogglePillButton key={site.id} solid accessibilityState={{ expanded: siteMenuOpen }} onPress={() => { if ((sites.data?.sites.length ?? 0) > 1) setSiteMenuOpen((open) => !open); }}>{site.name}</TogglePillButton>)}
                {siteMenuOpen && sites.data?.sites.filter((site) => site.id !== siteId).map((site) => <TogglePillButton key={site.id} onPress={() => { setSite(site.id); setGate(""); setSiteMenuOpen(false); setGateMenuOpen(false); }}>{site.name}</TogglePillButton>)}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                {sectionHeading(t("changeOver.gate"))}
                {stations.data?.stations.filter((station) => station.id === stationId).map((station) => <TogglePillButton key={station.id} solid accessibilityState={{ expanded: gateMenuOpen }} onPress={() => { if ((stations.data?.stations.length ?? 0) > 1) setGateMenuOpen((open) => !open); }}>{station.name}</TogglePillButton>)}
                {gateMenuOpen && stations.data?.stations.filter((station) => station.id !== stationId).map((station) => <TogglePillButton key={station.id} onPress={() => { setGate(station.id); setGateMenuOpen(false); }}>{station.name}</TogglePillButton>)}
              </View>
            </View>
            <View style={{ backgroundColor: colors.border, height: 1 }} />
            <View testID="shift-notes-recipients-card" style={{ gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("gateHistory.toggleRecipients")}
                accessibilityState={{ expanded: recipientsOpen }}
                onPress={() => setRecipientsOpen((open) => !open)}
                style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" }}
                testID="shift-notes-recipients-toggle"
              >
                <View style={{ flex: 1, gap: 2 }}>
                  {sectionHeading(t("gateHistory.recipients"))}
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    {t("gateHistory.selected", { count: reportRecipientIds.length })}
                  </Text>
                </View>
                <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{recipientsOpen ? "⌃" : "⌄"}</Text>
              </Pressable>
              {recipientsOpen ? (
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {reportRecipients.data?.recipients.filter(isVisibleGateReportRecipient).map((recipient) => <TogglePillButton key={recipient.userId} solid={reportRecipientIds.includes(recipient.userId)} onPress={() => setReportRecipientIds((current) => current.includes(recipient.userId) ? current.filter((id) => id !== recipient.userId) : [...current, recipient.userId])}>{recipient.name}</TogglePillButton>)}
                </View>
              ) : null}
            </View>
            <View style={{ backgroundColor: colors.border, height: 1 }} />
            <View testID="shift-notes-search-card" style={{ gap: 12 }}>
              {sectionHeading(t("changeOver.search"))}
              <TextInput
                accessibilityLabel={t("changeOver.search")}
                placeholder={t("changeOver.search")}
                placeholderTextColor={colors.mutedForeground}
                style={[fieldStyle, { backgroundColor: colors.card }]}
                value={search}
                onChangeText={(value) => {
                  setSearch(value);
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("gateHistory.toggleTimePeriod")}
                accessibilityState={{ expanded: timeframeOpen }}
                onPress={() => setTimeframeOpen((open) => !open)}
                style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 30 }}
                testID="shift-notes-timeframe-toggle"
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{t("gateHistory.chooseTimePeriod")}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{`${days} ${t("changeOver.days")}`}</Text>
                </View>
                <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{timeframeOpen ? "⌃" : "⌄"}</Text>
              </Pressable>
              {timeframeOpen ? <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {[7, 30, 90, 365].map((n) => (
                  <TogglePillButton
                    key={n}
                    solid={days === n}
                    onPress={() => {
                      setDays(n);
                    }}
                  >
                    {`${n} ${t("changeOver.days")}`}
                  </TogglePillButton>
                ))}
              </View> : null}
            </View>
            <View style={{ backgroundColor: colors.border, height: 1 }} />
            <View testID="shift-notes-export-row" style={{ flexDirection: "row", gap: 8 }}>
              {(["pdf", "excel", "word"] as const).map((format) => (
                <TogglePillButton key={format} color={format === "pdf" ? "red" : format === "excel" ? "green" : "blue"} solid={reportFormat === format} accessibilityState={{ selected: reportFormat === format }} style={{ flex: 1 }} onPress={() => setReportFormat(format)}>
                  {format === "excel" ? "CSV" : format === "word" ? "DOC" : "PDF"}
                </TogglePillButton>
              ))}
            </View>
            <TogglePillButton testID="shift-notes-save" color="brand" solid disabled={!reportFormat} onPress={() => void act(exportShiftNotes)}>{t("gateHistory.saveCopy", { defaultValue: "Save a Copy" })}</TogglePillButton>
            <TogglePillButton testID="shift-notes-email" color="brand" solid disabled={!reportFormat} onPress={() => void act(emailShiftNotes)}>{t("gateHistory.emailReport", { defaultValue: "Email Report" })}</TogglePillButton>
            </View>
          </>
        ) : (
          current && (
            <>
              {current.shift ? <View style={cardStyle}>
                {label(
                  `${current.shift.operator_name} · ${new Date(current.shift.started_at).toLocaleString()}`,
                )}
                {current.snapshot && (
                  <Snapshot snapshot={current.snapshot} />
                )}
              </View> : null}
              <View style={cardStyle}>
                {sectionHeading(t("changeOver.shiftFollowUps"))}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <TogglePillButton solid={itemView === "open"} accessibilityState={{ selected: itemView === "open" }} onPress={() => setItemView("open")}>{t("changeOver.openItems")}</TogglePillButton>
                  <TogglePillButton inactive askVInactiveStyle accessibilityState={{ selected: itemView === "resolved" }} onPress={() => setItemView("resolved")}>{t("changeOver.resolvedItems")}</TogglePillButton>
                </View>
                {current.items.filter((item) => item.status === itemView).length === 0 && label(t("changeOver.none"))}
                {current.items.filter((item) => item.status === itemView).map((i) => (
                  <View key={i.id} style={{ gap: 8, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10 }}>
                    {label(i.text)}
                    {(ownShift || current.supervisor) && (
                      <>
                        <TextInput
                          accessibilityLabel={t(i.status === "open" ? "changeOver.resolutionNote" : "changeOver.reopenNote")}
                          placeholder={t(i.status === "open" ? "changeOver.resolutionNote" : "changeOver.reopenNote")}
                          placeholderTextColor={colors.mutedForeground}
                          style={fieldStyle}
                          value={itemNotes[i.id] ?? ""}
                          onChangeText={(value) => setItemNotes((notesByItem) => ({ ...notesByItem, [i.id]: value }))}
                        />
                        {button(
                          t(i.status === "open" ? "changeOver.markResolved" : "changeOver.reopen"),
                          async () => {
                            await mutate("items", {
                              itemId: i.id,
                              kind: i.status === "open" ? "resolve" : "reopen",
                              text: itemNotes[i.id].trim(),
                            });
                            setItemNotes((notesByItem) => ({ ...notesByItem, [i.id]: "" }));
                          },
                          !online || !itemNotes[i.id]?.trim(),
                        )}
                      </>
                    )}
                  </View>
                ))}
                {itemView === "open" && (ownShift || current.supervisor) && (
                  <>
                    <TextInput
                      accessibilityLabel={t("changeOver.newItem")}
                      placeholder={t("changeOver.newItem")}
                      placeholderTextColor={colors.mutedForeground}
                      style={fieldStyle}
                      value={newItem}
                      maxLength={2000}
                      onChangeText={setNewItem}
                    />
                    {button(
                      t("changeOver.addItem"),
                      async () => {
                        await mutate("items", {
                          itemId: Crypto.randomUUID(),
                          kind: "open",
                          text: newItem,
                        });
                        setNewItem("");
                      },
                      !online || !newItem.trim(),
                      true,
                    )}
                  </>
                )}
              </View>
              {ownShift && (
                <View style={cardStyle}>
                  {label(t("changeOver.outgoingNotes"))}
                  <TextInput
                    accessibilityLabel={t("changeOver.outgoingNotes")}
                    style={[fieldStyle, { minHeight: 100 }]}
                    multiline
                    maxLength={8000}
                    value={notes}
                    onChangeText={(value) => {
                      setNotes(value);
                      resetReview();
                    }}
                  />
                  {button(
                    t(
                      prep ? "changeOver.refreshHandoff" : "changeOver.prepare",
                    ),
                    () => mutate("prepare", { notes }),
                    !online,
                    true,
                  )}
                </View>
              )}
              {prep && (
                <View style={cardStyle}>
                  {label(t("changeOver.review"))}
                  {label(
                    t(
                      prep.summary.source === "ai_selected_facts"
                        ? "changeOver.aiFacts"
                        : "changeOver.factualSummary",
                    ),
                  )}
                  {prep.summary.facts.map((f) => (
                    <Text key={f.id} style={{ color: colors.foreground }}>
                      {f.text}
                    </Text>
                  ))}
                  {label(prep.notes)}
                  {prep.snapshot.openItems.map((i) => (
                    <Text key={i.id} style={{ color: colors.foreground }}>
                      {t("changeOver.carryForward")}: {i.text}
                    </Text>
                  ))}
                  {current.stale && label(t("changeOver.stale"))}
                  {ownShift && !current.stale && notes === prep.notes && (
                    <>
                      {!auth ? (
                        <>
                          {label(t("changeOver.incomingLogin"))}
                          <TextInput
                            accessibilityLabel={t("changeOver.username")}
                            placeholder={t("changeOver.username")}
                            placeholderTextColor={colors.mutedForeground}
                            style={fieldStyle}
                            autoCapitalize="none"
                            autoCorrect={false}
                            value={username}
                            onChangeText={setUsername}
                          />
                          <TextInput
                            accessibilityLabel={t("changeOver.password")}
                            placeholder={t("changeOver.password")}
                            placeholderTextColor={colors.mutedForeground}
                            style={fieldStyle}
                            secureTextEntry
                            autoComplete="off"
                            value={password}
                            onChangeText={setPassword}
                          />
                          {button(
                            t("changeOver.authenticate"),
                            async () => {
                              const result = await request<IncomingHandoffAuth>(
                                `/${stationId}/authenticate`,
                                {
                                  username,
                                  password,
                                  preparationId: prep.id,
                                  revision: prep.snapshot.revision,
                                },
                              );
                              setPassword("");
                              setAuth(result);
                              setReviewedRevision(prep.snapshot.revision);
                            },
                            !online || !username || !password,
                          )}
                        </>
                      ) : (
                        <>
                          {label(
                            `${t("changeOver.incoming")}: ${auth.incoming.displayName}`,
                          )}
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <Switch
                              accessibilityLabel={t("changeOver.acknowledge")}
                              value={acknowledged}
                              onValueChange={setAcknowledged}
                            />
                            <Text style={{ color: colors.foreground, flex: 1 }}>
                              {t("changeOver.acknowledge")}
                            </Text>
                          </View>
                          {acknowledged &&
                            button(
                              t("changeOver.switchUser"),
                              async () => {
                                const result = await request<{
                                  token: string;
                                  user: StoredUser;
                                }>(`/${stationId}/transfer`, {
                                  proof: auth.proof,
                                  operationId: Crypto.randomUUID(),
                                  acknowledged: true,
                                });
                                await cache.cancelQueries();
                                cache.clear();
                                await acceptChangeOverSession(result);
                                router.replace({
                                  pathname: "/(tabs)/shift-notes",
                                  params: { siteId: String(siteId), stationId },
                                } as never);
                              },
                              !canTransfer,
                            )}
                        </>
                      )}
                      {label(t("changeOver.recovery"))}
                    </>
                  )}
                  {(ownShift || current.supervisor) &&
                    <>
                      <TextInput
                        accessibilityLabel={t("changeOver.reason")}
                        placeholder={t("changeOver.reason")}
                        placeholderTextColor={colors.mutedForeground}
                        style={fieldStyle}
                        value={reason}
                        onChangeText={setReason}
                      />
                      {button(
                        t("changeOver.cancel"),
                        () => mutate("cancel", { reason }),
                        !online || !reason.trim(),
                      )}
                    </>}
                </View>
              )}
              {current.supervisor && (
                <View style={cardStyle}>
                  {label(t("changeOver.supervisor"))}
                  {current.shift && !ownShift && (
                    <>
                      {label(t("changeOver.recoverExplanation"))}
                      <TextInput
                        accessibilityLabel={t("changeOver.reason")}
                        placeholder={t("changeOver.reason")}
                        placeholderTextColor={colors.mutedForeground}
                        style={fieldStyle}
                        value={reason}
                        onChangeText={setReason}
                      />
                      {button(
                        t("changeOver.recover"),
                        () =>
                          mutate("recover", {
                            expectedShiftId: current.shift!.id,
                            reason,
                            acknowledged: true,
                          }),
                        !online || !reason.trim(),
                      )}
                    </>
                  )}
                  <TextInput
                    accessibilityLabel={t("changeOver.newGate")}
                    placeholder={t("changeOver.newGate")}
                    placeholderTextColor={colors.mutedForeground}
                    style={fieldStyle}
                    value={newGate}
                    onChangeText={setNewGate}
                  />
                  {button(
                    t("changeOver.addGate"),
                    async () => {
                      await request("/stations", { siteId, name: newGate });
                      setNewGate("");
                      await stations.refetch();
                    },
                    !online || !newGate.trim(),
                  )}
                </View>
              )}
            </>
          )
        )}
      </ScrollView>
    </ScreenSafeArea>
  );
}
