import React from "react";
import {
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";

export interface TogglePill2Props {
  children: React.ReactNode;
  color: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Brand-colored CTA — delegates to LayeredPillButton (3-slice PNG). */
export default function TogglePill2({
  children,
  color,
  onPress,
  disabled,
  loading,
  height = 48,
  style,
  testID,
}: TogglePill2Props) {
  return (
    <LayeredPillButton
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      height={height}
      color={color}
      style={style}
      testID={testID}
    >
      {children}
    </LayeredPillButton>
  );
}
