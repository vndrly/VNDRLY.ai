import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { GREY_PILL_OPACITY } from "@/lib/pill-opacity";

const leftSrc = require("../assets/buttons/grey-left.png");
const centerSrc = require("../assets/buttons/grey-center.png");
const rightSrc = require("../assets/buttons/grey-right.png");

interface GreyButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
}

export default function GreyButton({
  children,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
  testID,
  height = 36,
}: GreyButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        {
          height,
          opacity: isDisabled ? 0.5 : pressed ? GREY_PILL_OPACITY * 0.95 : GREY_PILL_OPACITY,
        },
        style,
      ]}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.row}>
          <Image source={leftSrc} style={[styles.cap, { height }]} resizeMode="stretch" />
          <Image source={centerSrc} style={[styles.center, { height }]} resizeMode="stretch" />
          <Image source={rightSrc} style={[styles.cap, { height }]} resizeMode="stretch" />
        </View>
      </View>
      <View style={styles.contentRow}>
        {loading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : typeof children === "string" ? (
          <Text style={[styles.label, textStyle]} numberOfLines={1}>
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
  container: {
    position: "relative",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  row: {
    flex: 1,
    flexDirection: "row",
  },
  cap: {
    width: 8,
  },
  center: {
    flex: 1,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
