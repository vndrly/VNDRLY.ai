import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFieldMode } from "./use-field-mode";
import type { FieldModeEvent, FieldModeSnapshot } from "@/lib/field-mode-policy";

const initial = (consented = true): FieldModeSnapshot => ({
  mode: "off",
  presence: "off_site",
  consented,
  scheduled: true,
  expectsMoreWork: false,
  shiftEndsAtMs: null,
  stoppedOffsiteAtMs: null,
  promptStartedAtMs: null,
  lastEventId: null,
});

function harness(consented = true) {
  let listener: ((event: FieldModeEvent) => void) | null = null;
  const order: string[] = [];
  const actions = {
    startTracking: vi.fn(async () => { order.push("start"); }),
    stopTracking: vi.fn(async (_input: { reason: string; needsSupervisorConfirmation: boolean }) => { order.push("stop"); }),
    announceReady: vi.fn(async () => { order.push("announce"); }),
    recordArrival: vi.fn(async () => { order.push("arrival"); }),
    recordDeparture: vi.fn(async () => { order.push("departure"); }),
    promptEndWork: vi.fn(async () => { order.push("prompt-end"); }),
    promptExtendedStop: vi.fn(async () => { order.push("prompt-stop"); }),
    createSupervisorException: vi.fn(async () => { order.push("exception"); }),
  };
  const source = { subscribe: vi.fn((next: (event: FieldModeEvent) => void) => { listener = next; return () => { listener = null; }; }) };
  const hook = renderHook(() => useFieldMode({ initialSnapshot: initial(consented), source, actions }));
  const emit = async (event: FieldModeEvent) => {
    await act(async () => { listener?.(event); await Promise.resolve(); await Promise.resolve(); });
  };
  return { ...hook, actions, order, emit, source };
}

describe("useFieldMode", () => {
  it("starts only for consented work and executes an event once", async () => {
    const enabled = harness(true);
    await enabled.emit({ id: "arrival-1", type: "scheduled_arrival", atMs: 1_000 });
    await enabled.emit({ id: "arrival-1", type: "scheduled_arrival", atMs: 1_000 });
    expect(enabled.actions.startTracking).toHaveBeenCalledTimes(1);
    expect(enabled.actions.announceReady).toHaveBeenCalledTimes(1);

    const blocked = harness(false);
    await blocked.emit({ id: "arrival-2", type: "scheduled_arrival", atMs: 1_000 });
    expect(blocked.actions.startTracking).not.toHaveBeenCalled();
  });

  it("stops location before creating an unattended supervisor exception", async () => {
    const run = harness(true);
    await run.emit({ id: "arrival-1", type: "scheduled_arrival", atMs: 1_000 });
    await run.emit({ id: "exit-1", type: "geofence_exit", atMs: 2_000 });
    await run.emit({ id: "timeout-1", type: "clock_tick", atMs: 902_000 });
    expect(run.order.slice(-2)).toEqual(["stop", "exception"]);
  });

  it("unsubscribes on unmount so foreground callbacks cannot restart work", () => {
    const run = harness(true);
    run.unmount();
    expect(run.source.subscribe).toHaveBeenCalledTimes(1);
  });
});
