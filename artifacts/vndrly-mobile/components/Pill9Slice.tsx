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
 * Cap-preserving pill renderer for 900×229 PNG assets.
 * Matches web `pill-bg.tsx`: left 15% + right 15% caps, middle 70%
 * stretches horizontally. Same math on every platform — no iOS
 * capInsets (they caused left-cap smear / missing middle on device).
 */
export const PILL_SRC_W = 900;
export const PILL_SRC_H = 229;
export const PILL_IMAGE_ASPECT = PILL_SRC_W / PILL_SRC_H;
/** Each end cap = 15% of source width (135px on 900w assets). */
export const PILL_CAP_FRAC = 0.15;
/** Middle band = 70% of source width. */
export const PILL_MID_FRAC = 0.7;

export interface Pill9SliceProps {
  source: ImageSourcePropType;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

function PillSliceLayers({
  source,
  width,
  height,
}: {
  source: ImageSourcePropType;
  width: number;
  height: number;
}) {
  const naturalImgW = height * PILL_IMAGE_ASPECT;
  const layoutCap = naturalImgW * PILL_CAP_FRAC;
  // Below this width the end caps overlap — stretch the whole asset instead.
  if (width < layoutCap * 2 + 4) {
    return (
      <Image
        source={source}
        resizeMode="stretch"
        style={{ position: "absolute", top: 0, left: 0, width, height }}
      />
    );
  }
  const seam = 1;
  const capWidth = layoutCap + seam;
  const midLayoutLeft = layoutCap - seam;
  const midLayoutRight = layoutCap - seam;
  const midLayoutW = Math.max(0, width - midLayoutLeft - midLayoutRight);
  const midImgW = midLayoutW > 0 ? midLayoutW / PILL_MID_FRAC : 0;
  const midImgLeft = -(PILL_CAP_FRAC * midImgW);

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
      {height > 0 && w > 0 ? (
        <PillSliceLayers source={source} width={w} height={height} />
      ) : null}
    </View>
  );
}
