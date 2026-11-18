import { router } from "expo-router";

/** Use the actual navigation stack. A direct entry has no screen to pop. */
export function pageBack(fallback: Parameters<typeof router.replace>[0] = "/(tabs)/change-over") {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
