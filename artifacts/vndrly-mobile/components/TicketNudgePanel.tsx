import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  isNudgeAllowedForStatus,
  nudgeDirectionsForRole,
  type NudgeDirection,
  type TicketNudgeRow,
} from "@workspace/ticket-nudge-ui";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

type Props = {
  ticketId: number;
  ticketStatus: string;
  userRole: string | undefined;
};

export default function TicketNudgePanel({
  ticketId,
  ticketStatus,
  userRole,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<NudgeDirection | null>(null);
  const [history, setHistory] = useState<TicketNudgeRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const directions = useMemo(() => nudgeDirectionsForRole(userRole), [userRole]);
  const visible =
    isNudgeAllowedForStatus(ticketStatus) && (directions.up || directions.down);

  const loadHistory = useCallback(async () => {
    try {
      const rows = await apiFetch<TicketNudgeRow[]>(
        `/api/tickets/${ticketId}/nudges`,
      );
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (!visible) return;
    void loadHistory();
  }, [visible, loadHistory]);

  const send = async (direction: NudgeDirection) => {
    setBusy(direction);
    try {
      const body = await apiFetch<{ notifiedCount?: number }>(
        `/api/tickets/${ticketId}/nudge`,
        {
          method: "POST",
          body: JSON.stringify({
            direction,
            message: message.trim() || undefined,
          }),
        },
      );
      setMessage("");
      const notifiedCount = body?.notifiedCount ?? 0;
      Alert.alert(
        t("ticketDetail.nudge.sentTitle"),
        notifiedCount > 0
          ? t("ticketDetail.nudge.sentBody", { count: notifiedCount })
          : t("ticketDetail.nudge.sentBodyShort"),
      );
      await loadHistory();
    } catch (e) {
      Alert.alert(
        t("ticketDetail.nudge.failedTitle"),
        translateApiError(e, t, t("ticketDetail.nudge.failedBody")),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!visible) return null;

  return (
    <View
      style={[
        styles.wrap,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
      testID="ticket-nudge-panel"
    >
      <View style={styles.header}>
        <Feather name="bell" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("ticketDetail.nudge.title")}
        </Text>
      </View>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        {t("ticketDetail.nudge.subtitle")}
      </Text>
      <TextInput
        value={message}
        onChangeText={(v) => setMessage(v.slice(0, 500))}
        placeholder={t("ticketDetail.nudge.messagePlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[
          styles.input,
          {
            color: colors.foreground,
            borderColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
        testID="input-nudge-message"
      />
      <View style={styles.row}>
        {directions.up ? (
          <LayeredPillButton
            height={40}
            onPress={() => void send("up")}
            disabled={busy !== null}
            loading={busy === "up"}
            style={styles.btn}
            testID="button-nudge-up"
          >
            <Feather name="arrow-up" size={16} color="#fff" />
            <Text style={styles.btnText}>
              {busy === "up"
                ? t("ticketDetail.nudge.sending")
                : t("ticketDetail.nudge.up")}
            </Text>
          </LayeredPillButton>
        ) : null}
        {directions.down ? (
          <LayeredPillButton
            height={40}
            onPress={() => void send("down")}
            disabled={busy !== null}
            loading={busy === "down"}
            style={styles.btn}
            testID="button-nudge-down"
          >
            <Feather name="arrow-down" size={16} color="#fff" />
            <Text style={styles.btnText}>
              {busy === "down"
                ? t("ticketDetail.nudge.sending")
                : t("ticketDetail.nudge.down")}
            </Text>
          </LayeredPillButton>
        ) : null}
      </View>
      {loadingHistory ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : history.length > 0 ? (
        <View style={styles.history} testID="nudge-history">
          <Text style={[styles.historyTitle, { color: colors.mutedForeground }]}>
            {t("ticketDetail.nudge.recent")}
          </Text>
          {history.slice(0, 5).map((row) => (
            <Text
              key={row.id}
              style={[styles.historyRow, { color: colors.mutedForeground }]}
              testID={`nudge-history-${row.id}`}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                {row.direction === "up"
                  ? t("ticketDetail.nudge.upShort")
                  : t("ticketDetail.nudge.downShort")}
              </Text>
              {" — "}
              {row.message ||
                t("ticketDetail.nudge.noMessage", {
                  status: row.ticketStatus.replace(/_/g, " "),
                })}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  btn: {
    flexGrow: 1,
    minWidth: "45%",
  },
  btnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  history: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#444",
    paddingTop: 10,
    gap: 6,
  },
  historyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  historyRow: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
});
