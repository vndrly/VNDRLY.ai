import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export const gateStyle = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 30 },
  card: {
    backgroundColor: "#242426",
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 9 },
  title: { fontSize: 17, fontWeight: "700", color: "#ececec", flex: 1 },
  text: { color: "#ececec", fontSize: 14 },
  muted: { color: "#b3b3b3", fontSize: 12 },
  input: {
    backgroundColor: "#303034",
    borderWidth: 1,
    borderColor: "#626268",
    borderRadius: 8,
    color: "#ececec",
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  row: {
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: "#3a3a3a",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});

export function GateCard({
  title,
  subtitle,
  icon = "grid",
  children,
  headerAction,
  onHeaderPress,
  expanded,
  testID,
}: {
  title: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  onHeaderPress?: () => void;
  expanded?: boolean;
  testID?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  children: React.ReactNode;
}) {
  const colors = useColors();
  const heading = (
    <View style={gateStyle.heading}>
      <Feather name={icon} size={20} color={colors.primary} />
      <Text accessibilityRole="header" style={gateStyle.title}>
        {title}
      </Text>
    </View>
  );
  const headerTitle = onHeaderPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
      onPress={onHeaderPress} style={gateStyle.heading}>
      <View style={{ flex: 1 }}>{heading}</View>
      <Feather name={expanded ? "chevron-down" : "chevron-right"} size={18} color={colors.primary} />
    </Pressable>
  ) : heading;
  return (
    <View style={[gateStyle.card, { borderColor: colors.primary }]} testID={testID}>
      {headerAction ? (
        <View style={gateStyle.heading}>
          <View style={{ flex: 1, alignSelf: "flex-start", gap: gateStyle.card.gap }}>
            {headerTitle}
            {subtitle && <Text style={gateStyle.muted}>{subtitle}</Text>}
          </View>
          {headerAction}
        </View>
      ) : (
        <>
          {headerTitle}
          {subtitle && <Text style={gateStyle.muted}>{subtitle}</Text>}
        </>
      )}
      {children}
    </View>
  );
}
