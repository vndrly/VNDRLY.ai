export function publicMapConfig(env: Record<string, string | undefined>) {
  const token = [env.VITE_MAPBOX_ACCESS_TOKEN, env.MAPBOX_ACCESS_TOKEN, env.MAPBOX_API_KEY]
    .map((value) => value?.trim())
    .find((value) => value?.startsWith("pk."));
  return { mapboxAccessToken: token ?? "" };
}
