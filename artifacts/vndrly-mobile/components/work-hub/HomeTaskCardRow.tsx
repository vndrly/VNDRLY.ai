import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type TaskCardIcon = "tasks" | "new" | "unassigned" | "unstarted" | "progress" | "stale" | "completed" | "hours";

export function TaskIcon({ kind, size = 19 }: { kind: TaskCardIcon | "chevron"; size?: number }) {
  const { primary } = useColors();
  const shapes = {
    tasks: <><Rect x="3" y="3" width="18" height="18" rx="2" /><Path d="m9 12 2 2 4-4" /></>,
    new: <><Path d="M10.268 21a2 2 0 0 0 3.464 0" /><Path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
    unassigned: <><Rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>,
    unstarted: <><Circle cx="12" cy="12" r="10" /><Line x1="10" x2="10" y1="15" y2="9" /><Line x1="14" x2="14" y1="15" y2="9" /></>,
    progress: <><Path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" /><Circle cx="12" cy="12" r="10" /></>,
    stale: <Path d="M12 6v6l4 2M20 12v5M20 21h.01M21.25 8.2A10 10 0 1 0 16 21.16" />,
    completed: <><Circle cx="12" cy="12" r="10" /><Path d="m9 12 2 2 4-4" /></>,
    hours: <><Path d="M12 6v6h4" /><Circle cx="12" cy="12" r="10" /></>,
    chevron: <Path d="m9 18 6-6-6-6" />,
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={kind === "chevron" ? "#a3a3a3" : primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{shapes[kind]}</Svg>;
}

export default function HomeTaskCardRow({ kind, label, value, onPress, expanded, company = false }: {
  kind: TaskCardIcon;
  label: string;
  value: string;
  onPress: () => void;
  expanded: boolean;
  company?: boolean;
}) {
  const parts = value.split(" | ");
  const decoratedValue = parts.length > 1
    ? parts.map((part, index) => <React.Fragment key={index}>{index ? " | " : ""}<Text style={{ color: kind === "stale" && index === parts.length - 1 ? "#fbbf24" : company && index === 0 ? "#4ade80" : "#b3b3b3" }}>{part}</Text></React.Fragment>)
    : value;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, opacity: pressed ? 0.72 : 1 })}>
    <TaskIcon kind={kind} />
    <Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600", flex: 1 }}>{label}</Text>
    <Text style={{ color: kind === "unassigned" ? "#fbbf24" : "#b3b3b3", fontSize: kind === "hours" ? 12 : 13, textAlign: "right", maxWidth: kind === "hours" ? undefined : kind === "stale" ? "60%" : "45%" }}>{decoratedValue}</Text>
    <View style={expanded ? { transform: [{ rotate: "90deg" }] } : undefined}><TaskIcon kind="chevron" size={18} /></View>
  </Pressable>;
}
