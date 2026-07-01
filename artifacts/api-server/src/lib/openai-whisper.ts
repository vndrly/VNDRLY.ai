const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Strip markdown so TTS reads naturally (shared shape with mobile AskV). */
export function markdownToSpeechText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribeAudioBuffer(
  audio: Buffer,
  filename: string,
  apiKey: string,
): Promise<string> {
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error("Audio too large");
  }
  if (audio.length < 64) {
    throw new Error("Audio too short");
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mp4" }), filename);
  form.append("model", "whisper-1");
  form.append("language", "en");

  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const payload = (await res.json()) as { text?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(payload.error?.message ?? `Whisper HTTP ${res.status}`);
  }

  return (payload.text ?? "").trim();
}
