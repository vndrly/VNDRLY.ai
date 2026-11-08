export function workHubBackgroundWorkersEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.WORK_HUB_BACKGROUND_WORKERS_ENABLED !== "0";
}
