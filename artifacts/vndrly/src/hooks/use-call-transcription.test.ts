import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCallTranscription } from "./use-call-transcription";
import { startPcmStreamingCapture } from "@/lib/meeting-streaming";

const mocks = vi.hoisted(() => ({ request: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/meeting-streaming", () => ({ startPcmStreamingCapture: mocks.capture }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));

const auth = { deviceId: "device", connectionId: "connection", token: "lease", generation: 1 };
const stream = { current: {} as MediaStream };
const policy = { enabled: true, policyVersion: 1 };
const base = "/calls/call-1/transcription-stream";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (path: string) => (
    path === base ? { sessionId: "capture-1", frameDurationMs: 500 } : {}
  ));
});

it("streams only authorized microphone frames and closes capture when muted", async () => {
  let signal: AbortSignal | undefined;
  let transport: Parameters<typeof startPcmStreamingCapture>[1] | undefined;
  mocks.capture.mockImplementation(async (options, value) => {
    signal = options.signal;
    transport = value;
    await value.open(signal);
    return { stop: value.close };
  });
  const { rerender } = renderHook(
    ({ enabled, unmuted }) => useCallTranscription("call-1", { ...policy, enabled }, unmuted, stream, () => auth),
    { initialProps: { enabled: false, unmuted: true } },
  );
  expect(mocks.capture).not.toHaveBeenCalled();
  rerender({ enabled: true, unmuted: true });
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(base, {
    method: "POST", body: JSON.stringify(auth),
  }));
  const frame = new Uint8Array(16_000).fill(42);
  await act(async () => transport!.send(0, frame, signal!));
  expect(mocks.request).toHaveBeenCalledWith(`${base}/capture-1/frame`, expect.objectContaining({
    body: JSON.stringify({ ...auth, sequence: 0, pcmBase64: btoa(String.fromCharCode(...frame)) }),
  }));
  rerender({ enabled: true, unmuted: false });
  expect(signal?.aborted).toBe(true);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(`${base}/capture-1/close`, expect.objectContaining({
    body: JSON.stringify({ deviceId: auth.deviceId, reason: "pause" }),
  })));
  expect(mocks.capture).toHaveBeenCalledOnce();
});
