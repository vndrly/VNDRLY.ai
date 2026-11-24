import React, { useState } from "react";
import { Linking, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateMapActivityPopupData = {
  stationId: string;
  siteId: number;
  siteName: string;
  gateName: string;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
  historical: boolean;
  es: boolean;
  activity: {
    stationId: string;
    siteId: number;
    scope: "gate_attributed" | "linked_gates";
    generatedAt: string;
    startedAt: string;
    window: "current_shift" | "released_watch" | "24h";
    metrics: { checkIns: number; checkOuts: number; pendingAdmission: number; itemsToReview: number };
  } | null;
  loading: boolean;
  error: boolean;
  refreshing: boolean;
  statusLabel: string;
  statusActionLabel: string;
  confirmation: string;
  confirmationAction: string;
  confirmationError: string;
  statusBusy: boolean;
  editAllowed: boolean;
};

type Action = "edit" | "status" | "confirm" | "cancel" | "retry";

export default function GateMapActivityPopupNative({ data, onAction }: { data: GateMapActivityPopupData; onAction: (action: Action) => void }) {
  const { primary } = useColors();
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const c = (en: string, es: string) => data.es ? es : en;
  const text = { color: "#ececec" } as const;
  const secondary = { color: "#b3b3b3", fontSize: 12 } as const;
  const button = { borderColor: primary, borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 } as const;
  const hasLocation = data.latitude !== null && data.longitude !== null && Number.isFinite(data.latitude) && Number.isFinite(data.longitude) && Math.abs(data.latitude) <= 90 && Math.abs(data.longitude) <= 180;
  const destination = hasLocation ? encodeURIComponent(`${data.latitude},${data.longitude}`) : "";
  const metrics = [
    ["log-in", c("Check-in records", "Registros de entrada"), data.activity?.metrics.checkIns],
    ["log-out", c("Check-out records", "Registros de salida"), data.activity?.metrics.checkOuts],
    ["clock", c("Pending admission", "Admisión pendiente"), data.activity?.metrics.pendingAdmission],
    ["alert-triangle", c("Items to review", "Elementos para revisar"), data.activity?.metrics.itemsToReview],
  ] as const;
  const time = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
  };
  return <View accessibilityLabel={c("Gate activity", "Actividad del acceso")} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 12, padding: 12, gap: 7 }}>
    {data.editAllowed && <Pressable accessibilityRole="button" onPress={() => onAction("edit")} style={[button, { alignSelf: "flex-start" }]}><Text style={text}>{c("Edit / Move Gate", "Editar / mover acceso")}</Text></Pressable>}
    <Text accessibilityRole="header" style={{ ...text, fontSize: 17, fontWeight: "700" }}>{c("Gate activity", "Actividad del acceso")}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      <Text style={{ ...text, fontWeight: "700" }}>{data.siteName} · {data.gateName} ·</Text>
      {data.statusActionLabel && !data.historical ? <Pressable accessibilityRole="button" accessibilityLabel={data.statusActionLabel} onPress={() => onAction("status")} style={[button, { paddingVertical: 4 }]}><Text style={text}>{data.statusLabel}</Text></Pressable> : <Text style={text}>{data.statusLabel || c(data.active ? "Active" : "Inactive", data.active ? "Activo" : "Inactivo")}</Text>}
    </View>
    {data.confirmation ? <>
      <Text style={text}>{data.confirmation}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={data.confirmationAction} accessibilityState={{ disabled: data.statusBusy }} disabled={data.statusBusy} onPress={() => onAction("confirm")} style={button}><Text style={text}>{data.confirmationAction}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={c("Cancel", "Cancelar")} accessibilityState={{ disabled: data.statusBusy }} disabled={data.statusBusy} onPress={() => onAction("cancel")} style={button}><Text style={text}>{c("Cancel", "Cancelar")}</Text></Pressable>
      </View>
      {!!data.confirmationError && <Text accessibilityRole="alert" style={{ color: "#ff8080" }}>{data.confirmationError}</Text>}
    </> : <>
      <Text style={secondary}>{data.activity?.scope === "linked_gates" ? c("Shared linked-gate records", "Registros compartidos de accesos vinculados") : c("Current gate-attributed records", "Registros actuales atribuidos al acceso")}</Text>
      {data.historical && <Text style={secondary}>{c("Current counts; map shows a historical time.", "Cifras actuales; el mapa muestra una hora histórica.")}</Text>}
      {data.loading ? <Text accessibilityRole="alert" style={secondary}>{c("Loading current activity…", "Cargando actividad actual…")}</Text> : data.error || !data.activity ? <View><Text accessibilityRole="alert" style={secondary}>{c("Activity unavailable. Counts could not be loaded.", "Actividad no disponible. No se pudieron cargar las cifras.")}</Text><Pressable accessibilityRole="button" onPress={() => onAction("retry")} style={[button, { alignSelf: "flex-start", marginTop: 5 }]}><Text style={text}>{c("Retry", "Reintentar")}</Text></Pressable></View> : <>
        <Text style={secondary}>{c("Snapshot", "Captura")}: {time(data.activity.generatedAt)}</Text>
        <Text style={secondary}>{data.activity.window === "24h" ? c("Last 24 hours", "Últimas 24 horas") : `${c("Since", "Desde")} ${time(data.activity.startedAt)}`}</Text>
        {hasLocation && <View><Pressable accessibilityRole="button" onPress={() => setDirectionsOpen(value => !value)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 }}><Feather name="navigation" color={primary} size={15} /><Text style={text}>{c("Get Directions", "Cómo llegar")}</Text></Pressable>
          {directionsOpen && <View style={{ flexDirection: "row", gap: 12, paddingVertical: 5 }}><Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://maps.apple.com/?daddr=${destination}&dirflg=d`)}><Text style={{ color: primary }}>Apple Maps</Text></Pressable><Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`)}><Text style={{ color: primary }}>Google Maps</Text></Pressable></View>}
        </View>}
        {metrics.map(([icon, label, value]) => <View key={label} style={{ borderTopColor: "#454545", borderTopWidth: 1, paddingVertical: 8, flexDirection: "row", gap: 7, alignItems: "center" }}><Feather name={icon} color={primary} size={15} /><Text style={{ ...text, flex: 1 }}>{label}</Text><Text style={text}>{value}</Text></View>)}
        {data.refreshing && <Text accessibilityRole="alert" style={secondary}>{c("Refreshing…", "Actualizando…")}</Text>}
      </>}
    </>}
  </View>;
}
