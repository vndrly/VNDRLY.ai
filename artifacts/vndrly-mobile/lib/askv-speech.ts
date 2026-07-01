import * as Speech from "expo-speech";

/** Strip markdown so device TTS reads naturally. */
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

export function stopAskVSpeech(): void {
  void Speech.stop();
}

export async function isAskVSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

export function speakAskV(text: string, language = "en-US"): void {
  const plain = markdownToSpeechText(text);
  if (!plain) return;
  stopAskVSpeech();
  Speech.speak(plain, { language });
}
