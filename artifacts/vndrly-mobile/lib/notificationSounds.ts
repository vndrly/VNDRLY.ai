import { AppState, Platform, type AppStateStatus } from "react-native";

/** Bundled into the iOS/Android binary via the expo-notifications plugin. */
export const PUSH_NOTIFICATION_SOUND = "vndrly_bell_ring.wav";

const BELL_RING_ASSET = require("../assets/sounds/vndrly_bell_ring.wav") as number;
const BELL_TOLL_ASSET = require("../assets/sounds/vndrly_bell_toll.wav") as number;

type AvSound = {
  playAsync(): Promise<void>;
  stopAsync(): Promise<void>;
  unloadAsync(): Promise<void>;
  setOnPlaybackStatusUpdate(
    callback: (status: { isLoaded: boolean; didJustFinish?: boolean; error?: string }) => void,
  ): void;
};

let audioReady: Promise<void> | null = null;
let activeSound: AvSound | null = null;
let tollSessionTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

const TOLL_SESSION_MS = 45_000;

async function ensureAudioMode(): Promise<typeof import("expo-av").Audio> {
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

async function stopActiveSound(): Promise<void> {
  if (!activeSound) return;
  const sound = activeSound;
  activeSound = null;
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

async function playAsset(asset: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Audio = await ensureAudioMode();
    await stopActiveSound();
    const { sound } = await Audio.Sound.createAsync(asset);
    activeSound = sound;
    await sound.playAsync();
    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) resolve();
        if (status.error) resolve();
      });
    });
  } catch (err) {
    console.warn("notificationSounds.playAsset", err);
  } finally {
    if (activeSound) {
      try {
        await activeSound.unloadAsync();
      } catch {
        // ignore
      }
      activeSound = null;
    }
  }
}

/** Single bell ring — used for quick foreground pings if needed. */
export async function playBellRing(): Promise<void> {
  await playAsset(BELL_RING_ASSET);
}

/** Three-strike toll pattern — foreground alert when a push lands in-app. */
export async function playBellToll(): Promise<void> {
  await playAsset(BELL_TOLL_ASSET);
}

export function stopBellTolling(): void {
  if (tollSessionTimer) {
    clearTimeout(tollSessionTimer);
    tollSessionTimer = null;
  }
  void stopActiveSound();
}

/**
 * Foreground push received: play the toll pattern and keep the session
 * alive briefly so back-to-back notifications extend the alert window.
 */
export function handleForegroundNotificationSound(): void {
  if (Platform.OS === "web") return;
  if (AppState.currentState !== "active") return;

  if (tollSessionTimer) clearTimeout(tollSessionTimer);
  tollSessionTimer = setTimeout(() => {
    tollSessionTimer = null;
    void stopActiveSound();
  }, TOLL_SESSION_MS);

  void playBellToll();
}

function onAppStateChange(next: AppStateStatus): void {
  if (next !== "active") stopBellTolling();
}

/** Idempotent — safe to call from root layout on every mount. */
export function ensureNotificationSoundLifecycle(): () => void {
  if (Platform.OS === "web") return () => undefined;
  if (!appStateSub) {
    appStateSub = AppState.addEventListener("change", onAppStateChange);
  }
  return () => {
    stopBellTolling();
    appStateSub?.remove();
    appStateSub = null;
    audioReady = null;
  };
}
