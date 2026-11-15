import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

export default function ProfileMiniCardButton({ children, borderColor, onPress, loading = false, disabled, testID, inHeader = false }: {
  children: string;
  borderColor: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  inHeader?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.miniCardButton,
        inHeader && { marginTop: 0, alignSelf: "center" },
        { borderColor, opacity: disabled || loading ? 0.5 : 1 },
        pressed && { backgroundColor: "#353539" },
      ]}
    >
      {loading && <ActivityIndicator size="small" color={borderColor} />}
      <Text style={styles.miniCardLabel}>{children}</Text>
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
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: "#2b2b2f",
  },
  miniCardLabel: { color: "#ececec", fontSize: 12, fontWeight: "600" },
});
