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
import {
  fetchAssistantSendToRecipients,
  SEND_TO_GROUP_LABEL_KEYS,
  recipientDetail,
  recipientHeadline,
  selectedRecipientUserIds,
  sendFromAssistantMessage,
  sendToRowKey,
  type SendToRecipientGroups,
} from "@/lib/ticket-send-to";

export type AssistantShareContext = {
  messageId: number;
  previewTitle: string;
  previewBody: string;
  ticketId: number | null;
  pagePath: string;
};

type Props = {
  visible: boolean;
  share: AssistantShareContext | null;
  onClose: () => void;
  onSent?: () => void;
};

export default function AssistantSendToModal({
  visible,
  share,
  onClose,
  onSent,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [groups, setGroups] = useState<SendToRecipientGroups>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  const loadRecipients = useCallback(async () => {
    if (!share) return;
    setLoading(true);
    try {
      const res = await fetchAssistantSendToRecipients(share.messageId, share.ticketId);
      setGroups(res.groups ?? []);
    } catch {
      Alert.alert(t("common.error"), t("notifications.sendToLoadFailed"));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [onClose, share, t]);

  useEffect(() => {
    if (visible && share) {
      setSelected(new Set());
      setMessage("");
      void loadRecipients();
    }
  }, [visible, share, loadRecipients]);

  const allRecipients = useMemo(() => groups.flatMap((g) => g.recipients), [groups]);

  const toggle = (rowKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const recipientUserIds = useMemo(
    () => selectedRecipientUserIds(selected),
    [selected],
  );

  const handleSend = async () => {
    if (!share || recipientUserIds.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await sendFromAssistantMessage(share.messageId, {
        recipientUserIds,
        message: message.trim() || null,
        ticketId: share.ticketId,
        pagePath: share.pagePath,
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

  if (!share) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              {t("notifications.sendToTitle")}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} testID="assistant-send-to-close">
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>

          <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.previewTitle, { color: colors.foreground }]} numberOfLines={2}>
              {share.previewTitle}
            </Text>
            <Text style={[styles.previewBody, { color: colors.mutedForeground }]} numberOfLines={4}>
              {share.previewBody}
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
                {t("notifications.loading")}
              </Text>
            </View>
          ) : allRecipients.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {t("notifications.sendToEmpty")}
            </Text>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {groups.map((group) => (
                <View key={group.id} style={styles.group}>
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                    {t(SEND_TO_GROUP_LABEL_KEYS[group.id])}
                  </Text>
                  {group.recipients.map((recipient) => {
                    const rowKey = sendToRowKey(group.id, recipient.userId);
                    const checked = selected.has(rowKey);
                    return (
                      <Pressable
                        key={rowKey}
                        onPress={() => toggle(rowKey)}
                        style={[
                          styles.recipientRow,
                          { borderColor: colors.border, backgroundColor: colors.card },
                        ]}
                        testID={`assistant-send-to-row-${rowKey}`}
                      >
                        <Feather
                          name={checked ? "check-square" : "square"}
                          size={20}
                          color={checked ? colors.primary : colors.mutedForeground}
                        />
                        <View style={styles.recipientText}>
                          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>
                            {recipientHeadline(recipient)}
                          </Text>
                          {recipientDetail(recipient) ? (
                            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                              {recipientDetail(recipient)}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Text style={[styles.messageLabel, { color: colors.mutedForeground }]}>
              {t("notifications.sendToMessageLabel")}
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={t("notifications.sendToMessagePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.messageInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                },
              ]}
            />
            <TogglePillButton
              onPress={() => void handleSend()}
              disabled={recipientUserIds.length === 0 || sending || loading}
              loading={sending}
              testID="assistant-send-to-submit"
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                {sending
                  ? t("notifications.sendToSending")
                  : t("notifications.sendToSubmit", { count: recipientUserIds.length })}
              </Text>
            </TogglePillButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  preview: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  previewTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  previewBody: { fontSize: 13, lineHeight: 18 },
  loadingWrap: { alignItems: "center", paddingVertical: 32 },
  emptyText: { paddingHorizontal: 16, paddingVertical: 24, fontSize: 14 },
  list: { maxHeight: 280 },
  listContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  group: { gap: 8 },
  groupLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  recipientText: { flex: 1, gap: 2 },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  messageLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  messageInput: {
    minHeight: 44,
    maxHeight: 100,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
