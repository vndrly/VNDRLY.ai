import { useEffect, useState } from "react";
import bellUrl from "../../../vndrly-mobile/assets/sounds/vndrly_bell_ring.wav";
import { createMessageSoundAlert } from "@/lib/message-sound-alert";
import { NOTIFICATION_CREATED_BROWSER_EVENT, type NotificationCreatedBrowserDetail } from "@/lib/notifications-api";

const CHANGE_EVENT = "vndrly:message-sound-preference";
const preferenceKey = (userId: number) => `vndrly:message-sound-enabled:${userId}`;
function enabledFor(userId: number) {
  try { return localStorage.getItem(preferenceKey(userId)) !== "0"; } catch { return true; }
}

export function useMessageSoundPreference(userId: number | undefined) {
  const [enabled, setEnabled] = useState(() => userId ? enabledFor(userId) : false);
  useEffect(() => {
    const update = () => setEnabled(userId ? enabledFor(userId) : false);
    update();
    window.addEventListener("storage", update);
    window.addEventListener(CHANGE_EVENT, update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener(CHANGE_EVENT, update); };
  }, [userId]);
  return { enabled, setEnabled: (value: boolean) => {
    if (!userId) return;
    try { localStorage.setItem(preferenceKey(userId), value ? "1" : "0"); } catch { return; }
    setEnabled(value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } };
}

/** Mounted once by the bell; browser interaction unlocks audio without playing it. */
export function useMessageSound(userId: number | undefined) {
  useEffect(() => {
    if (!userId || typeof window.AudioContext !== "function") return;
    let context: AudioContext | undefined;
    let buffer: Promise<AudioBuffer> | undefined;
    let disposed = false;
    const unlock = () => {
      if (!enabledFor(userId)) return;
      try {
        context ??= new AudioContext();
        void context.resume().catch(() => undefined);
      } catch { /* Unsupported or blocked audio remains silent. */ }
    };
    let storage: Storage | undefined;
    try { storage = localStorage; } catch { /* Browser storage may be blocked. */ }
    const alert = createMessageSoundAlert({
      userId, enabled: () => !disposed && enabledFor(userId), storage,
      lock: navigator.locks ? async (name, work) => await navigator.locks.request(name, work) : undefined,
      play: async () => {
        if (disposed || context?.state !== "running") return false;
        const activeContext = context;
        buffer ??= fetch(bellUrl).then(response => {
          if (!response.ok) throw new Error("Notification sound unavailable");
          return response.arrayBuffer();
        }).then(bytes => activeContext.decodeAudioData(bytes)).catch(error => { buffer = undefined; throw error; });
        const decoded = await buffer;
        if (disposed || !enabledFor(userId) || activeContext.state !== "running") return false;
        const source = activeContext.createBufferSource();
        source.buffer = decoded;
        source.connect(activeContext.destination);
        source.start();
        return true;
      },
    });
    const onMessage = (event: Event) => { void alert((event as CustomEvent<NotificationCreatedBrowserDetail>).detail); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener(NOTIFICATION_CREATED_BROWSER_EVENT, onMessage);
    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener(NOTIFICATION_CREATED_BROWSER_EVENT, onMessage);
      void context?.close().catch(() => undefined);
    };
  }, [userId]);
}
