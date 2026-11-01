import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { EquipmentItem, EquipmentActivity, EquipmentType } from "@workspace/api-zod";
import TogglePillButton from "./TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { equipmentActivities, equipmentLabel, equipmentTypes } from "@/lib/equipment";

export default function EquipmentMapPicker({ items, shown, onShow, selectedId, onSelect, loading, error }: { items: EquipmentItem[]; shown: boolean; onShow: (value: boolean) => void; selectedId: string | null; onSelect: (id: string | null, group?: EquipmentItem[]) => void; loading?: boolean; error?: string }) {
  const colors = useColors(), { i18n } = useTranslation(), es = i18n.language.startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState(false), [type, setType] = useState<EquipmentType | "all">("all"), [activity, setActivity] = useState<EquipmentActivity | "all">("all");
  const tracked = items.filter(item => item.profile.trackOnMap), filtered = tracked.filter(item => (type === "all" || item.profile.equipmentType === type) && (activity === "all" || item.profile.activity === activity));
  return <>
    <TogglePillButton accessibilityLabel={c("Reveal Equipment", "Mostrar equipo")} solid={shown} onPress={() => setOpen(true)}><Feather name="truck" size={18} color={colors.text} /> {c("Reveal Equipment", "Mostrar equipo")}</TogglePillButton>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 18 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={c("Dismiss equipment picker", "Cerrar selector de equipo")} onPress={() => setOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.65)" }} />
        <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 460, maxHeight: "80%", padding: 16, gap: 12, borderWidth: 2, borderColor: colors.primary, borderRadius: 14, backgroundColor: colors.card }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: "700", fontSize: 18 }}>{c("Reveal Equipment", "Mostrar equipo")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}><TogglePillButton color="green" solid={shown} onPress={() => onShow(true)}>SHOW</TogglePillButton><TogglePillButton solid={!shown} onPress={() => { onShow(false); onSelect(null); }}>HIDE</TogglePillButton><TogglePillButton onPress={() => setOpen(false)}>{c("Close", "Cerrar")}</TogglePillButton></View>
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(["all", ...equipmentTypes] as const).map(value => <TogglePillButton key={value} solid={type === value} onPress={() => setType(value)}>{value === "all" ? c("All types", "Todos los tipos") : equipmentLabel(value, es)}</TogglePillButton>)}</View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(["all", ...equipmentActivities] as const).map(value => <TogglePillButton key={value} solid={activity === value} onPress={() => setActivity(value)}>{value === "all" ? c("All activity", "Toda actividad") : equipmentLabel(value, es)}</TogglePillButton>)}</View>
            {loading && <ActivityIndicator />}{error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
            <TogglePillButton disabled={!filtered.some(item => item.location)} onPress={() => { onShow(true); onSelect(null, filtered); setOpen(false); }}>{c("Fit selected group", "Ajustar al grupo")}</TogglePillButton>
            {!loading && !filtered.length && <Text style={{ color: colors.mutedForeground }}>{c("No equipment in this view.", "No hay equipo en esta vista.")}</Text>}
            {filtered.map(item => <TogglePillButton key={item.id} solid={selectedId === item.id} onPress={() => { onShow(true); onSelect(item.id); setOpen(false); }}>{item.name} · {equipmentLabel(item.profile.activity, es)} · {item.location ? c(item.location.freshness === "fresh" ? "Reported location" : "Last known", item.location.freshness === "fresh" ? "Ubicación reportada" : "Última ubicación") : c("Location unavailable", "Ubicación no disponible")}</TogglePillButton>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
