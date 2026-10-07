import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { apiFetch } from "./api";
import { captureAuthScope, getToken, getUser, isAuthScopeCurrent } from "./auth";
import { handleForegroundNotificationSound } from "./notificationSounds";
import { createWorkHubMessageSound } from "./work-hub-message-sound";
import type { NotificationsListResponse } from "./notifications-ui";

export const handleWorkHubMessageSound = createWorkHubMessageSound({
  context: async () => {
    const scope = captureAuthScope(), user = await getUser(), token = await getToken();
    const permission = await Notifications.getPermissionsAsync();
    return permission.granted && token && user && isAuthScopeCurrent(scope) ? { userId: user.id, generation: scope.generation } : null;
  },
  current: context => isAuthScopeCurrent({ generation: context.generation }),
  active: () => AppState.currentState === "active",
  load: async context => {
    const scope = { generation: context.generation };
    const [rows, preferences] = await Promise.all([
      apiFetch<NotificationsListResponse>("/api/notifications?limit=25", {}, scope),
      apiFetch<{ pushEnabled: boolean; mode?: string; messagesEnabled?: boolean; workHubMessagesEnabled?: boolean; dndStartHour: number | null; dndEndHour: number | null }>("/api/notifications/preferences", {}, scope),
    ]);
    return { notices: Array.isArray(rows) ? rows : rows.items, preferences };
  },
  play: handleForegroundNotificationSound,
});
