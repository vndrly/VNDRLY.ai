import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ENABLED_KEY = "vndrly.biometrics.enabled";
const EMAIL_KEY = "vndrly.biometrics.email";
const PASSWORD_KEY = "vndrly.biometrics.password";

export type BiometricCapability = {
  available: boolean;
  enrolled: boolean;
  type: "face" | "fingerprint" | "iris" | "generic" | "none";
  label: string;
};

export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (Platform.OS === "web") {
    return { available: false, enrolled: false, type: "none", label: "Biometrics" };
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    let type: BiometricCapability["type"] = "generic";
    let label = "Biometrics";
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      type = "face";
      label = Platform.OS === "ios" ? "Face ID" : "Face Unlock";
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      type = "fingerprint";
      label = Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      type = "iris";
      label = "Iris";
    }
    return { available: hasHardware, enrolled, type, label };
  } catch {
    return { available: false, enrolled: false, type: "none", label: "Biometrics" };
  }
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const v = await SecureStore.getItemAsync(ENABLED_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export async function saveBiometricCredentials(email: string, password: string): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(EMAIL_KEY, email, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(PASSWORD_KEY, password, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(ENABLED_KEY, "1");
}

export async function getBiometricCredentials(): Promise<{ email: string; password: string } | null> {
  if (Platform.OS === "web") return null;
  try {
    const email = await SecureStore.getItemAsync(EMAIL_KEY);
    const password = await SecureStore.getItemAsync(PASSWORD_KEY);
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export async function clearBiometricCredentials(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(ENABLED_KEY);
    await SecureStore.deleteItemAsync(EMAIL_KEY);
    await SecureStore.deleteItemAsync(PASSWORD_KEY);
  } catch {
    // ignore
  }
}

export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    // disableDeviceFallback: true is critical. With the default (false),
    // iOS will fall through from Face/Touch ID to "Enter iPhone passcode
    // for Expo Go" if the biometric scan fails or is unavailable. That
    // prompt is jarring and, when paired with auto-prompt-on-mount in
    // login.tsx, can manifest as an apparent "infinite passcode loop"
    // every time the AuthGate redirects back to /login (e.g., after a
    // 401 wipes the session). We never want to authorize an app login
    // via the OS passcode — only the user's actual biometric should
    // unlock saved credentials.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
      disableDeviceFallback: true,
    });
    return result.success;
  } catch {
    return false;
  }
}
