import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MeetingAudioRoom from "./meeting-audio-room";

const calls = vi.hoisted(() => ({ paths: [] as string[], active: false, spanish: false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: any) => ({
  "meetingWorkspace.webAudio.region": calls.spanish ? "Controles de audio de la reunión" : "Meeting audio controls",
  "meetingWorkspace.webAudio.description": calls.spanish ? "Audio interno de VNDRLY · solo participantes invitados" : "VNDRLY internal audio · invited participants only",
  "meetingWorkspace.webAudio.off": calls.spanish ? "La grabación y la transcripción están desactivadas." : "Recording and transcription are off.",
  "meetingWorkspace.webAudio.join": calls.spanish ? "Unirse al audio" : "Join audio",
}[key] ?? values?.defaultValue ?? key) }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: (props: any) => <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button> }));
vi.mock("@/lib/askv-transcribe", () => ({ transcribeAskVRecording: async () => "" }));
vi.mock("@/lib/work-hub-client", () => ({ createWorkHubOperationId: () => "00000000-0000-4000-8000-000000000001", workHubRequest: async (path: string, options?: any) => {
  calls.paths.push(path);
  if (path.endsWith("/join")) return { userId: 7, participants: [{ userId: 7, role: "host" }], iceServers: [], recordingAllowed: true, policyVersion: 1 };
  if (path.endsWith("/audio-state")) return { recordingState: calls.active ? "active" : "off", presentUserIds: [7] };
  if (path.endsWith("/recording")) { calls.active = JSON.parse(options.body).enabled; calls.paths.push(`recording:${calls.active}`); }
  if (path.includes("signals?")) return [];
  return {};
} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); calls.paths = []; calls.active = false; calls.spanish = false; });

it("renders actual Spanish audio-room status and controls", () => {
  calls.spanish = true;
  render(<MeetingAudioRoom occurrenceId="room" />);
  expect(screen.getByRole("region", { name: "Controles de audio de la reunión" })).toBeTruthy();
  expect(screen.getByText("La grabación y la transcripción están desactivadas.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Unirse al audio" })).toBeTruthy();
});

it("saves the final short recording before turning capture off", async () => {
  const track = { enabled: false, stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
  vi.stubGlobal("RTCPeerConnection", class {});
  vi.stubGlobal("AudioContext", class { createMediaStreamDestination() { return { stream }; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } });
  vi.stubGlobal("MediaRecorder", class extends EventTarget {
    static isTypeSupported() { return true; }
    state = "inactive"; ondataavailable: any; onstop: any;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["short-audio"], { type: "audio/webm" }) }); this.onstop?.(); this.dispatchEvent(new Event("stop")); }
  });
  const interval = vi.spyOn(window, "setInterval");
  render(<MeetingAudioRoom occurrenceId="room" />);
  fireEvent.click(screen.getByText("Join audio"));
  await screen.findByText("Consent to recording");
  fireEvent.click(screen.getByText("Consent to recording"));
  await screen.findByText("Withdraw recording consent");
  fireEvent.click(screen.getByText("Start recording"));
  await screen.findByText("Stop recording");
  const poll = interval.mock.calls.filter(call => call[1] === 1200).at(-1)![0] as () => Promise<void>;
  await act(async () => { await poll(); });
  expect(screen.queryByRole("alert")?.textContent).toBeUndefined();
  fireEvent.click(screen.getByText("Stop recording"));
  await waitFor(() => expect(calls.paths).toContain("recording:false"));
  expect(screen.queryByRole("alert")?.textContent).toBeUndefined();
  const upload = calls.paths.indexOf("/meetings/room/audio-chunks");
  expect(upload).toBeGreaterThan(-1);
  expect(upload).toBeLessThan(calls.paths.indexOf("recording:false"));
});
