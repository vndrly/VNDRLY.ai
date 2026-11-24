import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import DismissibleModal from "@/components/DismissibleModal";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import AuthedImage from "@/components/AuthedImage";
import { apiFetch, getApiBase } from "@/lib/api";
import { formatPlateForDisplay } from "@/lib/plate-display";
import { useAuth } from "@/hooks/use-auth";
import type { GateLogExportFilters } from "./GateLogExportNative";

type RecordDetail = {
  id: string; name?: string; company?: string | null; vehiclePlate?: string | null; plateState?: string | null;
  checkInTime?: string; checkOutTime?: string | null; reconciliationState?: string | null;
  admissionStatus?: string | null; gateName?: string | null; exitGateName?: string | null;
  gateAssociationSource?: string | null; checkOutGpsEvidence?: { gateName?: string } | null;
  expectedMinutes?: number | null; purpose?: string | null; notes?: string | null;
};
type CrossingImage = { objectPath: string; originalPath: string; kind: string; capturedAt: string };
type VisitDetail = { firstName?: string; lastName?: string; company?: string | null; vehiclePlate?: string | null; plateState?: string | null; siteName?: string | null; checkInTime?: string; checkOutTime?: string | null; purpose?: string | null; notes?: string | null; gateCapture?: { images?: CrossingImage[] } | null };

export default function GateLogRecordDetailsNative({ recordId, filters, onClose }: { recordId: string | null; filters: GateLogExportFilters | null; onClose: () => void }) {
  const { i18n, t } = useTranslation();
  const { user, activeMembershipId } = useAuth();
  const [photosOpen, setPhotosOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<CrossingImage | null>(null);
  const c = (en: string, es: string) => i18n.language?.startsWith("es") ? es : en;
  const detail = useQuery({
    queryKey: ["native-gate-log-record-detail", user?.id, activeMembershipId, recordId, filters],
    enabled: !!recordId && !!filters,
    retry: false,
    queryFn: () => apiFetch<{ rows: RecordDetail[] }>("/api/gate-report/query", { method: "POST", body: JSON.stringify({ reportKind: "history", filters: { ...filters!, recordType: "all", recordId } }) }),
  });
  const record = detail.data?.rows.find(row => row.id === recordId);
  const visitId = recordId && /^visit:[1-9]\d*$/.test(recordId) ? Number(recordId.slice(6)) : null;
  const visit = useQuery({
    queryKey: ["native-gate-log-crossing-photos", user?.id, activeMembershipId, visitId],
    enabled: photosOpen && visitId !== null,
    retry: false,
    queryFn: () => apiFetch<VisitDetail>(`/api/visits/${visitId}`),
  });
  const time = (value?: string | null) => value ? new Date(value).toLocaleString(i18n.language?.startsWith("es") ? "es-US" : "en-US") : "";
  const plate = record?.vehiclePlate ? formatPlateForDisplay(record.plateState, record.vehiclePlate, t("gatekeeper.plateStateUnconfirmed")) : "";
  const fields: [string, string | null | undefined][] = record ? [
    [c("Record", "Registro"), record.id],
    [c("Entry gate", "Acceso de entrada"), record.gateName || c("Unknown", "Desconocido")],
    [c("Exit gate", "Acceso de salida"), record.exitGateName || record.checkOutGpsEvidence?.gateName],
    [c("Gate association source", "Origen de la asociación del acceso"), record.gateName ? record.gateAssociationSource === "user_supplied_historical_correction" ? c("User-supplied historical correction", "Corrección histórica proporcionada por el usuario") : record.gateAssociationSource === "check_in_gps_evidence" ? c("Recorded gate selection", "Selección de acceso registrada") : c("Unknown", "Desconocido") : null],
    [c("Company", "Empresa"), record.company],
    [c("Vehicle plate", "Placa del vehículo"), plate],
    [c("Check-in", "Entrada"), time(record.checkInTime)],
    [c("Check-out", "Salida"), record.reconciliationState === "confirmed_off_site" ? c("Departure time unknown", "Hora de salida desconocida") : time(record.checkOutTime) || (record.admissionStatus === "pending" ? c("Pending admission", "Admisión pendiente") : c("On Site", "En el sitio"))],
    [c("Expected minutes", "Minutos previstos"), record.expectedMinutes == null ? null : String(record.expectedMinutes)],
    [c("Purpose", "Propósito"), record.purpose],
    [c("Notes", "Notas"), record.notes],
  ] : [];
  const close = () => { setPhotosOpen(false); setSelectedImage(null); onClose(); };
  return <DismissibleModal visible={!!recordId} transparent animationType="fade" onRequestClose={close} dismissLabel="close">
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 16 }}>
      <ScrollView style={{ maxHeight: "88%", borderWidth: 2, borderColor: "#08b5d5", borderRadius: 12, backgroundColor: "#242426" }} contentContainerStyle={{ padding: 18, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: "white", fontSize: 19, fontWeight: "700", flex: 1 }}>{photosOpen ? c("Crossing photos", "Fotos del cruce") : record?.name || c("Gate record", "Registro de acceso")}</Text><Pressable accessibilityRole="button" accessibilityLabel={c("Close", "Cerrar")} onPress={photosOpen ? () => { setPhotosOpen(false); setSelectedImage(null); } : close}><Feather name="x" size={24} color="white" /></Pressable></View>
        {!photosOpen ? <>
          <Text style={{ color: "#aaa" }}>{c("Recorded details for this gate crossing.", "Detalles registrados de este cruce de acceso.")}</Text>
          {detail.isLoading ? <ActivityIndicator color="#08b5d5" /> : detail.isError ? <Text accessibilityRole="alert" style={{ color: "#f87171" }}>{c("The record could not be loaded.", "No se pudo cargar el registro.")}</Text> : !record ? <Text style={{ color: "#aaa" }}>{c("This record is unavailable in the selected site.", "Este registro no está disponible en el sitio seleccionado.")}</Text> : fields.filter(([, value]) => value != null && value !== "").map(([label, value]) => <View key={label} style={{ gap: 2 }}><Text style={{ color: "#aaa", fontSize: 12 }}>{label}</Text><Text style={{ color: "white", fontSize: 14 }}>{value}</Text></View>)}
          {record && visitId !== null && <Pressable accessibilityRole="button" onPress={() => setPhotosOpen(true)} style={{ borderWidth: 1, borderColor: "#08b5d5", borderRadius: 7, padding: 10 }}><Text style={{ color: "white" }}>{c("View crossing photos", "Ver fotos del cruce")}</Text></Pressable>}
        </> : <>
          {visit.isLoading ? <ActivityIndicator color="#08b5d5" /> : visit.isError ? <Text accessibilityRole="alert" style={{ color: "#f87171" }}>{c("The record could not be loaded.", "No se pudo cargar el registro.")}</Text> : <>
            <Text style={{ color: "white", fontWeight: "700" }}>{[visit.data?.firstName, visit.data?.lastName].filter(Boolean).join(" ")}</Text>
            {(visit.data?.gateCapture?.images ?? []).map((image, index) => <Pressable key={image.objectPath} accessibilityRole="button" accessibilityLabel={`${image.kind} ${index + 1}`} onPress={() => setSelectedImage(image)} style={{ gap: 4 }}><AuthedImage uri={`${getApiBase()}/api/storage${image.objectPath}`} style={{ height: 160, width: "100%" }} resizeMode="contain" fallback={<Text style={{ color: "#aaa" }}>{c("Photo unavailable", "Foto no disponible")}</Text>} /><Text style={{ color: "#aaa" }}>{c("View original", "Ver original")} · {time(image.capturedAt)}</Text></Pressable>)}
            {!visit.data?.gateCapture?.images?.length && <Text style={{ color: "#aaa" }}>{c("No crossing photos", "No hay fotos del cruce")}</Text>}
            {selectedImage && <AuthedImage uri={`${getApiBase()}/api/storage${selectedImage.originalPath}`} style={{ height: 340, width: "100%" }} resizeMode="contain" fallback={<Text style={{ color: "#aaa" }}>{c("Photo unavailable", "Foto no disponible")}</Text>} />}
          </>}
        </>}
      </ScrollView>
    </View>
  </DismissibleModal>;
}
