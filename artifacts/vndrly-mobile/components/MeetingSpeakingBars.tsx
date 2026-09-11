import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, View } from "react-native";

const REST_HEIGHTS = [7, 12, 9, 13, 6] as const;
type AnimatedBarProps = React.ComponentProps<typeof Animated.View> & { dataSet?: Record<string, string> };
const AnimatedBar = Animated.View as React.ComponentType<AnimatedBarProps>;

export default function MeetingSpeakingBars({ active, color }: { active: boolean; color: string }) {
  const values = useRef<Animated.Value[] | null>(null);
  if (!values.current) values.current = REST_HEIGHTS.map(() => new Animated.Value(0));
  const levels = values.current;
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === "active");

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (mounted && !preferenceChanged) setReducedMotion(reduced);
    });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      preferenceChanged = true;
      setReducedMotion(reduced);
    });
    const app = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => {
      mounted = false;
      motion?.remove();
      app?.remove();
    };
  }, []);

  useEffect(() => {
    levels.forEach((level) => {
      level.stopAnimation();
      level.setValue(0);
    });
    if (!active || !foreground || reducedMotion !== false) return;
    const animation = Animated.loop(Animated.parallel(levels.map((level, index) => Animated.sequence([
      Animated.timing(level, { toValue: 1, duration: 260, delay: index * 70, useNativeDriver: false }),
      Animated.timing(level, { toValue: 0, duration: 320, useNativeDriver: false }),
    ]))));
    animation.start();
    return () => {
      animation.stop();
      levels.forEach((level) => {
        level.stopAnimation();
        level.setValue(0);
      });
    };
  }, [active, foreground, levels, reducedMotion]);

  if (!active) return null;
  return <View accessible={false} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
    {REST_HEIGHTS.map((restHeight, index) => <AnimatedBar
      key={index}
      testID={`speaker-bar-${index}`}
      dataSet={{ restHeight: String(restHeight) }}
      style={{
        width: 3,
        height: reducedMotion === false && foreground
          ? levels[index].interpolate({ inputRange: [0, 1], outputRange: [Math.max(4, restHeight - 2), restHeight + 3] })
          : restHeight,
        borderRadius: 2,
        backgroundColor: color,
      }}
    />)}
  </View>;
}
