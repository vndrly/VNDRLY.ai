import React, { useState } from "react";
import {
  Image,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * Nine-slice / cap-preserving pill renderer for the 900×229 pill PNG
 * assets shipped in `assets/pill-stack/` (blue-hot, orange-hot,
 * light-grey, etc).
 *
 * The source images have rounded glossy caps on the left and right.
 * If you `resizeMode="stretch"` the entire PNG into a small button,
 * the caps squish horizontally and the pill loses its shape. Instead
 * we render the same source three times:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ left cap │ stretched middle band │ right cap │
 *   └──────────────────────────────────────────────────┘
 *
 *  - Left and right caps render the source at its natural aspect
 *    ratio (height-driven), clipped so only the outer 15% is visible.
 *    This preserves the rounded glossy corner exactly.
 *  - The middle band shows the inner 70% of the source, stretched
 *    horizontally to fill whatever space remains between the caps.
 *
 * `borderRadius` defaults to `height / 2` so the container is also
 * a perfect pill.
 */
const SRC_W = 900;
const SRC_H = 229;
const CAP_PCT = 0.15;
// Sub-pixel rounding between the cap views and the stretched middle
// view leaves a ~1px transparent seam on web. Extend the middle band
// outward by OVERLAP_PX on each side so it tucks under both caps,
// then render caps after the middle so they paint on top and hide
// the overshoot. Works the same on iOS/Android.
const OVERLAP_PX = 1.5;

export interface Pill9SliceProps {
  source: ImageSourcePropType;
  /**
   * Render height. If omitted, the component fills its parent and
   * measures its own height via onLayout. Use the explicit form when
   * the parent's height comes from intrinsic content (e.g. a badge
   * around <Text>); use the auto form when the parent already has a
   * fixed height (e.g. a Pressable with style.height = 40).
   */
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export default function Pill9Slice({
  source,
  height: heightProp,
  borderRadius,
  style,
}: Pill9SliceProps) {
  const [w, setW] = useState(0);
  const [measuredH, setMeasuredH] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = e.nativeEvent.layout.width;
    const nh = e.nativeEvent.layout.height;
    if (nw !== w) setW(nw);
    if (nh !== measuredH) setMeasuredH(nh);
  };

  const height = heightProp ?? measuredH;
  const radius = borderRadius ?? height / 2;
  const aspect = SRC_W / SRC_H;
  const naturalImgW = height * aspect;
  const capW = naturalImgW * CAP_PCT;
  // Stretch the middle band a hair WIDER than the cap-to-cap gap so
  // it tucks under both caps and there is no transparent seam on web.
  const midLeft = Math.max(0, capW - OVERLAP_PX);
  const midRight = Math.max(0, capW - OVERLAP_PX);
  const visibleMiddle = Math.max(0, w - midLeft - midRight);
  const midScaledW = visibleMiddle / (1 - 2 * CAP_PCT);
  const midOffset = midScaledW * CAP_PCT;

  return (
    <View
      onLayout={onLayout}
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          borderRadius: radius,
        },
        style,
      ]}
    >
      {/* Middle — render FIRST so the cap views below paint on top
          and hide the OVERLAP_PX overshoot used to kill the seam. */}
      {w > 0 && midScaledW > 0 ? (
        <View
          style={{
            position: "absolute",
            left: midLeft,
            right: midRight,
            top: 0,
            bottom: 0,
            overflow: "hidden",
          }}
        >
          <Image
            source={source}
            resizeMode="stretch"
            style={{
              position: "absolute",
              left: -midOffset,
              top: 0,
              width: midScaledW,
              height,
            }}
          />
        </View>
      ) : null}
      {/* Left cap — show outer 15% of the source PNG, no horizontal
          squish (image rendered at its natural aspect width). Painted
          AFTER the middle so any sub-pixel overshoot from the middle
          band is hidden under the cap. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: capW,
          overflow: "hidden",
        }}
      >
        <Image
          source={source}
          resizeMode="stretch"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: naturalImgW,
            height,
          }}
        />
      </View>
      {/* Right cap — mirror of left, image pinned to right edge. */}
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: capW,
          overflow: "hidden",
        }}
      >
        <Image
          source={source}
          resizeMode="stretch"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: naturalImgW,
            height,
          }}
        />
      </View>
    </View>
  );
}
