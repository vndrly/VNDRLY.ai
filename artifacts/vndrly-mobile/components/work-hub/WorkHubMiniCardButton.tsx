import React from "react";
import { ActivityIndicator, Text, View, useWindowDimensions } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import type { TogglePillButtonProps } from "@/components/TogglePillButton";
export type { TogglePillButtonProps } from "@/components/TogglePillButton";

/** The Work Hub mini-card action keeps the pill button's children and action contract. */
export default function WorkHubMiniCardButton({ children, compactOnTablet, onPress, disabled, loading, style, textStyle, testID, accessibilityLabel, accessibilityState, solid, inactive }: TogglePillButtonProps) {
  const { primary } = useColors();
  const { width } = useWindowDimensions();
  const labelParts = React.Children.toArray(children);
  const plainLabel = labelParts.every(part => typeof part === "string" || typeof part === "number") ? labelParts.join("") : undefined;
  const isDisabled = Boolean(disabled || loading);
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? plainLabel}
    accessibilityState={{ ...accessibilityState, disabled: isDisabled, busy: Boolean(loading || accessibilityState?.busy) }}
    disabled={isDisabled}
    onPress={onPress}
    testID={testID}
    style={({ pressed }) => [
      { minHeight: 44, minWidth: 44, borderWidth: 1, borderColor: primary, borderRadius: 8, backgroundColor: pressed || solid ? "#353539" : "#2b2b2f", paddingVertical: 7, paddingHorizontal: 10, alignItems: "center" as const, justifyContent: "center" as const, opacity: isDisabled && !inactive ? 0.5 : 1 },
      style,
      compactOnTablet && width >= 768 ? { alignSelf: "flex-start" as const, flexGrow: 0, flexBasis: "auto" as const, minWidth: 160, maxWidth: 320 } : null,
      { borderRadius: 8 },
    ]}
  >
    {loading ? <ActivityIndicator size="small" color="#ececec" /> : plainLabel !== undefined ? <Text style={[{ color: "#ececec", fontSize: 12, fontWeight: "600" }, textStyle]}>{plainLabel}</Text> : <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>{children}</View>}
  </Pressable>;
}
