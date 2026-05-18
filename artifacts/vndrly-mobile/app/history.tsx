import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
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

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { useTicketsRateLimitGate } from "@/hooks/use-tickets-rate-limit-gate";
import { apiFetch } from "@/lib/api";
import {
  isTicketsRateLimited,
  noteTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";
import {
  ticketStaleDays,
  ticketStatusLabel,
  ticketStatusPillStyle,
} from "@/lib/ticketStatusLabels";

type HistoryTicket = {
  id: number;
  status: string;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  checkOutTime: string | null;
  createdAt: string;
  // Task #605: drives the 7-day inactivity escalation in the status
  // pill so a stalled ticket reads as urgent on mobile, matching the
  // web dispatcher view. History rows are usually terminal so this
  // mostly affects rare lingering pending_review / kicked_back
  // entries that haven't been resolved.
  updatedAt: string | null;
};

export default function HistoryScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<HistoryTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Task #679: header refresh button uses its own in-flight flag so the
  // icon can swap to a spinner without also triggering the pull-to-
  // refresh control's spinner. Mirrors the open-tickets / detail
  // screens shipped in Task #669.
  const [headerRefreshing, setHeaderRefreshing] = useState(false);
  // Task #679: brief "Refreshed" confirmation toast for manual refresh
  // (header button or pull-to-refresh). Mirrors the open-tickets list
  // toast from Task #669 so foremen reviewing past jobs get the same
  // visible cue across the field app. Auto-dismisses after ~3s.
  const [refreshedToastVisible, setRefreshedToastVisible] = useState(false);
  // Task #762 — most-recent error from `load()`. Drives the rate-limit
  // gate hook below so the History tab pauses + surfaces the same
  // "reconnecting" affordance the home/dashboard tab uses (Task #691)
  // when the per-session limiter (Task #675) trips on the field
  // endpoints. /api/field/history shares the same per-session budget
  // as /api/field/open-tickets, so without this gate a 429 here would
  // surface a generic alert and the next pull-to-refresh would
  // immediately re-trip the limit.
  const [loadError, setLoadError] = useState<unknown>(null);
  const { rateLimited, retryAfterSeconds } = useTicketsRateLimitGate(loadError);

  // Returns `true` only on a successful fetch so the manual refresh
  // entry points can gate the "Refreshed" confirmation toast — a
  // failed refresh should never falsely confirm a stale view.
  const load = useCallback(async (): Promise<boolean> => {
    try {
      // Task #762: short-circuit if the shared tickets rate-limit
      // cooldown is already active. Firing another /api/field/history
      // request now would just re-trip the limiter and indefinitely
      // extend the window. The hook above re-renders when the
      // cooldown expires; the recovery effect below then re-invokes
      // load() so the screen converges naturally.
      if (isTicketsRateLimited()) return false;
      const data = await apiFetch<HistoryTicket[]>("/api/field/history");
      setTickets(data || []);
      // A successful load means we're no longer in an error state —
      // clear so the gate hook doesn't re-fire on stale references.
      setLoadError(null);
      return true;
    } catch (e) {
      // Task #762: arm the rate-limit gate BEFORE deciding whether to
      // alert. Feed the error through `setLoadError` so the hook can
      // park the screen for the cooldown — and suppress the modal
      // alert on a 429, since the bottom-of-screen reconnecting toast
      // is the right affordance and a blocking modal on top of it
      // would be noisy and redundant.
      const rlSeconds = noteTicketsRateLimit(e);
      setLoadError(e);
      if (rlSeconds == null) {
        Alert.alert(t("common.error"), t("tickets.errorLoadHistory"));
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Task #762: auto-recover from a tickets rate-limit cooldown.
  // If `load()` short-circuited because the shared cooldown was
  // already active (e.g. the home tab or background reporter tripped
  // the limit just before this tab gained focus), the History tab
  // would otherwise sit on the previous (or empty) list with the
  // reconnecting toast forever — no further call site would re-fire
  // load() until the next pull-to-refresh. The hook flips
  // `rateLimited` back to false the moment the cooldown expires;
  // that's our cue to re-run load() so the list converges on its
  // own. Mirrors the home tab's recovery effect from Task #691.
  //
  // Track the previous `rateLimited` value in a ref so this only
  // fires on a true→false transition. Without that guard the effect
  // would also fire on the initial render (`rateLimited` starts at
  // false), double-loading alongside the mount effect above.
  const prevRateLimitedRef = React.useRef(false);
  useEffect(() => {
    const prev = prevRateLimitedRef.current;
    prevRateLimitedRef.current = rateLimited;
    if (!prev) return;
    if (rateLimited) return;
    void load();
  }, [rateLimited, load]);

  // Task #679: pull-to-refresh entry point. Mirrors the open-tickets
  // list pattern (Task #669) — fire the same fetch, then flash the
  // brief "Refreshed" toast on success.
  const onRefresh = useCallback(() => {
    // Task #762: ignore pull-to-refresh while the cooldown is active —
    // the RefreshControl is also marked disabled via `enabled={false}`
    // below, but guarding here too keeps programmatic callers safe.
    if (rateLimited) return;
    setRefreshing(true);
    void (async () => {
      try {
        const ok = await load();
        if (ok) setRefreshedToastVisible(true);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [load, rateLimited]);

  // Task #679: header refresh button handler. We intentionally don't
  // show the RefreshControl spinner here — that affordance belongs to
  // the pull gesture. Instead the header icon swaps to a spinner via
  // `headerRefreshing`, and the toast confirms completion the same way
  // the pull gesture does.
  const onHeaderRefresh = useCallback(() => {
    if (headerRefreshing || refreshing) return;
    // Task #762: a tap during cooldown would just re-trip the limiter.
    if (rateLimited) return;
    setHeaderRefreshing(true);
    void (async () => {
      try {
        const ok = await load();
        if (ok) setRefreshedToastVisible(true);
      } finally {
        setHeaderRefreshing(false);
      }
    })();
  }, [headerRefreshing, refreshing, rateLimited, load]);

  // Task #679: auto-dismiss the "Refreshed" confirmation after ~3s.
  // Same cadence as the open-tickets list toast so the cue feels
  // consistent across screens.
  useEffect(() => {
    if (!refreshedToastVisible) return;
    const handle = setTimeout(() => setRefreshedToastVisible(false), 3000);
    return () => clearTimeout(handle);
  }, [refreshedToastVisible]);

  // Task #679: header refresh button rendered through Stack.Screen so
  // it lives in the native nav bar alongside the back affordance —
  // same pattern the ticket detail screen uses (Task #669). The icon
  // swaps to a spinner while a request is in flight so the tap is
  // acknowledged without waiting for the toast.
  // Task #186: compose the active-org indicator with the existing
  // refresh button so screens that override `headerRight` still
  // surface the dual-role context reminder. Without this the
  // refresh-only `headerRight` defined here would replace the global
  // indicator the root stack injects.
  const headerRight = useCallback(
    () => (
      <>
        <ActiveOrgIndicator />
        <TouchableOpacity
          onPress={onHeaderRefresh}
          disabled={headerRefreshing || refreshing || rateLimited}
          accessibilityRole="button"
          accessibilityLabel={t("tickets.refreshHistoryAccessibility")}
          accessibilityHint={t("tickets.refreshHistoryAccessibilityHint")}
          accessibilityState={{
            disabled: headerRefreshing || refreshing || rateLimited,
            busy: headerRefreshing,
          }}
          testID="button-refresh-history"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 6,
            opacity: headerRefreshing || refreshing || rateLimited ? 0.6 : 1,
          }}
        >
          {headerRefreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
      </>
    ),
    [onHeaderRefresh, headerRefreshing, refreshing, rateLimited, t, colors.primary],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("stack.history")} right={headerRight()} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("stack.history")} right={headerRight()} />
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16 }}
        data={tickets}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            // Task #762: suppress the pull gesture while parked so the
            // user can't immediately re-trip the limiter from a tug.
            enabled={!rateLimited}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 40 }}>
            {t("common.noResults")}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push(`/ticket/${item.id}`)}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.row}>
              <Text style={[styles.id, { color: colors.foreground }]}>
                #{String(item.id).padStart(4, "0")}
              </Text>
              {(() => {
                const pill = ticketStatusPillStyle(item.status, item.updatedAt);
                const staleDays = ticketStaleDays(item.status, item.updatedAt);
                return (
                  <View style={styles.statusGroup}>
                    {staleDays != null ? (
                      <Text
                        style={[styles.staleText, { color: colors.mutedForeground }]}
                        accessibilityLabel={t("tickets.staleSuffixA11y", { days: staleDays })}
                        testID={`text-history-stale-${item.id}`}
                      >
                        {t("tickets.staleSuffix", { days: staleDays })}
                      </Text>
                    ) : null}
                    <View
                      style={[styles.badge, { backgroundColor: pill.background }]}
                      testID={`badge-history-status-${item.id}`}
                    >
                      <Text style={[styles.badgeText, { color: pill.foreground }]}>
                        {ticketStatusLabel(item.status, t)}
                      </Text>
                    </View>
                  </View>
                );
              })()}
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {item.siteName || "—"}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {item.workTypeName || "—"}
              {item.partnerName ? ` · ${item.partnerName}` : ""}
            </Text>
            {item.checkOutTime ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {t("tickets.checkedOut", { when: new Date(item.checkOutTime).toLocaleString() })}
              </Text>
            ) : null}
          </TouchableOpacity>
        )}
      />
      {/* ── Task #679: Manual refresh confirmation toast ──
          Mirrors the open-tickets list toast from Task #669 so foremen
          reviewing past jobs get the same visible "Refreshed" cue
          across the field app. Pinned to the bottom of the screen,
          `pointerEvents="none"` so the user can keep tapping cards
          underneath without waiting for it to fade. */}
      {refreshedToastVisible ? (
        <View
          style={styles.refreshedToastContainer}
          pointerEvents="none"
          testID="toast-history-refreshed"
        >
          <View style={styles.refreshedToast}>
            <Feather name="check-circle" size={16} color="#ffffff" />
            <Text style={styles.refreshedToastText}>{t("tickets.refreshedToast")}</Text>
          </View>
        </View>
      ) : null}
      {/* ── Task #762: tickets rate-limit "reconnecting" toast ──
          Mirrors the home tab's toast from Task #691 so the History
          tab surfaces the same pause indicator when the per-session
          limiter (Task #675) trips on the field endpoints. Stacked
          above the "Refreshed" confirmation toast when both happen
          to be visible. The toast disappears on its own when the
          cooldown expires — the hook re-renders, `rateLimited`
          flips back to false, and the recovery effect above re-runs
          `load()` so the list converges naturally. */}
      {rateLimited ? (
        <View
          style={[
            styles.refreshedToastContainer,
            { bottom: refreshedToastVisible ? 80 : 32 },
          ]}
          pointerEvents="none"
          testID="toast-tickets-rate-limited"
        >
          <View style={[styles.refreshedToast, styles.rateLimitedToast]}>
            <Feather name="clock" size={16} color="#ffffff" />
            <Text style={styles.refreshedToastText}>
              {t("tickets.rateLimitedToast", {
                seconds: retryAfterSeconds ?? 0,
              })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  id: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  // Task #890: groups the stale-time suffix with the status pill so
  // the two read together as one status block. Mirrors the open
  // tickets / schedule list layout.
  statusGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  staleText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 4 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  // Task #679: "Refreshed" confirmation toast on the history screen.
  // Mirrors the open-tickets list toast styling from Task #669 so the
  // confirmation reads as one consistent visual language across the
  // field app.
  refreshedToastContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 32,
    alignItems: "center",
  },
  refreshedToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#15803d",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    maxWidth: "90%",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  refreshedToastText: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  // Task #762: slate-grey background visually separates the rate-
  // limited pause indicator from the green "confirmed" toast above
  // so users can tell at a glance whether they're seeing a success
  // or a wait. Mirrors the home tab's `rateLimitedToast` style from
  // Task #691.
  rateLimitedToast: {
    backgroundColor: "#475569",
  },
});
