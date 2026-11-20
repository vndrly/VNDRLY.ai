import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { GateRecognition } from "@workspace/plate-state";
import { PlateOcrFailedError, PlateOcrUnavailableError } from "./plate-ocr";

let child: ChildProcessWithoutNullStreams | undefined;
let ready: Promise<void> | undefined;
const pending = new Map<string, { resolve: (value: GateRecognition) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

/** One preloaded process per API instance; never load models for each photo. */
export function warmFastAlpr(): Promise<void> {
  if (ready) return ready;
  const api = [process.cwd(), resolve(process.cwd(), "artifacts/api-server")].find(dir => existsSync(resolve(dir, "fastalpr/worker.py")));
  if (!api) return Promise.reject(new PlateOcrUnavailableError("FastALPR worker is missing."));
  const python = process.env.FASTALPR_PYTHON || resolve(api, "../../.local/fastalpr-env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const processChild = spawn(python, ["-u", resolve(api, "fastalpr/worker.py")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child = processChild;
  ready = new Promise<void>((resolveReady, rejectReady) => {
    const fail = () => {
      clearTimeout(startup);
      const error = new PlateOcrUnavailableError("FastALPR is unavailable. Enter the plate manually.");
      rejectReady(error);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
      pending.clear();
      if (child === processChild) { child = undefined; ready = undefined; }
    };
    const startup = setTimeout(() => { processChild.kill(); fail(); }, 30_000);
    processChild.once("error", fail);
    processChild.once("exit", fail);
    // Drain diagnostic output, which can contain model download progress.
    processChild.stderr.resume();
    createInterface({ input: processChild.stdout }).on("line", line => {
      let message: { ready?: boolean; id?: string; error?: string; result?: GateRecognition };
      try { message = JSON.parse(line); } catch { return; }
      if (message.ready) { clearTimeout(startup); resolveReady(); return; }
      const item = message.id ? pending.get(message.id) : undefined;
      if (!item) return;
      pending.delete(message.id!); clearTimeout(item.timer);
      if (message.result) item.resolve(message.result);
      else item.reject(new PlateOcrFailedError(message.error));
    });
  });
  return ready;
}

export async function readWithFastAlpr(input: { imageBase64: string; mimeType: string }): Promise<GateRecognition> {
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(input.mimeType) ||
      input.imageBase64.length > 11_184_812 || Buffer.byteLength(input.imageBase64, "base64") < 32)
    throw new PlateOcrFailedError("Use a JPEG, PNG or WebP photo smaller than 8 MB.");
  await warmFastAlpr();
  if (pending.size >= 8) throw new PlateOcrUnavailableError("Plate reader is busy. Enter the plate manually.");
  return new Promise((resolveResult, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new PlateOcrFailedError("Plate reading timed out. Enter the plate manually."));
      child?.kill();
    }, 4_000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    child!.stdin.write(JSON.stringify({ id, imageBase64: input.imageBase64 }) + "\n", error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(new PlateOcrFailedError("Plate reader disconnected.")); }
    });
  });
}

export function stopFastAlpr(): void { child?.kill(); }
