import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { FieldModeSnapshot } from "@/lib/field-mode-policy";

export default function FieldModeStatus({ snapshot, onEndWork }: { snapshot: FieldModeSnapshot; onEndWork: () => void }) {
  const { t } = useTranslation();
  if (snapshot.mode === "off" || snapshot.mode === "ended") return null;
  return (
    <View accessibilityRole="summary" style={styles.container} testID="field-mode-status">
      <Text style={styles.label}>{t("fieldMode.active")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("fieldMode.endWork")} onPress={onEndWork} style={styles.button}>
        <Text style={styles.buttonText}>{t("fieldMode.endWork")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 58,
    right: 12,
    zIndex: 80,
    maxWidth: 250,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 12,
    paddingRight: 7,
    borderRadius: 999,
    backgroundColor: "#103B2A",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  label: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", flexShrink: 1 },
  button: { minHeight: 32, justifyContent: "center", paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#FFFFFF" },
  buttonText: { color: "#103B2A", fontSize: 12, fontWeight: "800" },
});
