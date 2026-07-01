import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api";

type AskVTtsResponse = {
  audioBase64?: string;
  mimeType?: string;
};

type AvAudio = typeof import("expo-av").Audio;
type AvSound = import("expo-av").Audio.Sound;

const OPENAI_TTS_VOICE = "cedar";

let audioReady: Promise<void> | null = null;
let activeOpenAiSound: AvSound | null = null;
let activeOpenAiUri: string | null = null;
let openAiSpeechPending = false;
let speechRunId = 0;

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

async function ensureAudioMode(): Promise<AvAudio> {
  const { Audio } = await import("expo-av");
  if (!audioReady) {
    audioReady = Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  }
  await audioReady;
  return Audio;
}

async function stopOpenAiSpeech(): Promise<void> {
  openAiSpeechPending = false;
  const sound = activeOpenAiSound;
  const uri = activeOpenAiUri;
  activeOpenAiSound = null;
  activeOpenAiUri = null;
  if (sound) {
    try {
      await sound.stopAsync();
    } catch {
      // ignore
    }
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
  }
  if (uri) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // ignore
    }
  }
}

function extensionForMimeType(mimeType: string | undefined): string {
  if (mimeType?.includes("wav")) return "wav";
  if (mimeType?.includes("aac")) return "aac";
  if (mimeType?.includes("opus")) return "opus";
  return "mp3";
}

async function playOpenAiSpeech(
  audioBase64: string,
  mimeType: string | undefined,
  runId: number,
): Promise<void> {
  if (Platform.OS === "web") throw new Error("OpenAI TTS playback is mobile-only");
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error("Missing cache directory");

  const ext = extensionForMimeType(mimeType);
  const uri = `${cacheDir}askv-openai-tts-${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(uri, audioBase64, { encoding: "base64" });
  if (runId !== speechRunId) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }

  const Audio = await ensureAudioMode();
  const { sound } = await Audio.Sound.createAsync({ uri });
  if (runId !== speechRunId) {
    await sound.unloadAsync();
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }

  activeOpenAiSound = sound;
  activeOpenAiUri = uri;
  sound.setOnPlaybackStatusUpdate((status) => {
    if (!status.isLoaded) return;
    if (!status.didJustFinish && !status.error) return;
    if (activeOpenAiSound === sound) {
      activeOpenAiSound = null;
      activeOpenAiUri = null;
    }
    void sound.unloadAsync();
    void FileSystem.deleteAsync(uri, { idempotent: true });
  });
  await sound.playAsync();
}

export function stopAskVSpeech(): void {
  speechRunId += 1;
  void stopOpenAiSpeech();
  void Speech.stop();
}

export async function isAskVSpeaking(): Promise<boolean> {
  if (openAiSpeechPending || activeOpenAiSound) return true;
  return Speech.isSpeakingAsync();
}

export function speakAskV(text: string, language = "en-US"): void {
  const plain = markdownToSpeechText(text);
  if (!plain) return;
  const runId = speechRunId + 1;
  speechRunId = runId;
  void Speech.stop();
  void stopOpenAiSpeech();
  openAiSpeechPending = true;
  void (async () => {
    try {
      const data = await apiFetch<AskVTtsResponse>("/api/assistant/tts", {
        method: "POST",
        body: JSON.stringify({ text: plain, voice: OPENAI_TTS_VOICE }),
      });
      if (runId !== speechRunId) return;
      if (!data.audioBase64) throw new Error("Missing TTS audio");
      openAiSpeechPending = false;
      await playOpenAiSpeech(data.audioBase64, data.mimeType, runId);
    } catch {
      if (runId !== speechRunId) return;
      openAiSpeechPending = false;
      Speech.speak(plain, { language });
    }
  })();
}
