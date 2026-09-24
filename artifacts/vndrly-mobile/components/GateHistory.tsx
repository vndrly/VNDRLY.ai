import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import SphereBackButton from "@/components/SphereBackButton";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, apiFetchRaw } from "@/lib/api";
import { changeOverRequest } from "@/lib/change-over-api";
import {
  isVisibleGateReportRecipient,
  type GateReportRecipient,
} from "@/lib/gate-report-recipients";

type Range = "current_shift" | "previous_shift" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y";
type RecordType = "all" | "check_ins" | "check_outs" | "visitors_on_site" | "employees_on_site" | "vehicles_on_site" | "pending" | "needs_review";
type Format = "pdf" | "excel" | "word";
type Row = Record<string, unknown> & { id?: string | number };

export default function GateHistory() {
  const colors = useColors(); const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wideLandscape = width >= 768 && width > height;
  const { user } = useAuth();
  const [siteId, setSiteId] = useState<number | null>(null); const [stationId, setStationId] = useState("");
  const [siteMenuOpen, setSiteMenuOpen] = useState(false); const [gateMenuOpen, setGateMenuOpen] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [timePeriodOpen, setTimePeriodOpen] = useState(false); const [recordTypeOpen, setRecordTypeOpen] = useState(false);
  const [range, setRange] = useState<Range>("current_shift"); const [recordType, setRecordType] = useState<RecordType>("all");
  const [emailFormat, setEmailFormat] = useState<Format | null>(null);
  const [search, setSearch] = useState(""); const [message, setMessage] = useState("");
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const sites = useQuery({ queryKey: ["gate-history-sites"], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites"), retry: false });
  const selectedSiteId = siteId ?? sites.data?.sites[0]?.id ?? null;
  const stations = useQuery({ queryKey: ["gate-history-stations", selectedSiteId], queryFn: () => changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${selectedSiteId}`), enabled: Boolean(selectedSiteId), retry: false });
  const selectedStationId = stationId || stations.data?.stations[0]?.id || "";
  const filters = useMemo(() => ({ siteId: selectedSiteId!, ...(selectedStationId ? { stationId: selectedStationId } : {}), range, recordType, ...(search.trim() ? { search: search.trim() } : {}) }), [range, recordType, search, selectedSiteId, selectedStationId]);
  const report = useQuery({ queryKey: ["gate-history-report", filters], queryFn: () => apiFetch<{ rows: Row[] }>("/api/gate-report/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", filters }) }), enabled: Boolean(selectedSiteId), retry: false });
  const liveFilters = useMemo(() => ({ siteId: selectedSiteId!, ...(selectedStationId ? { stationId: selectedStationId } : {}), range: "1y" as const, recordType: "all" as const }), [selectedSiteId, selectedStationId]);
  const liveHistory = useQuery({ queryKey: ["gate-history-live", liveFilters], queryFn: () => apiFetch<{ rows: Row[] }>("/api/gate-report/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", filters: liveFilters }) }), enabled: Boolean(selectedSiteId), retry: false });
  useEffect(() => setHistoryPage(0), [selectedSiteId, selectedStationId]);
  const liveRows = liveHistory.data?.rows ?? [];
  const visibleLiveRows = liveRows.slice(historyPage * 50, historyPage * 50 + 50);
  const recipients = useQuery({ queryKey: ["gate-history-recipients", filters], queryFn: () => apiFetch<{ recipients: GateReportRecipient[] }>(`/api/gate-report/recipients?${new URLSearchParams({ reportKind: "history", siteId: String(filters.siteId), stationId: selectedStationId, range, recordType, search })}`), enabled: Boolean(selectedSiteId), retry: false });
  useEffect(() => {
    const visibleRecipients = recipients.data?.recipients.filter(isVisibleGateReportRecipient) ?? [];
    const visibleIds = new Set(visibleRecipients.map((entry) => entry.userId));
    setRecipientIds((current) => {
      const retained = current.filter((id) => visibleIds.has(id));
      if (retained.length) return retained;
      return user?.id && visibleIds.has(user.id) ? [user.id] : [];
    });
  }, [recipients.data, user?.id]);
  const exportReport = async () => {
    if (!emailFormat) throw new Error(t("gateHistory.noFormat"));
    const format = emailFormat;
    const response = await apiFetchRaw("/api/gate-report/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", format, filters }) });
    const extension = format === "excel" ? "csv" : format === "word" ? "doc" : "pdf";
    const filename = `vndrly-gate-history.${extension}`;
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    await FileSystem.writeAsStringAsync(uri, globalThis.btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(uri, { dialogTitle: t("gateHistory.share") });
  };
  const emailReport = async () => {
    if (!emailFormat) throw new Error(t("gateHistory.noFormat"));
    if (!recipientIds.length) throw new Error(t("gateHistory.noRecipients"));
    await apiFetch("/api/gate-report/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", format: emailFormat, recipientUserIds: recipientIds, filters }) });
    setMessage(t("gateHistory.emailed"));
  };
  const act = (work: () => Promise<void>) => void work().catch((cause) => setMessage(cause instanceof Error ? cause.message : t("gateHistory.failed")));
  const resolveReview = async (row: Row) => {
    const id = String(row.id ?? ""); const visitId = Number(row.visitId); const reason = reviewReasons[id]?.trim();
    if (!id || !Number.isSafeInteger(visitId) || visitId <= 0 || !reason) return;
    const reconciliationId = typeof row.reconciliationId === "string" ? row.reconciliationId : null;
    await apiFetch(reconciliationId ? `/api/visits/gate/${visitId}/reconciliations/${reconciliationId}/reverse` : `/api/visits/gate/${visitId}/resolve-stale`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason, idempotencyKey: Crypto.randomUUID() }) });
    setReviewReasons((current) => ({ ...current, [id]: "" })); await report.refetch();
  };
  const field = { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, color: colors.foreground, paddingHorizontal: 12, paddingVertical: 10 } as const;
  return <ScreenSafeArea><ScrollView contentContainerStyle={{ gap: 14, padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
    <BrandTitleRow subtitle="iOS Portal" logoTestId="gate-history-brand-logo" platformLogoTestId="gate-history-vndrly-logo" />
    <View style={{ alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" }}>
      <View style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 }}>
        <SphereBackButton
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/change-over" as never)}
          size={40}
          testID="history-page-back"
        />
        <Text accessibilityRole="header" style={{ color: colors.foreground, flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 20 }}>
          {t("gatekeeper.historyTitle")}
        </Text>
      </View>
      <AskVVoiceIndicator inline />
    </View>
    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: -8 }}>
      {t("gateHistory.subtitle")}
    </Text>
    <View testID="gate-history-live-card" style={{ backgroundColor: "#28282a", borderColor: colors.primary, borderRadius: 12, borderWidth: 2, gap: 12, padding: 16 }}>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("gatekeeper.historyTitle")}</Text>
      {liveHistory.isLoading ? <ActivityIndicator color={colors.primary} /> : visibleLiveRows.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t("gatekeeper.historyEmpty")}</Text> : visibleLiveRows.map((row, index) => <View key={String(row.id ?? index)} style={{ borderColor: colors.primary, borderRadius: 10, borderWidth: 2, gap: 4, padding: 10 }}><Text style={{ color: colors.foreground, fontWeight: "700" }}>{String(row.name ?? row.driver ?? row.vehiclePlate ?? t("gateHistory.record"))}</Text><Text style={{ color: colors.mutedForeground }}>{[row.vehiclePlate, row.company, row.checkInTime, row.checkOutTime].map((value) => String(value ?? "")).filter(Boolean).join(" · ")}</Text></View>)}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <TogglePillButton testID="gate-history-newer" inactive={historyPage === 0} disabled={historyPage === 0} onPress={() => setHistoryPage((page) => Math.max(0, page - 1))}>↑</TogglePillButton>
        <TogglePillButton testID="gate-history-older" inactive={(historyPage + 1) * 50 >= liveRows.length} disabled={(historyPage + 1) * 50 >= liveRows.length} onPress={() => setHistoryPage((page) => page + 1)}>↓</TogglePillButton>
      </View>
    </View>
    <View testID="gate-history-report-card" style={{ backgroundColor: "#28282a", borderColor: colors.primary, borderRadius: 12, borderWidth: 2, gap: 14, padding: 16 }}>
    <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("gateHistory.sendReports", { defaultValue: "Send Reports" })}</Text>
    <View style={{ backgroundColor: colors.border, height: 1 }} />
    <View testID="gate-history-report-selectors" style={{ flexDirection: wideLandscape ? "row" : "column", gap: 12 }}>
      <View style={{ flex: 1, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("changeOver.site")}</Text>
      {sites.data?.sites.filter((site) => site.id === selectedSiteId).map((site) => <TogglePillButton key={site.id} solid accessibilityState={{ expanded: siteMenuOpen }} onPress={() => { if ((sites.data?.sites.length ?? 0) > 1) setSiteMenuOpen((open) => !open); }}>{site.name}</TogglePillButton>)}
      {siteMenuOpen && sites.data?.sites.filter((site) => site.id !== selectedSiteId).map((site) => <TogglePillButton key={site.id} onPress={() => { setSiteId(site.id); setStationId(""); setSiteMenuOpen(false); setGateMenuOpen(false); }}>{site.name}</TogglePillButton>)}</View>
      <View style={{ flex: 1, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("changeOver.gate")}</Text>
      {stations.data?.stations.filter((station) => station.id === selectedStationId).map((station) => <TogglePillButton key={station.id} solid accessibilityState={{ expanded: gateMenuOpen }} onPress={() => { if ((stations.data?.stations.length ?? 0) > 1) setGateMenuOpen((open) => !open); }}>{station.name}</TogglePillButton>)}
      {gateMenuOpen && stations.data?.stations.filter((station) => station.id !== selectedStationId).map((station) => <TogglePillButton key={station.id} onPress={() => { setStationId(station.id); setGateMenuOpen(false); }}>{station.name}</TogglePillButton>)}</View>
    </View>
    <View style={{ backgroundColor: colors.border, height: 1 }} />
    <View testID="gate-history-recipients-card" style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gateHistory.toggleRecipients")}
        accessibilityState={{ expanded: recipientsOpen }}
        onPress={() => setRecipientsOpen((open) => !open)}
        style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" }}
        testID="gate-history-recipients-toggle"
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("gateHistory.recipients")}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t("gateHistory.selected", { count: recipientIds.length })}</Text>
        </View>
        <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{recipientsOpen ? "⌃" : "⌄"}</Text>
      </Pressable>
      {recipientsOpen ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{recipients.data?.recipients.filter(isVisibleGateReportRecipient).map((recipient) => <TogglePillButton key={recipient.userId} solid={recipientIds.includes(recipient.userId)} onPress={() => setRecipientIds((current) => current.includes(recipient.userId) ? current.filter((id) => id !== recipient.userId) : [...current, recipient.userId])}>{recipient.name}</TogglePillButton>)}</View> : null}
    </View>
    <View style={{ backgroundColor: colors.border, height: 1 }} />
    <View testID="gate-history-search-card" style={{ gap: 12 }}>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("gateHistory.searchTitle")}</Text>
      <TextInput accessibilityLabel={t("gatekeeper.historySearch")} value={search} onChangeText={setSearch} placeholder={t("gatekeeper.historySearch")} placeholderTextColor={colors.mutedForeground} style={[field, { backgroundColor: colors.card }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gateHistory.toggleTimePeriod")}
        accessibilityState={{ expanded: timePeriodOpen }}
        onPress={() => setTimePeriodOpen((open) => !open)}
        style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 30 }}
        testID="gate-history-time-period-toggle"
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{t("gateHistory.chooseTimePeriod")}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(`gateHistory.range.${range}`)}</Text>
        </View>
        <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{timePeriodOpen ? "⌃" : "⌄"}</Text>
      </Pressable>
      {timePeriodOpen ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"] as Range[]).map((value) => <TogglePillButton key={value} solid={range === value} onPress={() => setRange(value)}>{t(`gateHistory.range.${value}`)}</TogglePillButton>)}</View> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gateHistory.toggleRecordType")}
        accessibilityState={{ expanded: recordTypeOpen }}
        onPress={() => setRecordTypeOpen((open) => !open)}
        style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 30 }}
        testID="gate-history-record-type-toggle"
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{t("gateHistory.chooseRecordType")}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(`gateHistory.type.${recordType}`)}</Text>
        </View>
        <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{recordTypeOpen ? "⌃" : "⌄"}</Text>
      </Pressable>
      {recordTypeOpen ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["all", "check_ins", "check_outs", "visitors_on_site", "vehicles_on_site", "needs_review"] as RecordType[]).map((value) => <TogglePillButton key={value} solid={recordType === value} onPress={() => setRecordType(value)}>{t(`gateHistory.type.${value}`)}</TogglePillButton>)}</View> : null}
      {message ? <Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>{message}</Text> : null}
      {report.isLoading ? <ActivityIndicator color={colors.primary} /> : (report.data?.rows ?? []).length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t("gatekeeper.historyEmpty")}</Text> : report.data?.rows.map((row, index) => { const id = String(row.id ?? index); return <View key={id} style={{ borderColor: colors.border, borderRadius: 10, borderWidth: 1, gap: 8, padding: 12 }}><Text style={{ color: colors.foreground }}>{String(row.name ?? row.driver ?? row.vehiclePlate ?? t("gateHistory.record"))}</Text><Text style={{ color: colors.mutedForeground }}>{Object.entries(row).filter(([key]) => key !== "id").slice(0, 5).map(([, value]) => String(value ?? "")).filter(Boolean).join(" · ")}</Text>{recordType === "needs_review" ? <><TextInput accessibilityLabel={`${t("gateHistory.reviewReason")} ${id}`} value={reviewReasons[id] ?? ""} onChangeText={(value) => setReviewReasons((current) => ({ ...current, [id]: value }))} placeholder={t("gateHistory.reviewReason")} placeholderTextColor={colors.mutedForeground} style={field} /><TogglePillButton disabled={!reviewReasons[id]?.trim()} onPress={() => act(() => resolveReview(row))}>{t(typeof row.reconciliationId === "string" ? "gateHistory.reverse" : "gateHistory.reconcile")}</TogglePillButton></> : null}</View>; })}
    </View>
    <View testID="gate-history-export-row" style={{ flexDirection: "row", gap: 8 }}>{(["pdf", "excel", "word"] as Format[]).map((format) => <TogglePillButton key={format} color={format === "pdf" ? "red" : format === "excel" ? "green" : "blue"} solid={emailFormat === format} accessibilityState={{ selected: emailFormat === format }} style={{ flex: 1 }} onPress={() => setEmailFormat(format)}>{format === "excel" ? "CSV" : format === "word" ? "DOC" : "PDF"}</TogglePillButton>)}</View>
    <TogglePillButton testID="gate-history-save" color="brand" solid disabled={!emailFormat} onPress={() => act(exportReport)}>{t("gateHistory.saveCopy", { defaultValue: "Save a Copy" })}</TogglePillButton>
    <TogglePillButton testID="gate-history-email" color="brand" solid disabled={!emailFormat} onPress={() => act(emailReport)}>{t("gateHistory.emailReport", { defaultValue: "Email Report" })}</TogglePillButton>
    </View>
  </ScrollView></ScreenSafeArea>;
}
