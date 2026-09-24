import { Feather } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useBrand } from "@/hooks/use-brand";

type Props = {
  count: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Presentation only: every placement shares the shell's authoritative unread source. */
export default function NotificationBell({ count, onPress, style, testID = "notification-bell" }: Props) {
  const { t } = useTranslation();
  const brand = useBrand();
  const unread = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const value = unread > 0 ? t("home.unreadNotifications", { count: unread }) : t("home.noUnreadNotifications");
  return (
    <Pressable
      accessibilityLabel={t("nav.notifications")}
      accessibilityRole="button"
      accessibilityValue={{ text: value }}
      aria-valuetext={value}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { minHeight: 44, minWidth: 44 }, style, pressed && styles.pressed]}
      testID={testID}
    >
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <Feather color={brand.primary} name="bell" size={27} testID="notification-bell-icon" />
        {unread > 0 ? <View style={styles.badge} testID="notification-bell-badge">
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : String(unread)}</Text>
        </View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  badge: { alignItems: "center", backgroundColor: "#dc2626", borderRadius: 9, justifyContent: "center", minWidth: 18, paddingHorizontal: 3, position: "absolute", right: -8, top: -5 },
  badgeText: { color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 10 },
  pressed: { opacity: 0.78 },
});
