import React from "react";
import type { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from "react-native";

import BluePillButton from "@/components/BluePillButton";

/**
 * Legacy `BlueButton` import surface — preserved so existing call
 * sites keep working unchanged. Delegates to the canonical glossy
 * blue pill (`BluePillButton`).
 */
interface BlueButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
  /** Kept for API compatibility; blue pills are always solid. */
  solid?: boolean;
}

export default function BlueButton({ solid: _solid = true, ...props }: BlueButtonProps) {
  return <BluePillButton {...props} />;
}
