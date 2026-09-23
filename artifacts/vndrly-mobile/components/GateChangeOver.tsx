import React, { useEffect, useState } from "react";
import {
  AppState,
  ScrollView,
  Text,
  TextInput,
  View,
  Switch,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, apiFetchRaw } from "@/lib/api";
import type { StoredUser } from "@/lib/auth";
import {
  changeOverRequest as request,
  acceptChangeOverSession,
} from "@/lib/change-over-api";

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
  const [days, setDays] = useState(7);
  const [before, setBefore] = useState("");
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
    queryFn: () => apiFetch<{ recipients: { userId: number; name: string }[] }>(`/api/gate-report/recipients?${new URLSearchParams({ reportKind: "shift_notes", siteId: String(siteId), stationId, range: reportRange, recordType: "all", search })}`),
    enabled: history && Boolean(siteId), retry: false,
  });
  useEffect(() => {
    if (user?.id && reportRecipients.data?.recipients.some((entry) => entry.userId === user.id)) setReportRecipientIds((current) => current.length ? current : [user.id]);
  }, [reportRecipients.data, user?.id]);
  const state = useQuery({
    queryKey: ["change-over-state", user?.id, stationId],
    queryFn: () => request<ChangeOverState>(`/${stationId}/state`),
    enabled: Boolean(stationId) && !history,
    retry: false,
    networkMode: "always",
    refetchInterval: 15000,
  });
  const log = useQuery({
    queryKey: ["shift-notes", user?.id, stationId, days, before, search],
    queryFn: () =>
      request<ShiftNotesResponse>(
        `/${stationId}/notes?${new URLSearchParams({ days: String(days), search, ...(before ? { before } : {}) })}`,
      ),
    enabled: Boolean(stationId) && history,
    retry: false,
    networkMode: "always",
  });
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
    setBefore("");
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
    borderColor: colors.border,
    borderWidth: 1,
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
  const exportShiftNotes = async (format: "pdf" | "excel" | "word") => {
    if (!reportFilters) return;
    const response = await apiFetchRaw("/api/gate-report/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "shift_notes", format, filters: reportFilters }) });
    if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error(t("gateHistory.shareUnavailable"));
    const uri = `${FileSystem.cacheDirectory}vndrly-shift-notes.${format === "excel" ? "xls" : format === "word" ? "doc" : "pdf"}`;
    const bytes = new Uint8Array(await response.arrayBuffer()); let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await FileSystem.writeAsStringAsync(uri, globalThis.btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(uri, { dialogTitle: t("gateHistory.share") });
  };
  const emailShiftNotes = async () => {
    if (!reportFilters || !reportRecipientIds.length) throw new Error(t("gateHistory.noRecipients"));
    await apiFetch("/api/gate-report/deliver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "shift_notes", format: "pdf", recipientUserIds: reportRecipientIds, filters: reportFilters }) });
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
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <BrandTitleRow subtitle="iOS Portal" logoTestId="change-over-company-logo" platformLogoTestId="change-over-vndrly-logo" />
        <View style={{ alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" }}>
          <Text
            style={{ color: colors.foreground, flexShrink: 0, fontSize: 26, fontWeight: "700" }}
          >
            {t(history ? "changeOver.shiftNotes" : "changeOver.title")}
          </Text>
          <AskVVoiceIndicator inline />
        </View>
        {label(t(history ? "changeOver.historyIntro" : "changeOver.intro"))}
        {params.gateMode === "1" && (
          <TogglePillButton onPress={() => router.replace("/(tabs)" as never)}>
            {t("gateDuty.returnToAdmin")}
          </TogglePillButton>
        )}
        <View style={cardStyle}>
          {sectionHeading(t("changeOver.site"))}
          {sites.data?.sites.filter((site) => site.id === siteId).map((s) => (
            <TogglePillButton
              key={s.id}
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
              key={s.id}
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
          {sectionHeading(t("changeOver.gate"))}
          {stations.data?.stations.filter((station) => station.id === stationId).map((s) => (
            <TogglePillButton
              key={s.id}
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
            <TogglePillButton key={s.id} onPress={() => { setGate(s.id); setGateMenuOpen(false); }}>
              {s.name}
            </TogglePillButton>
          ))}
        </View>
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
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {(["pdf", "excel", "word"] as const).map((format) => <TogglePillButton key={format} onPress={() => void act(() => exportShiftNotes(format))}>{format.toUpperCase()}</TogglePillButton>)}
              <TogglePillButton onPress={() => void act(emailShiftNotes)}>{t("gateHistory.email")}</TogglePillButton>
            </View>
            {label(t("gateHistory.recipients"))}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {reportRecipients.data?.recipients.map((recipient) => <TogglePillButton key={recipient.userId} solid={reportRecipientIds.includes(recipient.userId)} onPress={() => setReportRecipientIds((current) => current.includes(recipient.userId) ? current.filter((id) => id !== recipient.userId) : [...current, recipient.userId])}>{recipient.name}</TogglePillButton>)}
            </View>
            <TextInput
              accessibilityLabel={t("changeOver.search")}
              placeholder={t("changeOver.search")}
              placeholderTextColor={colors.mutedForeground}
              style={fieldStyle}
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setBefore("");
              }}
            />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {[7, 30, 90, 365].map((n) => (
                <TogglePillButton
                  key={n}
                  solid={days === n}
                  onPress={() => {
                    setDays(n);
                    setBefore("");
                  }}
                >
                  {n} {t("changeOver.days")}
                </TogglePillButton>
              ))}
            </View>
            {log.data?.rows.length === 0 && label(t("changeOver.noNotes"))}
            {log.data?.rows.map((row) => (
              <View key={row.id} style={cardStyle}>
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                  {new Date(row.acknowledged_at).toLocaleString()} ·{" "}
                  {row.outgoing_name} → {row.incoming_name}
                </Text>
                {label(t("changeOver.acknowledged"))}
                {row.summary.facts.map((f) => (
                  <Text key={f.id} style={{ color: colors.foreground }}>
                    {f.text}
                  </Text>
                ))}
                {label(row.notes)}
                {row.snapshot.openItems.map((i) => (
                  <Text key={i.id} style={{ color: colors.foreground }}>
                    {t("changeOver.carryForward")}: {i.text}
                  </Text>
                ))}
                <Snapshot snapshot={row.snapshot} />
              </View>
            ))}
            {log.data?.nextBefore &&
              button(t("changeOver.older"), async () =>
                setBefore(log.data!.nextBefore!),
              )}
            {!!log.data?.actions.length && (
              <View style={cardStyle}>
                {label(t("changeOver.audit"))}
                {log.data.actions.map((a) => (
                  <Text key={a.id} style={{ color: colors.foreground }}>
                    {new Date(a.created_at).toLocaleString()} · {a.actor_name} ·{" "}
                    {a.kind}: {a.text}
                  </Text>
                ))}
              </View>
            )}
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
