import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import DismissibleModal from "@/components/DismissibleModal";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import AuthedImage from "@/components/AuthedImage";
import { apiFetch, getApiBase } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { formatPlateForDisplay } from "@/lib/plate-display";
import type { GateArrivalDetail } from "@workspace/api-zod";

type Visit = { id: number; firstName?: string; lastName?: string; company?: string | null; vehiclePlate?: string | null; plateState?: string | null; siteName?: string | null; checkInTime?: string; checkOutTime?: string | null; purpose?: string | null; notes?: string | null; gateCapture?: { images?: { objectPath: string; originalPath: string; kind: string; capturedAt: string }[] } | null };

export default function GateLogArrivalDetailsNative({ siteId, runId, previewDetail, onClose }: { siteId: number | null; runId: string | null; previewDetail?: GateArrivalDetail | null; onClose: () => void }) {
  const { i18n, t } = useTranslation();
  const { user, activeMembershipId } = useAuth();
  const [visitId, setVisitId] = useState<number | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const run = useQuery({
    queryKey: ["native-gate-arrival-detail", user?.id, activeMembershipId, siteId, runId],
    enabled: !!siteId && !!runId,
    retry: false,
    queryFn: () => previewDetail && previewDetail.runId === runId && previewDetail.siteLocationId === siteId
      ? Promise.resolve(previewDetail)
      : apiFetch<GateArrivalDetail>(`/api/gate-arrivals/${encodeURIComponent(runId!)}?siteLocationId=${siteId}`),
  });
  const visit = useQuery({
    queryKey: ["native-gate-arrival-visit", user?.id, activeMembershipId, visitId],
    enabled: visitId !== null,
    retry: false,
    queryFn: () => apiFetch<Visit>(`/api/visits/${visitId}`),
  });
  const c = (en: string, es: string) => i18n.language?.startsWith("es") ? es : en;
  const time = (value?: string | null) => value ? new Date(value).toLocaleString(i18n.language?.startsWith("es") ? "es-US" : "en-US") : "";
  const close = () => { setVisitId(null); setSelectedPhoto(null); onClose(); };
  const fields: [string, string | null | undefined][] = run.data ? [
    [t("gatekeeper.runRecord"), `#${run.data.ticketNumber}`],
    [t("gatekeeper.driver"), run.data.driverName],
    [t("gatekeeper.vehiclePlate"), run.data.vehicleLabel],
    [t("gatekeeper.company"), run.data.companyName],
    [t("changeOver.site"), run.data.destinationName],
    [t("gatekeeper.recordState"), t(run.data.runComplete ? "gatekeeper.runComplete" : "gatekeeper.runPartial")],
    [t("gatekeeper.lastGpsReport"), run.data.observedAt ? time(run.data.observedAt) : t("gatekeeper.etaUnavailable")],
  ] : [];
  const visitFields: [string, string | null | undefined][] = visit.data ? [
    [t("gatekeeper.company"), visit.data.company],
    [t("gatekeeper.vehiclePlate"), visit.data.vehiclePlate ? formatPlateForDisplay(visit.data.plateState, visit.data.vehiclePlate, t("gatekeeper.plateStateUnconfirmed")) : null],
    [t("changeOver.site"), visit.data.siteName],
    [t("gatekeeper.historyCheckedIn"), time(visit.data.checkInTime)],
    [t("gatekeeper.historyCheckedOut"), visit.data.checkOutTime ? time(visit.data.checkOutTime) : t("gatekeeper.onSiteTab")],
    [t("gatekeeper.purpose"), visit.data.purpose],
    [t("gatekeeper.notes"), visit.data.notes],
  ] : [];
  const row = ([label, value]: [string, string | null | undefined]) => value ? <View key={label} style={{ gap: 2, borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingTop: 8 }}><Text style={{ color: "#aaa", fontSize: 12 }}>{label}</Text><Text style={{ color: "white", fontSize: 14 }}>{value}</Text></View> : null;
  return <DismissibleModal visible={!!runId} transparent animationType="fade" onRequestClose={close} dismissLabel="close"><View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 16 }}><ScrollView style={{ maxHeight: "88%", borderWidth: 2, borderColor: "#08b5d5", borderRadius: 12, backgroundColor: "#242426" }} contentContainerStyle={{ padding: 18, gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: "white", fontSize: 19, fontWeight: "700", flex: 1 }}>{visitId === null ? run.data?.title ?? t("gatekeeper.runDetails") : `${visit.data?.firstName ?? ""} ${visit.data?.lastName ?? ""}`.trim() || t("gatekeeper.recordDetails")}</Text><Pressable accessibilityRole="button" accessibilityLabel={c("Close", "Cerrar")} onPress={visitId !== null ? () => { setVisitId(null); setSelectedPhoto(null); } : close}><Feather name="x" size={24} color="white" /></Pressable></View>
    <Text style={{ color: "#aaa" }}>{visitId === null ? t("gatekeeper.runDetailsHint") : t("gatekeeper.recordDetailsHint")}</Text>
    {visitId === null ? <>
      {run.isLoading ? <ActivityIndicator color="#08b5d5" /> : run.isError ? <Text accessibilityRole="alert" style={{ color: "#f87171" }}>{t("gatekeeper.recordLoadFailed")}</Text> : run.data ? <>
        {fields.map(row)}
        {!!run.data.loads.length && <View style={{ gap: 6 }}><Text style={{ color: "white", fontWeight: "700" }}>{t("gatekeeper.runLoads")}</Text>{run.data.loads.map(load => <View key={load.id} style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingTop: 6 }}><Text style={{ color: "white" }}>{[load.commodity, load.quantity, load.unit].filter(value => value != null && value !== "").join(" · ")}</Text>{load.deliveredAt && <Text style={{ color: "#aaa", fontSize: 12 }}>{time(load.deliveredAt)}</Text>}</View>)}</View>}
        {!!run.data.events.length && <View style={{ gap: 6 }}><Text style={{ color: "white", fontWeight: "700" }}>{t("gatekeeper.runTimeline")}</Text>{run.data.events.map((event, index) => <View key={`${event.type}:${event.recordedAt}:${index}`} style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingTop: 6, gap: 8 }}><Text style={{ color: "white", flex: 1 }}>{t(`gatekeeper.runEvents.${event.type}`, { defaultValue: event.type.replace(/_/g, " ") })}</Text><Text style={{ color: "#aaa", fontSize: 12 }}>{time(event.recordedAt)}</Text></View>)}</View>}
        {!!run.data.linkedVisitIds.length && <View style={{ gap: 6 }}><Text style={{ color: "white", fontWeight: "700" }}>{t("gatekeeper.linkedGateRecords")}</Text>{run.data.linkedVisitIds.map(id => <Pressable key={id} accessibilityRole="button" onPress={() => setVisitId(id)} style={{ borderWidth: 1, borderColor: "#08b5d5", borderRadius: 6, padding: 8 }}><Text style={{ color: "white" }}>{t("gatekeeper.gateRecordNumber", { id })}</Text></Pressable>)}</View>}
      </> : null}
    </> : <>
      {visit.isLoading ? <ActivityIndicator color="#08b5d5" /> : visit.isError ? <Text accessibilityRole="alert" style={{ color: "#f87171" }}>{t("gatekeeper.recordLoadFailed")}</Text> : <>
        {visitFields.map(row)}
        {visit.data?.gateCapture?.images?.map((image, index) => <Pressable key={image.objectPath} accessibilityRole="button" accessibilityLabel={`${image.kind} ${index + 1}`} onPress={() => setSelectedPhoto(image.originalPath)} style={{ gap: 4 }}><AuthedImage uri={`${getApiBase()}/api/storage${image.objectPath}`} style={{ width: "100%", height: 160 }} resizeMode="contain" fallback={<Text style={{ color: "#aaa" }}>{c("Photo unavailable", "Foto no disponible")}</Text>} /><Text style={{ color: "#aaa" }}>{time(image.capturedAt)}</Text></Pressable>)}
        {selectedPhoto && <AuthedImage uri={`${getApiBase()}/api/storage${selectedPhoto}`} style={{ width: "100%", height: 340 }} resizeMode="contain" />}
      </>}
    </>}
  </ScrollView></View></DismissibleModal>;
}
