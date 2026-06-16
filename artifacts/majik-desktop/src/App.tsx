import { useCallback, useEffect, useState } from "react";
import type { MajikCircleSnapshot } from "@workspace/majik";
import { LoginView } from "./components/LoginView";
import { WidgetView } from "./components/WidgetView";
import { useWidgetWindowHeight } from "./hooks/use-widget-window-height";
import {
  fetchCircle,
  fetchMajikMe,
  loadStoredSession,
  markDown,
  markUp,
  saveStoredSession,
  subscribeMajikEvents,
} from "./lib/api";

type Screen =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "forbidden"; message: string }
  | {
      kind: "widget";
      sessionCookie: string;
      selfUserId: number;
      snapshot: MajikCircleSnapshot;
    };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const memberCount =
    screen.kind === "widget" ? screen.snapshot.memberCount : 4;
  useWidgetWindowHeight(memberCount);

  const refreshCircle = useCallback(async (sessionCookie: string, selfUserId: number) => {
    const snapshot = await fetchCircle(sessionCookie);
    setScreen({ kind: "widget", sessionCookie, selfUserId, snapshot });
  }, []);

  useEffect(() => {
    void (async () => {
      const cookie = await loadStoredSession();
      if (!cookie) {
        setScreen({ kind: "login" });
        return;
      }
      try {
        const me = await fetchMajikMe(cookie);
        if (!me.isMember) {
          setScreen({
            kind: "forbidden",
            message: "Your VNDRLY account is not on the Majik team yet.",
          });
          return;
        }
        await refreshCircle(cookie, me.userId);
      } catch {
        await saveStoredSession(null);
        setScreen({ kind: "login" });
      }
    })();
  }, [refreshCircle]);

  useEffect(() => {
    if (screen.kind !== "widget") return;
    const unsubscribe = subscribeMajikEvents(screen.sessionCookie, (payload) => {
      const event = payload as { type?: string };
      if (event.type === "majik.presence_updated") {
        void refreshCircle(screen.sessionCookie, screen.selfUserId).catch(() => undefined);
      }
    });
    const timer = setInterval(() => {
      void refreshCircle(screen.sessionCookie, screen.selfUserId).catch(() => undefined);
    }, 60_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [screen, refreshCircle]);

  async function handleLoggedIn(sessionCookie: string) {
    await saveStoredSession(sessionCookie);
    const me = await fetchMajikMe(sessionCookie);
    if (!me.isMember) {
      setScreen({
        kind: "forbidden",
        message: "Signed in, but you are not on the Majik team yet.",
      });
      return;
    }
    await refreshCircle(sessionCookie, me.userId);
  }

  async function handleLogout() {
    await saveStoredSession(null);
    setScreen({ kind: "login" });
  }

  if (screen.kind === "loading") {
    return <div className="login-shell muted">Loading Majik…</div>;
  }

  if (screen.kind === "login") {
    return <LoginView onLoggedIn={handleLoggedIn} />;
  }

  if (screen.kind === "forbidden") {
    return (
      <div className="login-shell">
        <div className="brand">Majik</div>
        <p className="error-text">{screen.message}</p>
        <button type="button" className="secondary-btn" onClick={handleLogout}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <WidgetView
      snapshot={screen.snapshot}
      selfUserId={screen.selfUserId}
      busy={busy}
      onUp={() => {
        setBusy(true);
        void markUp(screen.sessionCookie)
          .then(() => refreshCircle(screen.sessionCookie, screen.selfUserId))
          .finally(() => setBusy(false));
      }}
      onDown={() => {
        setBusy(true);
        void markDown(screen.sessionCookie)
          .then(() => refreshCircle(screen.sessionCookie, screen.selfUserId))
          .finally(() => setBusy(false));
      }}
      onLogout={handleLogout}
    />
  );
}
