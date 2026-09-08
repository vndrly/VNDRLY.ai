export function workHubModuleRoute(label: string) { return `/work-hub/${label.toLowerCase().replace(/\s*&\s*/g, "-").replace(/\s+/g, "-")}`; }
export function workHubExitRoute() { return "/(tabs)" as const; }
