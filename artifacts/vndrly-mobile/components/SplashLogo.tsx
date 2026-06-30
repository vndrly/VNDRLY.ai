import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";

import {
  SPLASH_BACKGROUND_GREYSCALE,
  SPLASH_LOGO_CYCLE_MS,
  SPLASH_LOGO_FULLCOLOR,
  SPLASH_LOGO_GREYSCALE,
} from "@/lib/splash-assets";

const LOGO_SIZE = 168;

export default function SplashLogo() {
  const cycle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(cycle, {
        toValue: 1,
        duration: SPLASH_LOGO_CYCLE_MS,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [cycle]);

  // 0–0.5s greyscale visible → 0.5–1.5s full color (~1s) → 1.5–2s greyscale back.
  const greyscaleOpacity = cycle.interpolate({
    inputRange: [0, 0.25, 0.75, 1],
    outputRange: [1, 0, 0, 1],
  });

  return (
    <View style={styles.root}>
      <Image
        source={SPLASH_BACKGROUND_GREYSCALE}
        style={styles.background}
        resizeMode="cover"
      />
      <View style={styles.logoStack}>
        <Image
          source={SPLASH_LOGO_FULLCOLOR}
          style={styles.logo}
          resizeMode="contain"
        />
        <Animated.Image
          source={SPLASH_LOGO_GREYSCALE}
          style={[styles.logo, styles.logoOverlay, { opacity: greyscaleOpacity }]}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#2a2d31",
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  logoStack: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  logoOverlay: {
    position: "absolute",
  },
});
