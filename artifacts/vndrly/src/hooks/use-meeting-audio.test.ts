import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@/lib/meeting-types";
import { useMeetingAudio } from "./use-meeting-audio";

const boundary = vi.hoisted(() => ({ request: vi.fn(), transcribe: vi.fn(), startStreaming: vi.fn() }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: boundary.request, createWorkHubOperationId: () => "97dc3845-2360-48f7-b8ea-8a5c6611ab92" }));
vi.mock("@/lib/meeting-transcribe", () => ({ transcribeMeetingRecording: boundary.transcribe }));
vi.mock("@/lib/meeting-streaming", async (load) => ({ ...(await load<any>()), startMeetingStreamingCapture: boundary.startStreaming }));

class Recorder extends EventTarget {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly stream: MediaStream) { super(); Recorder.instances.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["own microphone audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}
let track: MediaStreamTrack;
let input: MediaStream;
function snapshot(): MeetingSnapshot {
  return {
    userId: 4, canManage: false, canViewAttendance: false, transcription: true, myConsent: "accepted", nativeCaptureAvailable: true, streamingCaptureAvailable: false,
    meeting: { title: "Operations", agenda: null, policyVersion: 1 },
    occurrence: { id: "meeting", status: "live", startsAt: "2026-09-09T14:00:00Z", endsAt: null, startedAt: "2026-09-09T14:00:00Z", endedAt: null, askvInvitedAt: "2026-09-09T14:00:00Z" },
    participants: [{ userId: 4, displayName: "Bob", role: "participant", muted: false, present: true, speaking: false, removedAt: null }],
    chat: [], activity: [], transcript: [], attendance: [], recap: null,
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T14:05:00Z"));
  Recorder.instances = [];
  track = Object.assign(new EventTarget(), { enabled: true, readyState: "live", stop: vi.fn() }) as unknown as MediaStreamTrack;
  input = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", class {
    createAnalyser() { return { fftSize: 256, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128) }; }
    createMediaStreamSource() { return { connect() {} }; }
    async close() {} async resume() {}
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => input } });
  boundary.request.mockReset().mockImplementation(async (path: string) => path.endsWith("/join") ? { userId: 4, startedAt: "2026-09-09T14:05:00Z", iceServers: [] } : path.includes("/signals?") ? { sequence: 0, signals: [] } : {});
  boundary.transcribe.mockReset().mockResolvedValue("Check the north gate.");
  boundary.startStreaming.mockReset().mockResolvedValue({ stop: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function connect(result: { current: ReturnType<typeof useMeetingAudio> }) {
  await act(async () => { await result.current.join(); });
  await act(async () => { await result.current.toggleMute(); });
}

describe("consented meeting microphone transcription", () => {
  it("selects authenticated streaming capture on the same microphone without opening native recording", async () => {
    const data = snapshot(); data.streamingCaptureAvailable = true;
    const { result } = renderHook(() => useMeetingAudio("meeting", data));
    await connect(result);
    await vi.waitFor(() => expect(boundary.startStreaming).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "meeting", input, startedAtMs: 300_000, signal: expect.any(AbortSignal) })));
    expect(Recorder.instances).toHaveLength(0); expect(boundary.transcribe).not.toHaveBeenCalled();
  });
  it("does not fall back to native clip capture when the selected streaming capability is unavailable", async () => {
    const data = snapshot(); data.nativeCaptureAvailable = false; data.streamingCaptureAvailable = false;
    const { result } = renderHook(() => useMeetingAudio("meeting", data));
    await connect(result);
    expect(boundary.startStreaming).not.toHaveBeenCalled();
    expect(Recorder.instances).toHaveLength(0);
    expect(boundary.transcribe).not.toHaveBeenCalled();
  });
  it("starts only after joining and unmuting, and captures this attendee's stream", async () => {
    const { result } = renderHook(() => useMeetingAudio("meeting", snapshot()));
    expect(Recorder.instances).toHaveLength(0);
    await act(async () => { await result.current.join(); });
    expect(Recorder.instances).toHaveLength(0);
    await act(async () => { await result.current.toggleMute(); });
    expect(Recorder.instances).toHaveLength(1);
    expect(Recorder.instances[0].stream).toBe(input);
    expect(result.current.transcriptionActive).toBe(true);
  });
  it.each([
    ["server authorization", (data: MeetingSnapshot) => { data.transcription = false; }],
    ["native transcription service", (data: MeetingSnapshot) => { data.nativeCaptureAvailable = false; }],
    ["personal consent", (data: MeetingSnapshot) => { data.myConsent = "declined"; }],
    ["host invitation", (data: MeetingSnapshot) => { data.occurrence.askvInvitedAt = null; }],
    ["meeting end", (data: MeetingSnapshot) => { data.occurrence.status = "ended"; }],
    ["removal", (data: MeetingSnapshot) => { data.participants[0].removedAt = "2026-09-09T14:05:00Z"; }],
    ["presence", (data: MeetingSnapshot) => { data.participants[0].present = false; }],
    ["canonical start", (data: MeetingSnapshot) => { data.occurrence.startedAt = null; }],
  ] as const)("never captures without %s and stops immediately if it changes", async (_name, disallow) => {
    const denied = snapshot(); disallow(denied);
    const blocked = renderHook(() => useMeetingAudio("meeting", denied));
    await connect(blocked.result);
    expect(Recorder.instances).toHaveLength(0);
    blocked.unmount();
    const { result, rerender } = renderHook(({ data }) => useMeetingAudio("meeting", data), { initialProps: { data: snapshot() } });
    await connect(result);
    expect(Recorder.instances[0].state).toBe("recording");
    rerender({ data: denied });
    expect(Recorder.instances[0].state).toBe("inactive");
    expect(result.current.transcriptionActive).toBe(false);
    expect(boundary.transcribe).not.toHaveBeenCalled();
  });
  it.each(["mute", "leave", "stop", "unmount"])("discards unfinished audio on %s", async (reason) => {
    const { result, unmount } = renderHook(() => useMeetingAudio("meeting", snapshot()));
    await connect(result);
    const recording = Recorder.instances[0];
    if (reason === "unmount") unmount();
    else await act(async () => { if (reason === "mute") await result.current.toggleMute(); else if (reason === "leave") await result.current.leave(); else result.current.stopTranscription(); });
    expect(recording.state).toBe("inactive");
    expect(boundary.transcribe).not.toHaveBeenCalled();
  });
  it("saves meeting-relative offsets and lets the server attribute this signed-in speaker", async () => {
    const { result } = renderHook(() => useMeetingAudio("meeting", snapshot()));
    await connect(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(boundary.transcribe).toHaveBeenCalledWith("meeting", expect.any(Blob), expect.any(AbortSignal));
    expect(boundary.request).toHaveBeenCalledWith("/meetings/meeting/transcript", expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "97dc3845-2360-48f7-b8ea-8a5c6611ab92", text: "Check the north gate.", startsAtMs: 300_000, endsAtMs: 315_000 }) }));
    expect(boundary.request.mock.calls.some(([path]) => path.endsWith("/audio-chunks"))).toBe(false);
  });
  it("aborts a delayed transcription and never submits its text after consent is withdrawn", async () => {
    let finish!: (text: string) => void;
    boundary.transcribe.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ data }) => useMeetingAudio("meeting", data), { initialProps: { data: snapshot() } });
    await connect(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    const signal = boundary.transcribe.mock.calls[0][2] as AbortSignal;
    const revoked = snapshot(); revoked.myConsent = "declined";
    rerender({ data: revoked });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish("Must not save"); });
    expect(boundary.request.mock.calls.some(([path]) => path.endsWith("/transcript"))).toBe(false);
  });
  it("reports unavailable transcription truthfully and stops capturing", async () => {
    boundary.transcribe.mockRejectedValue(new Error("Meeting transcription is not configured."));
    const { result } = renderHook(() => useMeetingAudio("meeting", snapshot()));
    await connect(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(result.current.transcriptionActive).toBe(false);
    expect(result.current.transcriptionError).toMatch(/not configured/i);
    expect(Recorder.instances.every((recorder) => recorder.state === "inactive")).toBe(true);
  });
});
