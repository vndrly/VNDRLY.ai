import { describe, expect, it } from "vitest";
import { evaluateFieldMode, type FieldModeSnapshot } from "./field-mode-policy";

const base: FieldModeSnapshot = {
  mode: "off",
  presence: "off_site",
  consented: true,
  scheduled: true,
  expectsMoreWork: false,
  shiftEndsAtMs: null,
  stoppedOffsiteAtMs: null,
  promptStartedAtMs: null,
  lastEventId: null,
};

describe("field mode policy", () => {
  it("starts at scheduled arrival and announces readiness once", () => {
    const first = evaluateFieldMode(base, { id: "arrival-1", type: "scheduled_arrival", atMs: 1_000 });
    expect(first.snapshot).toMatchObject({ mode: "active", presence: "on_site" });
    expect(first.effects).toEqual([{ type: "start_tracking" }, { type: "announce_ready" }]);
    expect(evaluateFieldMode(first.snapshot, { id: "arrival-1", type: "scheduled_arrival", atMs: 1_000 }).effects).toEqual([]);
  });

  it("records hauling-loop departures and returns without ending work", () => {
    const active = { ...base, mode: "active" as const, presence: "on_site" as const, expectsMoreWork: true };
    const exited = evaluateFieldMode(active, { id: "exit-1", type: "geofence_exit", atMs: 2_000 });
    const returned = evaluateFieldMode(exited.snapshot, { id: "entry-2", type: "geofence_entry", atMs: 3_000 });
    expect(exited.snapshot).toMatchObject({ mode: "active", presence: "off_site" });
    expect(exited.effects).toEqual([{ type: "record_departure" }]);
    expect(returned.effects).toEqual([{ type: "record_arrival" }]);
  });

  it("prompts at shift end and stops before escalating after fifteen minutes", () => {
    const active = { ...base, mode: "active" as const, shiftEndsAtMs: 10_000 };
    const prompted = evaluateFieldMode(active, { id: "tick-end", type: "clock_tick", atMs: 10_000 });
    expect(prompted.effects).toEqual([{ type: "prompt_end_work" }]);
    const timedOut = evaluateFieldMode(prompted.snapshot, { id: "tick-timeout", type: "clock_tick", atMs: 910_000 });
    expect(timedOut.snapshot.mode).toBe("ended");
    expect(timedOut.effects).toEqual([{ type: "stop_tracking" }, { type: "supervisor_exception", reason: "end_work_unanswered" }]);
  });

  it("prompts on an unassigned departure and ends immediately when confirmed", () => {
    const active = { ...base, mode: "active" as const, presence: "on_site" as const, expectsMoreWork: false };
    const prompted = evaluateFieldMode(active, { id: "exit-final", type: "geofence_exit", atMs: 5_000 });
    expect(prompted.effects).toEqual([{ type: "record_departure" }, { type: "prompt_end_work" }]);
    const ended = evaluateFieldMode(prompted.snapshot, { id: "confirm-end", type: "end_work_confirmed", atMs: 6_000 });
    expect(ended.effects).toEqual([{ type: "stop_tracking" }]);
    expect(ended.snapshot.mode).toBe("ended");
  });

  it("nudges after a forty-five minute offsite stop and escalates unanswered without checking out", () => {
    const stopped = { ...base, mode: "active" as const, stoppedOffsiteAtMs: 1_000 };
    const prompted = evaluateFieldMode(stopped, { id: "tick-stop", type: "clock_tick", atMs: 2_701_000 });
    expect(prompted.effects).toEqual([{ type: "prompt_extended_stop" }]);
    const escalated = evaluateFieldMode(prompted.snapshot, { id: "tick-stop-timeout", type: "clock_tick", atMs: 3_601_000 });
    expect(escalated.effects).toEqual([{ type: "supervisor_exception", reason: "extended_stop_unanswered" }]);
    expect(escalated.snapshot.mode).toBe("active");
  });

  it("never prompts for a stop while the worker remains on site", () => {
    const onsite = { ...base, mode: "active" as const, presence: "on_site" as const, stoppedOffsiteAtMs: 1_000 };
    expect(evaluateFieldMode(onsite, { id: "tick-onsite", type: "clock_tick", atMs: 9_999_999 }).effects).toEqual([]);
  });
});
