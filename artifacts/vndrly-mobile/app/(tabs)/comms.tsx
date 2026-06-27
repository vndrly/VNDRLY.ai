import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, Stack } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import CommentsPanel from "@/components/CommentsPanel";
import InPageHeader from "@/components/InPageHeader";
import PushToTalkPanel from "@/components/PushToTalkPanel";
import NudgeFlashOverlay from "@/components/NudgeFlashOverlay";
import { useAuth } from "@/hooks/use-auth";
import { useTicketNudgeFlash } from "@/hooks/useTicketNudgeFlash";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { setCommsBadge } from "@/lib/tabBadges";

type OpenTicket = {
  id: number;
  siteName: string | null;
  workTypeName: string | null;
  fieldEmployeeFirstName: string | null;
  fieldEmployeeLastName: string | null;
  unreadCommentCount: number;
};

export default function CommsScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isForeman =
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both");
  const { nudgeFlashingTicketIds } = useTicketNudgeFlash({ enabled: !!user });

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<OpenTicket[]>("/api/field/open-tickets");
      const rows = data ?? [];
      setTickets(rows);
      setCommsBadge(
        rows.reduce((n, tk) => n + (tk.unreadCommentCount ?? 0), 0),
      );
      if (rows.length > 0 && selectedId == null) {
        setSelectedId(rows[0]!.id);
      } else if (selectedId != null && !rows.some((r) => r.id === selectedId)) {
        setSelectedId(rows[0]?.id ?? null);
      }
    } catch {
      setTickets([]);
      setCommsBadge(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  if (!isForeman) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader
          title={t("foremanHome.crewCommsTitle")}
          hideBack
          right={<ActiveOrgIndicator />}
        />
        <Feather name="lock" size={32} color={colors.mutedForeground} />
        <Text style={[styles.locked, { color: colors.mutedForeground }]}>
          {t("foremanHome.commsForemanOnly")}
        </Text>
      </View>
    );
  }

  const selected = tickets.find((tk) => tk.id === selectedId);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader
        title={t("foremanHome.crewCommsTitle")}
        hideBack
        right={<ActiveOrgIndicator />}
      />
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        {t("foremanHome.crewCommsSubtitle")}
      </Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
      ) : tickets.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          {t("foremanHome.commsNoTickets")}
        </Text>
      ) : (
        <>
          <FlatList
            horizontal
            data={tickets}
            keyExtractor={(item) => String(item.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load();
                }}
              />
            }
            renderItem={({ item }) => {
              const active = item.id === selectedId;
              const crewName = `${item.fieldEmployeeFirstName ?? ""} ${item.fieldEmployeeLastName ?? ""}`.trim();
              return (
                <TouchableOpacity
                  onPress={() => setSelectedId(item.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? `${colors.primary}18` : colors.card,
                    },
                  ]}
                  testID={`comms-ticket-chip-${item.id}`}
                >
                  <NudgeFlashOverlay
                    active={nudgeFlashingTicketIds.has(item.id)}
                    borderRadius={10}
                  />
                  <View style={styles.chipHeader}>
                    <Text
                      style={[
                        styles.chipNum,
                        { color: active ? colors.primary : colors.foreground },
                      ]}
                    >
                      #{String(item.id).padStart(4, "0")}
                    </Text>
                    {item.unreadCommentCount > 0 ? (
                      <View
                        style={styles.unreadBadge}
                        accessibilityLabel={t("tickets.unreadCommentsA11y", {
                          count: item.unreadCommentCount,
                        })}
                        testID={`comms-unread-badge-${item.id}`}
                      >
                        <Feather name="message-circle" size={11} color="#1a1d23" />
                        <Text style={styles.unreadBadgeText}>
                          {item.unreadCommentCount}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[styles.chipSite, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {item.siteName ?? t("tickets.siteFallbackPlaceholder")}
                  </Text>
                  {crewName ? (
                    <Text
                      style={[styles.chipCrew, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {crewName}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />

          {selected ? (
            <ScrollView
              style={styles.panelScroll}
              contentContainerStyle={styles.panelContent}
              keyboardShouldPersistTaps="handled"
            >
              <PushToTalkPanel
                ticketId={selected.id}
                ticketLabel={`#${String(selected.id).padStart(4, "0")} · ${selected.siteName ?? ""}`}
              />
              <CommentsPanel
                key={selected.id}
                source="ticket"
                parentId={selected.id}
                hideHeader
                onCommentsChanged={() => void load()}
              />
              <TouchableOpacity
                onPress={() => router.push(`/ticket/${selected.id}`)}
                style={[styles.openTicket, { borderColor: colors.border }]}
                testID="button-comms-open-ticket"
              >
                <Feather name="external-link" size={14} color={colors.primary} />
                <Text style={[styles.openTicketText, { color: colors.primary }]}>
                  {t("foremanHome.openTicketDetail")}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  locked: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  empty: {
    textAlign: "center",
    marginTop: 32,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 24,
  },
  chips: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    width: 132,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 4,
    overflow: "hidden",
  },
  chipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipNum: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  unreadBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  unreadBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: "#1a1d23",
  },
  chipSite: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  chipCrew: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  panelScroll: {
    flex: 1,
    paddingHorizontal: 12,
  },
  panelContent: {
    paddingBottom: 24,
  },
  openTicket: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  openTicketText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
});
