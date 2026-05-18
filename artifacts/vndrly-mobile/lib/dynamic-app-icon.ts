import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

import type { BrandIconName } from "@/lib/brand-icon-map";

let nativeModule: { setAppIcon: (name: string) => string | false } | null =
  null;
let nativeModuleResolved = false;

function getNativeModule() {
  if (nativeModuleResolved) return nativeModule;
  nativeModuleResolved = true;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  // expo-dynamic-app-icon is a third-party native module that is NOT
  // bundled into Expo Go. In Expo Go (`executionEnvironment === 'storeClient'`)
  // requireNativeModule throws synchronously from inside the package's
  // module-initialization code, which bypasses the try/catch around
  // `require()` (the throw happens in a deeper stack frame during the
  // module's own evaluation, not at the require call site itself). The
  // result is a fatal red-screen on iOS right after login. Short-circuit
  // here so Expo Go never even reaches the require.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return null;
  }
  try {
    nativeModule = require("expo-dynamic-app-icon");
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export function applyAppIcon(name: BrandIconName): boolean {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    const target = name === "vndrly" ? "DEFAULT" : name;
    const result = mod.setAppIcon(target);
    return result !== false;
  } catch {
    return false;
  }
}
