import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import ScheduleTicketPanel from "@/components/ScheduleTicketPanel";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import { ticketStatusLabel, ticketStatusPillStyle } from "@/lib/ticketStatusLabels";

type OpenTicket = {
  id: number;
  status: string;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  updatedAt: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  vendorId: number;
  onScheduled: () => void;
};

export default function ForemanScheduleTicketsModal({
  visible,
  onClose,
  vendorId,
  onScheduled,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scheduleTicketId, setScheduleTicketId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<OpenTicket[]>("/api/field/open-tickets?vendorWide=1");
      setTickets(rows ?? []);
    } catch (e) {
      setError(translateApiError(e, t));
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={[styles.root, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} testID="button-close-schedule-tickets">
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t("foremanSchedule.pickTicketTitle")}
            </Text>
            <View style={{ width: 56 }} />
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <Text style={[styles.empty, { color: colors.destructive }]}>{error}</Text>
          ) : (
            <FlatList
              data={tickets}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                  {t("foremanSchedule.noOpenTickets")}
                </Text>
              }
              renderItem={({ item }) => {
                const pill = ticketStatusPillStyle(item.status, item.updatedAt);
                return (
                  <TouchableOpacity
                    onPress={() => setScheduleTicketId(item.id)}
                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                    testID={`open-ticket-schedule-${item.id}`}
                  >
                    <View style={styles.row}>
                      <Text style={[styles.id, { color: colors.foreground }]}>
                        #{String(item.id).padStart(4, "0")}
                      </Text>
                      <View style={[styles.badge, { backgroundColor: pill.background }]}>
                        <Text style={[styles.badgeText, { color: pill.foreground }]}>
                          {ticketStatusLabel(item.status, t)}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.job, { color: colors.foreground }]}>
                      {item.workTypeName || t("mySchedule.untitledJob")}
                    </Text>
                    <View style={styles.metaRow}>
                      <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                      <Text style={{ color: colors.mutedForeground, flex: 1, fontSize: 13 }}>
                        {[item.partnerName, item.siteName].filter(Boolean).join(" — ") || "—"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>

      {scheduleTicketId != null ? (
        <ScheduleTicketPanel
          visible
          ticketId={scheduleTicketId}
          vendorId={vendorId}
          onClose={() => setScheduleTicketId(null)}
          onSaved={() => {
            setScheduleTicketId(null);
            onScheduled();
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", marginTop: 40, fontFamily: "Inter_400Regular", padding: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  id: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  job: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
});
