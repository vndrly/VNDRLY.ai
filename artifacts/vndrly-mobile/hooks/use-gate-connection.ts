import { useEffect } from "react";
import { AppState } from "react-native";
import { useGateOperatingContext } from "./use-gate-operating-context";
import { useAuth } from "./use-auth";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
/** Only the server-confirmed watch reports a connected booth; browsing never does. */
export function useGateConnection() {
  const { user, activeMembershipId } = useAuth(),
    context = useGateOperatingContext(),
    station = context.operating?.stationId;
  useEffect(() => {
    if (!station || !context.isSuccess) return;
    const scope = captureAuthScope();
    let busy = false,
      alive = true;
    async function report() {
      if (
        !alive ||
        busy ||
        !isAuthScopeCurrent(scope) ||
        AppState.currentState !== "active"
      )
        return;
      busy = true;
      try {
        await apiFetch(
          "/api/gate-change-over/" + station + "/connection",
          { method: "POST", body: "{}" },
          scope,
        );
      } catch {
        /* Connection expires server-side; never claim online locally. */
      } finally {
        busy = false;
      }
    }
    void report();
    const timer = setInterval(() => void report(), 30000),
      sub = AppState.addEventListener("change", (state) => {
        if (state === "active") void report();
      });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [station, context.isSuccess, user?.id, activeMembershipId]);
}
