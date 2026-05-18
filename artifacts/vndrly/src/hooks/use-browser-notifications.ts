import { useCallback, useEffect, useState } from "react";

// Task #48 — small wrapper around the foreground Notifications API the
// notifications-bell uses to surface a system pop-up the moment a new
// notification arrives over the SSE stream. Two pieces of state we need
// to expose:
//
//   1. `permission` — the live browser permission (`default` / `granted` /
//      `denied`). Read straight from `Notification.permission` and kept
//      in sync with the user's choice on the prompt.
//   2. `enabled` — the user's *intent* (per-browser preference). Stored
//      in localStorage so the bell can remember "yes, this user opted
//      in on this browser" across reloads. The actual permission check
//      still happens at show-time so a user who later flips the OS /
//      browser permission to Denied silently stops seeing pop-ups
//      without us having to chase the change.
//
// The hook deliberately does NOT call `requestPermission()` on mount —
// browsers (and the task description) want the request gated on a real
// user gesture, hence `requestPermission()` is exposed as an action and
// not run automatically.

const STORAGE_KEY = "vndrly:browserNotificationsEnabled";

export type BrowserNotificationPermission = "default" | "granted" | "denied" | "unsupported";

export type UseBrowserNotificationsResult = {
  /** True iff `window.Notification` exists in this environment. */
  supported: boolean;
  /** The browser-level permission, or "unsupported" if the API is missing. */
  permission: BrowserNotificationPermission;
  /** The user's per-browser opt-in preference (stored in localStorage). */
  enabled: boolean;
  /** Toggle the per-browser preference and (when turning on) prompt for permission. */
  setEnabled: (next: boolean) => Promise<BrowserNotificationPermission>;
  /**
   * Show a system notification when both `enabled` is true AND `permission`
   * is `granted`. Returns `true` when a notification was actually shown.
   * Skipped (returns `false`) when the document is currently visible — the
   * in-app bell already updates in that case, so a system pop-up would be
   * a noisy duplicate of what the user is already seeing.
   */
  show: (input: {
    title: string;
    body?: string | null;
    tag?: string;
    onClick?: () => void;
  }) => boolean;
};

function readPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported";
  }
  return window.Notification.permission as BrowserNotificationPermission;
}

function readEnabledFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabledToStorage(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage may be disabled — degrade silently */
  }
}

export function useBrowserNotifications(): UseBrowserNotificationsResult {
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    readPermission(),
  );
  const [enabled, setEnabledState] = useState<boolean>(() => readEnabledFromStorage());

  // Keep state in sync if the permission is changed in another tab or
  // via the browser's site-settings UI while this tab is open. There is
  // no `permissionchange` event in older browsers, so we re-read on
  // window focus as a cheap fallback.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => setPermission(readPermission());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const supported = permission !== "unsupported";

  const setEnabled = useCallback<UseBrowserNotificationsResult["setEnabled"]>(
    async (next) => {
      if (!next) {
        writeEnabledToStorage(false);
        setEnabledState(false);
        return readPermission();
      }
      if (typeof window === "undefined" || typeof window.Notification === "undefined") {
        return "unsupported";
      }
      // Prompt only when needed; if already granted/denied just record
      // the user's intent. This matches Chrome/Firefox guidance — calling
      // requestPermission() when the answer is already known does work
      // but is wasteful and re-uses no UI.
      let perm = window.Notification.permission as BrowserNotificationPermission;
      if (perm === "default") {
        try {
          perm = (await window.Notification.requestPermission()) as BrowserNotificationPermission;
        } catch {
          perm = window.Notification.permission as BrowserNotificationPermission;
        }
      }
      setPermission(perm);
      // Only persist the opt-in if the browser actually granted permission
      // — otherwise the toggle would appear "on" while pop-ups silently
      // never show. The UI surfaces this state separately via `permission`.
      const granted = perm === "granted";
      writeEnabledToStorage(granted);
      setEnabledState(granted);
      return perm;
    },
    [],
  );

  const show = useCallback<UseBrowserNotificationsResult["show"]>(
    ({ title, body, tag, onClick }) => {
      if (typeof window === "undefined" || typeof window.Notification === "undefined") {
        return false;
      }
      if (!enabled) return false;
      if (window.Notification.permission !== "granted") return false;
      // Skip when the tab is already visible — the in-app bell handles
      // that case and a duplicate system pop-up would be noisy. We
      // intentionally check `visibilityState` rather than `document.hidden`
      // because the former includes "prerender" / "unloaded" too.
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        return false;
      }
      try {
        const n = new window.Notification(title, {
          body: body ?? undefined,
          tag,
        });
        if (onClick) {
          n.onclick = () => {
            try {
              window.focus();
            } catch {
              /* ignore */
            }
            onClick();
            try {
              n.close();
            } catch {
              /* ignore */
            }
          };
        }
        return true;
      } catch {
        return false;
      }
    },
    [enabled],
  );

  return { supported, permission, enabled, setEnabled, show };
}
