import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, Stack } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

// Task #639 — a focused "My crew changes" feed for field employees.
// Backed by the existing `notifications` rows with type
// `crew_added` / `crew_removed` (filtered server-side via `?type=`),
// this gives workers a durable history of recent assignments and
// removals they can scroll through after a missed push (DND, dead
// phone, dropped notification). The bell-style notifications screen
// already exists, but it mixes everything together — this screen is
// the "what jobs am I being put on / pulled off recently?" view a
// worker can open at the start of a shift.

type NotificationRow = {
  id: number;
  type: "crew_added" | "crew_removed" | string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TYPE_META: Record<string, { icon: FeatherName; labelKey: string }> = {
  crew_added: { icon: "user-plus", labelKey: "notifications.types.crew_added" },
  crew_removed: {
    icon: "user-minus",
    labelKey: "notifications.types.crew_removed",
  },
};

const PAGE_SIZE = 25;
const TYPES_QUERY = "crew_added,crew_removed";

// Pull the ticket id out of the notification's stored link so a row
// taps to the right place. crew_added stores `/tickets/123` (worker
// has access). crew_removed stores `/tickets` (worker no longer has
// access — opening the detail would 403, so taps just mark-read).
function ticketIdFromLink(link: string | null): number | null {
  if (!link) return null;
  const m = link.match(/^\/tickets\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function CrewChangesScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errored, setErrored] = useState(false);

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

  // First page / pull-to-refresh — reset the cursor + list. Server
  // returns rows in `desc(createdAt)` order, so the oldest row in the
  // returned page becomes the cursor for the next "load more".
  const loadFirstPage = useCallback(async () => {
    try {
      setErrored(false);
      const data = await apiFetch<NotificationRow[]>(
        `/api/notifications?type=${TYPES_QUERY}&limit=${PAGE_SIZE}`,
      );
      const rows = data ?? [];
      setItems(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = items[items.length - 1].createdAt;
      const data = await apiFetch<NotificationRow[]>(
        `/api/notifications?type=${TYPES_QUERY}&limit=${PAGE_SIZE}&before=${encodeURIComponent(
          cursor,
        )}`,
      );
      const rows = data ?? [];
      setItems((prev) => {
        // Defensive de-dupe: a fresh row could squeeze in between
        // requests at the boundary. Keep the existing entry to
        // preserve any optimistic read-state.
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      // Soft-fail: leave the existing list intact, just stop
      // advertising more pages so the spinner clears.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, hasMore]);

  // Refresh when the screen comes into focus (also fires on first
  // mount in expo-router) so newly read state and any rows that
  // arrived while the user was elsewhere show up. Using
  // `useFocusEffect` exclusively (rather than pairing with a
  // mount-time `useEffect`) avoids issuing the same first-page
  // request twice in the initial render.
  useFocusEffect(
    useCallback(() => {
      loadFirstPage();
    }, [loadFirstPage]),
  );

  const markRead = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
      setItems((xs) =>
        xs.map((x) => (x.id === id ? { ...x, isRead: true } : x)),
      );
    } catch {
      // Non-fatal; the read flip is purely UX.
    }
  };

  const onCardPress = (item: NotificationRow) => {
    if (!item.isRead) markRead(item.id);
    const ticketId = ticketIdFromLink(item.link);
    if (ticketId !== null) {
      // crew_added rows store `/tickets/<id>` in `link` (the same
      // column the bell-style inbox already uses to deep-link), so
      // we route to the mobile ticket detail. We deliberately read
      // `link` rather than a separate `ticketId` column because
      // `notifications` rows only carry `link` server-side — the
      // `pushData.ticketId` field exists on push payloads, not on
      // persisted rows. Mirrors `notifications.tsx`'s onCardPress.
      router.push(`/ticket/${ticketId}`);
      return;
    }
    if (item.link === "/tickets") {
      // crew_removed rows store `/tickets` (no id) on purpose: the
      // removed worker no longer has access to the ticket detail
      // (see crew.ts comment on the crew_removed notify call). We
      // still route them to the open-tickets list so the row is
      // navigable — the body text already shows the tracking
      // number + site for context.
      router.push("/(tabs)" as never);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: "transparent" }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader
        title={t("crewChanges.title")}
        right={<ActiveOrgIndicator />}
      />

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
                setRefreshing(true);
                loadFirstPage();
              }}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {errored
                ? t("crewChanges.loadFailed")
                : t("crewChanges.empty")}
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={{ marginVertical: 16 }}
                color={colors.primary}
                testID="crew-changes-loading-more"
              />
            ) : null
          }
          renderItem={({ item }) => {
            const meta = TYPE_META[item.type];
            const labelText = meta
              ? t(meta.labelKey)
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
                testID={`crew-change-${item.id}`}
              >
                <View style={styles.cardHeaderRow}>
                  {meta ? (
                    <View
                      style={[
                        styles.typeBadge,
                        {
                          backgroundColor: item.isRead
                            ? colors.muted
                            : colors.primary,
                        },
                      ]}
                      testID={`crew-change-${item.id}-type-${item.type}`}
                    >
                      <Feather
                        name={meta.icon}
                        size={12}
                        color={
                          item.isRead
                            ? colors.mutedForeground
                            : colors.primaryForeground
                        }
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
                    <Text
                      style={[
                        styles.cardCat,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {labelText}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.cardTitle,
                    {
                      color: item.isRead
                        ? colors.mutedForeground
                        : colors.primary,
                    },
                  ]}
                >
                  {item.title}
                </Text>
                {item.body ? (
                  <Text
                    style={[styles.cardBody, { color: colors.foreground }]}
                  >
                    {item.body}
                  </Text>
                ) : null}
                <Text
                  style={[styles.cardMeta, { color: colors.mutedForeground }]}
                >
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
  typeBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.3,
  },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 14, marginBottom: 4 },
  cardBody: { fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 6 },
  cardMeta: { fontFamily: "Inter_400Regular", fontSize: 11 },
});
