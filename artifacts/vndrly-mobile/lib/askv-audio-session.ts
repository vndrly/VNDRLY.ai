import { Audio } from "expo-av";
import { AppState, type NativeEventSubscription } from "react-native";

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
function setMode(mode: Parameters<typeof Audio.setAudioModeAsync>[0]): Promise<void> {
  const change = audioModeQueue.then(() => Audio.setAudioModeAsync(mode));
  audioModeQueue = change.catch(() => undefined);
  return change;
}

export function configureAskVAudioSession(): Promise<void> {
  return setMode({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: 1,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export function releaseAskVAudioSession(): Promise<void> {
  return setMode({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
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
