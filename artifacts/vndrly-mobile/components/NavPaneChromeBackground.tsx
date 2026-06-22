import React from "react";
import {
  Dimensions,
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { SvgXml } from "react-native-svg";

import { NAV_PANE_HALFTONE_SVG } from "@/assets/nav-pane-us-halftone";

/** Matches web `NavPaneHeaderBlur` default height. */
const HEADER_BLUR_HEIGHT = 200;

type Props = {
  style?: StyleProp<ViewStyle>;
};

/**
 * Decorative nav-pane chrome only — halftone body + top header blur PNG.
 * Mirrors web `NavPaneHalftoneBackground` + `NavPaneHeaderBlur`; does not
 * move or wrap interactive content.
 */
export default function NavPaneChromeBackground({ style }: Props) {
  const { width, height } = Dimensions.get("window");
  const halftoneWidth = width * 2.85;
  const halftoneHeight = height * 1.95;
  const halftoneLeft = width / 2 - halftoneWidth / 2;
  const halftoneTop = height / 2 - halftoneHeight / 2;

  return (
    <View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
            opacity: 0.22,
          }}
        />
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="navPaneTopCalm" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0.72} />
              <Stop offset="0.22" stopColor="#000000" stopOpacity={0.2} />
              <Stop offset="0.42" stopColor="#000000" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#navPaneTopCalm)" />
        </Svg>
      </View>

      <View style={[styles.headerLayer, { height: HEADER_BLUR_HEIGHT }]}>
        <Image
          source={require("@/assets/images/vndrly-header-blur-dark.png")}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <Svg
          width={width}
          height={HEADER_BLUR_HEIGHT}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <LinearGradient id="headerBlurFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000000" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={width}
            height={HEADER_BLUR_HEIGHT}
            fill="url(#headerBlurFade)"
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
  headerImage: {
    width: "100%",
    height: "100%",
    opacity: 0.85,
  },
});
