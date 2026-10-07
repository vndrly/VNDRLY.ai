import React from "react";
import {
  Text,
  TextInput,
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
