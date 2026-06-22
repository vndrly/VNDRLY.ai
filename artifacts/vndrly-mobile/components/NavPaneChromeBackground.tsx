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
import { HEADER_BLUR_DARK } from "@/lib/header-blur-asset";
import { NAV_PANE_DARK_BG } from "@/lib/nav-pane-tokens";

/** Matches web `NavPaneHeaderBlur` default height. */
const HEADER_BLUR_HEIGHT = 200;

/** Web `nav-pane-halftone-background` sidebar variant top calm band. */
const TOP_CALM_STOPS = [
  { offset: "0", opacity: 0.72 },
  { offset: "0.22", opacity: 0.2 },
  { offset: "0.42", opacity: 0 },
] as const;

type Props = {
  style?: StyleProp<ViewStyle>;
};

/** Halftone body + user Header Blur Dark PNG at the top — no logo PNGs. */
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
      testID="nav-pane-chrome-background"
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
              {TOP_CALM_STOPS.map((stop) => (
                <Stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor={NAV_PANE_DARK_BG}
                  stopOpacity={stop.opacity}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#navPaneTopCalm)" />
        </Svg>
      </View>

      <View style={[styles.headerLayer, { height: HEADER_BLUR_HEIGHT }]}>
        <Image
          source={HEADER_BLUR_DARK}
          style={styles.headerImage}
          resizeMode="cover"
        />
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
