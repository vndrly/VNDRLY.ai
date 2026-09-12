import { useEffect, useRef } from "react";
import { createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";

const DEVICE_KEY = "vndrly.workHubDeviceId";
const CONNECTION_KEY = "vndrly.workHubConnectionId";

export type WorkHubSurface = { path: string; entityType: string | null; entityId: string | null; updatedAt: number };

export function workHubSurfaceForPath(path: string, now = Date.now()): WorkHubSurface {
  const clean = path.split("?")[0] || "/";
  const rules: Array<[RegExp, string]> = [
    [/\/(?:tickets|ticket)\/(\d+)/, "ticket"],
    [/\/(?:site-locations|sites)\/(\d+)/, "site"],
    [/\/invoices\/(\d+)/, "invoice"],
    [/\/work-hub\/meetings\/([^/]+)/, "meeting"],
    [/\/gate(?:\/([^/]+))?/, "gate"],
  ];
  for (const [pattern, entityType] of rules) {
    const match = clean.match(pattern);
    if (match) return { path, entityType, entityId: match[1] ?? null, updatedAt: now };
  }
  return { path, entityType: null, entityId: null, updatedAt: now };
}

function storedId(storage: Storage, key: string) {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const value = createWorkHubOperationId();
  storage.setItem(key, value);
  return value;
}

export function useWorkHubDevicePresence(path: string, enabled: boolean) {
  const registered = useRef(false);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const deviceId = storedId(localStorage, DEVICE_KEY);
    const connectionId = storedId(sessionStorage, CONNECTION_KEY);
    const heartbeat = async () => {
      if (stopped) return;
      if (!registered.current) {
        await workHubRequest("/devices/register", { method: "POST", body: JSON.stringify({ deviceId, friendlyName: navigator.platform || "Web browser", deviceClass: /Mobi|Android/i.test(navigator.userAgent) ? "phone" : "desktop", capabilities: { microphone: true, speaker: true, fileSelection: true } }) });
        registered.current = true;
      }
      await workHubRequest(`/devices/${deviceId}/heartbeat`, { method: "POST", body: JSON.stringify({ connectionId, foreground: document.visibilityState === "visible", microphonePermission: "unknown", surface: workHubSurfaceForPath(`${window.location.pathname}${window.location.search}`) }) });
    };
    const send = () => { void heartbeat().catch(() => { registered.current = false; }); };
    send();
    timer = setInterval(send, 12_000);
    document.addEventListener("visibilitychange", send);
    window.addEventListener("focus", send);
    return () => { stopped = true; if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", send); window.removeEventListener("focus", send); };
  }, [enabled, path]);
}
