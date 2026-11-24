import React, { useEffect, useState } from "react";
import { Image, ScrollView, Text, TextInput, View } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type AdminDialogItem = {
  id: string;
  parentId?: string;
  kind: "text" | "heading" | "button" | "input" | "toggle" | "select" | "option" | "link" | "range";
  label: string;
  value?: string;
  inputType?: string;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  min?: number;
  max?: number;
};
export type AdminDialog = { title: string; description: string; logo?: string; items: AdminDialogItem[] };

function DialogInput({ item, field, onAction }: { item: AdminDialogItem; field: object; onAction: (id: string, action: "press" | "change", value?: string) => void }) {
  const [value, setValue] = useState(item.value ?? "");
  useEffect(() => setValue(item.value ?? ""), [item.value]);
  return <View style={{ gap: 4 }}><Text style={{ color: "#ececec", fontSize: 12 }}>{item.label}</Text><TextInput accessibilityLabel={item.label} value={value} editable={!item.disabled} keyboardType={item.inputType === "number" ? "decimal-pad" : "default"} autoCapitalize="none" onChangeText={next => { setValue(next); onAction(item.id, "change", next); }} style={field} /></View>;
}

export default function GateDashboardAdminDialogNative({ dialog, onAction }: {
  dialog: AdminDialog;
  onAction: (id: string, action: "press" | "change", value?: string) => void;
}) {
  const { primary } = useColors();
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const field = { borderWidth: 1, borderColor: primary, borderRadius: 8, backgroundColor: "#2b2b2f", color: "#ececec", paddingHorizontal: 10, minHeight: 42 } as const;
  return <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#000b", justifyContent: "center", alignItems: "center", padding: 18, zIndex: 90 }}>
    <View accessibilityLabel={dialog.title} style={{ width: "100%", maxWidth: 600, maxHeight: "85%", backgroundColor: "#242426", borderColor: primary, borderWidth: 1, borderRadius: 14, padding: 16 }}>
      {!!dialog.logo && <Image source={{ uri: dialog.logo }} resizeMode="contain" accessibilityLabel="Company logo" style={{ width: 80, height: 80, alignSelf: "center", marginBottom: 6 }} />}
      <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700", paddingBottom: 5 }}>{dialog.title}</Text>
      {!!dialog.description && <Text style={{ color: "#b3b3b3", paddingBottom: 12 }}>{dialog.description}</Text>}
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
        {dialog.items.map(item => {
          if (item.kind === "text" || item.kind === "heading") return <Text key={item.id} style={{ color: "#ececec", fontSize: item.kind === "heading" ? 15 : 13, fontWeight: item.kind === "heading" ? "700" : "400" }}>{item.label}</Text>;
          if (item.kind === "input") return <DialogInput key={item.id} item={item} field={field} onAction={onAction} />;
          if (item.kind === "option" && item.parentId && openSelect !== item.parentId) return null;
          if (item.kind === "range") return <View key={item.id} style={{ gap: 5 }}><Text style={{ color: "#ececec" }}>{item.label}: {item.value}</Text><View style={{ flexDirection: "row", gap: 10 }}>{["−", "+"].map((sign, index) => <Pressable key={sign} accessibilityRole="button" accessibilityLabel={`${index ? "Increase" : "Decrease"} ${item.label}`} disabled={item.disabled || Number(item.value) <= (item.min ?? 0) && !index || Number(item.value) >= (item.max ?? 2) && !!index} onPress={() => onAction(item.id, "change", String(Number(item.value) + (index ? 1 : -1)))} style={{ padding: 10, borderColor: primary, borderWidth: 1, borderRadius: 8 }}><Text style={{ color: "#ececec" }}>{sign}</Text></Pressable>)}</View></View>;
          const selectedOption = item.kind === "select" ? dialog.items.find(next => next.parentId === item.id && next.selected)?.label : undefined;
          const displayLabel = item.kind === "select" && selectedOption ? `${item.label}: ${selectedOption}` : item.label;
          return <Pressable key={item.id} accessibilityRole={item.kind === "toggle" ? "switch" : "button"} accessibilityLabel={displayLabel} accessibilityState={{ disabled: !!item.disabled, checked: item.kind === "toggle" ? !!item.checked : undefined, selected: item.kind === "option" ? !!item.selected : undefined, expanded: item.kind === "select" ? openSelect === item.id : undefined }} disabled={item.disabled} onPress={() => { if (item.kind === "select" && dialog.items.some(next => next.parentId === item.id)) setOpenSelect(current => current === item.id ? null : item.id); else { onAction(item.id, "press"); if (item.kind === "option") setOpenSelect(null); } }} style={{ minHeight: 40, borderColor: item.selected || item.checked ? primary : "#55555a", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: item.disabled ? "#a3a3a3" : "#ececec", fontSize: 13, flexShrink: 1 }}>{displayLabel}</Text>{item.kind === "toggle" && <Text style={{ color: item.checked ? "#86efac" : "#a3a3a3" }}>{item.checked ? "On" : "Off"}</Text>}{item.kind === "select" && <Text style={{ color: primary }}>⌄</Text>}</Pressable>;
        })}
      </ScrollView>
    </View>
  </View>;
}
