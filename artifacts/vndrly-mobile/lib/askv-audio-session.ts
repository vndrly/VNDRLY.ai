import { Audio } from "expo-av";
import { AppState, Platform, type NativeEventSubscription } from "react-native";
import AskVWake from "@/modules/askv-wake/src/AskVWakeModule";

// Audio-mode changes must retain call order when permission or app lifecycle work overlaps.
let audioModeQueue: Promise<void> = Promise.resolve();
let permissionPromptPending = 0;
export async function requestAskVMicrophonePermission(check: () => void = () => {}): Promise<void> {
  check();
  const permission = await Audio.getPermissionsAsync();
  check();
  if (permission.status === "granted") return;
  permissionPromptPending += 1;
  try {
    check();
    const result = await Audio.requestPermissionsAsync();
    check();
    if (result.status !== "granted") throw new Error("askv.microphoneDenied");
  } finally { permissionPromptPending -= 1; }
}
function changeAudioSession(operation: () => Promise<void>): Promise<void> {
  const change = audioModeQueue.then(operation);
  audioModeQueue = change.catch(() => undefined);
  return change;
}

export function configureAskVAudioSession(): Promise<void> {
  return changeAudioSession(async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: 1,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    // WebRTC applies its saved policy when it opens the peer connection. Keep
    // that policy in sync with the active session, including on wake fallback.
    if (Platform.OS === "ios") await AskVWake?.configureConversationAudio?.();
  });
}

export function releaseAskVAudioSession(): Promise<void> {
  return changeAudioSession(async () => {
    try {
      if (Platform.OS === "ios") await AskVWake?.releaseConversationAudio?.();
    } finally {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
    }
  });
}

export function isAskVAppActive(): boolean {
  return AppState.currentState === "active" || AppState.currentState == null;
}

export function subscribeAskVAppState(
  onActive: () => void,
  onBackground: () => void,
): NativeEventSubscription {
  return AppState.addEventListener("change", (status) => {
    if (status === "active") onActive();
    // iOS permission dialogs temporarily make the app inactive before capture exists.
    // A real background/lock still cancels startup even while a dialog is pending.
    else if (!(status === "inactive" && permissionPromptPending > 0)) onBackground();
  });
}
