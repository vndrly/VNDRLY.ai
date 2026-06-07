import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";

type Props = {
  unreadAlerts?: number;
  pendingSchedule?: number;
  onSchedulePress?: () => void;
};

export default function ForemanQuickActions({
  unreadAlerts = 0,
  pendingSchedule = 0,
  onSchedulePress,
}: Props) {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();

  const tiles = [
    {
      key: "alerts",
      icon: "bell" as const,
      label: t("foremanHome.alerts"),
      badge: unreadAlerts,
      onPress: () => router.push("/notifications"),
      testID: "foreman-action-alerts",
    },
    {
      key: "new",
      icon: "plus-circle" as const,
      label: t("foremanHome.startJob"),
      onPress: () => router.push("/new-ticket"),
      testID: "foreman-action-start-job",
    },
    {
      key: "schedule",
      icon: "calendar" as const,
      label: t("foremanHome.schedule"),
      badge: pendingSchedule,
      onPress: onSchedulePress ?? (() => router.push("/(tabs)/schedule")),
      testID: "foreman-action-schedule",
    },
    {
      key: "comms",
      icon: "radio" as const,
      label: t("foremanHome.crewComms"),
      onPress: () => router.push("/(tabs)/comms"),
      testID: "foreman-action-comms",
    },
  ];

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {t("foremanHome.quickActions")}
      </Text>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <TouchableOpacity
            key={tile.key}
            onPress={tile.onPress}
            style={[
              styles.tile,
              {
                backgroundColor: colors.card,
                borderColor: `${brand.primary}55`,
                borderLeftColor: brand.primary,
              },
            ]}
            testID={tile.testID}
            accessibilityRole="button"
          >
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: `${brand.primary}28` },
              ]}
            >
              <Feather name={tile.icon} size={22} color={brand.primary} />
              {tile.badge != null && tile.badge > 0 ? (
                <View style={[styles.badge, { backgroundColor: "#dc2626" }]}>
                  <Text style={styles.badgeText}>
                    {tile.badge > 99 ? "99+" : tile.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.label, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {tile.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    marginBottom: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "46%",
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 14,
    padding: 14,
    minHeight: 96,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    lineHeight: 18,
  },
});
