import type { StoredUser } from "@/lib/auth";
import {
  crewMapTabVisible,
  isForemanEmployeeUser,
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
  history: string;
  home: string;
  map: string;
  profile: string;
  scan: string;
  schedule: string;
  voice: string;
  workHub: string;
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
      item("gate", "/(tabs)/gate", labels.gate, "truck"),
      item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
      item("gate-history", "/(tabs)/gate-history", labels.history, "clock"),
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

function item(
  key: string,
  href: string,
  label: string,
  icon: string,
  kind: AppNavigationKind = "standard",
): AppNavigationItem {
  return { key, href, label, icon, kind };
}
