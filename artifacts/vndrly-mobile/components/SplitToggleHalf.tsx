import React, { useState } from "react";
import {
  Pressable,
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

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
  /** Unselected grey pill half. Kept for API parity with callers. */
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
  greyPill: _greyPill,
}: Props) {
  const height = SPLIT_TOGGLE_PILL_HEIGHT_PX;
  const clipRadius = side === "left" ? styles.leftClipRadius : styles.rightClipRadius;
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
      style={[styles.half, { height }, style]}
    >
      {halfW > 0 ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            styles.clip,
            clipRadius,
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
            <Image
              source={pillSrc}
              resizeMode="stretch"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: halfW * 2,
                height,
              }}
            />
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
    paddingHorizontal: 8,
    minWidth: 32,
    minHeight: SPLIT_TOGGLE_PILL_HEIGHT_PX,
    maxHeight: SPLIT_TOGGLE_PILL_HEIGHT_PX,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  clip: {
    overflow: "hidden",
  },
  leftClipRadius: {
    borderTopLeftRadius: SPLIT_TOGGLE_PILL_HEIGHT_PX / 2,
    borderBottomLeftRadius: SPLIT_TOGGLE_PILL_HEIGHT_PX / 2,
  },
  rightClipRadius: {
    borderTopRightRadius: SPLIT_TOGGLE_PILL_HEIGHT_PX / 2,
    borderBottomRightRadius: SPLIT_TOGGLE_PILL_HEIGHT_PX / 2,
  },
  label: {
    position: "relative",
    zIndex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    letterSpacing: 0,
  },
});
