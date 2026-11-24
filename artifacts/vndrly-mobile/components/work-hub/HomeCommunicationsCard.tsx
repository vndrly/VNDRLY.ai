import React, { useState } from "react";
import { Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import ProviderLogo, { type Provider } from "./ProviderLogo";

type CommunicationKey = "polls" | "channels" | "chats" | "calls" | "meetings" | "notifications" | "emails" | `email:${string}`;

export type CommunicationsCardRow = {
  key: CommunicationKey;
  label: string;
  value: string;
  onPress?: () => void;
  provider?: Provider;
  items?: readonly { key: string; title: string; detail?: string; onPress: () => void }[];
  empty?: string;
  onViewAll?: () => void;
};

function CommunicationIcon({ kind, size = 19, color }: {
  kind: Exclude<CommunicationKey, `email:${string}`> | "heading" | "chevron";
  size?: number;
  color: string;
}) {
  const paths = {
    heading: <Path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />,
    polls: <><Rect x="3" y="3" width="18" height="18" rx="2" /><Path d="m9 12 2 2 4-4" /></>,
    channels: <Path d="M4 9h16M4 15h16M11 3 7 21M17 3l-4 18" />,
    chats: <Path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />,
    calls: <Path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />,
    meetings: <>
      <Path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
      <Rect x="3" y="4" width="18" height="18" rx="2" />
    </>,
    notifications: <><Path d="M10.268 21a2 2 0 0 0 3.464 0" /><Path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
    emails: <><Path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /><Rect x="2" y="4" width="20" height="16" rx="2" /></>,
    chevron: <Path d="m9 18 6-6-6-6" />,
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</Svg>;
}

export default function HomeCommunicationsCard({ title, subtitle, rows }: {
  title: string;
  subtitle: string;
  rows: readonly CommunicationsCardRow[];
}) {
  const { primary } = useColors();
  const [expandedRow, setExpandedRow] = useState<CommunicationKey | null>(null);
  return <View accessibilityLabel={title} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 12 }}>
      <CommunicationIcon kind="heading" size={20} color={primary} />
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 24, fontWeight: "700" }}>{title}</Text>
        <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
      </View>
    </View>
    {rows.map(row => row.provider && expandedRow !== "emails" ? null : <React.Fragment key={row.key}><Pressable accessibilityRole={row.provider ? "link" : "button"} accessibilityLabel={row.label} accessibilityState={row.provider ? undefined : { expanded: expandedRow === row.key }} onPress={row.provider ? row.onPress : () => setExpandedRow(current => current === row.key ? null : row.key)} style={({ pressed }) => ({ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, paddingLeft: row.provider ? 24 : 0, opacity: pressed ? 0.72 : 1 })}>
      {row.provider ? <ProviderLogo provider={row.provider} size={19} /> : <CommunicationIcon kind={row.key as Exclude<CommunicationKey, `email:${string}`>} color={primary} />}
      <Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600", flex: 1 }}>{row.label}</Text>
      <Text style={{ color: "#b3b3b3", fontSize: 13, textAlign: "right", maxWidth: "45%" }}>{row.value}</Text>
      <View style={!row.provider && expandedRow === row.key ? { transform: [{ rotate: "90deg" }] } : undefined}><CommunicationIcon kind="chevron" size={18} color="#a3a3a3" /></View>
    </Pressable>
    {expandedRow === row.key && !row.provider && row.key !== "emails" && <View style={{ paddingLeft: 30, paddingBottom: 8 }}>
      {row.items?.length ? row.items.map(item => <Pressable key={item.key} accessibilityRole="link" accessibilityLabel={item.title} onPress={item.onPress} style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingVertical: 9 }}><Text style={{ color: "#ececec", fontSize: 14, fontWeight: "600" }}>{item.title}</Text>{item.detail ? <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{item.detail}</Text> : null}</Pressable>) : <Text style={{ color: "#b3b3b3", paddingVertical: 9 }}>{row.empty ?? "No items."}</Text>}
      {row.onViewAll && <Pressable accessibilityRole="link" accessibilityLabel={`View all ${row.label}`} onPress={row.onViewAll} style={{ paddingVertical: 9 }}><Text style={{ color: primary, fontWeight: "600" }}>View all {row.label}</Text></Pressable>}
    </View>}
    </React.Fragment>)}
  </View>;
}
