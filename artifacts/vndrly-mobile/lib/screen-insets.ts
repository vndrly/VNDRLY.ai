import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Breathing room below the iOS status bar / notch (matches home landing page). */
export const SCREEN_TOP_GAP = 8;

/** Top content padding: safe-area inset plus gap on iOS; plain inset elsewhere. */
export function screenTopPadding(insetTop: number): number {
  return Platform.OS === "ios" ? insetTop + SCREEN_TOP_GAP : insetTop;
}

export function useScreenTopPadding(): number {
  const insets = useSafeAreaInsets();
  return screenTopPadding(insets.top);
}
