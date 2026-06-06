import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import Pill9Slice from "@/components/Pill9Slice";
import { GREY_PILL_OPACITY } from "@/lib/pill-opacity";

export const SPLIT_TOGGLE_PILL_HEIGHT_PX = 23;

type Props = {
  side: "left" | "right";
  pillSrc: number;
  children: React.ReactNode;
  onPress?: () => void;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityState?: { selected?: boolean };
  /** Unselected grey pill half — rendered at {@link GREY_PILL_OPACITY}. */
  greyPill?: boolean;
};

/**
 * One half of a split EN/ES toggle. Clips a full pill PNG to left or
 * right half (same 200%-width trick as web `SplitToggleHalf`).
 */
export default function SplitToggleHalf({
  side,
  pillSrc,
  children,
  onPress,
  textStyle,
  style,
  testID,
  accessibilityState,
  greyPill,
}: Props) {
  const height = SPLIT_TOGGLE_PILL_HEIGHT_PX;
  const radius = height / 2;
  const [halfW, setHalfW] = useState(0);

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onLayout={(e) => {
        const nw = e.nativeEvent.layout.width;
        if (nw !== halfW) setHalfW(nw);
      }}
      style={[styles.half, { height }, greyPill ? styles.greyPill : null, style]}
    >
      {halfW > 0 ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            { overflow: "hidden", borderRadius: radius },
          ]}
        >
          <View
            style={{
              position: "absolute",
              top: 0,
              height,
              width: halfW * 2,
              left: side === "left" ? 0 : -halfW,
            }}
          >
            <Pill9Slice source={pillSrc} height={height} borderRadius={radius} />
          </View>
        </View>
      ) : null}
      <Text style={[styles.label, textStyle]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  half: {
    position: "relative",
    paddingHorizontal: 10,
    minWidth: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  label: {
    position: "relative",
    zIndex: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  greyPill: {
    opacity: GREY_PILL_OPACITY,
  },
});
