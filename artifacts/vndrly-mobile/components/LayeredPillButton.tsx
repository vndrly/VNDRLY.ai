import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useBrand } from "@/hooks/use-brand";
import Pill9Slice from "@/components/Pill9Slice";

const BASE = require("@/assets/pill-stack/base-grey.png");
// Inactive variants (Close For Review while checked in/out, etc.)
// use the lighter, brighter grey pill so disabled state is clearly
// distinct from the dark-grey active base. Active buttons keep BASE
// because the mid-color overlay is layered on top of it.
const BASE_INACTIVE = require("@/assets/pill-stack/light-grey.png");
const HIGHLIGHT = require("@/assets/pill-stack/highlight.png");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mid = { src: any; rgb: [number, number, number] };

const MIDS: Mid[] = [
  { src: require("@/assets/pill-stack/mid-dark-green.png"), rgb: [15, 107, 44] },
  { src: require("@/assets/pill-stack/mid-green.png"), rgb: [31, 154, 61] },
  { src: require("@/assets/pill-stack/mid-green-v3.png"), rgb: [45, 184, 74] },
  { src: require("@/assets/pill-stack/mid-dark-red.png"), rgb: [139, 18, 18] },
  { src: require("@/assets/pill-stack/mid-red.png"), rgb: [201, 42, 42] },
  { src: require("@/assets/pill-stack/mid-red-v2.png"), rgb: [181, 26, 42] },
  { src: require("@/assets/pill-stack/mid-orange.png"), rgb: [217, 122, 31] },
  { src: require("@/assets/pill-stack/mid-tan.png"), rgb: [185, 165, 103] },
  { src: require("@/assets/pill-stack/mid-tan-v2.png"), rgb: [184, 153, 90] },
  { src: require("@/assets/pill-stack/mid-tan-v3.png"), rgb: [192, 160, 74] },
  { src: require("@/assets/pill-stack/mid-baby-blue.png"), rgb: [74, 168, 216] },
  { src: require("@/assets/pill-stack/mid-blue.png"), rgb: [31, 95, 196] },
  { src: require("@/assets/pill-stack/mid-navy.png"), rgb: [42, 58, 120] },
  { src: require("@/assets/pill-stack/mid-teal.png"), rgb: [42, 144, 144] },
  { src: require("@/assets/pill-stack/mid-purple.png"), rgb: [107, 31, 196] },
  { src: require("@/assets/pill-stack/mid-indigo.png"), rgb: [122, 31, 196] },
  { src: require("@/assets/pill-stack/mid-hot-pink.png"), rgb: [196, 31, 168] },
  { src: require("@/assets/pill-stack/mid-pink.png"), rgb: [212, 106, 146] },
  { src: require("@/assets/pill-stack/mid-dark-grey.png"), rgb: [74, 74, 74] },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const norm =
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(norm, 16);
  if (Number.isNaN(n)) return [37, 99, 235];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function dist(a: [number, number, number], b: [number, number, number]) {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function pickPillForBrand(brandHex: string): Mid {
  const target = hexToRgb(brandHex);
  let best = MIDS[0];
  let bestD = dist(best.rgb, target);
  for (let i = 1; i < MIDS.length; i++) {
    const d = dist(MIDS[i].rgb, target);
    if (d < bestD) {
      best = MIDS[i];
      bestD = d;
    }
  }
  return best;
}

export interface LayeredPillButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  height?: number;
  /** Override brand color (else uses brand.primary). */
  color?: string;
  /** Forces inactive (grey-only) chrome — middle pill is hidden. */
  inactive?: boolean;
}

/**
 * Three-layer pill button:
 *   1. base-grey.png         (always present; shows through when inactive)
 *   2. nearest middle pill   (color-matched to brand.primary, then tinted)
 *   3. highlight.png         (white gloss on top)
 *
 * The middle layer is picked by RGB-distance to the resolved brand
 * primary, then a translucent overlay of the exact brand color is
 * laid over it to "dial in" the hue/saturation a step closer.
 */
export default function LayeredPillButton({
  children,
  onPress,
  disabled,
  loading,
  style,
  testID,
  height: heightProp = 40,
  color,
  inactive,
}: LayeredPillButtonProps) {
  const brand = useBrand();
  const targetHex = color ?? brand.primary;
  const mid = useMemo(() => pickPillForBrand(targetHex), [targetHex]);
  const isInactive = inactive || disabled || loading;
  // Hard cap: every action pill on mobile is 40px tall, full stop.
  const height = Math.min(heightProp, 40);
  const radius = height / 2;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      style={({ pressed }) => [
        styles.wrap,
        {
          height,
          opacity: pressed ? 0.92 : 1,
        },
        style,
      ]}
    >
      {/* Inactive variants render the pill layers inside an opacity
          wrapper so the disabled state visually softens the whole pill
          (image + glossy highlight) to ~80% without affecting the
          text/icon, which we recolor separately to light grey below. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          isInactive && { opacity: 0.6 },
        ]}
      >
        {/* All three pill layers (base, mid color, highlight) render
            through Pill9Slice — the rounded glossy caps on the source
            PNGs are preserved (left 15% + right 15%) and only the
            middle 70% stretches horizontally to fill the button. */}
        <Pill9Slice
          source={isInactive ? BASE_INACTIVE : BASE}
          borderRadius={radius}
        />
        {!isInactive ? (
          <>
            <Pill9Slice source={mid.src} borderRadius={radius} />
            {/* HSL "dial-in" — translucent brand-color overlay nudges
                the picked middle pill closer to the actual brand
                primary. */}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  backgroundColor: targetHex,
                  opacity: 0.22,
                  borderRadius: radius,
                },
              ]}
            />
          </>
        ) : null}
        <Pill9Slice source={HIGHLIGHT} borderRadius={radius} />
      </View>
      <View style={[styles.content, isInactive && { opacity: 0.8 }]}>
        {loading ? <ActivityIndicator color="#ffffff" /> : children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    paddingHorizontal: 18,
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
});
