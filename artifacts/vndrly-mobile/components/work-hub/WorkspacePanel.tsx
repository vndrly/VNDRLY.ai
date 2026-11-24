import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

type Icon = React.ComponentProps<typeof Feather>["name"];

/** Native counterpart of web Work Hub's workspace-panel and home.css. */
export function WorkspacePanel({ title, titleContent, subtitle, icon, iconElement, action, children }: {
  title: string;
  titleContent?: React.ReactNode;
  subtitle: string;
  icon: Icon;
  iconElement?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { primary } = useColors();
  return <View accessibilityLabel={title} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 12 }}>
      {iconElement ?? <Feather name={icon} size={20} color={primary} />}
      <View style={{ flex: 1 }}>
        {titleContent ?? <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 19, fontWeight: "700" }}>{title}</Text>}
        <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
      </View>
      {action}
    </View>
    {children}
  </View>;
}

export function WorkspaceRow({ icon, label, detail, value, onPress, expanded, testID }: {
  icon: Icon;
  label: string;
  detail?: string;
  value?: string;
  onPress: () => void;
  expanded?: boolean;
  testID?: string;
}) {
  const { primary } = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress} testID={testID}
    style={({ pressed }) => ({ minHeight: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, opacity: pressed ? 0.72 : 1 })}>
    <Feather name={icon} size={19} color={primary} />
    <View style={{ flex: 1 }}><Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600" }}>{label}</Text>{detail ? <Text style={{ color: "#b3b3b3", fontSize: 12, marginTop: 3 }}>{detail}</Text> : null}</View>
    {value ? <Text style={{ color: "#b3b3b3", fontSize: 13, textAlign: "right", maxWidth: "45%" }}>{value}</Text> : null}
    <Feather name="chevron-right" size={18} color="#a3a3a3" style={expanded ? { transform: [{ rotate: "90deg" }] } : undefined} />
  </Pressable>;
}
