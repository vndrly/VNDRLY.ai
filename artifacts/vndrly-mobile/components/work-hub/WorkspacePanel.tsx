import React, { useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

type Icon = React.ComponentProps<typeof Feather>["name"];

/** Native counterpart of web Work Hub's workspace-panel and home.css. */
export function WorkspacePanel({ title, titleContent, subtitle, icon, iconElement, action, children, collapsible = true, subtitleBelowHeader = false }: {
  title: string;
  titleContent?: React.ReactNode;
  subtitle: string;
  icon: Icon;
  iconElement?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  subtitleBelowHeader?: boolean;
}) {
  const { primary } = useColors();
  const [expanded, setExpanded] = useState(true);
  return <View accessibilityLabel={title} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: subtitleBelowHeader ? 0 : 12 }}>
      {collapsible ? <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      {iconElement ?? <Feather name={icon} size={20} color={primary} />}
      <View style={{ flex: 1 }}>
        {titleContent ?? <Text accessibilityRole="header" style={{ color: "#ececec", fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 24, fontWeight: "700" }}>{title}</Text>}
        {!subtitleBelowHeader && <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      <Feather name="chevron-right" size={18} color="#a3a3a3" style={expanded ? { transform: [{ rotate: "90deg" }] } : undefined} />
      </Pressable> : <>{iconElement ?? <Feather name={icon} size={20} color={primary} />}<View style={{ flex: 1 }}>{titleContent ?? <Text accessibilityRole="header" style={{ color: "#ececec", fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 24, fontWeight: "700" }}>{title}</Text>}{!subtitleBelowHeader && <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}</View></>}
      {action && <View style={{ marginLeft: "auto", alignSelf: "flex-start" }}>{action}</View>}
    </View>
    {subtitleBelowHeader && <Text style={{ color: "#a3a3a3", fontSize: 12, marginLeft: 28, marginBottom: 12, marginTop: 2 }}>{subtitle}</Text>}
    {(!collapsible || expanded) && children}
  </View>;
}

export function WorkspaceRow({ icon, label, detail, value, onPress, expanded, testID, topAligned = false }: {
  icon: Icon;
  label: string;
  detail?: string;
  value?: string;
  onPress: () => void;
  expanded?: boolean;
  testID?: string;
  topAligned?: boolean;
}) {
  const { primary } = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress} testID={testID}
    style={({ pressed }) => ({ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: topAligned ? "flex-start" : "center", gap: 11, paddingVertical: 10, opacity: pressed ? 0.72 : 1 })}>
    <Feather name={icon} size={19} color={primary} style={topAligned ? { marginTop: 1 } : undefined} />
    <View style={{ flex: 1 }}><Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600" }}>{label}</Text>{detail ? <Text style={{ color: "#b3b3b3", fontSize: 12, marginTop: 3 }}>{detail}</Text> : null}</View>
    {value ? <Text style={{ color: "#b3b3b3", fontSize: 13, textAlign: "right", maxWidth: "45%", marginTop: topAligned ? 2 : 0 }}>{value}</Text> : null}
    <Feather name="chevron-right" size={18} color="#a3a3a3" style={[topAligned ? { marginTop: 1 } : undefined, expanded ? { transform: [{ rotate: "90deg" }] } : undefined]} />
  </Pressable>;
}
