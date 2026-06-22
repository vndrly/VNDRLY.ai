import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  formatNotificationCount,
  NOTIFICATION_BELL_BADGE,
  NOTIFICATION_BELL_COLOR_ACTIVE,
  NOTIFICATION_BELL_COLOR_IDLE,
  NOTIFICATION_BELL_ICON_SIZE,
  NOTIFICATION_COUNT_BADGE_BG,
} from "@/lib/notifications-bell-ui";

type Props = {
  count: number;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
};

/** iOS port of web `notifications-bell.tsx` bell + flat red count pill. */
export default function NotificationsBellButton({
  count,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID = "button-notifications-bell",
}: Props) {
  const bellColor = count > 0 ? NOTIFICATION_BELL_COLOR_ACTIVE : NOTIFICATION_BELL_COLOR_IDLE;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={styles.button}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={testID}
    >
      <Feather name="bell" size={NOTIFICATION_BELL_ICON_SIZE} color={bellColor} />
      {count > 0 ? (
        <View style={styles.badge} testID="badge-notification-count">
          <Text style={styles.badgeText}>{formatNotificationCount(count)}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "relative",
    padding: 8,
    borderRadius: 6,
    overflow: "visible",
    marginRight: 5,
  },
  badge: {
    position: "absolute",
    top: NOTIFICATION_BELL_BADGE.top,
    right: NOTIFICATION_BELL_BADGE.right,
    height: NOTIFICATION_BELL_BADGE.height,
    minWidth: NOTIFICATION_BELL_BADGE.minWidth,
    paddingHorizontal: NOTIFICATION_BELL_BADGE.paddingHorizontal,
    borderRadius: 999,
    backgroundColor: NOTIFICATION_COUNT_BADGE_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: NOTIFICATION_BELL_BADGE.fontSize,
    lineHeight: NOTIFICATION_BELL_BADGE.lineHeight,
    fontFamily: NOTIFICATION_BELL_BADGE.fontFamily,
  },
});
