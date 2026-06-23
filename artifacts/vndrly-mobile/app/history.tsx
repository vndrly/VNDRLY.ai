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
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useTicketsRateLimitGate } from "@/hooks/use-tickets-rate-limit-gate";
import { apiFetch } from "@/lib/api";
import { isFieldEmployeeUser } from "@/lib/mobile-viewer";
import {
  fetchPortalTicketsForHome,
  type MobileOpenTicket,
} from "@/lib/portal-tickets";
import {
  mergeOpenAndRecentClosedJobs,
  type ClosedJobRow,
  type JobHistoryRow,
  type OpenJobRow,
} from "@/lib/jobHistoryList";
import {
  isTicketsRateLimited,
  noteTicketsRateLimit,
} from "@/lib/ticketsRateLimitGate";
import {
  ticketStaleDays,
  ticketStatusLabel,
  ticketStatusPillStyle,
} from "@/lib/ticketStatusLabels";

type OpenJobTicket = OpenJobRow | MobileOpenTicket;
type ClosedJobTicket = ClosedJobRow;

export default function HistoryScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const isFieldEmployee = isFieldEmployeeUser(me);
  const usesPortalTicketList = !isFieldEmployee;
  const [tickets, setTickets] = useState<JobHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [headerRefreshing, setHeaderRefreshing] = useState(false);
  const [refreshedToastVisible, setRefreshedToastVisible] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const { rateLimited, retryAfterSeconds } = useTicketsRateLimitGate(loadError);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      if (isTicketsRateLimited()) return false;
      const openPromise = usesPortalTicketList
        ? fetchPortalTicketsForHome()
        : apiFetch<OpenJobTicket[]>("/api/field/open-tickets");
      const closedPromise = isFieldEmployee
        ? apiFetch<ClosedJobTicket[]>("/api/field/history").catch(() => [] as ClosedJobTicket[])
        : Promise.resolve([] as ClosedJobTicket[]);
      const [openRows, closedRows] = await Promise.all([openPromise, closedPromise]);
      setTickets(mergeOpenAndRecentClosedJobs(openRows || [], closedRows || []));
      setLoadError(null);
      return true;
    } catch (e) {
      const rlSeconds = noteTicketsRateLimit(e);
      setLoadError(e);
      if (rlSeconds == null) {
        Alert.alert(t("common.error"), t("tickets.errorLoadHistory"));
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [isFieldEmployee, usesPortalTicketList, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const prevRateLimitedRef = React.useRef(false);
  useEffect(() => {
    const prev = prevRateLimitedRef.current;
    prevRateLimitedRef.current = rateLimited;
    if (!prev) return;
    if (rateLimited) return;
    void load();
  }, [rateLimited, load]);

  const onRefresh = useCallback(() => {
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

  const onHeaderRefresh = useCallback(() => {
    if (headerRefreshing || refreshing) return;
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

  useEffect(() => {
    if (!refreshedToastVisible) return;
    const handle = setTimeout(() => setRefreshedToastVisible(false), 3000);
    return () => clearTimeout(handle);
  }, [refreshedToastVisible]);

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
        <InPageHeader title={t("tickets.history")} right={headerRight()} />
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("tickets.history")} right={headerRight()} />
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16 }}
        data={tickets}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
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
        renderItem={({ item }) => {
          const employeeName = (() => {
            const first = item.fieldEmployeeFirstName?.trim() ?? "";
            const last = item.fieldEmployeeLastName?.trim() ?? "";
            const full = `${first} ${last}`.trim();
            return full.length > 0 ? full : null;
          })();
          return (
            <TouchableOpacity
              onPress={() => router.push(`/ticket/${item.id}`)}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              testID={`card-open-job-${item.id}`}
            >
              <View style={styles.row}>
                <View style={styles.idGroup}>
                  <Text style={[styles.id, { color: colors.foreground }]}>
                    #{String(item.id).padStart(4, "0")}
                  </Text>
                  {item.unreadCommentCount > 0 ? (
                    <View
                      style={styles.unreadBadge}
                      accessibilityLabel={t("tickets.unreadCommentsA11y", {
                        count: item.unreadCommentCount,
                      })}
                      testID={`badge-unread-comments-${item.id}`}
                    >
                      <Feather name="message-circle" size={11} color="#1a1d23" />
                      <Text style={styles.unreadBadgeText}>
                        {item.unreadCommentCount}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {(() => {
                  const pill = ticketStatusPillStyle(item.status, item.updatedAt);
                  const staleDays = ticketStaleDays(item.status, item.updatedAt);
                  return (
                    <View style={styles.statusGroup}>
                      {staleDays != null ? (
                        <Text
                          style={[styles.staleText, { color: colors.mutedForeground }]}
                          accessibilityLabel={t("tickets.staleSuffixA11y", { days: staleDays })}
                          testID={`text-open-job-stale-${item.id}`}
                        >
                          {t("tickets.staleSuffix", { days: staleDays })}
                        </Text>
                      ) : null}
                      <View
                        style={[styles.badge, { backgroundColor: pill.background }]}
                        testID={`badge-open-job-status-${item.id}`}
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
                {item.siteName || t("tickets.siteFallbackPlaceholder")}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {item.workTypeName || t("tickets.workTypeFallbackPlaceholder")}
                {item.partnerName
                  ? t("tickets.partnerSuffix", { partner: item.partnerName })
                  : ""}
              </Text>
              {employeeName ? (
                <Text
                  style={[styles.meta, { color: colors.mutedForeground }]}
                  testID={`text-open-job-employee-${item.id}`}
                >
                  <Feather name="user" size={11} color={colors.mutedForeground} />
                  {"  "}
                  {employeeName}
                </Text>
              ) : null}
              {item.isClosed && item.checkOutTime ? (
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {t("tickets.checkedOut", {
                    when: new Date(item.checkOutTime).toLocaleString(),
                  })}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
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
  idGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  id: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  unreadBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fbbf24",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  unreadBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: "#1a1d23",
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  statusGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  staleText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 4 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
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
  rateLimitedToast: {
    backgroundColor: "#475569",
  },
});
