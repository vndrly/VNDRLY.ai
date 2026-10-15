import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
import WorkHubConversation from "./WorkHubConversation";

type Row = Record<string, any>;
type Props = { channels: Row[]; groups: Row[]; people: Row[]; selected: Row | null; onSelect: (row: Row | null) => void; onTarget: (kind: "group" | "person", id: string) => void; onStart: () => void; target: string; busy: boolean; notice: string };
export default function WorkHubChatInbox({ channels, groups, people, selected, onSelect, onTarget, onStart, target, busy, notice }: Props) {
  const colors = useColors();
  const wide = useWindowDimensions().width >= 900;
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState(false);
  const [kind, setKind] = useState<"person" | "group">("person");
  const [targetQuery, setTargetQuery] = useState("");
  const searchStyle = { borderWidth: 2, borderColor: colors.primary, borderRadius: 12, padding: 12, minHeight: 44, color: colors.text };
  const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  const filtered = channels.filter(row => String(row.name ?? row.title ?? "").toLowerCase().includes(query.toLowerCase()));
  const targets = (kind === "group" ? groups : people).filter(row => [row.name, row.displayName, row.organizationName, row.role].filter(Boolean).join(" ").toLowerCase().includes(targetQuery.toLowerCase()));
  const list = <View style={{ gap: 12, width: wide ? 300 : undefined, flex: wide ? undefined : 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>Conversations</Text><TogglePillButton color="brand" accessibilityLabel="New chat" onPress={() => { onTarget(kind, ""); setPicker(true); }}>＋ New</TogglePillButton></View>
    <TextInput accessibilityLabel="Search conversations" placeholder="Search conversations" placeholderTextColor={colors.mutedForeground} value={query} onChangeText={setQuery} style={searchStyle} />
    <ScrollView style={{ maxHeight: wide ? 620 : undefined }}>
      {filtered.map(row => { const name = row.name ?? row.title ?? "Conversation"; const active = selected?.id === row.id; return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Open ${name}`} accessibilityState={{ selected: active }} onPress={() => onSelect(row)} style={{ flexDirection: "row", gap: 12, paddingVertical: 16, paddingHorizontal: 10, borderRadius: 12, backgroundColor: active ? colors.card : "transparent", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.primary, fontWeight: "700" }}>{initials(name)}</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>{name}</Text><Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{typeof row.lastMessage === "string" ? row.lastMessage : row.lastMessage?.body ?? row.description ?? "Open conversation"}</Text></View>
        {Number(row.unreadCount) > 0 && <Text style={{ color: colors.primary, fontWeight: "700" }}>{row.unreadCount}</Text>}
      </Pressable>; })}
      {!filtered.length && <View style={{ padding: 24, gap: 8 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{query ? "No matching conversations" : "Your conversations start here"}</Text><Text style={{ color: colors.mutedForeground }}>Choose ＋ New to contact a person or open a group.</Text></View>}
    </ScrollView>
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text>}
  </View>;
  return <View style={{ gap: 16 }}>
    <View style={{ flexDirection: wide ? "row" : "column", gap: 20, alignItems: "stretch" }}>
      {(wide || !selected) && list}
      {selected ? <View style={{ flex: 1, minWidth: 0 }}><WorkHubConversation channel={selected} onClose={() => onSelect(null)} /></View> : wide && <View style={{ flex: 1, padding: 40, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.card }}><Text style={{ color: colors.text, fontSize: 22, fontWeight: "700" }}>Keep your team connected</Text><Text style={{ color: colors.mutedForeground, marginTop: 10 }}>Select a conversation or start a new one.</Text></View>}
    </View>
    <Modal visible={picker} transparent animationType="fade" onRequestClose={() => !busy && setPicker(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: 20 }}><View style={{ width: "100%", maxWidth: 520, maxHeight: "85%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 2, borderColor: colors.primary, padding: 20, gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: colors.text, fontSize: 22, fontWeight: "700" }}>New chat</Text><Pressable accessibilityRole="button" accessibilityLabel="Close new chat" disabled={busy} onPress={() => setPicker(false)} style={{ padding: 12 }}><Text style={{ color: colors.text }}>✕</Text></Pressable></View>
        <View style={{ flexDirection: "row", gap: 10 }}>{(["person", "group"] as const).map(value => <TogglePillButton key={value} color="brand" solid={kind === value} accessibilityState={{ selected: kind === value }} onPress={() => { setKind(value); onTarget(value, ""); }}>{value === "person" ? "People" : "Groups"}</TogglePillButton>)}</View>
        <TextInput accessibilityLabel="Search chat recipients" placeholder="Search by name, company, or role" placeholderTextColor={colors.mutedForeground} value={targetQuery} onChangeText={setTargetQuery} style={searchStyle} />
        <ScrollView>{targets.map(row => { const name = row.displayName ?? row.name; const active = target === String(row.id); return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Select ${name}`} accessibilityState={{ selected: active }} onPress={() => onTarget(kind, String(row.id))} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", gap: 12 }}><Text style={{ color: colors.primary }}>{active ? "●" : "○"}</Text><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{name}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{[row.organizationName, row.role].filter(Boolean).join(" · ") || "Group conversation"}</Text></View></Pressable>; })}{!targets.length && <Text style={{ color: colors.mutedForeground, padding: 16 }}>No matching recipients</Text>}</ScrollView>
        <TogglePillButton color="brand" disabled={!target || busy} loading={busy} onPress={() => { onStart(); setPicker(false); }}>{kind === "group" ? "Open group chat" : "Send invitation"}</TogglePillButton>
      </View></View>
    </Modal>
  </View>;
}
