import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";

export default function ProfileMiniCardButton({ children, borderColor, onPress, loading = false, disabled, testID, inHeader = false, numberOfLines, accessibilityLabel, selected, icon }: {
  children: string;
  icon?: React.ReactNode;
  borderColor: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  inHeader?: boolean;
  numberOfLines?: number;
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ busy: loading, disabled: disabled || loading, selected }}
      aria-pressed={selected}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.miniCardButton,
        inHeader && { marginTop: 0, alignSelf: "center" },
        { borderColor, opacity: disabled || loading ? 0.5 : 1 },
        selected && { backgroundColor: "#3a3d42" },
        pressed && { backgroundColor: "#353539" },
      ]}
    >
      {loading && <ActivityIndicator size="small" color={borderColor} />}
      {icon}
      <Text style={[styles.miniCardLabel, selected && { color: borderColor }]} numberOfLines={numberOfLines}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  miniCardButton: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    minWidth: 0,
    maxWidth: "100%",
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: "#2b2b2f",
  },
  miniCardLabel: { color: "#ececec", fontSize: 12, fontWeight: "600", flexShrink: 1, minWidth: 0 },
});
