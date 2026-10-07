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
  fleet?: string;
  fleetSiteActivity?: string;
  fleetSupport?: string;
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
  fleetEnabled?: boolean;
  fleetSiteActivityEnabled?: boolean;
  fleetSupportEnabled?: boolean;
  badges: AppNavigationBadges;
  labels: AppNavigationLabels;
  user: StoredUser | null | undefined;
};

export function buildAppNavigation({
  fleetEnabled = false,
  fleetSiteActivityEnabled = false,
  fleetSupportEnabled = false,
  user,
  labels,
  badges,
}: Input): AppNavigationItem[] {
  if (isGatekeeperUser(user)) {
    const gateItems = [
      item("change-over", "/(tabs)/change-over", labels.changeOver ?? "Dashboard", "grid"),
      item("work-hub", "/work-hub", labels.workHub, "briefcase"),
      item("gate", "/(tabs)/gate", labels.gate, "truck"),
      item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
      item("gate-history", "/(tabs)/gate-history", labels.history, "clock"),
      item("shift-notes", "/(tabs)/shift-notes", labels.shiftNotes ?? "Shift Notes", "file-text"),
      item("profile", "/(tabs)/profile", labels.profile, "user"),
    ];
    if (fleetSiteActivityEnabled) gateItems.splice(2, 0, item("fleet-site-activity", "/(tabs)/fleet-site-activity", labels.fleetSiteActivity ?? "Fleet site activity", "activity"));
    if (fleetEnabled) gateItems.splice(2, 0, item("fleet", "/(tabs)/fleet", labels.fleet ?? "Fleet Ops", "truck"));
    return gateItems;
  }

  const result: AppNavigationItem[] = [
    item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
    { ...item("index", "/(tabs)", labels.home, "home"), badge: badges.home },
    item("work-hub", "/work-hub", labels.workHub, "briefcase"),
    {
      ...item("schedule", "/(tabs)/schedule", labels.schedule, "calendar"),
      badge: badges.schedule,
    },
    {
      ...item("flagged", "/(tabs)/flagged", labels.flagged, "flag"),
      badge: badges.flagged,
    },
  ];
  if (fleetSupportEnabled) result.splice(2, 0, item("fleet-support", "/(tabs)/fleet-support", labels.fleetSupport ?? "Fleet support", "shield"));
  if (fleetSiteActivityEnabled) result.splice(2, 0, item("fleet-site-activity", "/(tabs)/fleet-site-activity", labels.fleetSiteActivity ?? "Fleet site activity", "activity"));
  if (fleetEnabled) result.splice(2, 0, item("fleet", "/(tabs)/fleet", labels.fleet ?? "Fleet Ops", "truck"));

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
  const profileActionRoutes = new Set([
    "edit-profile",
    "location-consent",
    "compliance",
    "notifications",
    "notification-preferences",
    "onboarding",
  ]);
  return (
    (root === "(tabs)" && (isGatekeeperTabKey(child) || child === "fleet" || child === "fleet-run" || child === "fleet-site-activity")) ||
    root === "work-hub" ||
    profileActionRoutes.has(root)
  );
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
