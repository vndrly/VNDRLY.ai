import {gateDailyBillingCopy} from "@workspace/api-zod";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, Modal } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {gateVisitState,gateVisitDuration,groupGateVisits} from "@/lib/gate-log-view";
import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import GateGpsEvidence from "@/components/GateGpsEvidence";
import BrandTitleRow from "@/components/BrandTitleRow";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import SphereBackButton from "@/components/SphereBackButton";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { captureAuthScope } from "@/lib/auth";
import { formatPlateForDisplay } from "@/lib/plate-display";
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

type HistoryRoute = { siteId: number | null; stationId: string; range: Range; recordType: RecordType; search: string };
function readHistoryRoute(params: Record<string, unknown>): HistoryRoute {
  const scalar = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const requestedSite = scalar("siteId") || scalar("siteLocationId");
  const parsedSite = /^\d+$/.test(requestedSite) ? Number(requestedSite) : NaN;
  const ranges: Range[] = ["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"];
  const types: RecordType[] = ["all", "check_ins", "check_outs", "visitors_on_site", "employees_on_site", "vehicles_on_site", "pending", "needs_review"];
  const station = scalar("stationId");
  return {
    siteId: Number.isSafeInteger(parsedSite) && parsedSite > 0 ? parsedSite : null,
    stationId: /^[A-Za-z0-9_-]{1,128}$/.test(station) ? station : "",
    range: ranges.includes(scalar("range") as Range) ? scalar("range") as Range : "current_shift",
    recordType: types.includes(scalar("recordType") as RecordType) ? scalar("recordType") as RecordType : "all",
    search: scalar("search").trim().slice(0, 200),
  };
}
export default function GateHistory() {
  const { user, activeMembershipId } = useAuth();
  const params = useLocalSearchParams();
  const scope = `${user?.id}:${activeMembershipId}:${captureAuthScope().generation}`;
  const signature = JSON.stringify([params.siteId, params.siteLocationId, params.stationId, params.range, params.recordType, params.search]);
  // A route left open by the previous membership must not restore its filters.
  // A subsequent navigation with new parameters can select a fresh scoped view.
  const binding = useRef({ scope, blockedSignature: null as string | null });
  if (binding.current.scope !== scope) binding.current = { scope, blockedSignature: signature };
  const initial = readHistoryRoute(binding.current.blockedSignature === signature ? {} : params);
  return <GateHistoryPanel key={`${scope}:${signature}`} initial={initial} />;
}
function GateHistoryPanel({ initial }: { initial: HistoryRoute }) {
  const colors = useColors(); const { t,i18n } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wideLandscape = width >= 768 && width > height;
  const { user,activeMembershipId } = useAuth();
  const generation = captureAuthScope().generation;
  const [selectedRow,setSelectedRow]=useState<Row|null>(null),[reportsOpen,setReportsOpen]=useState(false);
  const [siteId, setSiteId] = useState<number | null>(initial.siteId); const [stationId, setStationId] = useState(initial.stationId);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false); const [gateMenuOpen, setGateMenuOpen] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [timePeriodOpen, setTimePeriodOpen] = useState(false); const [recordTypeOpen, setRecordTypeOpen] = useState(false);
  const [range, setRange] = useState<Range>(initial.range); const [recordType, setRecordType] = useState<RecordType>(initial.recordType);
  const [emailFormat, setEmailFormat] = useState<Format | null>(null);
  const [search, setSearch] = useState(initial.search); const [message, setMessage] = useState("");
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const sites = useQuery({ queryKey: ["gate-history-sites",user?.id,activeMembershipId,generation], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites?mode=history"), retry: false });
  const selectedSiteId = sites.data?.sites.find(site => site.id === siteId)?.id ?? sites.data?.sites[0]?.id ?? null;
  const stations = useQuery({ queryKey: ["gate-history-stations",user?.id,activeMembershipId,generation, selectedSiteId], queryFn: () => changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${selectedSiteId}&mode=history`), enabled: Boolean(selectedSiteId), retry: false });
  const selectedStationId = stations.data?.stations.find(station => station.id === stationId)?.id ?? stations.data?.stations[0]?.id ?? "";
  const filters = useMemo(() => ({ siteId: selectedSiteId!, ...(selectedStationId ? { stationId: selectedStationId } : {}), range, recordType, ...(search.trim() ? { search: search.trim() } : {}) }), [range, recordType, search, selectedSiteId, selectedStationId]);
  const report = useQuery({ queryKey: ["gate-history-report",user?.id,activeMembershipId,generation, filters], queryFn: () => apiFetch<{ rows: Row[] }>("/api/gate-report/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportKind: "history", filters }) }), enabled: Boolean(selectedSiteId) && stations.isSuccess, refetchInterval:15000, retry: false });
  useEffect(()=>{setHistoryPage(0);setSelectedRow(null);},[selectedSiteId,selectedStationId,range,recordType,search,activeMembershipId]);
  const rows=report.data?.rows??[],visibleRows=rows.slice(historyPage*50,historyPage*50+50);
  const onSite=rows.filter(row=>gateVisitState(row)==="on_site").length,reviewCount=rows.filter(row=>gateVisitState(row)==="review").length;
  const duration=(row:Row)=>{const minutes=gateVisitDuration(row);return minutes===null?t("gateHistory.notRecorded"):minutes>=1440?Math.floor(minutes/1440)+"d "+Math.floor(minutes%1440/60)+"h":minutes>=60?Math.floor(minutes/60)+"h "+minutes%60+"m":minutes+" min";};
  const dateTime=(value:unknown)=>{const date=new Date(String(value??""));return Number.isFinite(date.getTime())?date.toLocaleString():t("gateHistory.notRecorded");};
  const recipients = useQuery({ queryKey: ["gate-history-recipients",user?.id,activeMembershipId,generation, filters], queryFn: () => apiFetch<{ recipients: GateReportRecipient[] }>(`/api/gate-report/recipients?${new URLSearchParams({ reportKind: "history", siteId: String(filters.siteId), stationId: selectedStationId, range, recordType, search })}`), enabled: Boolean(selectedSiteId), retry: false });
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
    setReviewReasons((current) => ({ ...current, [id]: "" })); await report.refetch();setSelectedRow(null);
  };
  const field = { backgroundColor: colors.background, borderColor: colors.primary, borderRadius: 12, borderWidth: 2, color: colors.foreground, paddingHorizontal: 12, paddingVertical: 10 } as const;
  function details(){if(!selectedRow)return null;const row=selectedRow,id=String(row.id??""),state=gateVisitState(row);return <><View style={{flexDirection:"row",justifyContent:"space-between",gap:10}}><Text style={{color:colors.foreground,fontSize:20,fontWeight:"700",flex:1}}>{String(row.name??row.driver??t("gateHistory.record"))}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("gateHistory.closeDetails")} onPress={()=>setSelectedRow(null)} style={{padding:8}}><Text style={{color:colors.foreground}}>✕</Text></Pressable></View><Text style={{color:colors.primary}}>{t(({on_site:"gateHistory.state.on_site",departed:"gateHistory.state.departed",pending:"gateHistory.state.pending",denied:"gateHistory.state.denied",reconciled:"gateHistory.state.reconciled",review:"gateHistory.state.review"} as const)[state])}</Text>{[["company",row.company],["plate",[row.plateState,row.vehiclePlate].filter(Boolean).join(" ")],["arrived",dateTime(row.checkInTime)],["departed",dateTime(row.checkOutTime)],["duration",duration(row)]].map(([label,value])=><View key={String(label)} style={{gap:4}}><Text style={{color:colors.mutedForeground,fontSize:12}}>{t(({company:"gateHistory.company",plate:"gateHistory.plate",arrived:"gateHistory.arrived",departed:"gateHistory.departed",duration:"gateHistory.duration"} as Record<string,string>)[String(label)])}</Text><Text style={{color:colors.foreground}}>{String(value||t("gateHistory.notRecorded"))}</Text></View>)}<GateGpsEvidence row={row}/>{state==="review"&&<><TextInput accessibilityLabel={t("gateHistory.reviewReason")+" "+id} placeholder={t("gateHistory.reviewReason")} placeholderTextColor={colors.mutedForeground} value={reviewReasons[id]??""} onChangeText={value=>setReviewReasons(current=>({...current,[id]:value}))} style={field}/><TogglePillButton compactOnTablet disabled={!reviewReasons[id]?.trim()} onPress={()=>act(()=>resolveReview(row))}>{t(typeof row.reconciliationId==="string"?"gateHistory.reverse":"gateHistory.reconcile")}</TogglePillButton></>}</>;}
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
          {t("gateHistory.logTitle")}
        </Text>
      </View>
      <AskVVoiceIndicator inline />
    </View>
    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: -8 }}>
      {t("gateHistory.subtitle")}
    </Text>

    {user?.role==="vendor"?<TogglePillButton onPress={()=>router.push("/gate-billing" as never)}>{gateDailyBillingCopy("Gate daily billing",i18n.language)}</TogglePillButton>:null}

    <View testID="gate-history-filter-card" style={{borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:14,gap:12,backgroundColor:colors.card}}>
          <View testID="gate-history-report-selectors" style={{ flexDirection: wideLandscape ? "row" : "column", gap: 12 }}>
      <View style={{ flex: 1, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("changeOver.site")}</Text>
      {sites.data?.sites.filter((site) => site.id === selectedSiteId).map((site) =><TogglePillButton compactOnTablet key={site.id} solid accessibilityState={{ expanded: siteMenuOpen }} onPress={() => { if ((sites.data?.sites.length ?? 0) > 1) setSiteMenuOpen((open) => !open); }}>{site.name}</TogglePillButton>)}
      {siteMenuOpen && sites.data?.sites.filter((site) => site.id !== selectedSiteId).map((site) =><TogglePillButton compactOnTablet key={site.id} onPress={() => { setSiteId(site.id); setStationId(""); setRange("current_shift"); setRecordType("all"); setSearch(""); setSiteMenuOpen(false); setGateMenuOpen(false); }}>{site.name}</TogglePillButton>)}</View>
      <View style={{ flex: 1, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{t("changeOver.gate")}</Text>
      {stations.data?.stations.filter((station) => station.id === selectedStationId).map((station) =><TogglePillButton compactOnTablet key={station.id} solid accessibilityState={{ expanded: gateMenuOpen }} onPress={() => { if ((stations.data?.stations.length ?? 0) > 1) setGateMenuOpen((open) => !open); }}>{station.name}</TogglePillButton>)}
      {gateMenuOpen && stations.data?.stations.filter((station) => station.id !== selectedStationId).map((station) =><TogglePillButton compactOnTablet key={station.id} onPress={() => { setStationId(station.id); setGateMenuOpen(false); }}>{station.name}</TogglePillButton>)}</View>
    </View>

      <View testID="gate-history-search-card" style={{gap:10}}><TextInput accessibilityLabel={t("gatekeeper.historySearch")} value={search} onChangeText={setSearch} placeholder={t("gatekeeper.historySearch")} placeholderTextColor={colors.mutedForeground} style={[field, { backgroundColor: colors.card }]} />
      <View style={{flexDirection:wideLandscape?"row":"column",gap:10}}><View style={{flex:1,gap:8}}><Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gateHistory.toggleTimePeriod")}
        accessibilityState={{ expanded: timePeriodOpen }}
        onPress={() => setTimePeriodOpen((open) => !open)}
        style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 44, borderWidth:2,borderColor:colors.primary,borderRadius:12,padding:10 }}
        testID="gate-history-time-period-toggle"
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{t("gateHistory.chooseTimePeriod")}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(`gateHistory.range.${range}`)}</Text>
        </View>
        <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{timePeriodOpen ? "⌃" : "⌄"}</Text>
      </Pressable>
      {timePeriodOpen ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"] as Range[]).map((value) =><TogglePillButton compactOnTablet key={value} solid={range === value} onPress={() => {setRange(value);setTimePeriodOpen(false);}}>{t(`gateHistory.range.${value}`)}</TogglePillButton>)}</View> : null}
      </View><View style={{flex:1,gap:8}}><Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gateHistory.toggleRecordType")}
        accessibilityState={{ expanded: recordTypeOpen }}
        onPress={() => setRecordTypeOpen((open) => !open)}
        style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 44, borderWidth:2,borderColor:colors.primary,borderRadius:12,padding:10 }}
        testID="gate-history-record-type-toggle"
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{t("gateHistory.chooseRecordType")}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(`gateHistory.type.${recordType}`)}</Text>
        </View>
        <Text aria-hidden style={{ color: colors.foreground, fontSize: 22, lineHeight: 22 }}>{recordTypeOpen ? "⌃" : "⌄"}</Text>
      </Pressable>
      {recordTypeOpen ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["all", "check_ins", "check_outs", "visitors_on_site", "employees_on_site", "vehicles_on_site", "pending", "needs_review"] as RecordType[]).map((value) =><TogglePillButton compactOnTablet key={value} solid={recordType === value} onPress={() => {setRecordType(value);setRecordTypeOpen(false);}}>{t(`gateHistory.type.${value}`)}</TogglePillButton>)}</View> : null}</View></View>
</View>
      <View style={{flexDirection:"row",gap:10,flexWrap:"wrap",alignItems:"center"}}><TogglePillButton compactOnTablet testID="gate-history-reports-toggle" solid={reportsOpen} onPress={()=>setReportsOpen(!reportsOpen)}>{t("gateHistory.sendReports")}</TogglePillButton><Text style={{color:colors.mutedForeground}}>{t("gateHistory.viewCount",{count:rows.length})}</Text></View>
    </View>
    <View style={{flexDirection:"row",gap:10}}>{([["all",rows.length,t("gateHistory.visits")],["visitors_on_site",onSite,t("gateHistory.onSite")],["needs_review",reviewCount,t("gateHistory.attention")]] as const).map(([type,count,label])=><View key={type} style={{flex:1,borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:12,backgroundColor:colors.card}}><Text style={{color:colors.foreground,fontSize:24,fontWeight:"700"}}>{count}</Text><Text style={{color:colors.mutedForeground}}>{label}</Text></View>)}</View>
    {!!message&&<Text accessibilityRole="alert" style={{color:colors.mutedForeground}}>{message}</Text>}
    <View style={{flexDirection:wideLandscape?"row":"column",gap:12,alignItems:"flex-start"}}><View testID="gate-history-live-card" style={{flex:1,alignSelf:"stretch",borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:14,gap:12,backgroundColor:colors.card}}>
    {report.isLoading?<ActivityIndicator color={colors.primary}/>:report.isError?<Text accessibilityRole="alert" style={{color:colors.destructive}}>{t("gateHistory.failed")}</Text>:!rows.length?<Text style={{color:colors.mutedForeground}}>{t("gateHistory.empty")}</Text>:groupGateVisits(visibleRows).map(([day,visits])=><View key={day} style={{gap:6}}><Text style={{color:colors.primary,fontWeight:"700",paddingVertical:8}}>{day==="unknown"?t("gateHistory.notRecorded"):day}</Text>{visits.map((row,index)=>{const state=gateVisitState(row),id=String(row.id??index);return <Pressable key={id} accessibilityRole="button" accessibilityLabel={t("gateHistory.openVisit",{name:String(row.name??row.driver??row.vehiclePlate??t("gateHistory.record"))})} onPress={()=>setSelectedRow(row)} style={{borderLeftWidth:3,borderLeftColor:selectedRow?.id===row.id?colors.primary:colors.border,padding:12,gap:5,backgroundColor:colors.background,borderRadius:10}}><View style={{flexDirection:"row",justifyContent:"space-between",gap:10}}><Text style={{color:colors.foreground,fontWeight:"700",flex:1}}>{String(row.name??row.driver??row.vehiclePlate??t("gateHistory.record"))}</Text><Text style={{color:state==="on_site"?"#22a565":state==="review"?colors.destructive:colors.mutedForeground,fontWeight:"600"}}>{t(({on_site:"gateHistory.state.on_site",departed:"gateHistory.state.departed",pending:"gateHistory.state.pending",denied:"gateHistory.state.denied",reconciled:"gateHistory.state.reconciled",review:"gateHistory.state.review"} as const)[state])}</Text></View><Text style={{color:colors.mutedForeground}}>{[row.company,formatPlateForDisplay(typeof row.plateState === "string" ? row.plateState : null,typeof row.vehiclePlate === "string" ? row.vehiclePlate : null,t("gatekeeper.plateStateUnconfirmed"))].filter(Boolean).join(" · ")||t("gateHistory.record")}</Text><Text style={{color:colors.mutedForeground,fontSize:12}}>{t("gateHistory.arrived")}: {dateTime(row.checkInTime)} · {duration(row)}</Text><GateGpsEvidence row={row}/></Pressable>})}</View>)}
    <View style={{flexDirection:"row",justifyContent:"space-between",gap:8}}><TogglePillButton compactOnTablet testID="gate-history-newer" disabled={historyPage===0} onPress={()=>setHistoryPage(page=>Math.max(0,page-1))}>{t("gateHistory.newer")}</TogglePillButton><TogglePillButton compactOnTablet testID="gate-history-older" disabled={(historyPage+1)*50>=rows.length} onPress={()=>setHistoryPage(page=>page+1)}>{t("gateHistory.older")}</TogglePillButton></View></View>
    {selectedRow&&wideLandscape&&<View style={{width:300,borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:16,gap:10,backgroundColor:colors.card}}>{details()}</View>}</View>
    <Modal visible={!!selectedRow&&!wideLandscape} transparent animationType="fade" onRequestClose={()=>setSelectedRow(null)}><View style={{flex:1,justifyContent:"center",padding:16,backgroundColor:"rgba(0,0,0,0.65)"}}><ScrollView style={{maxHeight:"85%",borderWidth:2,borderColor:colors.primary,borderRadius:14,backgroundColor:colors.card}} contentContainerStyle={{padding:16,gap:10}}>{details()}</ScrollView></View></Modal>
    {reportsOpen&&<View testID="gate-history-report-card" style={{borderWidth:2,borderColor:colors.primary,borderRadius:14,padding:16,gap:14,backgroundColor:colors.card}}><Text style={{color:colors.foreground,fontWeight:"700"}}>{t("gateHistory.sendReports")}</Text><View testID="gate-history-recipients-card" style={{ gap: 12 }}>
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
      {recipientsOpen ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{recipients.data?.recipients.filter(isVisibleGateReportRecipient).map((recipient) =><TogglePillButton compactOnTablet key={recipient.userId} solid={recipientIds.includes(recipient.userId)} onPress={() => setRecipientIds((current) => current.includes(recipient.userId) ? current.filter((id) => id !== recipient.userId) : [...current, recipient.userId])}>{recipient.name}</TogglePillButton>)}</View> : null}
    </View>
    <View style={{ backgroundColor: colors.border, height: 1 }} />
    <View testID="gate-history-export-row" style={{ flexDirection: "row", gap: 8 }}>{(["pdf", "excel", "word"] as Format[]).map((format) =><TogglePillButton compactOnTablet key={format} color={format === "pdf" ? "red" : format === "excel" ? "green" : "blue"} solid={emailFormat === format} accessibilityState={{ selected: emailFormat === format }} style={{ flex: 1 }} onPress={() => setEmailFormat(format)}>{format === "excel" ? "CSV" : format === "word" ? "DOC" : "PDF"}</TogglePillButton>)}</View>
    <TogglePillButton compactOnTablet testID="gate-history-save" color="brand" solid disabled={!emailFormat} onPress={() => act(exportReport)}>{t("gateHistory.saveCopy", { defaultValue: "Save a Copy" })}</TogglePillButton>
    <TogglePillButton compactOnTablet testID="gate-history-email" color="brand" solid disabled={!emailFormat} onPress={() => act(emailReport)}>{t("gateHistory.emailReport", { defaultValue: "Email Report" })}</TogglePillButton>
</View>}
  </ScrollView></ScreenSafeArea>;
}
