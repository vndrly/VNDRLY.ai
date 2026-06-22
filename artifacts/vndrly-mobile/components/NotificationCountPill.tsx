import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import {
  formatNotificationCount,
  NOTIFICATION_COUNT_BADGE_BG,
  NOTIFICATION_TILE_BADGE,
} from "@/lib/notifications-bell-ui";

type Props = {
  count: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Flat white-on-red pill — web `foreman-quick-actions.tsx` tile badge. */
export default function NotificationCountPill({ count, style, testID }: Props) {
  if (count <= 0) return null;

  return (
    <View style={[styles.badge, style]} testID={testID}>
      <Text style={styles.badgeText}>{formatNotificationCount(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: NOTIFICATION_TILE_BADGE.minWidth,
    height: NOTIFICATION_TILE_BADGE.height,
    paddingHorizontal: NOTIFICATION_TILE_BADGE.paddingHorizontal,
    borderRadius: 999,
    backgroundColor: NOTIFICATION_COUNT_BADGE_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: NOTIFICATION_TILE_BADGE.fontSize,
    lineHeight: NOTIFICATION_TILE_BADGE.lineHeight,
    fontFamily: NOTIFICATION_TILE_BADGE.fontFamily,
  },
});
