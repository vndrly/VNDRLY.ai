import { workHubRequest } from "./work-hub-client";

/** Meeting speech uses only VNDRLY's native service, never the assistant's external provider. */
export async function transcribeMeetingRecording(occurrenceId: string, audio: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const audioBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? "").split(",")[1];
      if (base64) resolve(base64); else reject(new Error("Microphone audio could not be read."));
    };
    reader.onerror = () => reject(new Error("Microphone audio could not be read."));
    reader.readAsDataURL(audio);
  });
  // Consent can change during FileReader encoding. Do not upload that audio afterward.
  signal.throwIfAborted();
  const result = await workHubRequest<{ text: string }>(`/meetings/${occurrenceId}/transcribe-audio`, {
    method: "POST", signal,
    // Browser codec parameters describe the same container; the server validates
    // the base type and the local decoder inspects the actual encoded bytes.
    body: JSON.stringify({ audioBase64, mimeType: audio.type.split(";")[0].trim().toLowerCase() || "audio/webm" }),
  });
  signal.throwIfAborted();
  return result.text.trim();
}
