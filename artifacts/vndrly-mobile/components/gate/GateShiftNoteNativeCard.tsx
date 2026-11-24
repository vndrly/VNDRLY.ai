import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ShiftNote } from "@workspace/gate-booth";
import { useColors } from "@/hooks/useColors";
import GateDashboardActivityCard from "./GateDashboardActivityCard";

const disclaimer = /\[gatego-operations-v2\]\s*Fictional GateGo test data; no real attendance, GPS proof, payroll approval or payment\.?/gi;
const clean = (value: string) => value.replace(disclaimer, "").trim();

export default function GateShiftNoteNativeCard({ note }: { note: ShiftNote }) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const items = note.snapshot.taskItems ?? note.snapshot.openItems;
  let notes = clean(note.notes ?? "");
  const parsed = items.map(item => {
    const parts = clean(item.text).split(/\n(?:Resolution:\s*)?/i);
    const instruction = parts[0];
    if (instruction) notes = notes.split(instruction).join("").trim();
    return { ...item, text: instruction, resolution: item.resolution ?? parts.slice(1).join("\n").trim() };
  });
  const date = note.filed_at ?? note.created_at ?? note.acknowledged_at;
  const muted = { color: "#b3b3b3", fontSize: 12 } as const;
  return <View accessibilityLabel={`${c("Shift note", "Nota de turno")} ${new Date(date).toLocaleString()}`} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 8 }}>
    <View style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
      <Feather name="clipboard" size={19} color={primary} />
      <View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 16, fontWeight: "700" }}>{new Date(date).toLocaleString()}</Text><Text style={muted}>{note.outgoing_name} → {note.incoming_name}</Text></View>
    </View>
    <GateDashboardActivityCard snapshot={note.snapshot} historyBaseHref={`/gate/history?siteId=${note.site_id ?? ""}`} showAllLogLink={false} contentOnly />
    {!!notes && <Text style={{ color: "#ececec", fontSize: 13 }}>{notes}</Text>}
    <View style={{ paddingTop: 6, gap: 7 }} accessibilityLabel="Unassigned Task Hopper">
      <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 14, fontWeight: "700" }}>{c("Unassigned Task Hopper", "Tareas sin asignar")}</Text>
      {parsed.length ? parsed.map(item => <View key={item.id} style={{ gap: 2 }}><Text style={{ color: "#ececec", fontSize: 13 }}>{item.text}</Text><Text style={muted}>{item.status === "resolved" ? c("Resolved", "Resuelto") : c("Open", "Abierto")}</Text>{item.status === "resolved" && <Text style={{ color: "#ececec", fontSize: 13 }}>{c("Resolution", "Resolución")}: {item.resolution || c("No resolution was recorded.", "No se registró una resolución.")}</Text>}</View>) : <Text style={muted}>{c("No unassigned tasks.", "No hay tareas sin asignar.")}</Text>}
    </View>
  </View>;
}
