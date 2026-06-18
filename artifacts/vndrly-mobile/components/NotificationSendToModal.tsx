import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { parseTicketIdFromHref } from "@/lib/assistant-deep-links";
import type { NotificationRow } from "@/lib/notifications-ui";
import {
  fetchSendToRecipients,
  SEND_TO_GROUP_LABEL_KEYS,
  sendNotificationToRecipients,
  type SendToRecipientGroups,
} from "@/lib/ticket-send-to";

type Props = {
  visible: boolean;
  item: NotificationRow | null;
  typeLabel: string;
  onClose: () => void;
  onSent?: () => void;
};

export default function NotificationSendToModal({
  visible,
  item,
  typeLabel,
  onClose,
  onSent,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [groups, setGroups] = useState<SendToRecipientGroups>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");

  const ticketId = item?.link ? parseTicketIdFromHref(item.link) : null;

  const loadRecipients = useCallback(async () => {
    if (!item || ticketId === null) return;
    setLoading(true);
    try {
      const res = await fetchSendToRecipients(item.id);
      setGroups(res.groups ?? []);
    } catch {
      Alert.alert(t("common.error"), t("notifications.sendToLoadFailed"));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [item, onClose, t, ticketId]);

  useEffect(() => {
    if (visible && item) {
      setSelected(new Set());
      setMessage("");
      void loadRecipients();
    }
  }, [visible, item, loadRecipients]);

  const allRecipients = useMemo(() => groups.flatMap((g) => g.recipients), [groups]);

  const toggle = (userId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSend = async () => {
    if (!item || selected.size === 0 || sending) return;
    setSending(true);
    try {
      const result = await sendNotificationToRecipients(item.id, {
        recipientUserIds: [...selected],
        message: message.trim() || null,
      });
      Alert.alert(
        t("notifications.sendToSuccess", { count: result.notifiedCount }),
        t("notifications.sendToCoopNote"),
      );
      onSent?.();
      onClose();
    } catch {
      Alert.alert(t("common.error"), t("notifications.sendToFailed"));
    } finally {
      setSending(false);
    }
  };

  if (!item) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="notification-send-to-modal"
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.heading, { color: colors.foreground }]}>
              {t("notifications.sendToTitle")}
            </Text>
            <Pressable onPress={onClose} accessibilityLabel={t("common.close")}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {ticketId === null ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              {t("notifications.sendToNoTicket")}
            </Text>
          ) : loading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : allRecipients.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              {t("notifications.sendToEmpty")}
            </Text>
          ) : (
            <ScrollView style={styles.scroll} bounces={false}>
              <Text style={[styles.coopNote, { color: colors.mutedForeground }]}>
                {t("notifications.sendToCoopNote")}
              </Text>

              <View style={[styles.preview, { borderColor: colors.border }]}>
                <Text style={[styles.previewType, { color: colors.mutedForeground }]}>
                  {typeLabel}
                </Text>
                <Text style={[styles.previewTitle, { color: colors.foreground }]}>
                  {item.title}
                </Text>
                {item.body ? (
                  <Text style={[styles.previewBody, { color: colors.mutedForeground }]}>
                    {item.body}
                  </Text>
                ) : null}
              </View>

              {groups.map((group) => (
                <View key={group.id} style={styles.groupBlock}>
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                    {t(SEND_TO_GROUP_LABEL_KEYS[group.id])}
                  </Text>
                  {group.recipients.map((r) => {
                    const checked = selected.has(r.userId);
                    return (
                      <Pressable
                        key={r.userId}
                        style={[
                          styles.recipientRow,
                          {
                            borderColor: checked ? colors.primary : colors.border,
                            backgroundColor: checked ? `${colors.primary}14` : "transparent",
                          },
                        ]}
                        onPress={() => toggle(r.userId)}
                        testID={`send-to-recipient-${r.userId}`}
                      >
                        <Feather
                          name={checked ? "check-square" : "square"}
                          size={18}
                          color={checked ? colors.primary : colors.mutedForeground}
                        />
                        <View style={styles.recipientText}>
                          <Text style={[styles.recipientName, { color: colors.foreground }]}>
                            {r.displayName}
                          </Text>
                          <Text style={[styles.recipientRole, { color: colors.mutedForeground }]}>
                            {r.roleLabel}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              <Text style={[styles.messageLabel, { color: colors.foreground }]}>
                {t("notifications.sendToMessageLabel")}
              </Text>
              <TextInput
                value={message}
                onChangeText={(v) => setMessage(v.slice(0, 500))}
                placeholder={t("notifications.sendToMessagePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[
                  styles.messageInput,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
                testID="send-to-message"
              />
            </ScrollView>
          )}

          <View style={styles.actions}>
            <TogglePillButton color="blue" solid onPress={onClose} style={styles.actionBtn}>
              {t("common.cancel")}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              solid
              disabled={selected.size === 0 || sending || loading || ticketId === null}
              onPress={() => void handleSend()}
              testID="send-to-submit"
              style={styles.actionBtn}
            >
              {sending
                ? t("notifications.sendToSending")
                : t("notifications.sendToSubmit", { count: selected.size })}
            </TogglePillButton>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 2,
    maxHeight: "88%",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heading: {
    flex: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  hint: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    marginVertical: 12,
  },
  loader: {
    marginVertical: 24,
  },
  scroll: {
    maxHeight: 360,
    marginBottom: 12,
  },
  coopNote: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  preview: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  previewType: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  previewTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  previewBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 4,
  },
  groupBlock: {
    marginBottom: 12,
  },
  groupLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  recipientText: {
    flex: 1,
  },
  recipientName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  recipientRole: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  messageLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    marginBottom: 6,
  },
  messageInput: {
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 72,
    padding: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlignVertical: "top",
  },
  actions: {
    gap: 8,
  },
  actionBtn: {
    width: "100%",
  },
});
