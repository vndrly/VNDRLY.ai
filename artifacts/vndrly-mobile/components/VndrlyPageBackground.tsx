import React, { type ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Pattern, Rect, Stop } from "react-native-svg";

const BACKGROUND = "#111111";

type Props = {
  children: ReactNode;
};

export default function VndrlyPageBackground({ children }: Props) {
  return (
    <View style={styles.root}>
      <Image
        source={require("@/assets/images/vndrly-header-blur-dark.png")}
        style={styles.headerImage}
        resizeMode="cover"
      />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="headerFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={BACKGROUND} stopOpacity="0.08" />
            <Stop offset="0.56" stopColor={BACKGROUND} stopOpacity="0.24" />
            <Stop offset="1" stopColor={BACKGROUND} stopOpacity="1" />
          </LinearGradient>
          <Pattern id="halftone" width="14" height="14" patternUnits="userSpaceOnUse">
            <Circle cx="2" cy="2" r="1.05" fill="#ffffff" opacity="0.055" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="300" fill="url(#headerFade)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#halftone)" opacity="0.72" />
      </Svg>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  headerImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    width: "100%",
    height: 300,
    opacity: 0.82,
  },
  content: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
