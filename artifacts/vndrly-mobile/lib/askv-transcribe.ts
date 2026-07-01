import * as FileSystem from "expo-file-system/legacy";

import { apiFetch } from "@/lib/api";

export async function transcribeAskVRecording(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: "base64",
  });

  try {
    const data = await apiFetch<{ text?: string }>("/api/assistant/transcribe", {
      method: "POST",
      body: JSON.stringify({ audioBase64: base64 }),
    });
    return (data.text ?? "").trim();
  } catch (err) {
    const code =
      err instanceof Error && "code" in err && typeof (err as { code?: string }).code === "string"
        ? (err as { code: string }).code
        : "assistant.transcribe_failed";
    throw new Error(code);
  }
}
