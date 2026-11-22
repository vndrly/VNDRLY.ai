import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React from "react";
import {miniCardStyles as styles} from "@/lib/mini-card-styles";
import { ActivityIndicator, Text } from "react-native";

export default function ProfileMiniCardButton({ children, borderColor, onPress, loading = false, disabled, testID, inHeader = false, numberOfLines, accessibilityLabel, selected }: {
  children: string;
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
      <Text style={[styles.miniCardLabel, selected && { color: borderColor }]} numberOfLines={numberOfLines}>{children}</Text>
    </Pressable>
  );
}
