import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  type AccessibilityProps,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { TEXT_SHADOW } from "@/lib/pill-doctrine";

type Props = {
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
} & Pick<AccessibilityProps, "accessibilityLabel" | "accessibilityHint">;

/** Brand glossy refresh pill — matches Site tickets home header refresh. */
export default function HeaderRefreshPillButton({
  onPress,
  disabled,
  loading,
  testID,
  style,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  return (
    <LayeredPillButton
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      testID={testID}
      style={style}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
    >
      <Feather name="refresh-cw" size={16} color="#ffffff" style={TEXT_SHADOW.deep} />
    </LayeredPillButton>
  );
}
