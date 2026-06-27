import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import { setFlaggedBadge } from "@/lib/tabBadges";
import { SCREEN_SUBTITLE_TEXT, TEXT_SHADOW } from "@/lib/pill-doctrine";

type FlaggedTicket = {
  ticketId: number;
  trackingNumber: string;
  status: string;
  siteName: string | null;
  vendorName: string | null;
  reason: string | null;
  flaggedAt: string;
  flaggedByName: string | null;
};

export default function FlaggedTab() {
  const colors = useColors();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<FlaggedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const json = await apiFetch<{ tickets?: FlaggedTicket[] }>("/api/tickets/flagged");
      const rows = json?.tickets ?? [];
      setTickets(rows);
      setFlaggedBadge(rows.length);
    } catch (e) {
      setError(translateApiError(e, t));
      setTickets([]);
      setFlaggedBadge(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={{ flex: 1 }}>
      <InPageHeader
        title={t("flagged.title")}
        onBack={() => router.push("/(tabs)" as never)}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.primary} />
        }
      >
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>{t("flagged.subtitle")}</Text>

      {error ? <Text style={[styles.error, { color: colors.destructive ?? "#dc2626" }]}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : tickets.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, marginTop: 16, ...SCREEN_SUBTITLE_TEXT }}>
          {t("flagged.empty")}
        </Text>
      ) : (
        tickets.map((ticket) => (
          <Pressable
            key={ticket.ticketId}
            onPress={() => router.push(`/ticket/${ticket.ticketId}`)}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
            testID={`flagged-ticket-${ticket.ticketId}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]}>{ticket.trackingNumber}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, ...SCREEN_SUBTITLE_TEXT }}>
                {ticket.siteName ?? t("flagged.unknownSite")}
                {ticket.vendorName ? ` · ${ticket.vendorName}` : ""}
              </Text>
              {ticket.reason ? (
                <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 4, ...TEXT_SHADOW.onLight }}>
                  {ticket.reason}
                </Text>
              ) : null}
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ))
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 16, ...SCREEN_SUBTITLE_TEXT },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15, ...TEXT_SHADOW.content },
  error: { marginBottom: 12, fontFamily: "Inter_400Regular" },
});
