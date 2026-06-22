import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import TogglePillButton from "@/components/TogglePillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { buildNotificationMailtoUrl } from "@/lib/notification-mailto";
import {
  navigateFromNotificationLink,
  parseSafetyEventIdFromHref,
  parseSiteLocationFromHref,
  parseTicketIdFromNotificationLink,
} from "@/lib/notification-navigation";
import { fetchSafetyCapabilities, reactivateSiteLocation } from "@/lib/safety-api";
import type { NotificationRow } from "@/lib/notifications-ui";
import { NOTIFICATION_TYPE_META } from "@/lib/notifications-ui";

type Props = {
  visible: boolean;
  item: NotificationRow | null;
  typeLabel: string;
  timeAgoLabel: string;
  onClose: () => void;
  onMarkRead: (id: number) => Promise<void>;
  onMarkUnread: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onSendTo?: () => void;
};

export default function NotificationActionModal({
  visible,
  item,
  typeLabel,
  timeAgoLabel,
  onClose,
  onMarkRead,
  onMarkUnread,
  onDelete,
  onSendTo,
}: Props) {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (!item) return null;

  const meta = NOTIFICATION_TYPE_META[item.type];
  const ticketId = parseTicketIdFromNotificationLink(item.link ?? "");
  const safetyEventId = parseSafetyEventIdFromHref(item.link ?? "");
  const siteLocation = item.link ? parseSiteLocationFromHref(item.link) : null;
  const canOpenTicket = ticketId !== null || item.link === "/tickets";
  const canOpenSafetyEvent = safetyEventId !== null;
  const canSendTo = ticketId !== null && !!onSendTo;
  const logoUri = brand.logoSquareUrl ?? brand.logoUrl;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRead = () =>
    run(async () => {
      if (item.isRead) await onMarkUnread(item.id);
      else await onMarkRead(item.id);
    });

  const handleDelete = () => {
    Alert.alert(
      t("notifications.deleteConfirmTitle"),
      t("notifications.deleteConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("notifications.delete"),
          style: "destructive",
          onPress: () =>
            void run(async () => {
              await onDelete(item.id);
              onClose();
            }),
        },
      ],
    );
  };

  const handleShare = async () => {
    const url = buildNotificationMailtoUrl({
      title: item.title,
      body: item.body,
      link: item.link,
      createdAt: item.createdAt,
      typeLabel,
    });
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(t("common.error"), t("notifications.shareUnavailable"));
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("common.error"), t("notifications.shareUnavailable"));
    }
  };

  const handleOpenTicket = () => {
    onClose();
    navigateFromNotificationLink(item.link);
  };

  const handleOpenSafetyEvent = () => {
    onClose();
    navigateFromNotificationLink(item.link);
  };

  const handleSiteLocationPress = () => {
    if (!siteLocation) return;
    if (ticketId !== null) {
      onClose();
      navigateFromNotificationLink(item.link);
      return;
    }
    void (async () => {
      try {
        const caps = await fetchSafetyCapabilities();
        if (!caps.isPartnerHse) {
          Alert.alert(t("common.error"), t("notifications.siteLocationNoAccess"));
          return;
        }
        Alert.alert(
          t("siteLocations.reactivateSiteConfirmTitle"),
          t("siteLocations.reactivateSiteConfirmDescription"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("siteLocations.reactivateSite"),
              onPress: () =>
                void reactivateSiteLocation(siteLocation.id)
                  .then(() => Alert.alert(t("siteLocations.reactivateSuccess")))
                  .catch((e) => Alert.alert(t("siteLocations.reactivateFailed"), String(e))),
            },
          ],
        );
      } catch {
        Alert.alert(t("common.error"), t("notifications.actionFailed"));
      }
    })();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="notification-action-modal"
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.headerRow}>
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.logo} resizeMode="contain" />
            ) : (
              <View style={[styles.logoFallback, { backgroundColor: colors.primary }]}>
                <Feather name="bell" size={16} color={colors.primaryForeground} />
              </View>
            )}
            <Text style={[styles.heading, { color: colors.foreground }]}>
              {t("notifications.actionTitle")}
            </Text>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel={t("common.close")}
              testID="notification-action-close"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView bounces={false} style={styles.bodyScroll}>
            {meta ? (
              <View
                style={[
                  styles.typeBadge,
                  {
                    backgroundColor: item.isRead ? colors.muted : colors.primary,
                  },
                ]}
              >
                <Feather
                  name={meta.icon}
                  size={12}
                  color={item.isRead ? colors.mutedForeground : "#ffffff"}
                />
                <Text
                  style={[
                    styles.typeBadgeText,
                    {
                      color: item.isRead ? colors.mutedForeground : "#ffffff",
                    },
                  ]}
                >
                  {typeLabel}
                </Text>
              </View>
            ) : (
              <Text style={[styles.category, { color: colors.mutedForeground }]}>{typeLabel}</Text>
            )}

            <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
            {item.body ? (
              <Text style={[styles.body, { color: colors.mutedForeground }]}>{item.body}</Text>
            ) : null}
            {siteLocation ? (
              <Pressable onPress={handleSiteLocationPress} testID="notification-action-site-link">
                <Text style={[styles.siteLink, { color: colors.primary }]}>
                  {t("notifications.siteLocationLink", {
                    name: siteLocation.name ?? t("notifications.siteLocationFallback"),
                  })}
                </Text>
              </Pressable>
            ) : null}
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{timeAgoLabel}</Text>
          </ScrollView>

          <View style={styles.actions}>
            <TogglePillButton
              color="brand"
              solid
              disabled={busy}
              onPress={() => void handleToggleRead()}
              testID="notification-action-toggle-read"
              style={styles.actionBtn}
            >
              {item.isRead ? t("notifications.markUnread") : t("notifications.markRead")}
            </TogglePillButton>

            <TogglePillButton
              color="red"
              solid
              disabled={busy}
              onPress={handleDelete}
              testID="notification-action-delete"
              style={styles.actionBtn}
            >
              {t("notifications.delete")}
            </TogglePillButton>

            {canSendTo ? (
              <TogglePillButton
                color="brand"
                solid
                disabled={busy}
                onPress={onSendTo}
                testID="notification-action-send-to"
                style={styles.actionBtn}
              >
                {t("notifications.sendTo")}
              </TogglePillButton>
            ) : null}

            <TogglePillButton
              color="blue"
              solid
              disabled={busy}
              onPress={() => void handleShare()}
              testID="notification-action-share"
              style={styles.actionBtn}
            >
              {t("notifications.shareViaEmail")}
            </TogglePillButton>

            {canOpenSafetyEvent ? (
              <TogglePillButton
                color="blue"
                solid
                disabled={busy}
                onPress={handleOpenSafetyEvent}
                testID="notification-action-open-safety-event"
                style={styles.actionBtn}
              >
                {t("notifications.openSafetyEvent")}
              </TogglePillButton>
            ) : null}

            {canOpenTicket ? (
              <TogglePillButton
                color="blue"
                solid
                disabled={busy}
                onPress={handleOpenTicket}
                testID="notification-action-open-ticket"
                style={styles.actionBtn}
              >
                {ticketId !== null
                  ? t("notifications.openTicket")
                  : t("notifications.openTickets")}
              </TogglePillButton>
            ) : null}
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
    maxHeight: "85%",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  logoFallback: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    flex: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  closeBtn: {
    padding: 4,
  },
  bodyScroll: {
    maxHeight: 260,
    marginBottom: 12,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  typeBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.3,
  },
  category: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    marginBottom: 8,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    marginBottom: 6,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  meta: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  siteLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginBottom: 8,
  },
  actions: {
    gap: 8,
  },
  actionBtn: {
    width: "100%",
  },
});
