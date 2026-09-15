import { AppState } from "react-native";
import { getLiveLocationStatus, subscribeLiveLocationStatus } from "@/lib/liveLocationReporter";
import type { FieldModeEventSource } from "@/hooks/use-field-mode";

const TICK_MS = 60_000;

export function createReporterFieldModeEventSource(now: () => number = Date.now): FieldModeEventSource {
  return {
    subscribe(listener) {
      let active = true;
      let workActive = false;
      let sequence = 0;
      const emitStatus = async () => {
        const status = await getLiveLocationStatus();
        if (!active) return;
        if (status.hasActiveTicket && !workActive) {
          workActive = true;
          listener({ id: `work-start:${now()}:${++sequence}`, type: "scheduled_arrival", atMs: now() });
        } else if (!status.hasActiveTicket) {
          workActive = false;
        }
      };
      const unsubscribeStatus = subscribeLiveLocationStatus(() => { void emitStatus(); });
      const appState = AppState.addEventListener("change", (state) => { if (state === "active") void emitStatus(); });
      const timer = setInterval(() => {
        if (workActive) listener({ id: `clock:${Math.floor(now() / TICK_MS)}`, type: "clock_tick", atMs: now() });
      }, TICK_MS);
      void emitStatus();
      return () => {
        active = false;
        unsubscribeStatus();
        appState.remove();
        clearInterval(timer);
      };
    },
  };
}
