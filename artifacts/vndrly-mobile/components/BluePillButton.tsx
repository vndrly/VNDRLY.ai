import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import Pill9Slice from "@/components/Pill9Slice";

const BLUE_PILL = require("@/assets/pill-stack/mid-blue.png");

export interface BluePillButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
}

/**
 * Canonical glossy blue pill used for every blue CTA/chip in the
 * mobile app. Uses the 900×229 blue pill asset via Pill9Slice so
 * rounded caps never squash at any width.
 */
export default function BluePillButton({
  children,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
  testID,
  height = 36,
}: BluePillButtonProps) {
  const isDisabled = disabled || loading;
  const radius = height / 2;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.wrap,
        { height, borderRadius: radius },
        isDisabled ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
        style,
      ]}
    >
      <Pill9Slice source={BLUE_PILL} height={height} borderRadius={radius} />
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : typeof children === "string" ? (
          <Text
            style={[styles.label, textStyle]}
            numberOfLines={1}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  label: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.92,
  },
});
