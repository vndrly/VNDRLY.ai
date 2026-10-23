import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { useTranslation } from "react-i18next";

/** Brief attention for a new leg; ordinary GPS updates keep the label still. */
export default function GateArrivalSignal({ fresh }: { fresh: boolean }) {
  const { t } = useTranslation();
  const opacity = useRef(new Animated.Value(1)).current;
  const played = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", value => { if (alive) setReduceMotion(value); });
    return () => { alive = false; subscription?.remove?.(); };
  }, []);
  useEffect(() => {
    opacity.setValue(1);
    if (!fresh) { played.current = false; return; }
    if (reduceMotion || played.current) return;
    played.current = true;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.3, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]), { iterations: 4 });
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [fresh, reduceMotion, opacity]);
  return <Animated.Text style={{ color: "#22c55e", fontWeight: "700", fontSize: 12, opacity }}>{t("gatekeeper.arriving")}</Animated.Text>;
}
