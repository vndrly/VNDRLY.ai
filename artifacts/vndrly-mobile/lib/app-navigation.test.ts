import { describe, expect, it } from "vitest";

import type { StoredUser } from "@/lib/auth";
import { buildAppNavigation, gateLandingRoute, isGatekeeperRouteAllowed, type AppNavigationLabels } from "./app-navigation";

const labels: AppNavigationLabels = {
  askv: "AskV",
  comms: "Comms",
  crews: "Crews",
  flagged: "Flagged",
  gate: "Gate",
  gateMode: "Gate Mode",
  history: "History",
  home: "Home",
  map: "Map",
  profile: "Profile",
  scan: "Scan",
  schedule: "Schedule",
  voice: "Voice",
  workHub: "Work Hub",
};
const badges = { home: 4, schedule: 3, comms: 2, flagged: 1 };
const user = (role: string, vendorRole?: string): StoredUser => ({
  id: 1,
  username: "test",
  displayName: "Test",
  role,
  vendorRole,
});

describe("buildAppNavigation", () => {
  it("opens Dashboard after sign-in for both gate roles only", () => {
    for (const role of ["gatekeeper", "gate_supervisor"]) {
      expect(gateLandingRoute(user("vendor", role))).toBe("/(tabs)/change-over");
    }
    expect(gateLandingRoute(user("vendor", "admin"))).toBe("/(tabs)");
  });
  it("gives sponsored gate workers Gate and Work Hub without office or payroll navigation", () => {
    for (const role of ["gatekeeper", "gate_supervisor"]) {
      const worker = {
        ...user("field_employee", role),
        managedSubcontractor: { siteGrants: [{ siteId: 7, role }] },
      };
      const keys = buildAppNavigation({
        user: worker as StoredUser,
        labels,
        badges,
      }).map((item) => item.key);
      expect(keys).toEqual([
        "change-over",
        "work-hub",
        "gate",
        "askv",
        "gate-history",
        "shift-notes",
        "profile",
      ]);
    }
  });
  it("lands direct field gate employees in the restricted gate experience", () => {
    for (const role of ["gatekeeper", "gate_supervisor"]) {
      const worker = user("field_employee", role);
      expect(gateLandingRoute(worker)).toBe("/(tabs)/change-over");
      expect(
        buildAppNavigation({ user: worker, labels, badges }).map(
          (item) => item.key,
        ),
      ).toEqual([
        "change-over",
        "work-hub",
        "gate",
        "askv",
        "gate-history",
        "shift-notes",
        "profile",
      ]);
      expect(isGatekeeperRouteAllowed(worker, ["employees"])).toBe(false);
    }
  });
  it("orders Dashboard, Work Hub, Gate, History, Shift Notes with AskV available", () => {
    const items = buildAppNavigation({
      user: user("vendor", "gatekeeper"),
      labels,
      badges,
    });
    expect(items.map((entry) => entry.key)).toEqual([
      "change-over",
      "work-hub",
      "gate",
      "askv",
      "gate-history",
      "shift-notes",
      "profile",
    ]);
    expect(items.some((entry) => entry.kind === "gate-voice")).toBe(false);
  });

  it("adds crew map, crews, and communications for foremen", () => {
    const items = buildAppNavigation({
      user: user("field_employee", "foreman"),
      labels,
      badges,
    });
    expect(items.map((entry) => entry.key)).toEqual([
      "askv",
      "index",
      "work-hub",
      "schedule",
      "flagged",
      "crew-map",
      "crews",
      "comms",
      "scan",
      "profile",
    ]);
    expect(items.find((entry) => entry.key === "comms")?.badge).toBe(2);
  });

  it("gives authorized office admins an explicit Gate Mode entry", () => {
    const items = buildAppNavigation({ user: user("vendor", "admin"), labels, badges });
    expect(items.find((entry) => entry.key === "gate-mode")).toMatchObject({
      href: "/(tabs)/change-over?gateMode=1",
      label: "Gate Mode",
    });
  });

  it("shows the shared map to partner and admin office viewers", () => {
    for (const role of ["partner", "admin"]) {
      const keys = buildAppNavigation({ user: user(role), labels, badges }).map(
        (entry) => entry.key,
      );
      expect(keys).toContain("crew-map");
      expect(keys).not.toContain("crews");
    }
  });

  it("opens the Work Hub stack, which supplies the shared navigation shell", () => {
    const entry = buildAppNavigation({
      user: user("vendor"),
      labels,
      badges,
    }).find((item) => item.key === "work-hub");
    expect(entry?.href).toBe("/work-hub");
  });

  it("allows every gatekeeper account into the Work Hub route advertised by its navigation", () => {
    expect(isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["work-hub"])).toBe(true);
    expect(isGatekeeperRouteAllowed(user("vendor", "gate_supervisor"), ["work-hub", "tasks-forms"])).toBe(true);
  });

  it("allows gatekeepers and gate supervisors to open the notification inbox", () => {
    expect(isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["notifications"])).toBe(true);
    expect(isGatekeeperRouteAllowed(user("vendor", "gate_supervisor"), ["notifications"])).toBe(true);
    expect(isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["(tabs)", "gate-notifications"])).toBe(true);
    expect(isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["(tabs)", "gate-notification-preferences"])).toBe(true);
  });

  it("allows gatekeepers into the profile actions exposed by the Profile screen", () => {
    for (const route of ["edit-profile", "location-consent", "compliance", "notification-preferences"]) {
      expect(
        isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), [route]),
        route,
      ).toBe(true);
    }
    expect(isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["employees"])).toBe(false);
    expect(isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["services"])).toBe(false);
  });

  it("keeps home, schedule, flagged, scan, and profile access for field users", () => {
    const items = buildAppNavigation({
      user: user("field_employee", "field"),
      labels,
      badges,
    });
    expect(items.map((entry) => entry.key)).toEqual([
      "askv",
      "index",
      "work-hub",
      "schedule",
      "flagged",
      "scan",
      "profile",
    ]);
    expect(items.find((entry) => entry.key === "index")?.badge).toBe(4);
    expect(items.find((entry) => entry.key === "schedule")?.badge).toBe(3);
    expect(items.find((entry) => entry.key === "flagged")?.badge).toBe(1);
  });
});
