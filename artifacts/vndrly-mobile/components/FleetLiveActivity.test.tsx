import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  capabilities: vi.fn(),
  show: vi.fn(),
  stop: vi.fn(),
  current: true,
  clear: null as (() => void) | null,
  listener: null as ((value: string) => void) | null,
  remove: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: (_: string, fn: (value: string) => void) => {
      env.listener = fn;
      return { remove: env.remove };
    },
  },
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black" }) }));
vi.mock(
  "../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule",
  () => ({ default: { getCapabilities: env.capabilities } }),
);
vi.mock("@/lib/native-live-work", () => ({
  showFleetWorkActivity: env.show,
  stopNativeWorkActivity: env.stop,
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
  subscribeToken: (fn: () => void) => {
    env.clear = fn;
    return () => {};
  },
  subscribeUser: () => () => {},
}));
import FleetLiveActivity from "./FleetLiveActivity";
const runId = "70000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  env.current = true;
  env.capabilities.mockResolvedValue({ liveActivities: true });
  env.show.mockResolvedValue({ activityId: "actual" });
  env.stop.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("explicit current-work Live Activity", () => {
  it("requests only after explicit selection and stops when duty ends", async () => {
    const view = render(
      <FleetLiveActivity runId={runId} active disabled={false} />,
    );
    await screen.findByText("nativeLiveWork.show");
    expect(env.show).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("nativeLiveWork.show"));
    await screen.findByText("nativeLiveWork.shown");
    expect(env.show).toHaveBeenCalledWith(runId);
    view.rerender(
      <FleetLiveActivity runId={runId} active={false} disabled={false} />,
    );
    expect(env.stop).toHaveBeenCalledWith(runId);
    expect(screen.queryByText("nativeLiveWork.stop")).toBeNull();
    expect(screen.queryByText("nativeLiveWork.shown")).toBeNull();
  });
  it("cancels the exact pending run on unmount without accepting its late callback", async () => {
    let finish!: () => void;
    env.show.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <FleetLiveActivity runId={runId} active disabled={false} />,
    );
    await screen.findByText("nativeLiveWork.show");
    fireEvent.click(screen.getByText("nativeLiveWork.show"));
    view.unmount();
    expect(env.stop).toHaveBeenCalledWith(runId);
    await act(async () => {
      finish();
    });
    expect(screen.queryByText("nativeLiveWork.shown")).toBeNull();
  });
  it("does not display a late old-account success", async () => {
    let finish!: () => void;
    env.show.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<FleetLiveActivity runId={runId} active disabled={false} />);
    await screen.findByText("nativeLiveWork.show");
    fireEvent.click(screen.getByText("nativeLiveWork.show"));
    await act(async () => {
      env.current = false;
      env.clear?.();
      finish();
    });
    expect(screen.queryByText("nativeLiveWork.shown")).toBeNull();
    expect(screen.queryByText("nativeLiveWork.stop")).toBeNull();
  });
  it("removes foreground refresh listeners and timers on unmount", async () => {
    vi.useFakeTimers();
    const view = render(
      <FleetLiveActivity runId={runId} active disabled={false} />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByText("nativeLiveWork.show"));
    await act(async () => {});
    expect(env.show).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(env.remove).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(env.show).toHaveBeenCalledTimes(1);
  });
});
