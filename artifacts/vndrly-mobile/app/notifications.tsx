import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type NotificationRow = {
  id: number;
  type: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

// Map known notification `category` values to an i18n label key. Used as the
// fallback badge text when a row's `type` doesn't have a richer entry in
// TYPE_META below — keeps the badge readable in Spanish (and matches the
// labels already used in the notification preferences screen) instead of
// shouting the raw English enum like "TICKETS" or "COMPLIANCE".
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  ticket: "notifications.rows.tickets",
  tickets: "notifications.rows.tickets",
  hotlist: "notifications.rows.hotlist",
  compliance: "notifications.rows.compliance",
  crew: "notifications.rows.crew",
  system: "notifications.rows.system",
  comment: "notifications.rows.comments",
  comments: "notifications.rows.comments",
};

// Map known notification `type` values to a recognizable icon + i18n label.
// Unknown types fall back to the category badge (handled at the call site).
type FeatherName = React.ComponentProps<typeof Feather>["name"];
const TYPE_META: Record<string, { icon: FeatherName; labelKey: string }> = {
  ticket_assigned: { icon: "briefcase", labelKey: "notifications.types.ticket_assigned" },
  crew_added: { icon: "user-plus", labelKey: "notifications.types.crew_added" },
  // Task #649 — distinguish a re-schedule of an already-on-roster crew
  // member from a fresh add so the badge tells the worker what changed.
  schedule_changed: { icon: "clock", labelKey: "notifications.types.schedule_changed" },
  // Task #639: also surface crew_removed in the bell list with a
  // matching icon. The dedicated /crew-changes screen filters down
  // to just these two types, but a worker who jumps straight to the
  // general inbox should still see the same recognizable badge.
  crew_removed: { icon: "user-minus", labelKey: "notifications.types.crew_removed" },
  hotlist_match: { icon: "zap", labelKey: "notifications.types.hotlist_match" },
  bid_outbid: { icon: "trending-down", labelKey: "notifications.types.bid_outbid" },
  job_awarded: { icon: "award", labelKey: "notifications.types.job_awarded" },
  cert_expiring: { icon: "calendar", labelKey: "notifications.types.cert_expiring" },
  cert_expired: { icon: "alert-octagon", labelKey: "notifications.types.cert_expired" },
  long_checkin: { icon: "clock", labelKey: "notifications.types.long_checkin" },
  rating_received: { icon: "star", labelKey: "notifications.types.rating_received" },
};

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Task #699 — surface a friendly slow-down banner when the
  // /api/notifications endpoint returns 429 with code
  // "notifications.rate_limited", and skip the load() call until the
  // server-supplied window resets so we don't immediately re-trip the
  // limiter on focus or pull-to-refresh.
  const [loadError, setLoadError] = useState<unknown>(null);
  const { rateLimited, retryAfterSeconds } = useRateLimitGate(
    loadError,
    "notifications.rate_limited",
  );

  function timeAgo(iso: string): string {
    const tt = new Date(iso).getTime();
    const s = Math.floor((Date.now() - tt) / 1000);
    if (s < 60) return t("notifications.ago.second", { n: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t("notifications.ago.minute", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("notifications.ago.hour", { n: h });
    const d = Math.floor(h / 24);
    return t("notifications.ago.day", { n: d });
  }

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NotificationRow[]>("/api/notifications");
      setItems(data || []);
      // Clear any stale error so the gate can disarm on a successful
      // recovery fetch (the hook only re-arms when it sees a *new*
      // error reference, but holding onto an old 429 here would block
      // future loads from looking error-free).
      setLoadError(null);
    } catch (e) {
      // Park on rate-limit instead of popping a blocking modal — the
      // gate hook reads this error and surfaces the slow-down banner.
      // Generic load failures still pop the existing alert so users
      // know the screen is stale.
      const status = (e as { status?: unknown })?.status;
      if (status === 429) {
        setLoadError(e);
      } else {
        Alert.alert(t("common.error"), t("notifications.loadFailed"));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    // Don't kick off another load while we're parked — the gate's
    // auto-clear timer flips `rateLimited` back to false at the end of
    // the window, which re-runs this effect and re-issues the fetch.
    if (rateLimited) return;
    load();
  }, [load, rateLimited]);

  const markRead = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, isRead: true } : x)));
    } catch (e) {
      console.warn("markRead", e);
    }
  };

  // The server stores notification links in web format (e.g. "/tickets/123").
  // The mobile route is "/ticket/[id]" (singular). Translate ticket links to
  // the mobile route. Non-ticket links (invoices, vendors, etc.) have no
  // mobile screen yet, so they just mark-as-read.
  const ticketIdFromLink = (link: string | null): number | null => {
    if (!link) return null;
    const m = link.match(/^\/tickets?\/(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const onCardPress = (item: NotificationRow) => {
    if (!item.isRead) markRead(item.id);
    const ticketId = ticketIdFromLink(item.link);
    if (ticketId !== null) {
      router.push(`/ticket/${ticketId}`);
    }
  };

  const markAll = async () => {
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST" });
      setItems((xs) => xs.map((x) => ({ ...x, isRead: true })));
    } catch (e) {
      console.warn("markAll", e);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.heading, { color: colors.foreground }]}>{t("notifications.title")}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity onPress={() => router.push("/notification-preferences")} style={styles.iconBtn}>
            <Feather name="settings" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={markAll} style={styles.iconBtn} accessibilityLabel={t("notifications.markAll")}>
            <Feather name="check-circle" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {rateLimited ? (
        <View
          style={[
            styles.slowDownBanner,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
          accessibilityRole="alert"
          testID="notifications-slow-down-banner"
        >
          <Feather name="clock" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.slowDownText, { color: colors.mutedForeground }]}
          >
            {retryAfterSeconds != null
              ? t("notifications.slowDown.retryIn", {
                  seconds: retryAfterSeconds,
                })
              : t("notifications.slowDown.brief")}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                // Task #699 — pull-to-refresh during cooldown would
                // immediately re-trip the limiter and reset the user's
                // window. Snap the spinner back instead so the gesture
                // feels acknowledged but no fetch goes out; the gate's
                // auto-clear timer will resume polling on its own.
                if (rateLimited) return;
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {t("notifications.empty")}
            </Text>
          }
          renderItem={({ item }) => {
            const meta = TYPE_META[item.type];
            const categoryKey = CATEGORY_LABEL_KEYS[item.category];
            const labelText = meta
              ? t(meta.labelKey)
              : categoryKey
                ? t(categoryKey)
                : item.category.toUpperCase();
            return (
              <TouchableOpacity
                onPress={() => onCardPress(item)}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: item.isRead ? colors.border : colors.primary,
                  },
                ]}
                testID={`notification-${item.id}`}
              >
                <View style={styles.cardHeaderRow}>
                  {meta ? (
                    <View
                      style={[
                        styles.typeBadge,
                        {
                          backgroundColor: item.isRead ? colors.muted : colors.primary,
                        },
                      ]}
                      testID={`notification-${item.id}-type-${item.type}`}
                    >
                      <Feather
                        name={meta.icon}
                        size={12}
                        color={item.isRead ? colors.mutedForeground : colors.primaryForeground}
                      />
                      <Text
                        style={[
                          styles.typeBadgeText,
                          { color: item.isRead ? colors.mutedForeground : colors.primaryForeground },
                        ]}
                      >
                        {labelText}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.cardCat, { color: colors.mutedForeground }]}>
                      {labelText}
                    </Text>
                  )}
                </View>
                <Text style={[styles.cardTitle, { color: item.isRead ? colors.mutedForeground : colors.primary }]}>
                  {item.title}
                </Text>
                {item.body ? (
                  <Text style={[styles.cardBody, { color: colors.foreground }]}>
                    {item.body}
                  </Text>
                ) : null}
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {timeAgo(item.createdAt)}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  iconBtn: { padding: 8 },
  heading: { fontFamily: "Inter_700Bold", fontSize: 18, flex: 1, marginLeft: 4 },
  slowDownBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  slowDownText: { fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 },
  empty: { textAlign: "center", marginTop: 40, fontFamily: "Inter_400Regular" },
  card: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  cardCat: { fontFamily: "Inter_500Medium", fontSize: 10, marginBottom: 4 },
  cardHeaderRow: { flexDirection: "row", marginBottom: 6 },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  typeBadgeText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.3 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 14, marginBottom: 4 },
  cardBody: { fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 6 },
  cardMeta: { fontFamily: "Inter_400Regular", fontSize: 11 },
});
