import { afterEach, expect, it, vi } from "vitest";
import { transcribeMeetingRecording } from "./meeting-transcribe";

afterEach(() => vi.unstubAllGlobals());

it("does not upload audio when consent is revoked while audio is being encoded", async () => {
  let complete!: () => void;
  vi.stubGlobal("FileReader", class {
    result = "data:audio/webm;base64,YXVkaW8=";
    onload: (() => void) | null = null;
    readAsDataURL() { complete = () => this.onload?.(); }
  });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "Private speech" }) });
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const pending = transcribeMeetingRecording("meeting", new Blob(["audio"]), controller.signal);
  controller.abort(); complete();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("passes cancellation to the authenticated transcription request", async () => {
  vi.stubGlobal("FileReader", class {
    result = "data:audio/webm;base64,YXVkaW8=";
    onload: (() => void) | null = null;
    readAsDataURL() { this.onload?.(); }
  });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "Ready." }) });
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  await expect(transcribeMeetingRecording("meeting", new Blob(["audio"]), controller.signal)).resolves.toBe("Ready.");
  expect(fetcher).toHaveBeenCalledWith("/api/work-hub/meetings/meeting/transcribe-audio", expect.objectContaining({ signal: controller.signal, credentials: "include" }));
});

it("accepts Safari recording codec parameters without changing the audio format", async () => {
  vi.stubGlobal("FileReader", class {
    result = "data:audio/mp4;base64,YXVkaW8=";
    onload: (() => void) | null = null;
    readAsDataURL() { this.onload?.(); }
  });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "Ready." }) });
  vi.stubGlobal("fetch", fetcher);
  await transcribeMeetingRecording("meeting", new Blob(["audio"], { type: "audio/mp4;codecs=mp4a.40.2" }), new AbortController().signal);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ audioBase64: "YXVkaW8=", mimeType: "audio/mp4" });
});
