import React from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";

import colors from "@/constants/colors";
import { getCachedBrand } from "@/hooks/use-brand";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";

export default function SplashLogo() {
  const palette = colors.dark;
  // Read the cached brand synchronously so the splash can show the most
  // recent org's primary color while the auth context re-hydrates. With
  // no cached org brand, brand.primary already defaults to the VNDRLY
  // brand gold (#e6ac00) via DEFAULT_BRAND_PRIMARY — so we always trust
  // brand.primary instead of falling back to the neutral palette token,
  // which would render the spinner as washed-out light grey.
  const brand = getCachedBrand();
  const spinnerColor = brand.primary;
  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Image
        source={VNDRLY_LOGO_SQUARE}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator color={spinnerColor} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 140,
    height: 140,
  },
  spinner: {
    marginTop: 28,
  },
});
