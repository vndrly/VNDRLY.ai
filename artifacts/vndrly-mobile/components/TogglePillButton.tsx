import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React from "react";
import {
  ActivityIndicator,
  Text,
  useWindowDimensions,
  type GestureResponderEvent,
  type AccessibilityState,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useBrand } from "@/hooks/use-brand";
import { miniCardStyles as styles } from "@/lib/mini-card-styles";

export type TogglePillColor = "brand" | "blue" | "green" | "red";

export interface TogglePillButtonProps {
  children: React.ReactNode;
  compactOnTablet?: boolean;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
  color?: TogglePillColor;
  inactive?: boolean;
  /** Legacy visual flag retained for callers; actions always use minicards. */
  askVInactiveStyle?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  tintColor?: string;
  accessibilityState?: AccessibilityState;
  /** Use the selected minicard treatment at rest. */
  solid?: boolean;
}

/** Compatibility export: shared native action buttons use the existing profile minicard style. */
export default function TogglePillButton({
  children,
  compactOnTablet = false,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
  testID,
  height: heightProp,
  color = "brand",
  inactive,
  askVInactiveStyle: _askVInactiveStyle,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  solid,
  tintColor,
}: TogglePillButtonProps) {
  const brand = useBrand(),
    { width } = useWindowDimensions();
  const isDisabled = Boolean(disabled || loading);
  const parts = React.Children.toArray(children);
  const plainLabel = parts.every(
    (part) => typeof part === "string" || typeof part === "number",
  )
    ? parts.join("")
    : undefined;
  const accent =
    tintColor ??
    (color === "brand"
      ? (brand.primary ?? "#00adb5")
      : { blue: "#3260CD", green: "#15803D", red: "#DC2626" }[color]);
  const selected = !inactive && Boolean(solid || accessibilityState?.selected);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? plainLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        ...accessibilityState,
        disabled: isDisabled,
        busy: Boolean(loading || accessibilityState?.busy),
      }}
      aria-selected={accessibilityState?.selected}
      aria-busy={Boolean(loading || accessibilityState?.busy)}
      aria-disabled={isDisabled}
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.miniCardButton,
        {
          marginTop: 0,
          alignSelf: "stretch",
          borderColor: accent,
          height: Math.max(44, heightProp ?? 44),
          opacity: isDisabled && !inactive ? 0.5 : 1,
        },
        selected && { backgroundColor: "#3a3d42" },
        pressed && { backgroundColor: "#353539" },
        style,
        compactOnTablet && width >= 768
          ? {
              alignSelf: "flex-start",
              flexGrow: 0,
              flexBasis: "auto",
              minWidth: 160,
              maxWidth: 320,
            }
          : null,
        { borderRadius: 8, minHeight: 44 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={accent} />
      ) : plainLabel !== undefined ? (
        <Text
          style={[
            styles.miniCardLabel,
            selected && { color: accent },
            textStyle,
          ]}
        >
          {plainLabel}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
