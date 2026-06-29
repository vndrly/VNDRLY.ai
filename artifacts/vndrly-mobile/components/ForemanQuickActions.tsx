import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import type { NotificationRow } from "@/lib/notifications-ui";

type UpcomingScheduleTicket = {
  id: number;
  scheduledStartAt: string | null;
  siteName: string | null;
  workTypeName: string | null;
};

type UpcomingScheduleResponse = {
  tickets?: UpcomingScheduleTicket[];
};

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

function formatNotificationSummary(item?: NotificationRow): string {
  if (!item) return "No recent alerts";
  return item.title?.trim() || item.body?.trim() || "Latest alert";
}

function formatScheduleSummary(ticket?: UpcomingScheduleTicket): string {
  if (!ticket?.scheduledStartAt) return "No tickets scheduled today";
  const d = new Date(ticket.scheduledStartAt);
  const when = Number.isNaN(d.getTime())
    ? "Scheduled"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return `${when} · #${ticket.id}`;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function ForemanQuickActions({
  latestTicket = null,
  unreadAlerts = 0,
  pendingSchedule = 0,
  onSchedulePress,
}: Props) {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const { data: latestNotification } = useQuery({
    queryKey: ["foreman-latest-notification"],
    queryFn: async () => {
      const rows = await apiFetch<NotificationRow[]>("/api/notifications?limit=1");
      return rows[0] ?? null;
    },
    refetchInterval: 60_000,
  });
  const { data: nextSchedule } = useQuery({
    queryKey: ["foreman-today-schedule"],
    queryFn: async () => {
      const response = await apiFetch<UpcomingScheduleResponse>(
        "/api/me/upcoming-schedule?days=1",
      );
      return (response.tickets ?? [])
        .filter((ticket) => isToday(ticket.scheduledStartAt))
        .sort(
          (a, b) =>
            Date.parse(a.scheduledStartAt!) - Date.parse(b.scheduledStartAt!),
        )[0] ?? null;
    },
    refetchInterval: 60_000,
  });

  const tiles: Tile[] = [
    {
      key: "alerts",
      icon: "bell" as const,
      label: t("foremanHome.alerts"),
      badge: unreadAlerts,
      onPress: () => router.push("/notifications"),
      summary: formatNotificationSummary(latestNotification ?? undefined),
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
      label: t("foremanHome.schedule"),
      badge: pendingSchedule,
      onPress: onSchedulePress ?? (() => router.push("/(tabs)/schedule")),
      summary: formatScheduleSummary(nextSchedule ?? undefined),
      testID: "foreman-action-schedule",
    },
    {
      key: "safety",
      icon: "shield" as const,
      label: "Safety Reports",
      onPress: () => router.push("/safety-my-reports"),
      summary: "Open safety reports",
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
          <TouchableOpacity
            key={tile.key}
            onPress={tile.onPress}
            style={[
              styles.tile,
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
