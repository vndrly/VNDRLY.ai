import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from "react-native";

import { useBrand } from "@/hooks/use-brand";
import { setLanguage } from "@/lib/i18n";

// Light neutral grey for the pill outline + EN/ES divider — matches the
// `border-zinc-300/70` chrome used by the canonical web TogglePillButton
// at-rest state. Kept literal (not pulled from `colors.border`) so the
// toggle reads the same against every screen background and is not tied
// to dark-mode chrome tokens.
const PILL_OUTLINE = "#d4d4d8";

type Props = {
  style?: ViewStyle | ViewStyle[];
};

/**
 * Small EN/ES pill that mirrors the web `LanguageToggle`
 * (artifacts/vndrly/src/components/language-toggle.tsx).
 *
 * Tapping a half calls `setLanguage` from `lib/i18n.ts`, which both
 * updates i18next immediately and persists the choice to AsyncStorage
 * so it survives app restarts. Designed for use on signed-out screens
 * (e.g. the login screen) where the existing in-app language switcher
 * on the profile tab is unreachable.
 */
export default function LanguageToggle({ style }: Props) {
  // Read the brand directly instead of routing through useColors() so the
  // active half is unambiguously brand.primary — VNDRLY amber by default,
  // or the partner's primary (Exxon green, etc.) once BrandProvider has
  // hydrated the previously-cached brand from SecureStore. Going through
  // useColors() risked picking up the static dark-palette `primary`
  // token whenever `isOrgBranded` was false on first paint; reading the
  // brand directly removes that branch entirely.
  const brand = useBrand();
  const { i18n } = useTranslation();
  const current = i18n.language?.startsWith("es") ? "es" : "en";

  const onPress = (lng: "en" | "es") => {
    if (lng === current) return;
    void setLanguage(lng);
  };

  const renderHalf = (lng: "en" | "es", label: string, isFirst: boolean) => {
    const active = current === lng;
    return (
      <TouchableOpacity
        key={lng}
        onPress={() => onPress(lng)}
        style={[
          styles.half,
          // Subtle 1px light-grey divider between EN and ES halves. Only
          // applied to the second half so the line lives on the boundary
          // and never doubles up. Stays the same colour whether the
          // active half is on the left or the right — i.e. the divider
          // is part of the chrome, not part of either half.
          !isFirst && styles.halfDivider,
          active
            ? { backgroundColor: brand.primary }
            : { backgroundColor: "#ffffff" },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        testID={`button-lang-${lng}`}
      >
        {/* Top-half white gloss highlight — matches the web
            TogglePill's `before:` pseudo-element gloss that runs
            across both the rest and active states. 50% white on
            the top half, transparent on the bottom. Sits behind
            the label via absolute fill + pointerEvents none. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "50%",
            backgroundColor: "rgba(255,255,255,0.5)",
          }}
        />
        <Text
          style={[
            styles.label,
            // Active: white-on-tonal with the canonical TogglePill drop
            // shadow for legibility against any brand color.
            // Inactive: dark text on white (matches the web
            // TogglePillButton's `text-gray-800/85` rest label).
            active
              ? { color: "#ffffff", ...styles.labelActiveShadow }
              : { color: "#1a1d23" },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, style]} testID="language-toggle">
      {renderHalf("en", "EN", true)}
      {renderHalf("es", "ES", false)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    // Hairline-ish light grey outline (StyleSheet.hairlineWidth keeps
    // it visually thin on every density without tipping into chunky on
    // 3x screens). Matches the web TogglePillButton at-rest border.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PILL_OUTLINE,
    borderRadius: 999,
    overflow: "hidden",
  },
  half: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  halfDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: PILL_OUTLINE,
  },
  label: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  labelActiveShadow: {
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
