import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const processMock = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: processMock.execFile }));
import { nativeTranscriptionAvailable, transcribeNativeAudio } from "./native-transcription";

function wav(seconds = 0.02, amplitude = 1000) {
  const data = Buffer.alloc(44 + Math.floor(seconds * 16000) * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  for (let i = 44; i < data.length; i += 2) data.writeInt16LE(amplitude, i);
  return data;
}

describe("VNDRLY-owned native speech boundary", () => {
  let dir: string;
  let audioOutput: Buffer;
  let inferenceOutput: string;
  let inputPath: string;
  let hold: (() => void) | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vndrly-native-test-"));
    for (const file of ["decoder", "engine", "model.bin"]) await writeFile(join(dir, file), "fixture");
    vi.stubEnv("VNDRLY_NATIVE_TRANSCRIBE_ENABLED", "1");
    vi.stubEnv("VNDRLY_FFMPEG_BIN", join(dir, "decoder"));
    vi.stubEnv("VNDRLY_WHISPER_BIN", join(dir, "engine"));
    vi.stubEnv("VNDRLY_WHISPER_MODEL", join(dir, "model.bin"));
    vi.stubEnv("OPENAI_API_KEY", "must-not-reach-child");
    audioOutput = wav(); inferenceOutput = " The crew arrived at eleven. "; inputPath = ""; hold = undefined;
    processMock.execFile.mockReset();
    processMock.execFile.mockImplementation((bin, args, options, callback) => {
      const run = async () => {
        if (bin === join(dir, "decoder")) {
          inputPath = args[args.indexOf("-i") + 1];
          await writeFile(args.at(-1), audioOutput);
        } else await writeFile(args[args.indexOf("-of") + 1] + ".txt", inferenceOutput);
        callback(null, "", "");
      };
      if (hold) hold = () => { void run(); }; else void run();
      options.signal?.addEventListener("abort", () => callback(Object.assign(new Error("aborted"), { name: "AbortError" }), "", ""), { once: true });
      return { kill: vi.fn() };
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    // Test-owned, freshly created directory only; never a user audio directory.
    await rm(dir, { recursive: true, force: true });
  });

  it("requires explicit enablement and all three local regular files", () => {
    expect(nativeTranscriptionAvailable()).toBe(true);
    expect(nativeTranscriptionAvailable({})).toBe(false);
    vi.stubEnv("VNDRLY_WHISPER_MODEL", dir);
    expect(nativeTranscriptionAvailable()).toBe(false);
  });
  it("fails closed instead of using a remote provider when disabled", async () => {
    vi.stubEnv("VNDRLY_NATIVE_TRANSCRIBE_ENABLED", "0");
    await expect(transcribeNativeAudio(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ code: "native_transcription_unavailable" });
    expect(processMock.execFile).not.toHaveBeenCalled();
  });
  it("returns locally decoded text and removes the request's temporary audio", async () => {
    expect(await transcribeNativeAudio(Buffer.from("audio"), "audio/webm;codecs=opus")).toBe("The crew arrived at eleven.");
    const calls = processMock.execFile.mock.calls;
    expect(calls[0][0]).toBe(join(dir, "decoder"));
    expect(calls[0][1]).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,pipe", "-ac", "1", "-ar", "16000"]));
    expect(calls[1][0]).toBe(join(dir, "engine"));
    expect(calls[1][1]).toEqual(expect.arrayContaining(["-m", join(dir, "model.bin"), "-t", "2", "-l", "auto"]));
    expect(calls[0][2].env.OPENAI_API_KEY).toBeUndefined();
    expect(calls[1][2].env.DATABASE_URL).toBeUndefined();
    expect(calls[0][2].shell).not.toBe(true);
    await expect(readFile(inputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["text/plain", "audio/x-mpegurl"])("rejects unsupported input %s before executing", async (mime) => {
    await expect(transcribeNativeAudio(Buffer.from("audio"), mime)).rejects.toMatchObject({ code: "native_transcription_invalid" });
    expect(processMock.execFile).not.toHaveBeenCalled();
  });
  it("rejects oversized and empty audio", async () => {
    for (const audio of [Buffer.alloc(0), Buffer.alloc(4 * 1024 * 1024 + 1)]) {
      await expect(transcribeNativeAudio(audio, "audio/wav")).rejects.toMatchObject({ code: "native_transcription_invalid" });
    }
    expect(processMock.execFile).not.toHaveBeenCalled();
  });
  it("rejects excessive decoded duration rather than silently truncating it", async () => {
    audioOutput = wav(21);
    await expect(transcribeNativeAudio(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ code: "native_transcription_invalid" });
    expect(processMock.execFile).toHaveBeenCalledTimes(1);
  });
  it("returns no text for silence without hallucinating through inference", async () => {
    audioOutput = wav(0.02, 0);
    expect(await transcribeNativeAudio(Buffer.from("audio"), "audio/webm")).toBe("");
    expect(processMock.execFile).toHaveBeenCalledTimes(1);
  });
  it("treats a valid no-speech engine result as silence", async () => {
    inferenceOutput = " \n ";
    expect(await transcribeNativeAudio(Buffer.from("audio"), "audio/webm")).toBe("");
  });
  it("suppresses cancelled work and cleans up its audio", async () => {
    hold = () => undefined;
    const controller = new AbortController();
    const request = transcribeNativeAudio(Buffer.from("audio"), "audio/webm", controller.signal).catch(error => error);
    await vi.waitFor(() => expect(processMock.execFile).toHaveBeenCalledTimes(1));
    const file = processMock.execFile.mock.calls[0][1];
    controller.abort();
    expect(await request).toMatchObject({ name: "AbortError" });
    await expect(readFile(file[file.indexOf("-i") + 1])).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("caps concurrent speech processing instead of building an unbounded queue", async () => {
    hold = () => undefined;
    const controllers = [new AbortController(), new AbortController()];
    const pending = controllers.map(c => transcribeNativeAudio(Buffer.from("audio"), "audio/webm", c.signal).catch(e => e.name));
    await vi.waitFor(() => expect(processMock.execFile).toHaveBeenCalledTimes(2));
    await expect(transcribeNativeAudio(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ code: "native_transcription_busy" });
    controllers.forEach(c => c.abort());
    expect(await Promise.all(pending)).toEqual(["AbortError", "AbortError"]);
  });
  it("does not expose process output or secrets on inference failure", async () => {
    processMock.execFile.mockImplementation((_b, _a, _o, cb) => cb(new Error("private speech or secret"), "private words", "secret"));
    await expect(transcribeNativeAudio(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ code: "native_transcription_failed", message: "Native transcription could not process this clip" });
  });
  it("identifies malformed audio separately from unavailable infrastructure", async () => {
    processMock.execFile.mockImplementation((_b, _a, _o, cb) => cb(Object.assign(new Error("invalid encoded data"), { code: 1 }), "", ""));
    await expect(transcribeNativeAudio(Buffer.from("garbage"), "audio/mp4")).rejects.toMatchObject({ code: "native_transcription_invalid" });
  });
});
