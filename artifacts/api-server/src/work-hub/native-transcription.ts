import { execFile } from "node:child_process";
import { lstatSync } from "node:fs";
import { chmod, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const extensions: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
};
let inFlight = 0;
type NativeCode = "unavailable" | "busy" | "invalid" | "failed";
function failure(code: NativeCode) {
  return Object.assign(new Error(code === "unavailable" ? "Native transcription is not configured" : "Native transcription could not process this clip"), { code: `native_transcription_${code}` });
}
function config(env: NodeJS.ProcessEnv) {
  const decoder = env.VNDRLY_FFMPEG_BIN;
  const engine = env.VNDRLY_WHISPER_BIN;
  const model = env.VNDRLY_WHISPER_MODEL;
  if (env.VNDRLY_NATIVE_TRANSCRIBE_ENABLED !== "1" || !decoder || !engine || !model) return null;
  try {
    if (![decoder, engine, model].every(path => isAbsolute(path) && lstatSync(path).isFile())) return null;
    return { decoder, engine, model };
  } catch { return null; }
}

/** Explicitly provisioned local executables only. No remote provider fallback. */
export function nativeTranscriptionAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return config(env) !== null;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error("Native transcription cancelled"), { name: "AbortError" });
}
async function run(binary: string, args: string[], signal: AbortSignal | undefined, timeout: number, decoding = false) {
  checkAbort(signal);
  // Never give decoder/model processes application credentials or a shell.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", OMP_NUM_THREADS: "2" };
  if (process.platform === "win32") env.SystemRoot = process.env.SystemRoot;
  await new Promise<void>((resolve, reject) => {
    execFile(binary, args, { env, signal, timeout, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 65536 }, (error) => {
      if (signal?.aborted || error?.name === "AbortError") {
        reject(Object.assign(new Error("Native transcription cancelled"), { name: "AbortError" }));
      } else if (error) reject(failure(decoding && typeof error.code === "number" && !error.killed ? "invalid" : "failed"));
      else resolve();
    });
  });
  checkAbort(signal);
}

/** Validate the decoder's bounded PCM result; actual silence bypasses inference. */
function hasSpeechSignal(wav: Buffer): boolean {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw failure("invalid");
  let formatValid = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const kind = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw failure("invalid");
    if (kind === "fmt ") {
      formatValid = size >= 16 && wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 &&
        wav.readUInt32LE(start + 4) === 16000 && wav.readUInt16LE(start + 14) === 16;
    }
    if (kind === "data") {
      // Small browser timer jitter is allowed; a 21-second capped decode is rejected.
      if (!formatValid || size === 0 || size % 2 !== 0 || size > 20.5 * 32000) throw failure("invalid");
      let magnitude = 0;
      for (let i = start; i < start + size; i += 2) magnitude += Math.abs(wav.readInt16LE(i));
      return magnitude / (size / 2) >= 50;
    }
    offset = start + size + (size % 2);
  }
  throw failure("invalid");
}

/** Temporary audio is confined to a private per-request directory and removed. */
export async function transcribeNativeAudio(audio: Buffer, mimeType: string, signal?: AbortSignal): Promise<string> {
  const settings = config(process.env);
  if (!settings) throw failure("unavailable");
  const extension = extensions[mimeType.split(";")[0].trim().toLowerCase()];
  if (!extension || audio.length === 0 || audio.length > 4 * 1024 * 1024) throw failure("invalid");
  checkAbort(signal);
  if (inFlight >= 2) throw failure("busy");
  inFlight++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "vndrly-speech-"));
    await chmod(directory, 0o700);
    const input = join(directory, `input.${extension}`);
    const decoded = join(directory, "decoded.wav");
    const output = join(directory, "transcript");
    await writeFile(input, audio, { mode: 0o600, flag: "wx" });
    await run(settings.decoder, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
      "-format_whitelist", "matroska,webm,mov,wav,ogg", "-threads", "1", "-i", input, "-vn", "-t", "21",
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-fs", "700000", "-y", decoded], signal, 10000, true);
    if (!hasSpeechSignal(await readFile(decoded))) return "";
    await run(settings.engine, ["-m", settings.model, "-f", decoded, "-t", "2", "-l", "auto",
      "-np", "-nt", "-otxt", "-of", output], signal, 30000);
    checkAbort(signal);
    const text = (await readFile(`${output}.txt`, "utf8")).trim();
    if (text.length > 20000) throw failure("invalid");
    return text;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || String((error as { code?: string }).code).startsWith("native_transcription_"))) throw error;
    throw failure("failed");
  } finally {
    if (directory) {
      // Exact generated files only. Never recursively remove user data.
      await Promise.all([`input.${extension}`, "decoded.wav", "transcript.txt"].map(name => unlink(join(directory!, name)).catch(() => undefined)));
      await rmdir(directory).catch(() => undefined);
    }
    inFlight--;
  }
}
