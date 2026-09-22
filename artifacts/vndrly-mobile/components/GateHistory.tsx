import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import BrandTitleRow from "@/components/BrandTitleRow";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, apiFetchRaw } from "@/lib/api";
import { changeOverRequest } from "@/lib/change-over-api";

type Range = "current_shift" | "previous_shift" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y";
type RecordType = "all" | "check_ins" | "check_outs" | "visitors_on_site" | "employees_on_site" | "vehicles_on_site" | "pending" | "needs_review";
type Format = "pdf" | "excel" | "word";
type Row = Record<string, unknown> & { id?: string | number };

export default function GateHistory() {
  const colors = useColors(); const { t } = useTranslation();
  const { user } = useAuth();
  const [siteId, setSiteId] = useState<number | null>(null); const [stationId, setStationId] = useState("");
  const [range, setRange] = useState<Range>("current_shift"); const [recordType, setRecordType] = useState<RecordType>("all");
  const [search, setSearch] = useState(""); const [message, setMessage] = useState("");
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const sites = useQuery({ queryKey: ["gate-history-sites"], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites"), retry: false });
  const selectedSiteId = siteId ?? sites.data?.sites[0]?.id ?? null;
  const stations = useQuery({ queryKey: ["gate-history-stations", selectedSiteId], queryFn: () => changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${selectedSiteId}`), enabled: Boolean(selectedSiteId), retry: false });
  const selectedStationId = stationId || stations.data?.stations[0]?.id || "";
  const filters = useMemo(() => ({ siteId: selectedSiteId!, ...(selectedStationId ? { stationId: selectedStationId } : {}), range, recordType, ...(search.trim() ? { search: search.trim() } : {}) }), [range, recordType, search, selectedSiteId, selectedStationId]);
  const report = useQuery({ queryKey: ["gate-history-report", filters], queryFn: () => apiFetch<{ rows: Row[] }>("/api/gate-report/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", filters }) }), enabled: Boolean(selectedSiteId), retry: false });
  const recipients = useQuery({ queryKey: ["gate-history-recipients", filters], queryFn: () => apiFetch<{ recipients: { userId: number; name: string }[] }>(`/api/gate-report/recipients?${new URLSearchParams({ reportKind: "history", siteId: String(filters.siteId), stationId: selectedStationId, range, recordType, search })}`), enabled: Boolean(selectedSiteId), retry: false });
  useEffect(() => {
    if (user?.id && recipients.data?.recipients.some((entry) => entry.userId === user.id)) setRecipientIds((current) => current.length ? current : [user.id]);
  }, [recipients.data, user?.id]);
  const exportReport = async (format: Format) => {
    const response = await apiFetchRaw("/api/gate-report/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", format, filters }) });
    if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error(t("gateHistory.shareUnavailable"));
    const uri = `${FileSystem.cacheDirectory}vndrly-gate-history.${format === "excel" ? "xls" : format === "word" ? "doc" : "pdf"}`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    await FileSystem.writeAsStringAsync(uri, globalThis.btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(uri, { dialogTitle: t("gateHistory.share") });
  };
  const emailReport = async () => {
    if (!recipientIds.length) throw new Error(t("gateHistory.noRecipients"));
    await apiFetch("/api/gate-report/deliver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", format: "pdf", recipientUserIds: recipientIds, filters }) });
    setMessage(t("gateHistory.emailed"));
  };
  const act = (work: () => Promise<void>) => void work().catch((cause) => setMessage(cause instanceof Error ? cause.message : t("gateHistory.failed")));
  const resolveReview = async (row: Row) => {
    const id = String(row.id ?? ""); const reason = reviewReasons[id]?.trim();
    if (!id || !reason) return;
    const reconciliationId = typeof row.reconciliationId === "string" ? row.reconciliationId : null;
    await apiFetch(reconciliationId ? `/api/visits/gate/${id}/reconciliations/${reconciliationId}/reverse` : `/api/visits/gate/${id}/resolve-stale`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, idempotencyKey: Crypto.randomUUID() }) });
    setReviewReasons((current) => ({ ...current, [id]: "" })); await report.refetch();
  };
  const field = { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, color: colors.foreground, paddingHorizontal: 12, paddingVertical: 10 } as const;
  return <ScreenSafeArea><ScrollView contentContainerStyle={{ gap: 14, padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
    <BrandTitleRow title={t("gatekeeper.historyTitle")} subtitle={t("gateHistory.subtitle")} logoTestId="gate-history-brand-logo" />
    <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderRadius: 12, borderWidth: 1, gap: 12, padding: 14 }}>
      <Text style={{ color: colors.foreground }}>{t("changeOver.site")}</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{sites.data?.sites.map((site) => <TogglePillButton key={site.id} solid={selectedSiteId === site.id} onPress={() => { setSiteId(site.id); setStationId(""); }}>{site.name}</TogglePillButton>)}</View>
      <Text style={{ color: colors.foreground }}>{t("changeOver.gate")}</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{stations.data?.stations.map((station) => <TogglePillButton key={station.id} solid={selectedStationId === station.id} onPress={() => setStationId(station.id)}>{station.name}</TogglePillButton>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"] as Range[]).map((value) => <TogglePillButton key={value} solid={range === value} onPress={() => setRange(value)}>{t(`gateHistory.range.${value}`)}</TogglePillButton>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["all", "check_ins", "check_outs", "visitors_on_site", "vehicles_on_site", "needs_review"] as RecordType[]).map((value) => <TogglePillButton key={value} solid={recordType === value} onPress={() => setRecordType(value)}>{t(`gateHistory.type.${value}`)}</TogglePillButton>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["pdf", "excel", "word"] as Format[]).map((format) => <TogglePillButton key={format} onPress={() => act(() => exportReport(format))}>{format.toUpperCase()}</TogglePillButton>)}<TogglePillButton onPress={() => act(emailReport)}>{t("gateHistory.email")}</TogglePillButton></View>
      <Text style={{ color: colors.foreground }}>{t("gateHistory.recipients")}</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{recipients.data?.recipients.map((recipient) => <TogglePillButton key={recipient.userId} solid={recipientIds.includes(recipient.userId)} onPress={() => setRecipientIds((current) => current.includes(recipient.userId) ? current.filter((id) => id !== recipient.userId) : [...current, recipient.userId])}>{recipient.name}</TogglePillButton>)}</View>
      <TextInput accessibilityLabel={t("gatekeeper.historySearch")} value={search} onChangeText={setSearch} placeholder={t("gatekeeper.historySearch")} placeholderTextColor={colors.mutedForeground} style={field} />
      {message ? <Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>{message}</Text> : null}
      {report.isLoading ? <ActivityIndicator color={colors.primary} /> : (report.data?.rows ?? []).length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t("gatekeeper.historyEmpty")}</Text> : report.data?.rows.map((row, index) => { const id = String(row.id ?? index); return <View key={id} style={{ borderColor: colors.border, borderRadius: 10, borderWidth: 1, gap: 8, padding: 12 }}><Text style={{ color: colors.foreground }}>{String(row.name ?? row.driver ?? row.vehiclePlate ?? t("gateHistory.record"))}</Text><Text style={{ color: colors.mutedForeground }}>{Object.entries(row).filter(([key]) => key !== "id").slice(0, 5).map(([, value]) => String(value ?? "")).filter(Boolean).join(" · ")}</Text>{recordType === "needs_review" ? <><TextInput accessibilityLabel={`${t("gateHistory.reviewReason")} ${id}`} value={reviewReasons[id] ?? ""} onChangeText={(value) => setReviewReasons((current) => ({ ...current, [id]: value }))} placeholder={t("gateHistory.reviewReason")} placeholderTextColor={colors.mutedForeground} style={field} /><TogglePillButton disabled={!reviewReasons[id]?.trim()} onPress={() => act(() => resolveReview(row))}>{t(typeof row.reconciliationId === "string" ? "gateHistory.reverse" : "gateHistory.reconcile")}</TogglePillButton></> : null}</View>; })}
    </View>
  </ScrollView></ScreenSafeArea>;
}
