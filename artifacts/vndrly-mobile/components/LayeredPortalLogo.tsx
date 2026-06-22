import React, { type ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";

import AuthedImage from "@/components/AuthedImage";

const LOGO_SIZE = 64;
const LOGO_PADDING = 8;

type Props = {
  uri: string;
  fallback?: ReactNode;
  accessibilityLabel?: string;
};

/** User underlay image behind the branded square logo only — no overlay layer. */
export default function LayeredPortalLogo({ uri, fallback, accessibilityLabel }: Props) {
  return (
    <View style={styles.frame} accessibilityLabel={accessibilityLabel}>
      <Image
        source={require("@/assets/images/logo-overlay_1778217860263.png")}
        style={styles.underlay}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.logoInset}>
        <AuthedImage
          uri={uri}
          fallback={fallback}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={accessibilityLabel}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 8,
    overflow: "hidden",
  },
  underlay: {
    ...StyleSheet.absoluteFillObject,
  },
  logoInset: {
    ...StyleSheet.absoluteFillObject,
    padding: LOGO_PADDING,
  },
  logo: {
    width: "100%",
    height: "100%",
  },
});
