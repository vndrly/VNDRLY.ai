import type { StoredUser } from "@/lib/auth";
import {
  crewMapTabVisible,
  isForemanEmployeeUser,
  isGatekeeperTabKey,
  isGatekeeperUser,
} from "@/lib/mobile-viewer";

export type AppNavigationKind = "standard" | "askv" | "gate-voice";

export type AppNavigationItem = {
  badge?: number;
  href: string;
  icon: string;
  key: string;
  kind: AppNavigationKind;
  label: string;
};

export type AppNavigationLabels = {
  askv: string;
  comms: string;
  crews: string;
  flagged: string;
  gate: string;
  gateMode?: string;
  history: string;
  home: string;
  map: string;
  profile: string;
  scan: string;
  schedule: string;
  voice: string;
  workHub: string;
  changeOver?: string;
  shiftNotes?: string;
};

export type AppNavigationBadges = {
  comms: number;
  flagged: number;
  home: number;
  schedule: number;
};

type Input = {
  badges: AppNavigationBadges;
  labels: AppNavigationLabels;
  user: StoredUser | null | undefined;
};

export function buildAppNavigation({
  user,
  labels,
  badges,
}: Input): AppNavigationItem[] {
  if (isGatekeeperUser(user)) {
    return [
      item("change-over", "/(tabs)/change-over", labels.changeOver ?? "Dashboard", "grid"),
      item("work-hub", "/(tabs)/work-hub", labels.workHub, "briefcase"),
      item("gate", "/(tabs)/gate", labels.gate, "truck"),
      item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
      item("gate-history", "/(tabs)/gate-history", labels.history, "clock"),
      item("shift-notes", "/(tabs)/shift-notes", labels.shiftNotes ?? "Shift Notes", "file-text"),
      item("profile", "/(tabs)/profile", labels.profile, "user"),
    ];
  }

  const result: AppNavigationItem[] = [
    item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
    { ...item("index", "/(tabs)", labels.home, "home"), badge: badges.home },
    item("work-hub", "/(tabs)/work-hub", labels.workHub, "briefcase"),
    {
      ...item("schedule", "/(tabs)/schedule", labels.schedule, "calendar"),
      badge: badges.schedule,
    },
    {
      ...item("flagged", "/(tabs)/flagged", labels.flagged, "flag"),
      badge: badges.flagged,
    },
  ];

  if (
    user?.role === "admin" ||
    (user?.role === "vendor" && ["admin", "office"].includes(user.vendorRole ?? ""))
  ) {
    result.splice(2, 0, item("gate-mode", "/(tabs)/change-over?gateMode=1", labels.gateMode ?? "Gate Mode", "log-in"));
  }

  if (crewMapTabVisible(user)) {
    result.push(item("crew-map", "/(tabs)/crew-map", labels.map, "map-pin"));
  }
  if (isForemanEmployeeUser(user)) {
    result.push(item("crews", "/(tabs)/crews", labels.crews, "users"));
    result.push({
      ...item("comms", "/(tabs)/comms", labels.comms, "radio"),
      badge: badges.comms,
    });
  }
  result.push(item("scan", "/(tabs)/scan", labels.scan, "maximize"));
  result.push(item("profile", "/(tabs)/profile", labels.profile, "user"));
  return result;
}

export function gateLandingRoute(user: StoredUser | null | undefined): string {
  return isGatekeeperUser(user) ? "/(tabs)/change-over" : "/(tabs)";
}

/** Routes exposed by the focused gatekeeper navigation. */
export function isGatekeeperRouteAllowed(
  user: StoredUser | null | undefined,
  segments: readonly string[],
): boolean {
  const [root, child] = segments;
  return (root === "(tabs)" && isGatekeeperTabKey(child)) || root === "work-hub";
}

function item(
  key: string,
  href: string,
  label: string,
  icon: string,
  kind: AppNavigationKind = "standard",
): AppNavigationItem {
  return { key, href, label, icon, kind };
}
