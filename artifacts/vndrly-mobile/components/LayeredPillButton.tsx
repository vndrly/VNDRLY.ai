import React from "react";
import TogglePillButton from "./TogglePillButton";
import {
  type ImageSourcePropType,
  type PressableProps,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { TEXT_SHADOW } from "@/lib/pill-doctrine";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mid = { src: any; rgb: [number, number, number] };

const MIDS: Mid[] = [
  { src: require("@/assets/pill-stack/mid-dark-green.png"), rgb: [15, 107, 44] },
  { src: require("@/assets/pill-stack/mid-green.png"), rgb: [31, 154, 61] },
  { src: require("@/assets/pill-stack/mid-green-v3.png"), rgb: [45, 184, 74] },
  { src: require("@/assets/pill-stack/mid-dark-red.png"), rgb: [139, 18, 18] },
  { src: require("@/assets/pill-stack/mid-red.png"), rgb: [201, 42, 42] },
  { src: require("@/assets/pill-stack/mid-red-v2.png"), rgb: [181, 26, 42] },
  { src: require("@/assets/pills/pill_amber.png"), rgb: [245, 158, 11] },
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

export const LAYERED_PILL_BUTTON_TEXT = {
  fontFamily: "Inter_400Regular",
  fontSize: 12,
  color: "#ffffff",
  ...TEXT_SHADOW.deep,
} as const;

export interface LayeredPillButtonProps extends Pick<PressableProps, "accessibilityState" | "accessibilityLabel" | "accessibilityHint"> {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  height?: number;
  /** Override brand color (else uses brand.primary). */
  color?: string;
  /** Keep the neutral minicard state. */
  inactive?: boolean;
  /** Legacy artwork prop retained for callers; minicards do not render artwork. */
  source?: ImageSourcePropType;
}

/** Compatibility export for the shared native minicard action. */
export default function LayeredPillButton({source:_source,color,...props}:LayeredPillButtonProps){
 return <TogglePillButton {...props} tintColor={color}/>;
}
