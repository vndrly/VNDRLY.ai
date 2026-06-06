import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View, type ViewStyle } from "react-native";

import SplitToggleHalf from "@/components/SplitToggleHalf";
import { useBrand } from "@/hooks/use-brand";
import { setLanguage } from "@/lib/i18n";
import { pickTogglePillSrc, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";

const PILL_OUTLINE = "#d4d4d8";

type Props = {
  style?: ViewStyle | ViewStyle[];
};

/** EN/ES toggle — PNG pill halves, 3-slice (matches web LanguageToggle). */
export default function LanguageToggle({ style }: Props) {
  const brand = useBrand();
  const { i18n } = useTranslation();
  const current = i18n.language?.startsWith("es") ? "es" : "en";
  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);

  const onPress = (lng: "en" | "es") => {
    if (lng === current) return;
    void setLanguage(lng);
  };

  const activeText = {
    color: "#ffffff" as const,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 } as const,
    textShadowRadius: 2,
  };
  const idleText = { color: "#374151" as const };

  return (
    <View style={[styles.container, style]} testID="language-toggle">
      <SplitToggleHalf
        side="left"
        pillSrc={current === "en" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
        onPress={() => onPress("en")}
        textStyle={current === "en" ? activeText : idleText}
        testID="button-lang-en"
        accessibilityState={{ selected: current === "en" }}
      >
        EN
      </SplitToggleHalf>
      <View style={styles.divider} />
      <SplitToggleHalf
        side="right"
        pillSrc={current === "es" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
        onPress={() => onPress("es")}
        textStyle={current === "es" ? activeText : idleText}
        testID="button-lang-es"
        accessibilityState={{ selected: current === "es" }}
      >
        ES
      </SplitToggleHalf>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PILL_OUTLINE,
    borderRadius: 999,
    overflow: "hidden",
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: PILL_OUTLINE,
    alignSelf: "stretch",
  },
});
