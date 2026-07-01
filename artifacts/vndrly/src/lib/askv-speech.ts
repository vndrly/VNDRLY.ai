type AskVTtsResponse = {
  audioBase64?: string;
  mimeType?: string;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const OPENAI_TTS_VOICE = "cedar";

let speechRunId = 0;
let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let openAiSpeechPending = false;

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

function clearActiveAudio(): void {
  const audio = activeAudio;
  const objectUrl = activeObjectUrl;
  activeAudio = null;
  activeObjectUrl = null;
  openAiSpeechPending = false;

  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

function blobFromBase64(base64: string, mimeType: string | undefined): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
}

async function playOpenAiSpeech(
  audioBase64: string,
  mimeType: string | undefined,
  runId: number,
): Promise<void> {
  const blob = blobFromBase64(audioBase64, mimeType);
  const objectUrl = URL.createObjectURL(blob);
  if (runId !== speechRunId) {
    URL.revokeObjectURL(objectUrl);
    return;
  }

  const audio = new Audio(objectUrl);
  activeAudio = audio;
  activeObjectUrl = objectUrl;
  audio.onended = clearActiveAudio;
  audio.onerror = clearActiveAudio;
  await audio.play();
}

export function stopAskVSpeech(): void {
  speechRunId += 1;
  clearActiveAudio();
  window.speechSynthesis?.cancel();
}

export function isAskVSpeaking(): boolean {
  return openAiSpeechPending || activeAudio !== null || Boolean(window.speechSynthesis?.speaking);
}

export function speakAskV(text: string, language = "en-US"): void {
  const plain = markdownToSpeechText(text);
  if (!plain) return;

  const runId = speechRunId + 1;
  speechRunId = runId;
  clearActiveAudio();
  window.speechSynthesis?.cancel();
  openAiSpeechPending = true;

  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/assistant/tts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: plain, voice: OPENAI_TTS_VOICE }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AskVTtsResponse;
      if (runId !== speechRunId) return;
      if (!data.audioBase64) throw new Error("Missing TTS audio");
      openAiSpeechPending = false;
      await playOpenAiSpeech(data.audioBase64, data.mimeType, runId);
    } catch {
      if (runId !== speechRunId) return;
      openAiSpeechPending = false;
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.lang = language;
      window.speechSynthesis?.speak(utterance);
    }
  })();
}
