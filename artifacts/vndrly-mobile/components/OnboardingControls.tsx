import React from "react";
import {
  Text,
  TextInput,
  View,
  type TextProps,
  type TextInputProps,
} from "react-native";
import { useColors } from "@/hooks/useColors";
export function OnboardingText({ style, ...props }: TextProps) {
  const colors = useColors();
  return <Text {...props} style={[{ color: colors.text }, style]} />;
}
export function OnboardingInput({ style, ...props }: TextInputProps) {
  const colors = useColors();
  return (
    <TextInput
      placeholderTextColor={colors.mutedForeground}
      {...props}
      style={[
        {
          color: colors.text,
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
          minHeight: 44,
        },
        style,
      ]}
    />
  );
}

export function BrandedOnboardingField({ label, ...props }: TextInputProps & { label: string }) {
  const { primary } = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#fff", fontSize: 12 }}>{label}</Text>
      <OnboardingInput
        {...props}
        accessibilityLabel={label}
        style={{ backgroundColor: "#303034", borderColor: primary, borderRadius: 9999, paddingHorizontal: 12 }}
      />
    </View>
  );
}
