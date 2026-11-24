import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateLogRecord = {
  id: string;
  name: string;
  description: string;
  status: string;
  overdue: boolean;
  flags: { key: string; label: string; title: string }[];
  footer: string | null;
  actionLabel: string;
  actionDisabled: boolean;
  checkedIn: string | null;
  checkedOut: string | null;
  duration: string | null;
};

export default function GateLogRecordNative({ record, onOpen, onAction }: { record: GateLogRecord; onOpen: () => void; onAction: () => void }) {
  const { primary } = useColors();
  return <View accessibilityLabel={record.name} style={{ borderColor: record.overdue ? "#f59e0b" : "#555", borderWidth: 1, borderRadius: 7, backgroundColor: "#242426" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={record.name} onPress={onOpen} style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700", flex: 1 }}>{record.name}</Text><Text style={{ color: record.status === "Admitted" ? "#11c66c" : "#ececec", fontSize: 12 }}>{record.status}</Text></View>
      {!!record.description && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{record.description}</Text>}
      {!!record.checkedIn && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{record.checkedIn}</Text>}
      {!!record.checkedOut && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{record.checkedOut}</Text>}
      {!!record.duration && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{record.duration}</Text>}
    </Pressable>
    {(record.flags.length > 0 || record.footer || record.actionLabel) && <View style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1, gap: 3 }}>{record.flags.map(flag => <View key={flag.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Feather name="alert-triangle" size={13} color="#f59e0b" /><Text style={{ color: "#ececec", fontSize: 12 }}>{flag.label}</Text></View>)}{!!record.footer && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{record.footer}</Text>}</View>
      {!!record.actionLabel && <Pressable accessibilityRole="button" disabled={record.actionDisabled} onPress={onAction} style={{ borderColor: primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, opacity: record.actionDisabled ? 0.4 : 1 }}><Text style={{ color: "#ececec", fontSize: 12 }}>{record.actionLabel}</Text></Pressable>}
    </View>}
  </View>;
}
