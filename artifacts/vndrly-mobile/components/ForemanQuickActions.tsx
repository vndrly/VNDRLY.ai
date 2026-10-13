import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { useDailySummary } from "@/lib/daily-workspace";

type TicketSummary = {
  id: number;
  updatedAt: string | null;
  createdAt: string;
};

type Props = {
  latestTicket?: TicketSummary | null;
  unreadAlerts?: number;
  pendingSchedule?: number;
  onSchedulePress?: () => void;
};

type Tile = {
  badge?: number;
  icon: React.ComponentProps<typeof Feather>["name"];
  key: string;
  label: string;
  onPress: () => void;
  summary: string;
  testID: string;
};

function formatTicketSummary(ticket?: TicketSummary | null): string {
  if (!ticket) return "No recent ticket";
  return `#${ticket.id}`;
}

export default function ForemanQuickActions({ latestTicket = null }: Props) {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const daily = useDailySummary();
  const summary = daily.data;

  const tiles: Tile[] = [
    {
      key: "alerts",
      icon: "bell" as const,
      label: "Needs Attention",
      badge: summary?.attentionCount ?? undefined,
      onPress: () => router.push("/work-hub/attention" as never),
      summary:
        summary?.attentionCount != null
          ? summary.topAttentionLabel ||
            `${summary.attentionCount} need attention`
          : "Summary unavailable",
      testID: "foreman-action-alerts",
    },
    {
      key: "new",
      icon: "plus-circle" as const,
      label: t("foremanHome.startJob"),
      onPress: () => router.push("/new-ticket"),
      summary: formatTicketSummary(latestTicket),
      testID: "foreman-action-start-job",
    },
    {
      key: "schedule",
      icon: "calendar" as const,
      label: "Calendar",
      badge: summary?.calendarCount ?? undefined,
      onPress: () => router.push("/work-hub/calendar" as never),
      summary:
        summary?.calendarCount != null
          ? summary.nextCalendarLabel || `${summary.calendarCount} upcoming`
          : "Summary unavailable",
      testID: "foreman-action-schedule",
    },
    {
      key: "safety",
      icon: "shield" as const,
      label: "Safety",
      onPress: () => router.push("/work-hub/safety" as never),
      badge: summary?.safetyCount ?? undefined,
      summary:
        summary?.safetyCount != null
          ? `${summary.safetyCount} safety items`
          : "Summary unavailable",
      testID: "foreman-action-safety-reports",
    },
  ];

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {t("foremanHome.quickActions")}
      </Text>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View key={tile.key} style={[styles.tile, {backgroundColor:colors.card,borderColor:brand.primary}]} >
          <TouchableOpacity
            onPress={tile.onPress}
            style={[
              {flex:1},
              {
                backgroundColor: colors.card,
                borderColor: brand.primary,
              },
            ]}
            testID={tile.testID}
            accessibilityRole="button"
          >
            <View style={styles.tileHeader}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${brand.primary}28` },
                ]}
              >
                <Feather name={tile.icon} size={20} color={brand.primary} />
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
            </View>
            <Text
              style={[styles.summary, { color: colors.mutedForeground }]}
              numberOfLines={2}
            >
              {tile.summary}
            </Text>
          </TouchableOpacity>
          {tile.key === "safety" ? <LayeredPillButton testID="button-safety-report" onPress={() => router.push("/safety-report")} height={32} style={{alignSelf:"flex-end",marginTop:8}}><Text style={{color:"#fff",fontSize:12}}>Report safety issue</Text></LayeredPillButton> : null}
          </View>
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
    borderRadius: 14,
    padding: 14,
    minHeight: 104,
  },
  tileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
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
    flex: 1,
  },
  summary: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 10,
  },
});
