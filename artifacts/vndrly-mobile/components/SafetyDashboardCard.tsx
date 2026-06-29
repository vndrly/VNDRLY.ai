import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { fetchSafetyMetrics } from "@/lib/safety-api";

export default function SafetyDashboardCard() {
  const { t } = useTranslation();
  const colors = useColors();
  const brand = useBrand();
  const { data, isLoading } = useQuery({
    queryKey: ["safety-metrics"],
    queryFn: fetchSafetyMetrics,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/notifications", params: { category: "safety" } })}
      style={[styles.card, { backgroundColor: colors.card, borderColor: brand.primary }]}
      testID="safety-dashboard-open-notifications"
    >
      <View style={styles.headerRow}>
        <Feather name="shield" size={16} color="#dc2626" />
        <Text style={[styles.title, { color: colors.foreground }]}>{t("safety.dashboardTitle")}</Text>
      </View>
      <View style={styles.grid}>
        <View style={styles.metric}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{t("safety.score")}</Text>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>{data.safetyScore}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{t("safety.daysClean")}</Text>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>
            {data.daysWithoutRecordable ?? "—"}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{t("safety.openEvents")}</Text>
          <Text style={[styles.metricValueSm, { color: colors.foreground }]}>{data.openEventCount}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{t("safety.openHipo")}</Text>
          <Text style={[styles.metricValueSm, { color: colors.foreground }]}>{data.openHipoCount}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metric: {
    width: "47%",
  },
  metricLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginBottom: 2,
  },
  metricValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
  },
  metricValueSm: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
  },
});
