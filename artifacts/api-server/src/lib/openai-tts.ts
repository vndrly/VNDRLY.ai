const TTS_URL = "https://api.openai.com/v1/audio/speech";
const MAX_TTS_CHARS = 3500;

const BUILT_IN_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type BuiltInTtsVoice = (typeof BUILT_IN_VOICES)[number];

export function normalizeBuiltInTtsVoice(value: unknown): BuiltInTtsVoice {
  if (typeof value !== "string") return "cedar";
  return (BUILT_IN_VOICES as readonly string[]).includes(value)
    ? (value as BuiltInTtsVoice)
    : "cedar";
}

export async function synthesizeSpeechBuffer(input: {
  text: string;
  apiKey: string;
  voice?: BuiltInTtsVoice;
  model?: string;
  instructions?: string;
}): Promise<{ audio: Buffer; mimeType: string; model: string; voice: BuiltInTtsVoice }> {
  const text = input.text.trim().slice(0, MAX_TTS_CHARS);
  if (!text) throw new Error("Missing text");

  const model = input.model?.trim() || "gpt-4o-mini-tts";
  const voice = input.voice ?? "cedar";
  const body: Record<string, unknown> = {
    model,
    voice,
    input: text,
    response_format: "mp3",
  };
  if (input.instructions?.trim() && model.startsWith("gpt-4o")) {
    body.instructions = input.instructions.trim();
  }

  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `OpenAI TTS HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      const textBody = await res.text().catch(() => "");
      if (textBody) message = textBody;
    }
    throw new Error(message);
  }

  const arrayBuffer = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "audio/mpeg";
  return { audio: Buffer.from(arrayBuffer), mimeType, model, voice };
}
