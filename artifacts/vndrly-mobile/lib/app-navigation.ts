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
  fleetLog?: string;
  fleetMap?: string;
  fleetLocations?: string;
  fleetCompliance?: string;
  fleetSiteActivity?: string;
  fleetSupport?: string;
  askv: string;
  comms: string;
  crews: string;
  flagged: string;
  gate: string;
  gateMode?: string;
  gateLog?: string;
  gateMap?: string;
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
  companyOperationsCategories?: readonly ("field" | "fleet" | "gate")[] | null;
  fleetEnabled?: boolean;
  fleetSiteActivityEnabled?: boolean;
  fleetSupportEnabled?: boolean;
  badges: AppNavigationBadges;
  labels: AppNavigationLabels;
  user: StoredUser | null | undefined;
};

export function buildAppNavigation({
  companyOperationsCategories,
  fleetEnabled = false,
  fleetSiteActivityEnabled = false,
  fleetSupportEnabled = false,
  user,
  labels,
  badges,
}: Input): AppNavigationItem[] {
  if (companyOperationsCategories) {
    if (!companyOperationsCategories.length)
      return [
        item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
        item("work-hub", "/work-hub", labels.workHub, "briefcase"),
        item("profile", "/(tabs)/profile", labels.profile, "user"),
      ];
    const entries = buildAppNavigation({
      user,
      labels,
      badges,
      fleetEnabled:
        companyOperationsCategories.includes("fleet") && fleetEnabled,
      fleetSiteActivityEnabled: false,
      fleetSupportEnabled: false,
    });
    const fieldKeys = new Set([
      "index",
      "schedule",
      "flagged",
      "crew-map",
      "crews",
      "comms",
      "scan",
    ]);
    const gateKeys = new Set([
      "gate-mode",
      "change-over",
      "gate",
      "gate-history",
      "shift-notes",
    ]);
    const filtered = entries.filter(
      (entry) =>
        (!fieldKeys.has(entry.key) ||
          companyOperationsCategories.includes("field")) &&
        (!gateKeys.has(entry.key) ||
          companyOperationsCategories.includes("gate")),
    );
    if (
      companyOperationsCategories.includes("gate") &&
      !filtered.some((entry) => gateKeys.has(entry.key))
    )
      filtered.splice(
        1,
        0,
        item(
          "gate-mode",
          "/(tabs)/change-over?gateMode=1",
          labels.gateMode ?? "Gate Ops",
          "log-in",
        ),
      );
    const navigation = filtered.map((entry) =>
      entry.key === "gate-mode"
        ? {
            ...entry,
            key: "change-over",
            label: labels.changeOver ?? "Dashboard",
            href: "/(tabs)/change-over",
          }
        : entry.key === "gate-history"
          ? { ...entry, label: labels.gateLog ?? "Gate Log" }
          : entry,
    );
    if (
      companyOperationsCategories.includes("gate") &&
      !navigation.some((entry) => entry.key === "gate")
    ) {
      const position =
        navigation.findIndex((entry) => entry.key === "change-over") + 1;
      navigation.splice(
        position,
        0,
        item("gate", "/(tabs)/gate", labels.gate, "truck"),
        item(
          "gate-history",
          "/(tabs)/gate-history",
          labels.gateLog ?? "Gate Log",
          "clock",
        ),
      );
    }
    if (companyOperationsCategories.includes("gate")) {
      const gateIndex = navigation.findIndex(
        (entry) => entry.key === "gate-history",
      );
      navigation.splice(
        gateIndex >= 0 ? gateIndex + 1 : 1,
        0,
        item(
          "gate-map",
          "/(tabs)/gate-map",
          labels.gateMap ?? "Gate Map",
          "map-pin",
        ),
      );
    }
    return navigation;
  }
  if (isGatekeeperUser(user)) {
    const gateItems = [
      item(
        "change-over",
        "/(tabs)/change-over",
        labels.changeOver ?? "Dashboard",
        "grid",
      ),
      item("work-hub", "/work-hub", labels.workHub, "briefcase"),
      item("gate", "/(tabs)/gate", labels.gate, "truck"),
      item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
      item("gate-history", "/(tabs)/gate-history", labels.history, "clock"),
      item(
        "shift-notes",
        "/(tabs)/shift-notes",
        labels.shiftNotes ?? "Shift Notes",
        "file-text",
      ),
      item("profile", "/(tabs)/profile", labels.profile, "user"),
    ];
    if (fleetSiteActivityEnabled)
      gateItems.splice(
        2,
        0,
        item(
          "fleet-site-activity",
          "/(tabs)/fleet-site-activity",
          labels.fleetSiteActivity ?? "Fleet site activity",
          "activity",
        ),
      );
    if (fleetEnabled)
      gateItems.splice(
        2,
        0,
        item("fleet", "/(tabs)/fleet", labels.fleet ?? "Fleet Ops", "truck"),
      );
    return gateItems;
  }

  const result: AppNavigationItem[] = [
    item("askv", "/(tabs)/askv", labels.askv, "zap", "askv"),
    item("index", "/(tabs)", labels.home, "home"),
    item("work-hub", "/work-hub", labels.workHub, "briefcase"),
    {
      ...item("schedule", "/work-hub/calendar", labels.schedule, "calendar"),
      badge: badges.schedule,
    },
    {
      ...item("flagged", "/(tabs)/flagged", labels.flagged, "flag"),
      badge: badges.flagged,
    },
  ];
  if (user?.role === "vendor" || user?.role === "admin") {
    const flaggedIndex = result.findIndex((entry) => entry.key === "flagged");
    if (flaggedIndex >= 0) result.splice(flaggedIndex, 1);
  }
  if (fleetSupportEnabled)
    result.splice(
      2,
      0,
      item(
        "fleet-support",
        "/(tabs)/fleet-support",
        labels.fleetSupport ?? "Fleet support",
        "shield",
      ),
    );
  if (fleetSiteActivityEnabled)
    result.splice(
      2,
      0,
      item(
        "fleet-site-activity",
        "/(tabs)/fleet-site-activity",
        labels.fleetSiteActivity ?? "Fleet site activity",
        "activity",
      ),
    );
  if (fleetEnabled)
    result.splice(
      2,
      0,
      item("fleet", "/(tabs)/fleet", labels.fleet ?? "Fleet Ops", "truck"),
    );

  if (
    user?.role === "admin" ||
    (user?.role === "vendor" &&
      ["admin", "office"].includes(user.vendorRole ?? ""))
  ) {
    result.splice(
      2,
      0,
      item(
        "gate-mode",
        "/(tabs)/change-over?gateMode=1",
        labels.gateMode ?? "Gate Mode",
        "log-in",
      ),
    );
  }

  if (crewMapTabVisible(user)) {
    result.push(item("crew-map", "/(tabs)/crew-map", labels.map, "map-pin"));
  }
  if (isForemanEmployeeUser(user)) {
    for (const key of ["schedule", "flagged"]) {
      const index = result.findIndex((item) => item.key === key);
      if (index >= 0) result.splice(index, 1);
    }
    result.push(item("crews", "/(tabs)/crews", labels.crews, "users"));
  }
  result.push(item("profile", "/(tabs)/profile", labels.profile, "user"));
  return result;
}

export function gateLandingRoute(user: StoredUser | null | undefined): string {
  return isGatekeeperUser(user) ? "/(tabs)/change-over" : "/(tabs)";
}

/** Nested Work Hub pages share its sidebar selection and company-category access. */
export function activeNavigationKey(pathname: string): string {
  const segments = pathname
    .split(/[?#]/, 1)[0]
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "(tabs)");
  if (segments[0] === "work-hub") return "work-hub";
  if (segments.includes("fleet-run")) return "fleet";
  if (["fleet-log", "fleet-map", "fleet-locations", "fleet-compliance"].includes(segments[0] ?? "")) return "fleet";
  if (!segments.length || segments[0] === "index") return "index";
  return segments.at(-1) ?? "index";
}

/** Routes exposed by the focused gatekeeper navigation. */
export function isGatekeeperRouteAllowed(
  user: StoredUser | null | undefined,
  segments: readonly string[],
): boolean {
  const [root, child] = segments;
  const profileActionRoutes = new Set([
    "company-operations",
    "edit-profile",
    "location-consent",
    "compliance",
    "notifications",
    "notification-preferences",
    "onboarding",
  ]);
  return (
    (root === "(tabs)" &&
      (isGatekeeperTabKey(child) ||
        child === "gate-map" ||
        child === "fleet" ||
        child === "fleet-log" ||
        child === "fleet-map" ||
        child === "fleet-compliance" ||
        child === "fleet-run" ||
        child === "fleet-site-activity")) ||
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
