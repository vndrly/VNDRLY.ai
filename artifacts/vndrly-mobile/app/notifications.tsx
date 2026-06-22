import { Feather } from "@expo/vector-icons";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import InPageHeader from "@/components/InPageHeader";
import NotificationActionModal from "@/components/NotificationActionModal";
import NotificationSendToModal from "@/components/NotificationSendToModal";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { stopBellTolling } from "@/lib/notificationSounds";
import { syncAppIconBadge } from "@/lib/notificationBadge";
import {
  effectiveNotificationCategory,
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_TYPE_META,
  notificationTypeLabel,
  type NotificationRow,
} from "@/lib/notifications-ui";

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  const initialCategory =
    categoryParam && NOTIFICATION_CATEGORY_IDS.includes(categoryParam as (typeof NOTIFICATION_CATEGORY_IDS)[number])
      ? categoryParam
      : "all";
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<NotificationRow | null>(null);
  const [sendToItem, setSendToItem] = useState<NotificationRow | null>(null);
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
      void syncAppIconBadge();
      setLoadError(null);
    } catch (e) {
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
    if (rateLimited) return;
    load();
  }, [load, rateLimited]);

  useFocusEffect(
    useCallback(() => {
      stopBellTolling();
    }, []),
  );

  useEffect(() => {
    setActiveCategory(initialCategory);
  }, [initialCategory]);

  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return items;
    return items.filter((item) => effectiveNotificationCategory(item) === activeCategory);
  }, [activeCategory, items]);

  const categoryUnread = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (item.isRead) continue;
      const cat = effectiveNotificationCategory(item);
      counts[cat] = (counts[cat] ?? 0) + 1;
      counts.all = (counts.all ?? 0) + 1;
    }
    return counts;
  }, [items]);

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

  const onCardPress = (item: NotificationRow) => {
    setSelected(item);
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader
        title={t("notifications.title")}
        compactVertical={7}
        right={
          <View style={{ flexDirection: "row", gap: 4 }}>
            <TouchableOpacity
              onPress={() => router.push("/notification-preferences")}
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
        }
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
        style={styles.categoryScroll}
      >
        {NOTIFICATION_CATEGORY_IDS.map((id) => {
          const selected = activeCategory === id;
          const unread = categoryUnread[id] ?? 0;
          return (
            <TouchableOpacity
              key={id}
              onPress={() => setActiveCategory(id)}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: selected ? colors.primary : colors.muted,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              testID={`notifications-tab-${id}`}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  { color: selected ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {t(`notifications.categories.${id}`)}
                {unread > 0 ? ` (${unread})` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
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
  iconBtn: { padding: 8 },
  categoryScroll: { flexGrow: 0, marginBottom: 4 },
  categoryRow: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  categoryChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryChipText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
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
