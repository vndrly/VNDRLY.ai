import React from "react";
import { Text, View } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export default function LibraryMiniCardButton({
  children,
  onPress,
  disabled = false,
  solid = false,
  accessibilityLabel,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  solid?: boolean;
  color?: "brand" | "blue" | "green" | "red";
  accessibilityLabel?: string;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: solid, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 40,
        minWidth: 0,
        maxWidth: "100%",
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignSelf: "flex-start",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 8,
        backgroundColor: pressed || solid ? "#3a3d42" : "#2b2b2f",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ minWidth: 0 }}><Text style={{ color: solid ? colors.primary : "#ececec", fontSize: 12, fontWeight: "600" }}>{children}</Text></View>
    </Pressable>
  );
}
