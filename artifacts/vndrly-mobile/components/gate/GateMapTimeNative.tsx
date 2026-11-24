import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "react-i18next";

const CENTRAL = "America/Chicago";
const clock = new Intl.DateTimeFormat("en-US", { timeZone: CENTRAL, month: "2-digit", day: "2-digit", year: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

export default function GateMapTimeNative({ instant, liveConnected, onChange, onRefresh }: { instant: string | null; liveConnected: boolean; onChange: (instant: string | null) => void; onRefresh: () => void }) {
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const { primary } = useColors();
  const [now, setNow] = useState(Date.now());
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (instant) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [instant]);
  const date = instant && !Number.isNaN(Date.parse(instant)) ? new Date(instant) : new Date(now);
  return <View accessibilityLabel="Coverage time controls" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={es ? "En vivo" : "Live"} accessibilityState={{ selected: !instant }} onPress={() => { setPickerOpen(false); onChange(null); }} style={{ borderColor: primary, borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, minHeight: 35, flexDirection: "row", alignItems: "center", gap: 5 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: !instant && liveConnected ? "#12ca6e" : "#777" }} /><Text style={{ color: "#ececec", fontSize: 13 }}>{es ? "En vivo" : "Live"}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={es ? "Día de" : "Day of"} accessibilityState={{ selected: !!instant }} onPress={() => setPickerOpen(value => !value)} style={{ borderColor: primary, borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, minHeight: 35, flexDirection: "row", alignItems: "center", gap: 5 }}><Feather name="calendar" color={primary} size={16} /><Text style={{ color: "#ececec", fontSize: 13 }}>{es ? "Día de" : "Day of"}</Text></Pressable>
      {!!instant && <Pressable accessibilityRole="button" accessibilityLabel={es ? "Restablecer" : "Reset"} onPress={() => { setPickerOpen(false); onChange(null); }}><Feather name="rotate-ccw" color={primary} size={17} /></Pressable>}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text accessibilityLabel="Coverage clock" style={{ color: "#ececec", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{clock.format(date)} CT</Text><Pressable accessibilityRole="button" accessibilityLabel={es ? "Actualizar" : "Refresh"} onPress={onRefresh}><Feather name="refresh-cw" color={primary} size={17} /></Pressable></View>
    {pickerOpen && <View style={{ width: "100%" }}><Text style={{ color: "#ececec", fontSize: 12 }}>{es ? "Fecha y hora (hora central)" : "Date and time (Central Time)"}</Text><DateTimePicker mode="datetime" display="spinner" timeZoneName={CENTRAL} value={date} onChange={(event, selected) => { if (event.type === "dismissed") { setPickerOpen(false); return; } if (selected) onChange(selected.toISOString()); }} /><Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} style={{ alignSelf: "flex-end", padding: 8 }}><Text style={{ color: primary }}>{es ? "Listo" : "Done"}</Text></Pressable></View>}
  </View>;
}
