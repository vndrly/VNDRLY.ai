import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  create: vi.fn(), warmUp: vi.fn(), post: vi.fn(), haptic: vi.fn(), alert: vi.fn(),
  background: null as (() => void) | null,
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active" }, Alert: { alert: env.alert }, StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  ScrollView: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>, ActivityIndicator: () => <span />,
  Pressable: ({ children, onPressIn, onPressOut, disabled, testID }: React.PropsWithChildren<{
    onPressIn?: () => void; onPressOut?: () => void; disabled?: boolean; testID?: string;
  }>) => <button data-testid={testID} disabled={disabled} onMouseDown={onPressIn} onMouseUp={onPressOut}>{children}</button>,
}));
vi.mock("expo-router", () => ({ useFocusEffect: (effect: () => (() => void) | void) => React.useEffect(effect, [effect]) }));
vi.mock("expo-haptics", () => ({ impactAsync: env.haptic, notificationAsync: vi.fn(), ImpactFeedbackStyle: { Medium: "medium" }, NotificationFeedbackType: { Success: "success" } }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => <span /> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#123456" }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@/components/LayeredPillButton", () => ({ default: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/askv-audio-session", () => ({ subscribeAskVAppState: (_active: () => void, background: () => void) => {
  env.background = background; return { remove: () => { env.background = null; } };
} }));
vi.mock("@/lib/ptt", () => ({
  createPttRecorder: env.create, warmUpPttSession: env.warmUp, postPttMessage: env.post,
  isBackgroundAudioSessionError: () => false, isRecordingBusyError: () => false, isPttComment: () => false,
  playPttUri: vi.fn(), pttAttachmentPlayUri: (uri: string) => uri, pttDurationLabel: () => null,
  PttMicPermissionError: class extends Error {},
}));
import PushToTalkPanel from "./PushToTalkPanel";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function recorder() {
  return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue({ uri: "file:///cache/test.m4a", durationSeconds: 2 }), dispose: vi.fn().mockResolvedValue(undefined) };
}
const press = async () => { await act(async () => { fireEvent.mouseDown(screen.getByTestId("button-ptt-hold")); }); };
const release = async () => { await act(async () => { fireEvent.mouseUp(screen.getByTestId("button-ptt-hold")); }); };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); env.background = null;
  env.warmUp.mockReset().mockResolvedValue(undefined);
  env.haptic.mockReset().mockResolvedValue(undefined);
  env.post.mockReset().mockResolvedValue(undefined);
  env.create.mockReset();
});

describe("PushToTalkPanel press lifecycle", () => {
  it("does not create a recorder after release during permission warm-up", async () => {
    const permission = deferred<void>(); env.warmUp.mockReturnValue(permission.promise);
    render(<PushToTalkPanel ticketId={42} ticketLabel="Ticket 42" />);
    await press(); await release();
    await act(async () => permission.resolve());
    expect(env.create).not.toHaveBeenCalled();
    expect(env.post).not.toHaveBeenCalled();
    expect(env.alert).not.toHaveBeenCalled();
  });

  it("disposes a pending start on release and never posts its late result", async () => {
    const starting = deferred<void>(); const rec = recorder(); rec.start.mockReturnValue(starting.promise);
    env.create.mockResolvedValue(rec);
    render(<PushToTalkPanel ticketId={42} ticketLabel="Ticket 42" />);
    await press(); expect(rec.start).toHaveBeenCalledTimes(1);
    await release(); expect(rec.dispose).toHaveBeenCalledTimes(1);
    await act(async () => starting.resolve());
    expect(screen.queryByText("foremanHome.pttRecording")).toBeNull();
    expect(env.post).not.toHaveBeenCalled();
    expect(env.alert).not.toHaveBeenCalled();
  });

  it("does not create capture after unmount during the haptic await", async () => {
    const haptic = deferred<void>(); env.haptic.mockReturnValue(haptic.promise);
    const view = render(<PushToTalkPanel ticketId={42} ticketLabel="Ticket 42" />);
    await press(); view.unmount();
    await act(async () => haptic.resolve());
    expect(env.create).not.toHaveBeenCalled();
    expect(env.post).not.toHaveBeenCalled();
  });

  it("does not let a late old start dispose a newer recording", async () => {
    const starting = deferred<void>(); const first = recorder(); const second = recorder();
    first.start.mockReturnValue(starting.promise);
    env.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<PushToTalkPanel ticketId={42} ticketLabel="Ticket 42" />);
    await press(); await release(); await press();
    expect(second.start).toHaveBeenCalledTimes(1);
    await act(async () => starting.resolve());
    expect(second.dispose).not.toHaveBeenCalled();
    await release();
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(env.post).toHaveBeenCalledTimes(1);
  });

  it("cancels pending capture on background without resuming it", async () => {
    const starting = deferred<void>(); const rec = recorder(); rec.start.mockReturnValue(starting.promise);
    env.create.mockResolvedValue(rec);
    render(<PushToTalkPanel ticketId={42} ticketLabel="Ticket 42" />);
    await press();
    await act(async () => env.background?.());
    expect(rec.dispose).toHaveBeenCalledTimes(1);
    await act(async () => starting.resolve());
    expect(env.post).not.toHaveBeenCalled();
    expect(screen.queryByText("foremanHome.pttRecording")).toBeNull();
  });

  it("uploads exactly once on a completed hold/release and disposes the scoped file owner", async () => {
    const rec = recorder(); env.create.mockResolvedValue(rec);
    render(<PushToTalkPanel ticketId={42} ticketLabel="Ticket 42" />);
    await press();
    expect(env.create).toHaveBeenCalledWith({ deleteOnDispose: true });
    expect(screen.getByText("foremanHome.pttRecording")).toBeTruthy();
    await release(); await release();
    expect(rec.stop).toHaveBeenCalledTimes(1);
    expect(env.post).toHaveBeenCalledWith(42, "file:///cache/test.m4a", 2);
    expect(env.post).toHaveBeenCalledTimes(1);
    expect(rec.dispose).toHaveBeenCalledTimes(1);
  });
});
