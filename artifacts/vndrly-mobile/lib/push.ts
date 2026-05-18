import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiFetch } from "./api";
import { isExpoGo } from "./runtime";

// expo-notifications in SDK 54 dropped remote push support inside
// Expo Go. setNotificationHandler still works for local notifications
// on iOS Expo Go but on Android Expo Go it throws at module load,
// killing the JS bridge before AuthGate can render. Wrap in try/catch
// and additionally skip remote-push surfaces under Expo Go entirely.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // ignore — host (Expo Go on SDK 54+) doesn't support the handler
}

export async function registerForPushNotifications(): Promise<string | null> {
  // Expo Go on SDK 54 cannot deliver remote push tokens. Calling
  // getExpoPushTokenAsync there throws a non-recoverable native error
  // on iOS that surfaces as a red screen. Skip cleanly.
  if (isExpoGo) return null;
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;

  try {
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResult.data;
    await apiFetch("/api/field/push-token", {
      method: "POST",
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    return token;
  } catch (err) {
    console.warn("Push token registration failed", err);
    return null;
  }
}

export async function unregisterPushToken(token: string) {
  try {
    await apiFetch("/api/field/push-token", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  } catch {
    // ignore
  }
}
