import React, { useState } from "react";
import {
  Image,
  Platform,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * Cap-preserving pill renderer for the 900×229 pill PNG assets in
 * `assets/pill-stack/`. Uses native `capInsets` on iOS (no seams) and
 * a z-indexed manual slice on Android/web where the middle band is
 * taken only from the flat center of the source so cap gradients are
 * never double-drawn at the join lines.
 */
const SRC_W = 900;
const SRC_H = 229;
/** Source-image inset (each end) passed to iOS capInsets. */
const CAP_INSET_SRC = Math.round(SRC_W * 0.2);
/** Manual slice: layout cap width as a fraction of scaled image width. */
const LAYOUT_CAP_PCT = 0.15;
/** Manual slice: only the inner `[INNER_START, 1-INNER_START)` band stretches. */
const INNER_START = 0.2;
const INNER_WIDTH = 1 - 2 * INNER_START;

export interface Pill9SliceProps {
  source: ImageSourcePropType;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

function overlapPx(height: number): number {
  return Math.max(4, Math.round(height * 0.1));
}

function ManualPillSlice({
  source,
  width,
  height,
}: {
  source: ImageSourcePropType;
  width: number;
  height: number;
}) {
  const aspect = SRC_W / SRC_H;
  const naturalImgW = height * aspect;
  const layoutCap = naturalImgW * LAYOUT_CAP_PCT;
  const overlap = overlapPx(height);
  const capWidth = layoutCap + overlap;
  const midLayoutLeft = layoutCap - overlap;
  const midLayoutRight = layoutCap - overlap;
  const midLayoutW = Math.max(0, width - midLayoutLeft - midLayoutRight);
  const midImgW = midLayoutW > 0 ? midLayoutW * (SRC_W / (SRC_W * INNER_WIDTH)) : 0;
  const midImgLeft = -(INNER_START * midImgW);

  return (
    <>
      {midLayoutW > 0 && midImgW > 0 ? (
        <View
          style={{
            position: "absolute",
            left: midLayoutLeft,
            right: midLayoutRight,
            top: 0,
            bottom: 0,
            overflow: "hidden",
            zIndex: 1,
          }}
        >
          <Image
            source={source}
            resizeMode="stretch"
            style={{
              position: "absolute",
              left: midImgLeft,
              top: 0,
              width: midImgW,
              height,
            }}
          />
        </View>
      ) : null}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: capWidth,
          overflow: "hidden",
          zIndex: 2,
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
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: capWidth,
          overflow: "hidden",
          zIndex: 2,
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
    </>
  );
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
  const radius = borderRadius ?? (height > 0 ? height / 2 : 0);
  const useNativeCaps = Platform.OS === "ios" && height > 0 && w > 0;

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
      {useNativeCaps ? (
        <Image
          source={source}
          capInsets={{
            left: CAP_INSET_SRC,
            right: CAP_INSET_SRC,
            top: 0,
            bottom: 0,
          }}
          style={{ width: w, height }}
          resizeMode="stretch"
        />
      ) : height > 0 && w > 0 ? (
        <ManualPillSlice source={source} width={w} height={height} />
      ) : null}
    </View>
  );
}
