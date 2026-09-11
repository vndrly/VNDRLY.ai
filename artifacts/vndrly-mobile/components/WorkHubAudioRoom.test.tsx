import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { askVMicrophone, MicrophoneCoordinator } from "@workspace/askv-wake";
import i18n from "@/lib/i18n";
import WorkHubAudioRoom from "./WorkHubAudioRoom";

const env = vi.hoisted(() => ({
  api: vi.fn(), capture: vi.fn(), permission: vi.fn(), token: "token-a" as string | null,
  tokens: new Set<(token: string | null) => void>(), users: new Set<(user: any) => void>(),
  background: new Set<() => void>(), foreground: new Set<() => void>(), active: true,
  peers: [] as any[], offer: vi.fn(), remote: vi.fn(), nativeFactory: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", text: "black", destructive: "red" }) }));
vi.mock("@/lib/auth", () => ({
  getCachedToken: () => env.token, getToken: async () => env.token,
  subscribeToken: (fn: any) => { env.tokens.add(fn); return () => env.tokens.delete(fn); },
  subscribeUser: (fn: any) => { env.users.add(fn); return () => env.users.delete(fn); },
}));
vi.mock("@/lib/askv-audio-session", () => ({
  requestAskVMicrophonePermission: env.permission, isAskVAppActive: () => env.active,
  subscribeAskVAppState: (active: () => void, background: () => void) => {
    env.foreground.add(active); env.background.add(background);
    return { remove: () => { env.foreground.delete(active); env.background.delete(background); } };
  },
}));
vi.mock("react-native-webrtc", () => ({
  mediaDevices: { getUserMedia: env.capture },
  RTCSessionDescription: class { constructor(value: any) { Object.assign(this, value); } },
  RTCIceCandidate: class { constructor(value: any) { Object.assign(this, value); } },
  RTCPeerConnection: class {
    listeners = new Map<string, (event?: any) => void>();
    connectionState = "new"; remoteDescription: any = null;
    addTrack = vi.fn(); close = vi.fn(() => { this.connectionState = "closed"; });
    createOffer = vi.fn(() => env.offer()); createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer" }));
    setLocalDescription = vi.fn(async () => undefined);
    setRemoteDescription = vi.fn(async (value: any) => { await env.remote(); this.remoteDescription = value; });
    addIceCandidate = vi.fn(async () => undefined);
    addEventListener = (name: string, listener: any) => this.listeners.set(name, listener);
    removeEventListener = (name: string) => this.listeners.delete(name);
    constructor() { env.peers.push(this); }
  },
}));
vi.mock("@/lib/native-meeting-audio", () => ({ createNativeMeetingAudioSession: (...args: any[]) => env.nativeFactory(...args) }));

function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeStream() {
  const listeners = new Map<string, () => void>();
  const track = { enabled: true, stop: vi.fn(), addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  return { track, listeners, getTracks: () => [track], getAudioTracks: () => [track], release: vi.fn() };
}
const info = { userId: 1, iceServers: [], recordingAllowed: true, policyVersion: 2, consentAccepted: false };
function response(path: string) {
  if (path.endsWith("/join")) return info;
  if (path.endsWith("/audio-state")) return { presentUserIds: [1, 2], recordingState: "off" };
  if (path.includes("/signals?")) return [];
  return {};
}
function writes(kind: string) { return env.api.mock.calls.filter(([path]) => path.endsWith(`/${kind}`)); }
async function settle() {
  await act(async () => { await vi.dynamicImportSettled(); for (let i = 0; i < 30; i++) await Promise.resolve(); });
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(1200); }); }
async function join() { fireEvent.click(screen.getByRole("button", { name: "Join audio" })); await settle(); }
async function clearOwner() { const release = await askVMicrophone.acquire("test-cleanup", async () => {}); await release(); }
beforeEach(async () => {
  await i18n.changeLanguage("en");
  await clearOwner(); vi.useFakeTimers(); env.peers.length = 0; env.token = "token-a"; env.active = true;
  env.api.mockReset().mockImplementation(async (path) => response(path));
  env.capture.mockReset().mockImplementation(async () => nativeStream());
  env.permission.mockReset().mockResolvedValue(undefined);
  env.nativeFactory.mockReset().mockReturnValue(null);
  env.offer.mockReset().mockResolvedValue({ type: "offer", sdp: "offer" }); env.remote.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  cleanup(); await settle(); vi.restoreAllMocks(); await clearOwner();
  expect(env.tokens.size).toBe(0); expect(env.users.size).toBe(0);
  expect(env.background.size).toBe(0); expect(env.foreground.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
  await i18n.changeLanguage("en");
});

describe("native meeting microphone lifecycle", () => {
  it("renders the meeting audio status and controls in Spanish", async () => {
    await i18n.changeLanguage("es");
    render(<WorkHubAudioRoom occurrenceId="room-a" />);
    expect(screen.getByText("Audio interno · Grabación desactivada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unirse al audio" })).toBeTruthy();
    await i18n.changeLanguage("en");
    vi.clearAllTimers();
  });

  it("shows an iOS native-module failure without opening the legacy microphone", async () => {
    env.nativeFactory.mockImplementation(() => {
      throw Object.assign(new Error("Native meeting audio unavailable"), { code: "NATIVE_MEETING_AUDIO_UNAVAILABLE" });
    });
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    expect(env.capture).not.toHaveBeenCalled();
    expect(screen.getByText(/Native meeting audio is unavailable/i)).toBeTruthy();
  });

  it("uses the meeting-only native session without opening the global WebRTC microphone", async () => {
    const native = { start: vi.fn(async () => undefined), setMuted: vi.fn(async () => undefined), setTranscription: vi.fn(async () => undefined), createOffer: vi.fn(async () => undefined), applySignal: vi.fn(async () => undefined), removePeer: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    env.nativeFactory.mockReturnValue(native);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    expect(env.capture).not.toHaveBeenCalled();
    expect(native.start).toHaveBeenCalledWith({ sourceId: expect.stringContaining("meeting-1-"), iceServers: [] });
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });

  it("forks native PCM only while recording is active, consent is current, and the participant is unmuted", async () => {
    const native = { start: vi.fn(async () => undefined), setMuted: vi.fn(async () => undefined), setTranscription: vi.fn(async () => undefined), createOffer: vi.fn(async () => undefined), applySignal: vi.fn(async () => undefined), removePeer: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    env.nativeFactory.mockReturnValue(native);
    env.api.mockImplementation(async path => path.endsWith("/join") ? { ...info, consentAccepted: true }
      : path.endsWith("/audio-state") ? { presentUserIds: [1], recordingState: "active" }
      : response(path));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    await tick(); expect(native.setTranscription).not.toHaveBeenCalledWith(true, 2);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" })); await settle(); await tick();
    expect(native.setMuted).toHaveBeenCalledWith(false);
    expect(native.setTranscription).toHaveBeenCalledWith(true, 2);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(native.setMuted).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(native.setTranscription).toHaveBeenCalledWith(false, 2));
  });

  it("reconciles a mute that occurs while native transcription enablement is pending", async () => {
    const enabling = deferred<void>();
    const native = {
      start: vi.fn(async () => undefined), setMuted: vi.fn(async () => undefined),
      setTranscription: vi.fn((enabled: boolean) => enabled ? enabling.promise : Promise.resolve()),
      createOffer: vi.fn(async () => undefined), applySignal: vi.fn(async () => undefined),
      removePeer: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    };
    env.nativeFactory.mockReturnValue(native);
    env.api.mockImplementation(async path => path.endsWith("/join") ? { ...info, consentAccepted: true }
      : path.endsWith("/audio-state") ? { presentUserIds: [1], recordingState: "active" }
      : response(path));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Unmute" })); await settle(); await tick();
    await vi.waitFor(() => expect(native.setTranscription).toHaveBeenCalledWith(true, 2));

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    enabling.resolve();
    await settle();

    expect(native.setMuted).toHaveBeenCalledWith(true);
    expect(native.setTranscription).toHaveBeenCalledWith(false, 2);
  });

  it("routes native offers and inbound signals through the authenticated meeting signaling service", async () => {
    let onSignal: ((value: any) => void) | undefined;
    const native = { start: vi.fn(async () => undefined), setMuted: vi.fn(async () => undefined), setTranscription: vi.fn(async () => undefined), createOffer: vi.fn(async () => undefined), applySignal: vi.fn(async () => undefined), removePeer: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    env.nativeFactory.mockImplementation((options: any) => { onSignal = options.onSignal; return native; });
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    expect(native.createOffer).toHaveBeenCalledWith(2);
    onSignal?.({ generation: 1, toUserId: 2, kind: "offer", payload: { type: "offer", sdp: "native" } }); await settle();
    expect(JSON.parse(writes("signal").at(-1)?.[1]?.body)).toEqual({ toUserId: 2, kind: "offer", payload: { type: "offer", sdp: "native" } });
  });
  it("hands off the real coordinator before native capture", async () => {
    const previous = nativeStream(); await askVMicrophone.acquire("askv", async () => { previous.track.stop(); });
    env.capture.mockImplementation(async () => { expect(previous.track.stop).toHaveBeenCalledOnce(); return nativeStream(); });
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
    expect(askVMicrophone.owner).not.toBe("askv");
  });
  it.each(["permission", "join"])("releases ownership after failed %s", async (boundary) => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    if (boundary === "permission") env.permission.mockRejectedValue(new Error("Microphone denied"));
    else env.api.mockRejectedValue(new Error("Join failed"));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    expect(screen.getByRole("button", { name: "Join audio" })).toBeTruthy(); expect(askVMicrophone.owner).toBeNull();
    if (boundary === "permission") expect(env.capture).not.toHaveBeenCalled();
    else expect(local.track.stop).toHaveBeenCalledOnce();
  });
  it("Leave during capture holds the lease until every late track is stopped", async () => {
    const pending = deferred(); const local = nativeStream(); env.capture.mockReturnValue(pending.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    // Startup must itself be cancellable; use the same explicit Leave control.
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    let acquired = false;
    const next = askVMicrophone.acquire("ptt", async () => {}).then(release => { acquired = true; return release; });
    await settle(); expect(acquired).toBe(false);
    pending.resolve(local); await settle(); const release = await next;
    expect(local.track.enabled).toBe(false); expect(local.track.stop).toHaveBeenCalledOnce();
    expect(writes("join")).toHaveLength(0); expect(writes("signal")).toHaveLength(0); await release();
  });
  it("coordinator takeover cancels pending native capture without deadlocking", async () => {
    const pending = deferred(); const local = nativeStream(); env.capture.mockReturnValue(pending.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    let acquired = false;
    const next = askVMicrophone.acquire("ptt", async () => {}).then(release => { acquired = true; return release; });
    await settle(); expect(acquired).toBe(false); pending.resolve(local); await settle();
    const release = await next; expect(local.track.stop).toHaveBeenCalledOnce(); expect(writes("join")).toHaveLength(0); await release();
  });
  it("cancels while waiting for a prior owner without waiting for its own join", async () => {
    const previousStopped = deferred();
    await askVMicrophone.acquire("askv", () => previousStopped.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    let acquired = false;
    const next = askVMicrophone.acquire("ptt", async () => {}).then(release => { acquired = true; return release; });
    previousStopped.resolve(undefined); await settle();
    expect(acquired).toBe(true); expect(env.capture).not.toHaveBeenCalled();
    const release = await next; await release();
  });
  it("does not capture after permission resolves for a cancelled join", async () => {
    const permission = deferred(); env.permission.mockReturnValue(permission.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    const next = await askVMicrophone.acquire("ptt", async () => {});
    permission.resolve(undefined); await settle();
    expect(env.capture).not.toHaveBeenCalled(); expect(askVMicrophone.owner).toBe("ptt"); await next();
  });
  it("cancels the active request and stops every track on occurrence change", async () => {
    const pending = deferred(), first = nativeStream(), second = nativeStream();
    const stream = { getTracks: () => [first.track, second.track], getAudioTracks: () => [first.track, second.track], release: vi.fn() };
    env.capture.mockResolvedValue(stream);
    const view = render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    env.api.mockImplementation(path => path.endsWith("/audio-state") ? pending.promise : Promise.resolve(response(path)));
    await tick(); const request = writes("audio-state")[0][1];
    view.rerender(<WorkHubAudioRoom occurrenceId="room-b" />);
    expect(request.signal.aborted).toBe(true);
    expect(first.track.stop).toHaveBeenCalledOnce(); expect(second.track.stop).toHaveBeenCalledOnce(); expect(stream.release).toHaveBeenCalledOnce();
    pending.resolve({ presentUserIds: [1, 2], recordingState: "active" }); await settle();
    expect(writes("signal")).toHaveLength(0); expect(screen.getByRole("button", { name: "Join audio" })).toBeTruthy();
  });
  it("only captures once for concurrent Join clicks", async () => {
    const pending = deferred(), local = nativeStream(); env.capture.mockReturnValue(pending.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />);
    const button = screen.getByRole("button", { name: "Join audio" });
    act(() => { fireEvent.click(button); fireEvent.click(button); }); await settle();
    pending.resolve(local); await settle(); expect(env.capture).toHaveBeenCalledOnce(); expect(writes("join")).toHaveLength(1);
  });
  it("an old rejected capture cannot clear the next Join's busy state", async () => {
    const first = deferred(), second = deferred(), local = nativeStream();
    env.capture.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    fireEvent.click(screen.getByRole("button", { name: "Leave" })); await join();
    expect(env.capture).toHaveBeenCalledTimes(1);
    first.reject(new Error("Old native capture rejected")); await settle();
    expect(env.capture).toHaveBeenCalledTimes(2); expect(screen.getByRole("button", { name: "Joining…" })).toBeTruthy();
    second.resolve(local); await settle(); expect(local.track.stop).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });
  it("checks again after a transient polling failure without enabling the microphone", async () => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    env.api.mockRejectedValueOnce(new Error("Network unavailable")); await tick();
    expect(local.track.stop).not.toHaveBeenCalled(); expect(local.track.enabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("Network unavailable");
    await tick(); expect(env.peers).toHaveLength(1); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("stops local capture, peers, ownership, polling, and signaling when fresh state omits the joined self", async () => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    let presentUserIds = [1, 2];
    env.api.mockImplementation(async path => path.endsWith("/audio-state")
      ? { presentUserIds, recordingState: "off" }
      : response(path));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    expect(env.peers).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    await settle();
    expect(local.track.enabled).toBe(true);
    const signalsBeforeEnd = writes("signal").length;
    const signalReadsBeforeEnd = env.api.mock.calls.filter(([path]) => String(path).includes("/signals?")).length;
    presentUserIds = [];
    await tick(); await settle();
    expect(local.track.enabled).toBe(false);
    expect(local.track.stop).toHaveBeenCalledOnce();
    expect(env.peers[0].close).toHaveBeenCalledOnce();
    expect(askVMicrophone.owner).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(writes("signal")).toHaveLength(signalsBeforeEnd);
    expect(env.api.mock.calls.filter(([path]) => String(path).includes("/signals?"))).toHaveLength(signalReadsBeforeEnd);
    await tick();
    expect(writes("signal")).toHaveLength(signalsBeforeEnd);
    expect(env.api.mock.calls.filter(([path]) => String(path).includes("/signals?"))).toHaveLength(signalReadsBeforeEnd);
    expect(screen.getByRole("button", { name: "Join audio" })).toBeTruthy();
  });
  it("keeps a valid one-person session joined when fresh state still includes self", async () => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    env.api.mockImplementation(async path => path.endsWith("/audio-state")
      ? { presentUserIds: [1], recordingState: "off" }
      : response(path));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    expect(local.track.stop).not.toHaveBeenCalled();
    expect(env.peers).toHaveLength(0);
    expect(askVMicrophone.owner).toBe("work-hub-audio");
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });
  it("closes only a departed peer while self remains present", async () => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    let presentUserIds = [1, 2];
    env.api.mockImplementation(async path => path.endsWith("/audio-state")
      ? { presentUserIds, recordingState: "off" }
      : response(path));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    presentUserIds = [1];
    await tick(); await settle();
    expect(env.peers[0].close).toHaveBeenCalledOnce();
    expect(local.track.stop).not.toHaveBeenCalled();
    expect(askVMicrophone.owner).toBe("work-hub-audio");
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });
  it("releases every late capture resource after cancellation even when disabling a track throws", async () => {
    const coordinator = new MicrophoneCoordinator();
    vi.spyOn(askVMicrophone, "acquire").mockImplementation((name, stop) => coordinator.acquire(name, stop));
    const pending = deferred(), first = nativeStream(), second = nativeStream();
    const nativeError = new Error("Late native track unavailable");
    Object.defineProperty(first.track, "enabled", { get: () => true, set: value => {
      if (!value) throw nativeError;
    } });
    const stream = { getTracks: () => [first.track, second.track], getAudioTracks: () => [first.track, second.track], release: vi.fn() };
    env.capture.mockReturnValue(pending.promise);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    let acquired = false, settled = false;
    const next = coordinator.acquire("ptt", async () => {}).then(
      () => { acquired = true; settled = true; return null; },
      error => { settled = true; return error; },
    );
    await settle(); expect(settled).toBe(false);
    pending.resolve(stream); await settle();
    expect(await next).toBe(nativeError); expect(acquired).toBe(false);
    expect(first.track.stop).toHaveBeenCalledOnce(); expect(second.track.stop).toHaveBeenCalledOnce();
    expect(second.track.enabled).toBe(false); expect(stream.release).toHaveBeenCalledOnce();
    expect(coordinator.owner).toBe("work-hub-audio");
    expect(writes("join")).toHaveLength(0); expect(writes("signal")).toHaveLength(0);
  });
  it("finishes all owned cleanup and blocks handoff if a native track operation throws", async () => {
    // Isolate an intentionally failed owner using the same real coordinator:
    // a failed release must retain ownership until the app is restarted.
    const coordinator = new MicrophoneCoordinator();
    vi.spyOn(askVMicrophone, "acquire").mockImplementation((name, stop) => coordinator.acquire(name, stop));
    const first = nativeStream(), second = nativeStream(); let throwDisabling = false, enabled = true;
    Object.defineProperty(first.track, "enabled", { get: () => enabled, set: value => {
      if (throwDisabling && !value) throw new Error("Native track unavailable"); enabled = value;
    } });
    const stream = { getTracks: () => [first.track, second.track], getAudioTracks: () => [first.track, second.track], release: vi.fn() };
    env.capture.mockResolvedValue(stream);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    throwDisabling = true;
    let handoffError: unknown;
    await act(async () => { try { await coordinator.acquire("ptt", async () => {}); } catch (error) { handoffError = error; } });
    expect(handoffError).toBeInstanceOf(Error);
    expect(first.track.stop).toHaveBeenCalledOnce(); expect(second.track.stop).toHaveBeenCalledOnce();
    expect(stream.release).toHaveBeenCalledOnce(); expect(env.peers[0].close).toHaveBeenCalledOnce();
    expect(writes("audio-state")[0][1].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(coordinator.owner).not.toBe("ptt");
  });
  it.each(["offer", "remote", "poll"])("ignores late %s after Leave", async boundary => {
    const pending = deferred(); const local = nativeStream(); env.capture.mockResolvedValue(local);
    if (boundary === "offer") env.offer.mockReturnValue(pending.promise);
    if (boundary === "remote") {
      env.remote.mockReturnValue(pending.promise);
      env.api.mockImplementation(async path => path.includes("/signals?") ? [{ sequence: 1, fromUserId: 2, kind: "offer", payload: { type: "offer", sdp: "remote" } }] : response(path));
    }
    if (boundary === "poll") env.api.mockImplementation(path => path.endsWith("/audio-state") ? pending.promise : Promise.resolve(response(path)));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    const before = writes("signal").length; const peerCount = env.peers.length;
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    pending.resolve(boundary === "poll" ? { presentUserIds: [1, 2, 3], recordingState: "active" } : { type: "offer", sdp: "late" }); await settle();
    expect(writes("signal")).toHaveLength(before); expect(env.peers).toHaveLength(peerCount);
    expect(local.track.stop).toHaveBeenCalledOnce(); env.peers.forEach(peer => expect(peer.close).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Join audio" })).toBeTruthy(); expect(screen.queryByText(/Recording active/)).toBeNull();
  });
  it("late A rejection cannot stop B or clear B's joining state", async () => {
    const first = deferred(); const second = deferred(); const a = nativeStream(), b = nativeStream();
    env.capture.mockResolvedValueOnce(a).mockReturnValueOnce(second.promise);
    env.api.mockImplementation(path => path.endsWith("/join") ? first.promise : Promise.resolve(response(path)));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    fireEvent.click(screen.getByRole("button", { name: "Leave" })); await join();
    first.reject(new Error("Old rejection")); await settle();
    expect(screen.getByRole("button", { name: "Joining…" })).toBeTruthy();
    env.api.mockImplementation(async path => response(path)); second.resolve(b); await settle();
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy(); expect(b.track.stop).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 410])("stops native peers and polling on audio-state %s", async status => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    env.api.mockRejectedValue(Object.assign(new Error("Access lost"), { status })); await tick();
    expect(local.track.stop).toHaveBeenCalledOnce(); expect(env.peers[0].close).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Join audio" })).toBeTruthy();
    const count = env.api.mock.calls.length; await tick(); expect(env.api.mock.calls).toHaveLength(count);
  });
  it.each(["presence", "consent", "signal", "signals"])("stops on terminal %s response", async boundary => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    env.api.mockImplementation(async path => {
      if (path.endsWith(`/${boundary}`) || (boundary === "signals" && path.includes("/signals?"))) throw Object.assign(new Error("Access lost"), { status: 403 });
      return response(path);
    });
    if (boundary === "presence") fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    else if (boundary === "consent") fireEvent.click(screen.getByRole("button", { name: "Consent to host recording and transcription" }));
    else await tick();
    await settle(); expect(local.track.enabled).toBe(false); expect(local.track.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Join audio" })).toBeTruthy();
  });
  it.each(["background", "token", "logout", "ended", "failed", "unmount", "occurrence"])("cleans up on %s without automatic restart", async cause => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    const view = render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    act(() => {
      if (cause === "background") { env.active = false; env.background.forEach(fn => fn()); }
      if (cause === "token") { env.token = "token-b"; env.tokens.forEach(fn => fn(env.token)); }
      if (cause === "logout") env.users.forEach(fn => fn(null));
      if (cause === "ended") local.listeners.get("ended")?.();
      if (cause === "failed") { env.peers[0].connectionState = "failed"; env.peers[0].listeners.get("connectionstatechange")?.(); }
    });
    if (cause === "unmount") view.unmount();
    if (cause === "occurrence") view.rerender(<WorkHubAudioRoom occurrenceId="room-b" />);
    await settle(); expect(local.track.stop).toHaveBeenCalledOnce(); expect(env.peers[0].close).toHaveBeenCalledOnce();
    act(() => { env.active = true; env.foreground.forEach(fn => fn()); }); await tick(); expect(env.capture).toHaveBeenCalledOnce();
  });
  it.each(["failure", "leave"])("never enables audio after pending unmute %s", async outcome => {
    const local = nativeStream(), pending = deferred(); env.capture.mockResolvedValue(local);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    env.api.mockImplementation(path => path.endsWith("/presence") ? pending.promise : Promise.resolve(response(path)));
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(local.track.enabled).toBe(false);
    if (outcome === "leave") { fireEvent.click(screen.getByRole("button", { name: "Leave" })); pending.resolve({}); }
    else pending.reject(new Error("Network unavailable"));
    await settle(); expect(local.track.enabled).toBe(false);
  });
  it("mutes synchronously and ignores old ICE callbacks after rejoin", async () => {
    const local = nativeStream(); env.capture.mockResolvedValue(local);
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    fireEvent.click(screen.getByRole("button", { name: "Unmute" })); await settle(); expect(local.track.enabled).toBe(true);
    env.api.mockImplementation(path => path.endsWith("/presence") ? new Promise(() => {}) : Promise.resolve(response(path)));
    fireEvent.click(screen.getByRole("button", { name: "Mute" })); expect(local.track.enabled).toBe(false);
    const oldIce = env.peers[0].listeners.get("icecandidate"); fireEvent.click(screen.getByRole("button", { name: "Leave" })); await join();
    const count = writes("signal").length; oldIce({ candidate: { toJSON: () => ({ candidate: "old" }) } }); await settle();
    expect(writes("signal")).toHaveLength(count);
  });
  it("ignores late consent after leaving and rejoining", async () => {
    const pending = deferred(); render(<WorkHubAudioRoom occurrenceId="room-a" />); await join();
    env.api.mockImplementation(path => path.endsWith("/consent") ? pending.promise : Promise.resolve(response(path)));
    fireEvent.click(screen.getByRole("button", { name: "Consent to host recording and transcription" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" })); await join(); pending.resolve({}); await settle();
    expect(screen.getByRole("button", { name: "Consent to host recording and transcription" })).toBeTruthy();
  });
  it("retains healthy offer, answer, queued ICE and consent behavior", async () => {
    let signals: any[] = [{ sequence: 1, fromUserId: 2, kind: "ice", payload: { candidate: "early" } }];
    env.api.mockImplementation(async path => path.includes("/signals?") ? signals : response(path));
    render(<WorkHubAudioRoom occurrenceId="room-a" />); await join(); await tick();
    expect(JSON.parse(writes("signal")[0][1].body).kind).toBe("offer"); expect(env.peers[0].addIceCandidate).not.toHaveBeenCalled();
    signals = [{ sequence: 2, fromUserId: 2, kind: "offer", payload: { type: "offer", sdp: "remote" } }]; await tick();
    expect(JSON.parse(writes("signal")[1][1].body).kind).toBe("answer"); expect(env.peers[0].addIceCandidate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Consent to host recording and transcription" })); await settle();
    expect(screen.getByRole("button", { name: "Withdraw recording consent" })).toBeTruthy();
  });
});
