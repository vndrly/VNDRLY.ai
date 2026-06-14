import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import Pill9Slice from "@/components/Pill9Slice";
import { useBrand } from "@/hooks/use-brand";
import { GREY_PILL_OPACITY } from "@/lib/pill-opacity";
import { PILL_HEIGHT_PX, TEXT_SHADOW } from "@/lib/pill-doctrine";
import { pickTogglePillSrc, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";

const BLUE_PILL = require("@/assets/pill-stack/mid-blue.png");
const GREEN_PILL = require("@/assets/pill-stack/mid-green-v3.png");
const RED_PILL = require("@/assets/pill-stack/mid-red-v2.png");
const GREY_PILL = require("@/assets/pill-stack/light-grey.png");

export type TogglePillColor = "brand" | "blue" | "green" | "red";

export interface TogglePillButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
  color?: TogglePillColor;
  inactive?: boolean;
  /** Colored at rest (primary CTAs). Default false = grey rest, colored on press. */
  solid?: boolean;
}

function coloredSrc(color: TogglePillColor, brandPrimary: string, brandName: string): ImageSourcePropType {
  if (color === "blue") return BLUE_PILL;
  if (color === "green") return GREEN_PILL;
  if (color === "red") return RED_PILL;
  return pickTogglePillSrc(brandPrimary, brandName);
}

/**
 * Mobile pill button — one PNG per state, 3-slice stretch (web PngPillButton rule).
 */
export default function TogglePillButton({
  children,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
  testID,
  height: _heightProp,
  color = "brand",
  inactive,
  solid,
}: TogglePillButtonProps) {
  const brand = useBrand();
  const isDisabled = disabled || loading;
  const lockToRest = !!inactive || !!loading;
  const lockToColored = !!solid && !lockToRest;
  const height = PILL_HEIGHT_PX;
  const radius = height / 2;
  const activeSrc = coloredSrc(color, brand.primary ?? "#1f9a3d", brand.name ?? "");
  const restSrc = TOGGLE_IDLE_PILL_SRC;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        { height, alignSelf: "stretch" },
        isDisabled && !inactive ? styles.dimmed : null,
        style,
      ]}
    >
      {({ pressed }) => {
        const showColored = !lockToRest && (lockToColored ? !pressed : pressed);
        const src = showColored ? activeSrc : restSrc;
        const labelColor = showColored ? "#ffffff" : "#1a1d23";
        const isGreyedOut = isDisabled && !inactive;
        const isGreyPill = !showColored && !isGreyedOut;
        return (
          <View style={[styles.inner, { height }, isGreyPill ? styles.greyPill : null]}>
            <Pill9Slice source={src} height={height} borderRadius={radius} />
            <View style={styles.contentRow}>
              {loading ? (
                <ActivityIndicator color={labelColor} size="small" />
              ) : typeof children === "string" ? (
                <Text
                  style={[
                    styles.label,
                    { color: labelColor },
                    showColored ? styles.labelColoredShadow : null,
                    textStyle,
                  ]}
                  numberOfLines={1}
                >
                  {children}
                </Text>
              ) : (
                children
              )}
            </View>
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 999,
  },
  inner: {
    position: "relative",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderRadius: 999,
    flex: 1,
  },
  dimmed: {
    opacity: 0.5,
  },
  greyPill: {
    opacity: GREY_PILL_OPACITY,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    zIndex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  labelColoredShadow: TEXT_SHADOW.onColor,
});
