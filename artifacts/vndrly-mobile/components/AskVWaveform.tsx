import React, { useEffect, useMemo } from "react";
import { Animated, View } from "react-native";

const BAR_HEIGHTS = [8, 14, 20, 14, 8];

export default function AskVWaveform({ active, color = "#ffffff" }: { active: boolean; color?: string }) {
  const pulse = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { duration: 325, toValue: 1, useNativeDriver: false }),
        Animated.timing(pulse, { duration: 325, toValue: 0, useNativeDriver: false }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, pulse]);

  return (
    <View
      accessibilityLabel={active ? "Ask V voice activity" : "Ask V voice idle"}
      accessibilityRole="image"
      style={{ alignItems: "center", flexDirection: "row", gap: 2, height: 20, justifyContent: "center" }}
      testID="askv-waveform"
    >
      {BAR_HEIGHTS.map((height, index) => (
        <Animated.View
          key={`${height}-${index}`}
          style={{
            backgroundColor: color,
            borderRadius: 2,
            height: active
              ? pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [Math.max(4, height * 0.45), height],
                })
              : 4,
            opacity: active ? 1 : 0.4,
            width: 3,
          }}
        />
      ))}
    </View>
  );
}
