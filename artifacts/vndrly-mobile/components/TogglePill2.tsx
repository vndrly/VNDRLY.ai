import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
/**
 * TogglePill2 — pill-shaped action button matching the
 * "Start New Job" CTA chrome (linear two-tone gradient,
 * hairline border, drop shadow, inset gloss highlight).
 *
 * Children should include their own Text/Icon nodes already
 * styled with a textShadow (rgba(0,0,0,0.63), {0,2}, 4) so the
 * icon and label sit on the same depth plane as the home screen
 * brand pill.
 */

function shade(hex: string, pct: number): string {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (pct < 0 ? c : 255 - c) * pct)));
  const to = (c: number) => adj(c).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

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
  const isDisabled = disabled || loading;
  const top = shade(color, 0.18);
  const bottom = shade(color, -0.22);
  const border = shade(color, -0.35);
  const radius = height / 2;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        {
          height,
          borderRadius: radius,
          opacity: isDisabled ? 0.5 : pressed ? 0.92 : 1,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 4,
          elevation: 3,
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: radius,
            borderWidth: 1,
            borderColor: border,
            overflow: "hidden",
            backgroundColor: color,
          },
        ]}
      >
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "50%",
            backgroundColor: top,
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
            opacity: 0.55,
          }}
        />
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "50%",
            backgroundColor: bottom,
            borderBottomLeftRadius: radius,
            borderBottomRightRadius: radius,
            opacity: 0.55,
          }}
        />
        <View style={[styles.glossTop, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]} />
        <View style={[styles.glossBottom, { borderBottomLeftRadius: radius, borderBottomRightRadius: radius }]} />
      </View>
      <View style={styles.content}>
        {loading ? <ActivityIndicator color="#ffffff" /> : children}
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
    overflow: "visible",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  glossTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  glossBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
});
