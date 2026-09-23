import { useEffect } from "react";
import { AppState } from "react-native";
import { apiFetch } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { workHubDeviceClass, workHubDeviceLabel } from "@/lib/work-hub-device-label";

let connectionId: string | null = null;

function newConnectionId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function nativeWorkHubDeviceIdentity() {
  return { deviceId: await getDeviceId(), connectionId: connectionId ?? (connectionId = newConnectionId()) };
}

export type NativeWorkHubSurface = {
  path: string;
  entityType: string | null;
  entityId: string | null;
  updatedAt: number;
};

export function nativeWorkHubSurface(path: string, now = Date.now()): NativeWorkHubSurface {
  const clean = path.split("?")[0] || "/";
  const rules: Array<[RegExp, string]> = [
    [/\/(?:tickets|ticket)\/(\d+)/, "ticket"],
    [/\/(?:site-locations|sites)\/(\d+)/, "site"],
    [/\/invoices\/(\d+)/, "invoice"],
    [/\/work-hub\/meeting\/([^/]+)/, "meeting"],
    [/\/(?:visitor-checkin|gate)(?:\/([^/]+))?/, "gate"],
  ];
  for (const [pattern, entityType] of rules) {
    const match = clean.match(pattern);
    if (match) return { path, entityType, entityId: match[1] ?? null, updatedAt: now };
  }
  return { path, entityType: null, entityId: null, updatedAt: now };
}

export function useWorkHubDevicePresence(path: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let registered = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deviceId = "";
    const currentConnectionId = connectionId ?? (connectionId = newConnectionId());
    const heartbeat = async () => {
      if (stopped) return;
      deviceId ||= await getDeviceId();
      if (!registered) {
        await apiFetch("/api/work-hub/devices/register", {
          method: "POST",
          headers: { "x-work-hub-source": "ios" },
          body: JSON.stringify({
            deviceId,
            friendlyName: workHubDeviceLabel(),
            deviceClass: workHubDeviceClass(),
            capabilities: { microphone: true, speaker: true, camera: true, fileSelection: true, pushNotifications: true },
          }),
        });
        registered = true;
      }
      await apiFetch(`/api/work-hub/devices/${deviceId}/heartbeat`, {
        method: "POST",
        headers: { "x-work-hub-source": "ios" },
        body: JSON.stringify({
          connectionId: currentConnectionId,
          foreground: AppState.currentState === "active",
          microphonePermission: "unknown",
          surface: nativeWorkHubSurface(path),
        }),
      });
    };
    const send = () => { void heartbeat().catch(() => { registered = false; }); };
    send();
    timer = setInterval(send, 12_000);
    const subscription = AppState.addEventListener("change", send);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, path]);
}
