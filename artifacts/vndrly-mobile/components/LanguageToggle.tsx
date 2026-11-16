import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { setLanguage } from "@/lib/i18n";
import { iosPageLayout } from "@/lib/ios-page-layout";

export default function LanguageToggle({ style, onChange = setLanguage, disabled = false, navigation = false }: { style?: ViewStyle | ViewStyle[]; onChange?: (language: "en" | "es") => void | Promise<unknown>; disabled?: boolean; navigation?: boolean }) {
  const { i18n } = useTranslation();
  const brand = useBrand();
  const colors = useColors();
  const spanish = i18n.language?.startsWith("es") === true;
  const choose = (language: "en" | "es") => {
    if ((language === "es") !== spanish) void onChange(language);
  };

  if (iosPageLayout && !navigation) return null;
  return (
    <View style={[styles.container, style]} testID="language-toggle">
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !spanish }}
        disabled={disabled} onPress={() => choose("en")} style={styles.labelButton} testID="button-lang-en">
        <Text style={[styles.label, { color: spanish ? colors.mutedForeground : brand.primary }]}>English</Text>
      </Pressable>
      <Pressable accessibilityRole="switch" accessibilityLabel="English / Español"
        accessibilityState={{ checked: spanish }} disabled={disabled} onPress={() => choose(spanish ? "en" : "es")}
        style={styles.switchButton}>
        <View style={[styles.track, spanish && styles.spanishTrack]}>
          <View style={styles.thumb} />
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: spanish }}
        disabled={disabled} onPress={() => choose("es")} style={styles.labelButton} testID="button-lang-es">
        <Text style={[styles.label, { color: spanish ? brand.primary : colors.mutedForeground }]}>Español</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  labelButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  label: { fontSize: 14, fontWeight: "700" },
  switchButton: { minHeight: 44, justifyContent: "center" },
  track: { width: 44, height: 24, borderRadius: 12, backgroundColor: "#6b7280", padding: 3 },
  spanishTrack: { alignItems: "flex-end", backgroundColor: "#22c55e" },
  thumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff" },
});
