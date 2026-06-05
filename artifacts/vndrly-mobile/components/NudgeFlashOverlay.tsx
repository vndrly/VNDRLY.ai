import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

type Props = {
  active: boolean;
  borderRadius?: number;
};

/** Blue pulse overlay for ticket cards / detail when a workflow nudge arrives. */
export default function NudgeFlashOverlay({
  active,
  borderRadius = 14,
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      return;
    }
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
      { iterations: 4 },
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: "#3b82f6",
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 0.28],
          }),
          borderRadius,
        },
      ]}
      testID="nudge-flash-overlay"
    />
  );
}
