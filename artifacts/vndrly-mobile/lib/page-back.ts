import { router } from "expo-router";

/** Use the actual navigation stack. A direct entry has no screen to pop. */
export function pageBack() {
  if (router.canGoBack()) router.back();
}
