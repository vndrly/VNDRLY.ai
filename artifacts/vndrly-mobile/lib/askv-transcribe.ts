import * as FileSystem from "expo-file-system/legacy";

import { apiFetch } from "@/lib/api";

export async function deleteAskVRecording(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function transcribeAskVRecording(uri: string, signal?: AbortSignal): Promise<string> {

  try {
    if (signal?.aborted) throw new Error("assistant.transcription_cancelled");
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    if (signal?.aborted) throw new Error("assistant.transcription_cancelled");
    const data = await apiFetch<{ text?: string }>("/api/assistant/transcribe", {
      method: "POST",
      body: JSON.stringify({ audioBase64: base64 }),
      signal,
    });
    return (data.text ?? "").trim();
  } catch (err) {
    const code =
      err instanceof Error && "code" in err && typeof (err as { code?: string }).code === "string"
        ? (err as { code: string }).code
        : "assistant.transcribe_failed";
    throw new Error(code);
  } finally { await deleteAskVRecording(uri); }
}
