import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  reduced: false,
  preference: vi.fn<() => Promise<boolean>>(),
  starts: vi.fn(),
  stops: vi.fn(),
  resets: vi.fn(),
  reduceListeners: new Set<(reduced: boolean) => void>(),
  appListeners: new Set<(state: string) => void>(),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  class Value {
    setValue = env.resets;
    stopAnimation = vi.fn();
    interpolate() { return 10; }
  }
  return {
    ...actual,
    AccessibilityInfo: {
      isReduceMotionEnabled: () => env.preference(),
      addEventListener: (_event: string, listener: (reduced: boolean) => void) => {
        env.reduceListeners.add(listener);
        return { remove: () => env.reduceListeners.delete(listener) };
      },
    },
    AppState: {
      currentState: "active",
      addEventListener: (_event: string, listener: (state: string) => void) => {
        env.appListeners.add(listener);
        return { remove: () => env.appListeners.delete(listener) };
      },
    },
    Animated: {
      View: actual.View,
      Value,
      timing: () => ({}),
      sequence: (steps: unknown[]) => steps,
      parallel: (steps: unknown[]) => steps,
      loop: () => ({ start: env.starts, stop: env.stops }),
    },
  };
});

import MeetingSpeakingBars from "./MeetingSpeakingBars";

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  env.reduced = false;
  env.preference.mockReset().mockImplementation(() => Promise.resolve(env.reduced));
  env.starts.mockReset();
  env.stops.mockReset();
  env.resets.mockReset();
});

afterEach(() => {
  cleanup();
  expect(env.reduceListeners.size).toBe(0);
  expect(env.appListeners.size).toBe(0);
});

describe("MeetingSpeakingBars", () => {
  it("renders the approved five separated heights and animates only while active in the foreground", async () => {
    const view = render(<MeetingSpeakingBars active color="#00adb5" />);
    await settle();
    expect(screen.getAllByTestId(/speaker-bar-/).map((bar) => bar.getAttribute("data-rest-height")))
      .toEqual(["7", "12", "9", "13", "6"]);
    expect(env.starts).toHaveBeenCalledOnce();

    act(() => env.appListeners.forEach((listener) => listener("background")));
    expect(env.stops).toHaveBeenCalledOnce();
    const startsBeforeInactive = env.starts.mock.calls.length;
    view.rerender(<MeetingSpeakingBars active={false} color="#00adb5" />);
    expect(screen.queryAllByTestId(/speaker-bar-/)).toHaveLength(0);
    expect(env.starts).toHaveBeenCalledTimes(startsBeforeInactive);
  });

  it("honors initial and changed reduced-motion preferences while retaining static speaking bars", async () => {
    env.reduced = true;
    const view = render(<MeetingSpeakingBars active color="#00adb5" />);
    await settle();
    expect(screen.getAllByTestId(/speaker-bar-/)).toHaveLength(5);
    expect(env.starts).not.toHaveBeenCalled();

    act(() => env.reduceListeners.forEach((listener) => listener(false)));
    expect(env.starts).toHaveBeenCalledOnce();
    act(() => env.reduceListeners.forEach((listener) => listener(true)));
    expect(env.stops).toHaveBeenCalledOnce();
    expect(env.resets).toHaveBeenCalled();

    view.unmount();
    expect(env.stops).toHaveBeenCalledOnce();
  });

  it("does not let a late initial preference overwrite a newer reduced-motion change", async () => {
    let resolveInitial!: (value: boolean) => void;
    env.preference.mockReturnValue(new Promise<boolean>((resolve) => { resolveInitial = resolve; }));
    render(<MeetingSpeakingBars active color="#00adb5" />);
    act(() => env.reduceListeners.forEach((listener) => listener(true)));
    await act(async () => { resolveInitial(false); await Promise.resolve(); });
    expect(screen.getAllByTestId(/speaker-bar-/)).toHaveLength(5);
    expect(env.starts).not.toHaveBeenCalled();
  });
});
