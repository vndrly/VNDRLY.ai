import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { LAYERED_PILL_BUTTON_TEXT } from "@/components/LayeredPillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type Props = {
  ticketId: number;
  ticketStatus: string;
  userRole: string | undefined;
};

const TERMINAL = new Set(["cancelled", "denied", "completed", "funds_dispersed"]);

export default function TicketFlagPanel({ ticketId, ticketStatus, userRole }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const visible =
    !!userRole &&
    !TERMINAL.has(ticketStatus) &&
    ["admin", "partner", "vendor", "field_employee"].includes(userRole);

  const load = useCallback(async () => {
    try {
      const body = await apiFetch<{ flagged?: boolean; reason?: string | null }>(
        `/api/tickets/${ticketId}/flag`,
      );
      setFlagged(!!body.flagged);
      if (body.reason) setReason(body.reason);
    } catch {
      setFlagged(false);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const flag = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/tickets/${ticketId}/flag`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      setFlagged(true);
      Alert.alert(t("ticketDetail.flag.flaggedTitle"), t("ticketDetail.flag.flaggedBody"));
    } catch (e) {
      Alert.alert(t("common.error"), translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/tickets/${ticketId}/flag`, { method: "DELETE" });
      setFlagged(false);
      setReason("");
      Alert.alert(t("ticketDetail.flag.clearedTitle"));
    } catch (e) {
      Alert.alert(t("common.error"), translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <Feather name="flag" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>{t("ticketDetail.flag.title")}</Text>
      </View>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>{t("ticketDetail.flag.help")}</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : flagged ? (
        <>
          {reason ? (
            <Text style={{ color: colors.foreground, marginBottom: 8 }}>
              {t("ticketDetail.flag.reasonLabel")}: {reason}
            </Text>
          ) : null}
          <LayeredPillButton inactive onPress={clear} disabled={busy}>
            <Text style={LAYERED_PILL_BUTTON_TEXT}>{t("ticketDetail.flag.clear")}</Text>
          </LayeredPillButton>
        </>
      ) : (
        <>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t("ticketDetail.flag.reasonPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={500}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
            ]}
          />
          <LayeredPillButton onPress={flag} disabled={busy} loading={busy}>
            <Text style={LAYERED_PILL_BUTTON_TEXT}>{t("ticketDetail.flag.submit")}</Text>
          </LayeredPillButton>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  help: { fontFamily: "Inter_400Regular", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 64,
    textAlignVertical: "top",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
});
