import React from "react";
import type { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from "react-native";
import TogglePillButton from "@/components/TogglePillButton";

/**
 * Legacy `BlueButton` import surface — preserved so existing call
 * sites keep working unchanged. Delegates to the canonical mobile
 * `TogglePillButton` with `color="blue"`. New code SHOULD import
 * `TogglePillButton` directly.
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
  /**
   * Forces the colored chrome on at all times. Defaults to `true`
   * for legacy parity — the original BlueButton was always blue,
   * not a press-only toggle.
   */
  solid?: boolean;
}

export default function BlueButton({ solid = true, ...props }: BlueButtonProps) {
  return <TogglePillButton color="blue" solid={solid} {...props} />;
}
