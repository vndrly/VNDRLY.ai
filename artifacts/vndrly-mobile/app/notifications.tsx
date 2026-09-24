import { Feather } from "@expo/vector-icons";
import { router, Stack, useFocusEffect, useLocalSearchParams, usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  useWindowDimensions,
} from "react-native";

import NotificationActionModal from "@/components/NotificationActionModal";
import NotificationSendToModal from "@/components/NotificationSendToModal";
import PortalPageHeader from "@/components/PortalPageHeader";
import NotificationCategoryCarousel from "@/components/NotificationCategoryCarousel";
import { useNotificationInbox } from "@/hooks/use-notification-inbox";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { stopBellTolling } from "@/lib/notificationSounds";
import { syncAppIconBadge } from "@/lib/notificationBadge";
import { openNotificationDestination } from "@/lib/notification-deep-links";
import {
  effectiveNotificationCategory,
  NOTIFICATION_TYPE_META,
  notificationTypeLabel,
  type NotificationRow,
} from "@/lib/notifications-ui";

// Task 7 supplies localized gate labels and empty copy; defaults keep the staged UI readable.
const CATEGORY_LABELS: Record<string, string> = { all: "All", schedule: "Schedule", gate_crew: "Gate Crew", messages: "Messages", handoffs: "Handoffs", tasks: "Tasks", compliance: "Compliance", alerts: "Alerts" };

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  const { generation, activeCategory, selectCategory, categories, isGate, items, setItems, loading, refreshing, loadingMore, loadError, rateLimited, retryAfterSeconds, refresh, loadMore, retry } = useNotificationInbox(categoryParam ?? "all");
  const [selected, setSelected] = useState<NotificationRow | null>(null);
  const [sendToItem, setSendToItem] = useState<NotificationRow | null>(null);
  useEffect(() => { setSelected(null); setSendToItem(null); }, [generation]);

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

  useFocusEffect(
    useCallback(() => {
      stopBellTolling();
    }, []),
  );

  const filteredItems = useMemo(() => {
    if (isGate || activeCategory === "all") return items;
    return items.filter((item) => effectiveNotificationCategory(item) === activeCategory);
  }, [activeCategory, items, isGate]);

  const categoryUnread = useMemo(() => {
    const counts: Record<string, number> = {};
    // Gate pages are partial; only the separately fetched bell has an authoritative total.
    if (isGate) return counts;
    for (const item of items) {
      if (item.isRead) continue;
      const cat = item.displayCategory ?? effectiveNotificationCategory(item);
      counts[cat] = (counts[cat] ?? 0) + 1;
      counts.all = (counts.all ?? 0) + 1;
    }
    return counts;
  }, [items, isGate]);

  const updateItem = (id: number, patch: Partial<NotificationRow>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setSelected((cur) => (cur?.id === id ? { ...cur, ...patch } : cur));
  };

  const markRead = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
      updateItem(id, { isRead: true });
      void syncAppIconBadge();
    } catch {
      Alert.alert(t("common.error"), t("notifications.actionFailed"));
    }
  };

  const markUnread = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/unread`, { method: "POST" });
      updateItem(id, { isRead: false });
      void syncAppIconBadge();
    } catch {
      Alert.alert(t("common.error"), t("notifications.actionFailed"));
    }
  };

  const deleteNotification = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
      setItems((xs) => xs.filter((x) => x.id !== id));
      setSelected((cur) => (cur?.id === id ? null : cur));
      void syncAppIconBadge();
    } catch {
      Alert.alert(t("common.error"), t("notifications.actionFailed"));
    }
  };

  const onCardPress = async (item: NotificationRow) => {
    if (!item.displayCategory) {
      setSelected(item);
      return;
    }
    try {
      const result = await openNotificationDestination(item, router);
      if (result === "unavailable") {
        Alert.alert(t("common.error"), t("notifications.destinationUnavailable", {
          defaultValue: "This notification's destination is no longer available.",
        }));
        return;
      }
      updateItem(item.id, { isRead: true });
      void syncAppIconBadge();
    } catch {
      Alert.alert(t("common.error"), t("notifications.actionFailed"));
    }
  };

  const markAll = async () => {
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST" });
      setItems((xs) => xs.map((x) => ({ ...x, isRead: true })));
      void syncAppIconBadge();
    } catch (e) {
      console.warn("markAll", e);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PortalPageHeader
        title={t("notifications.title")}
        testIdPrefix="notifications"
        fallbackHref="/(tabs)/change-over"
      />
      <Text style={[styles.pageDescription, { color: colors.mutedForeground }]}>
        {t("notifications.description")}
      </Text>

      <View
        style={[
          styles.inboxCard,
          { backgroundColor: colors.card, borderColor: colors.primary },
        ]}
        testID="notifications-inbox-card"
      >
      <View style={styles.cardActions}>
        <TouchableOpacity
          onPress={() =>
            router.push(
              pathname.endsWith("/gate-notifications")
                ? "/(tabs)/gate-notification-preferences"
                : "/notification-preferences",
            )
          }
          style={styles.iconBtn}
          accessibilityLabel={t("notifications.preferencesTitle")}
        >
          <Feather name="settings" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={markAll}
          style={styles.iconBtn}
          accessibilityLabel={t("notifications.markAll")}
        >
          <Feather name="check-circle" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <NotificationCategoryCarousel
        categories={categories}
        activeCategory={activeCategory}
        unread={categoryUnread}
        width={width}
        onSelect={selectCategory}
        label={(id) => t(`notifications.categories.${id}`, { defaultValue: CATEGORY_LABELS[id] ?? id })}
      />
      <View
        style={[styles.categoryDivider, { backgroundColor: colors.border }]}
        testID="notifications-category-divider"
      />
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
          style={{ flex: 1 }}
          data={filteredItems}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
            />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {loadError ? t("notifications.loadFailed") : isGate && activeCategory !== "all"
                ? t(`notifications.emptyCategories.${activeCategory}`, { defaultValue: `No ${(CATEGORY_LABELS[activeCategory] ?? activeCategory).toLowerCase()} notifications yet.` })
                : t("notifications.empty")}
            </Text>
          }
          onEndReached={() => { if (!loadError) void loadMore(); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : loadError && !rateLimited ? (
            <View testID="notifications-load-error" accessibilityRole="alert">
              <Text style={{ color: colors.mutedForeground }}>{t("notifications.loadFailed")}</Text>
              <TouchableOpacity onPress={retry} testID="notifications-retry" accessibilityRole="button">
                <Text style={{ color: colors.primary }}>{t("common.retry", { defaultValue: "Retry" })}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          renderItem={({ item }) => {
            const meta = NOTIFICATION_TYPE_META[item.type];
            const labelText = notificationTypeLabel(item, t);
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
                          {
                            color: item.isRead
                              ? colors.mutedForeground
                              : colors.primaryForeground,
                          },
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
                <Text
                  style={[
                    styles.cardTitle,
                    { color: item.isRead ? colors.mutedForeground : colors.primary },
                  ]}
                >
                  {item.title}
                </Text>
                {item.body ? (
                  <Text numberOfLines={1} style={[styles.cardBody, { color: colors.foreground }]}>
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

      <NotificationActionModal
        visible={selected !== null}
        item={selected}
        typeLabel={selected ? notificationTypeLabel(selected, t) : ""}
        timeAgoLabel={selected ? timeAgo(selected.createdAt) : ""}
        onClose={() => setSelected(null)}
        onMarkRead={markRead}
        onMarkUnread={markUnread}
        onDelete={deleteNotification}
        onSendTo={() => {
          if (selected) {
            setSendToItem(selected);
            setSelected(null);
          }
        }}
      />

      <NotificationSendToModal
        visible={sendToItem !== null}
        item={sendToItem}
        typeLabel={sendToItem ? notificationTypeLabel(sendToItem, t) : ""}
        onClose={() => setSendToItem(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pageDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginBottom: 12,
    marginHorizontal: 20,
    marginTop: -8,
  },
  inboxCard: {
    borderRadius: 12,
    borderWidth: 2,
    flex: 1,
    marginBottom: 12,
    marginHorizontal: 12,
    overflow: "hidden",
  },
  cardActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  iconBtn: { padding: 8 },
  categoryDivider: {
    height: 1,
    marginHorizontal: 12,
  },
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
