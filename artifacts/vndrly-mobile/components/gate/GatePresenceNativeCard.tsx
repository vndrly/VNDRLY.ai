import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import AuthedImage from "@/components/AuthedImage";

export type PresenceNode = {
  kind: "group" | "header" | "text" | "action" | "select" | "input" | "photo" | "record" | "image" | "loading";
  id?: string; text?: string; value?: string; disabled?: boolean; pressed?: boolean; alert?: boolean; uri?: string;
  options?: { value: string; label: string; disabled: boolean }[]; children?: PresenceNode[];
};
export type GatePresenceCard = {
  top: number; left: number; width: number; height: number; active: boolean;
  tabs: { id: string; label: string; count: string; pressed: boolean; alert: boolean; disabled: boolean }[];
  refresh: { id: string; label: string; disabled: boolean } | null;
  items: PresenceNode[]; history: { id: string; label: string } | null;
  dialog: { title: string; description: string; items: PresenceNode[]; closeId: string } | null;
  es: boolean;
};

function NativeInput({ node, onChange }: { node: PresenceNode; onChange: (id: string, value: string) => void }) {
  const { primary } = useColors();
  const [value, setValue] = useState(node.value ?? "");
  useEffect(() => setValue(node.value ?? ""), [node.value]);
  return <View style={{ gap: 4 }}><Text style={{ color: "#ddd", fontSize: 12 }}>{node.text}</Text><TextInput accessibilityLabel={node.text} value={value} editable={!node.disabled} onChangeText={next => { setValue(next); onChange(node.id!, next); }} multiline={node.kind === "input" && node.text?.toLowerCase().includes("note")} style={{ color: "#fff", backgroundColor: "#303236", borderWidth: 1, borderColor: primary, borderRadius: 6, minHeight: 38, paddingHorizontal: 9 }} /></View>;
}

function NativeSelect({ node, onChange }: { node: PresenceNode; onChange: (id: string, value: string) => void }) {
  const { primary } = useColors();
  const [open, setOpen] = useState(false);
  const selected = node.options?.find(option => option.value === node.value);
  return <View style={{ gap: 5 }}><Text style={{ color: "#ccc", fontSize: 12 }}>{node.text}</Text><Pressable accessibilityRole="button" accessibilityLabel={node.text} accessibilityState={{ expanded: open, disabled: !!node.disabled }} disabled={node.disabled} onPress={() => setOpen(!open)} style={{ borderColor: primary, borderWidth: 1, borderRadius: 6, padding: 8, flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: "#eee", fontSize: 12 }}>{selected?.label ?? node.value}</Text><Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={primary} /></Pressable>{open && node.options?.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === node.value, disabled: option.disabled }} disabled={option.disabled} onPress={() => { setOpen(false); onChange(node.id!, option.value); }} style={{ borderColor: "#555", borderWidth: 1, borderRadius: 5, padding: 7 }}><Text style={{ color: option.disabled ? "#888" : "#eee", fontSize: 12 }}>{option.label}</Text></Pressable>)}</View>;
}

function NativeNode({ node, onPress, onChange, onPhoto, es, depth = 0 }: { node: PresenceNode; onPress: (id: string) => void; onChange: (id: string, value: string) => void; onPhoto: (visitId: string, base64: string, mime: string) => void; es: boolean; depth?: number }) {
  const { primary } = useColors();
  if (node.kind === "loading") return <ActivityIndicator color={primary} />;
  if (node.kind === "text") return <Text style={{ color: node.alert ? "#f59e0b" : depth === 0 ? "#eee" : "#ccc", fontSize: depth === 0 ? 14 : 12, fontWeight: depth === 0 ? "600" : "400" }}>{node.text}</Text>;
  if (node.kind === "image") return <AuthedImage uri={node.uri ?? ""} resizeMode="contain" style={{ width: "100%", height: 140 }} fallback={<Text style={{ color: "#aaa" }}>{es ? "Foto no disponible" : "Photo unavailable"}</Text>} />;
  if (node.kind === "input") return <NativeInput node={node} onChange={onChange} />;
  if (node.kind === "select") return <NativeSelect node={node} onChange={onChange} />;
  if (node.kind === "photo") return <Pressable accessibilityRole="button" accessibilityLabel={node.text} disabled={node.disabled} onPress={async () => { try { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { Alert.alert(es ? "Se necesita permiso de cámara" : "Camera permission required"); return; } const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], base64: true, quality: .65 }); const asset = result.assets?.[0]; if (!result.canceled && asset?.base64) onPhoto(node.id!, asset.base64, asset.mimeType === "image/png" ? "image/png" : "image/jpeg"); } catch { Alert.alert(es ? "No se pudo capturar la foto" : "Photo capture failed"); } }} style={{ borderColor: primary, borderWidth: 1, borderRadius: 6, padding: 7, opacity: node.disabled ? .5 : 1 }}><Text style={{ color: "#eee", fontSize: 12 }}>{node.text}</Text></Pressable>;
  if (node.kind === "action") return <Pressable accessibilityRole="button" accessibilityLabel={node.text} accessibilityState={{ disabled: !!node.disabled, selected: !!node.pressed }} disabled={node.disabled} onPress={() => onPress(node.id!)} style={{ borderColor: primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 9, minHeight: 34, justifyContent: "center", backgroundColor: node.pressed ? "#135c68" : "#292b2e", opacity: node.disabled ? .5 : 1 }}><Text style={{ color: node.alert ? "#fbbf24" : "#eee", fontSize: 12, fontWeight: "600" }}>{node.text}</Text></Pressable>;
  if (node.kind === "header") return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}><View style={{ flex: 1, minWidth: 110 }}>{node.children?.[0]?.children?.map((child, index) => <NativeNode key={`${child.id ?? child.kind}-${index}`} node={child} onPress={onPress} onChange={onChange} onPhoto={onPhoto} es={es} depth={depth + 1} />)}</View><View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 5 }}>{node.children?.[1]?.children?.map((child, index) => <NativeNode key={`${child.id ?? child.kind}-${index}`} node={child} onPress={onPress} onChange={onChange} onPhoto={onPhoto} es={es} depth={depth + 1} />)}</View></View>;
  return <View pointerEvents="box-none" style={{ gap: node.kind === "record" ? 7 : 5, borderWidth: node.kind === "record" ? 1 : 0, borderColor: "#4b4c4e", borderRadius: 7, padding: node.kind === "record" ? 9 : 0, marginLeft: Math.min(depth, 2) * 2 }}>{node.children?.map((child, index) => <NativeNode key={`${child.id ?? child.kind}-${index}`} node={child} onPress={onPress} onChange={onChange} onPhoto={onPhoto} es={es} depth={depth + 1} />)}</View>;
}

export default function GatePresenceNativeCard({ card, onPress, onChange, onPhoto, onCloseDialog }: { card: GatePresenceCard; onPress: (id: string) => void; onChange: (id: string, value: string) => void; onPhoto: (visitId: string, base64: string, mime: string) => void; onCloseDialog: () => void }) {
  const { primary } = useColors();
  return <><View pointerEvents="box-none" style={{ height: card.height, backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 10, overflow: "hidden" }}>
    <View style={{ padding: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, borderBottomColor: "#444", borderBottomWidth: 1 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginRight: 4 }}><Feather name="list" size={17} color={primary} /><Text accessibilityRole="header" style={{ color: "#eee", fontSize: 16, fontWeight: "600" }}>{card.es ? "Registro de accesos" : "Gate log"}</Text></View><View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{card.tabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: tab.pressed, disabled: tab.disabled }} disabled={tab.disabled} onPress={() => onPress(tab.id)} style={{ borderWidth: 1, borderColor: primary, borderRadius: 6, backgroundColor: tab.pressed ? "#135c68" : "#303236", padding: 7, flexDirection: "row", gap: 5 }}><Text style={{ color: tab.alert ? "#fbbf24" : "#eee", fontWeight: "600", fontSize: 12 }}>{tab.label}</Text><Text style={{ color: primary, fontSize: 12 }}>{tab.count}</Text></Pressable>)}</View>{card.refresh && <Pressable accessibilityRole="button" accessibilityLabel={card.refresh.label} disabled={card.refresh.disabled} onPress={() => onPress(card.refresh!.id)} style={{ padding: 8 }}><Feather name="refresh-cw" size={17} color={primary} /></Pressable>}</View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 10, gap: 9 }} style={{ flex: 1 }}>{card.items.map((item, index) => <NativeNode key={`${item.id ?? item.kind}-${index}`} node={item} onPress={onPress} onChange={onChange} onPhoto={onPhoto} es={card.es} />)}</ScrollView>
    {card.history && <Pressable accessibilityRole="link" accessibilityLabel={card.history.label} onPress={() => onPress(card.history!.id)} style={{ padding: 10, alignItems: "flex-end", borderTopColor: "#444", borderTopWidth: 1 }}><Text style={{ color: primary, fontSize: 12, fontWeight: "600" }}>{card.history.label}</Text></Pressable>}
  </View><Modal transparent visible={!!card.dialog} animationType="fade" onRequestClose={onCloseDialog}><View style={{ flex: 1, backgroundColor: "#000c", justifyContent: "center", padding: 18 }}><View style={{ maxHeight: "85%", backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 10, padding: 14, gap: 7 }}><View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Text accessibilityRole="header" style={{ color: "#eee", fontWeight: "700", fontSize: 18, flex: 1 }}>{card.dialog?.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={card.es ? "Cerrar" : "Close"} onPress={onCloseDialog}><Feather name="x" size={20} color={primary} /></Pressable></View><Text style={{ color: "#aaa", fontSize: 12 }}>{card.dialog?.description}</Text><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>{card.dialog?.items.map((item, index) => <NativeNode key={`${item.id ?? item.kind}-${index}`} node={item} onPress={onPress} onChange={onChange} onPhoto={onPhoto} es={card.es} />)}</ScrollView></View></View></Modal></>;
}
