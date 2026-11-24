import React, { useEffect, useState } from "react";
import { Dimensions, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateAdminItem = {
  id: string;
  kind: "heading" | "text" | "field" | "button";
  label: string;
  value?: string;
  inputKind?: "input" | "select" | "textarea";
  inputType?: string;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  options?: { value: string; label: string; disabled: boolean }[];
  tone?: "error" | "success";
};

export type GateAdminCard = {
  title: string;
  subtitle: string;
  mode: "create" | "edit";
  busy: boolean;
  es: boolean;
  items: GateAdminItem[];
};

function NativeField({ item, onChange }: { item: GateAdminItem; onChange: (id: string, value: string) => void }) {
  const { primary } = useColors();
  const [value, setValue] = useState(item.value ?? "");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setValue(item.value ?? ""), [item.value]);
  const common = { color: "#ececec", fontSize: 13 } as const;
  const field = { borderColor: primary, borderWidth: 1, borderRadius: 7, minHeight: 38, paddingHorizontal: 9, color: "#ececec" } as const;
  return <View style={{ gap: 5, marginTop: 4 }}>
    <Text style={common}>{item.label}{item.required ? " *" : ""}</Text>
    {item.inputKind === "select" ? <>
      <Pressable accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ disabled: item.disabled, expanded }} disabled={item.disabled} onPress={() => setExpanded(open => !open)} style={{ ...field, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={common}>{item.options?.find(option => option.value === item.value)?.label ?? item.value}</Text><Feather name={expanded ? "chevron-up" : "chevron-down"} size={15} color={primary} /></Pressable>
      {expanded && item.options?.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: item.value === option.value, disabled: option.disabled }} disabled={option.disabled} onPress={() => { setExpanded(false); onChange(item.id, option.value); }} style={{ borderColor: item.value === option.value ? primary : "#4b4b4b", borderWidth: 1, borderRadius: 5, minHeight: 34, paddingHorizontal: 9, justifyContent: "center" }}><Text style={{ ...common, color: option.disabled ? "#777" : "#ececec" }}>{option.label}</Text></Pressable>)}
    </> : <TextInput accessibilityLabel={item.label} value={value} editable={!item.disabled} onChangeText={next => { setValue(next); onChange(item.id, next); }} maxLength={item.maxLength} multiline={item.inputKind === "textarea"} keyboardType={item.inputType === "number" ? "numbers-and-punctuation" : "default"} style={[field, item.inputKind === "textarea" && { minHeight: 74, paddingVertical: 8, textAlignVertical: "top" }]} />}
  </View>;
}

export default function GateMapAdministrationNative({ card, onMode, onChange, onPress }: { card: GateAdminCard; onMode: (mode: "create" | "edit") => void; onChange: (id: string, value: string) => void; onPress: (id: string) => void }) {
  const { primary } = useColors();
  const [modeExpanded, setModeExpanded] = useState(false);
  const text = { color: "#ececec" } as const;
  const button = { borderColor: primary, borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, minHeight: 38, justifyContent: "center" } as const;
  const c = (en: string, es: string) => card.es ? es : en;
  return <View accessibilityLabel={card.title} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, padding: 14 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 10 }}><Feather name="settings" size={19} color={primary} /><View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ ...text, fontSize: 17, fontWeight: "700" }}>{card.title}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{card.subtitle}</Text></View></View>
    <Text style={{ ...text, fontSize: 13, marginBottom: 5 }}>{c("Administrative function", "Función administrativa")}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={c("Administrative function", "Función administrativa")} accessibilityState={{ expanded: modeExpanded, disabled: card.busy }} disabled={card.busy} onPress={() => setModeExpanded(open => !open)} style={[button, { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, opacity: card.busy ? 0.5 : 1 }]}><Text style={text}>{card.mode === "create" ? c("Create Gate", "Crear acceso") : c("Edit a Gate", "Editar un acceso")}</Text><Feather name={modeExpanded ? "chevron-up" : "chevron-down"} size={15} color={primary} /></Pressable>
    {modeExpanded && <View style={{ gap: 5, marginBottom: 8 }}>{(["create", "edit"] as const).map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: card.mode === mode }} onPress={() => { setModeExpanded(false); onMode(mode); }} style={[button, { borderColor: card.mode === mode ? primary : "#555" }]}><Text style={text}>{mode === "create" ? c("Create Gate", "Crear acceso") : c("Edit a Gate", "Editar un acceso")}</Text></Pressable>)}</View>}
    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: Math.max(360, Dimensions.get("window").height - 210) }} contentContainerStyle={{ gap: 6 }}>
      {card.items.map(item => item.kind === "heading" ? <Text key={item.id} accessibilityRole="header" style={{ ...text, borderTopColor: "#444", borderTopWidth: 1, paddingTop: 9, marginTop: 6, fontWeight: "700", fontSize: 15 }}>{item.label}</Text> : item.kind === "text" ? <Text key={item.id} accessibilityRole={item.tone === "error" ? "alert" : "text"} style={{ color: item.tone === "error" ? "#ff8989" : item.tone === "success" ? "#52df92" : "#b3b3b3", fontSize: 12 }}>{item.label}</Text> : item.kind === "field" ? <NativeField key={item.id} item={item} onChange={onChange} /> : <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ disabled: item.disabled, selected: item.pressed }} disabled={item.disabled} onPress={() => onPress(item.id)} style={[button, { alignSelf: "flex-start", opacity: item.disabled ? 0.5 : 1, marginTop: 4 }]}><Text style={text}>{item.label}</Text></Pressable>)}
    </ScrollView>
  </View>;
}
