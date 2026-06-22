import React from "react";
import {
  Dimensions,
  Image as RNImage,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, {
  Defs,
  Image as SvgImage,
  LinearGradient,
  Mask,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { SvgXml } from "react-native-svg";

import { NAV_PANE_HALFTONE_SVG } from "@/assets/nav-pane-us-halftone";
import { HEADER_BLUR_DARK } from "@/lib/header-blur-asset";
import { APP_SCREEN_BACKGROUND } from "@/lib/nav-pane-tokens";

/** Matches web `NavPaneHeaderBlur` default height. */
const HEADER_BLUR_HEIGHT = 200;

/** Web sidebar halftone: 285% × 195%, opacity 0.22, centered. */
const HALFTONE_SCALE_WIDTH = 2.85;
const HALFTONE_SCALE_HEIGHT = 1.95;
const HALFTONE_OPACITY = 0.22;

/** Web `nav-pane-halftone-background` sidebar top calm band (42% fade). */
const TOP_CALM_STOPS = [
  { offset: "0", opacity: 0.72 },
  { offset: "0.22", opacity: 0.2 },
  { offset: "0.42", opacity: 0 },
] as const;

/** Web sidebar halftone radial mask — inverse vignette onto pane background. */
const HALFTONE_VIGNETTE_STOPS = [
  { offset: "0.18", opacity: 0 },
  { offset: "0.5", opacity: 0.25 },
  { offset: "1", opacity: 1 },
] as const;

const HEADER_BLUR_URI = RNImage.resolveAssetSource(HEADER_BLUR_DARK).uri;

type Props = {
  style?: StyleProp<ViewStyle>;
};

/** Background layer only — halftone + header blur (web nav-pane parity). */
export default function NavPaneChromeBackground({ style }: Props) {
  const { width, height } = Dimensions.get("window");
  const halftoneWidth = width * HALFTONE_SCALE_WIDTH;
  const halftoneHeight = height * HALFTONE_SCALE_HEIGHT;
  const halftoneLeft = width / 2 - halftoneWidth / 2;
  const halftoneTop = height / 2 - halftoneHeight / 2;

  return (
    <View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="app-screen-background-layer"
    >
      <View style={styles.halftoneLayer}>
        <SvgXml
          xml={NAV_PANE_HALFTONE_SVG}
          width={halftoneWidth}
          height={halftoneHeight}
          style={{
            position: "absolute",
            left: halftoneLeft,
            top: halftoneTop,
            opacity: HALFTONE_OPACITY,
          }}
        />
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="navPaneTopCalm" x1="0" y1="0" x2="0" y2="1">
              {TOP_CALM_STOPS.map((stop) => (
                <Stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor={APP_SCREEN_BACKGROUND}
                  stopOpacity={stop.opacity}
                />
              ))}
            </LinearGradient>
            <RadialGradient
              id="navPaneHalftoneVignette"
              cx="50%"
              cy="52%"
              rx="47.5%"
              ry="42.5%"
              gradientUnits="objectBoundingBox"
            >
              {HALFTONE_VIGNETTE_STOPS.map((stop) => (
                <Stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor={APP_SCREEN_BACKGROUND}
                  stopOpacity={stop.opacity}
                />
              ))}
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#navPaneTopCalm)" />
          <Rect x={0} y={0} width={width} height={height} fill="url(#navPaneHalftoneVignette)" />
        </Svg>
      </View>

      <View style={[styles.headerLayer, { height: HEADER_BLUR_HEIGHT }]}>
        <Svg
          width={width}
          height={HEADER_BLUR_HEIGHT}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id="headerBlurMask" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="white" stopOpacity="1" />
              <Stop offset="1" stopColor="white" stopOpacity="0" />
            </LinearGradient>
            <Mask id="headerBlurFade">
              <Rect
                x={0}
                y={0}
                width={width}
                height={HEADER_BLUR_HEIGHT}
                fill="url(#headerBlurMask)"
              />
            </Mask>
          </Defs>
          <SvgImage
            href={HEADER_BLUR_URI}
            x={0}
            y={0}
            width={width}
            height={HEADER_BLUR_HEIGHT}
            preserveAspectRatio="xMidYMin slice"
            opacity={0.85}
            mask="url(#headerBlurFade)"
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  halftoneLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    overflow: "hidden",
  },
  headerLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    overflow: "hidden",
  },
});
