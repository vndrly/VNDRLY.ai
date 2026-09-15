export type FieldModeSnapshot = {
  mode: "off" | "active" | "awaiting_end" | "awaiting_stop" | "ended";
  presence: "on_site" | "off_site";
  consented: boolean;
  scheduled: boolean;
  expectsMoreWork: boolean;
  shiftEndsAtMs: number | null;
  stoppedOffsiteAtMs: number | null;
  promptStartedAtMs: number | null;
  lastEventId: string | null;
};

export type FieldModeEvent =
  | { id: string; type: "scheduled_arrival"; atMs: number }
  | { id: string; type: "geofence_entry"; atMs: number }
  | { id: string; type: "geofence_exit"; atMs: number }
  | { id: string; type: "clock_tick"; atMs: number }
  | { id: string; type: "end_work_confirmed"; atMs: number }
  | { id: string; type: "end_work_declined"; atMs: number }
  | { id: string; type: "extended_stop_response"; atMs: number };

export type FieldModeEffect =
  | { type: "start_tracking" }
  | { type: "announce_ready" }
  | { type: "record_arrival" }
  | { type: "record_departure" }
  | { type: "prompt_end_work" }
  | { type: "prompt_extended_stop" }
  | { type: "stop_tracking" }
  | { type: "supervisor_exception"; reason: "end_work_unanswered" | "extended_stop_unanswered" };

const END_RESPONSE_TIMEOUT_MS = 15 * 60 * 1_000;
const EXTENDED_STOP_MS = 45 * 60 * 1_000;

export function evaluateFieldMode(snapshot: FieldModeSnapshot, event: FieldModeEvent): { snapshot: FieldModeSnapshot; effects: FieldModeEffect[] } {
  if (snapshot.lastEventId === event.id) return { snapshot, effects: [] };
  const next = { ...snapshot, lastEventId: event.id };
  const effects: FieldModeEffect[] = [];

  if (event.type === "scheduled_arrival") {
    if (next.mode === "off" && next.consented && next.scheduled) {
      next.mode = "active";
      next.presence = "on_site";
      effects.push({ type: "start_tracking" }, { type: "announce_ready" });
    }
    return { snapshot: next, effects };
  }

  if (event.type === "geofence_entry") {
    next.presence = "on_site";
    next.stoppedOffsiteAtMs = null;
    if (next.mode !== "off" && next.mode !== "ended") effects.push({ type: "record_arrival" });
    return { snapshot: next, effects };
  }

  if (event.type === "geofence_exit") {
    next.presence = "off_site";
    if (next.mode !== "off" && next.mode !== "ended") effects.push({ type: "record_departure" });
    if (next.mode === "active" && !next.expectsMoreWork) {
      next.mode = "awaiting_end";
      next.promptStartedAtMs = event.atMs;
      effects.push({ type: "prompt_end_work" });
    }
    return { snapshot: next, effects };
  }

  if (event.type === "end_work_confirmed" && next.mode === "awaiting_end") {
    next.mode = "ended";
    next.promptStartedAtMs = null;
    effects.push({ type: "stop_tracking" });
    return { snapshot: next, effects };
  }

  if (event.type === "end_work_declined" && next.mode === "awaiting_end") {
    next.mode = "active";
    next.expectsMoreWork = true;
    next.promptStartedAtMs = null;
    return { snapshot: next, effects };
  }

  if (event.type === "extended_stop_response" && next.mode === "awaiting_stop") {
    next.mode = "active";
    next.promptStartedAtMs = null;
    next.stoppedOffsiteAtMs = null;
    return { snapshot: next, effects };
  }

  if (event.type !== "clock_tick") return { snapshot: next, effects };

  if (next.mode === "awaiting_end" && next.promptStartedAtMs != null && event.atMs - next.promptStartedAtMs >= END_RESPONSE_TIMEOUT_MS) {
    next.mode = "ended";
    next.promptStartedAtMs = null;
    effects.push({ type: "stop_tracking" }, { type: "supervisor_exception", reason: "end_work_unanswered" });
    return { snapshot: next, effects };
  }

  if (next.mode === "awaiting_stop" && next.promptStartedAtMs != null && event.atMs - next.promptStartedAtMs >= END_RESPONSE_TIMEOUT_MS) {
    next.mode = "active";
    next.promptStartedAtMs = null;
    next.stoppedOffsiteAtMs = null;
    effects.push({ type: "supervisor_exception", reason: "extended_stop_unanswered" });
    return { snapshot: next, effects };
  }

  if (next.mode === "active" && next.shiftEndsAtMs != null && event.atMs >= next.shiftEndsAtMs) {
    next.mode = "awaiting_end";
    next.promptStartedAtMs = event.atMs;
    effects.push({ type: "prompt_end_work" });
    return { snapshot: next, effects };
  }

  if (next.mode === "active" && next.presence === "off_site" && next.stoppedOffsiteAtMs != null && event.atMs - next.stoppedOffsiteAtMs >= EXTENDED_STOP_MS) {
    next.mode = "awaiting_stop";
    next.promptStartedAtMs = event.atMs;
    effects.push({ type: "prompt_extended_stop" });
  }
  return { snapshot: next, effects };
}
