import { describe, expect, it } from "vitest";

import type { StoredUser } from "@/lib/auth";
import {
  activeNavigationKey,
  buildAppNavigation,
  gateLandingRoute,
  isGatekeeperRouteAllowed,
  type AppNavigationLabels,
} from "./app-navigation";

describe("nested Work Hub route classification", () => {
  it.each([
    "calendar",
    "payroll-documents",
    "activity",
    "tasks-forms",
    "chat",
    "calls",
    "meetings",
    "search",
    "files-notes",
    "implementation-exports",
    "site-presence",
    "operations-health",
  ])("keeps %s within shared Work Hub navigation", (module) => {
    expect(activeNavigationKey(`/work-hub/${module}`)).toBe("work-hub");
    expect(activeNavigationKey(`/(tabs)/work-hub/${module}`)).toBe("work-hub");
  });
  it("preserves other company operations routes", () => {
    expect(activeNavigationKey("/fleet")).toBe("fleet");
    expect(activeNavigationKey("/fleet-run/run-id")).toBe("fleet");
    expect(activeNavigationKey("/gate")).toBe("gate");
    expect(activeNavigationKey("/")).toBe("index");
  });
});

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
  it("keeps Fleet modules behind one authorized navigation entry", () => {
    const navigation = buildAppNavigation({
      user: user("vendor", "admin"),
      labels,
      badges,
      companyOperationsCategories: ["fleet"],
      fleetEnabled: true,
    });
    expect(navigation.filter((item) => item.key.startsWith("fleet"))).toEqual([
      expect.objectContaining({ key: "fleet", href: "/(tabs)/fleet" }),
    ]);
    expect(
      buildAppNavigation({
        user: user("vendor", "admin"),
        labels,
        badges,
        companyOperationsCategories: ["field"],
        fleetEnabled: true,
      }).some((item) => item.key === "fleet"),
    ).toBe(false);
  });
  it("keeps Fleet companies out of Field and Gate workspaces even for office staff", () => {
    const keys = buildAppNavigation({
      user: user("vendor", "admin"),
      labels,
      badges,
      companyOperationsCategories: ["fleet"],
      fleetEnabled: true,
    }).map((item) => item.key);
    expect(keys).toEqual([
      "askv",
      "fleet",
      "work-hub",
      "profile",
    ]);
    expect(
      buildAppNavigation({
        user: user("vendor", "admin"),
        labels,
        badges,
        companyOperationsCategories: ["fleet"],
        fleetEnabled: false,
      }).some((item) => item.key === "fleet"),
    ).toBe(false);
  });
  it("keeps Field companies out of Fleet and Gate even when broader grants exist", () => {
    const keys = buildAppNavigation({
      user: user("vendor", "admin"),
      labels,
      badges,
      companyOperationsCategories: ["field"],
      fleetEnabled: true,
    }).map((item) => item.key);
    expect(keys).toContain("index");
    expect(keys).not.toContain("fleet");
    expect(keys).not.toContain("gate-mode");
  });
  it("gives Gate office staff the Gate workspace and preserves worker-specific Gate navigation", () => {
    const keys = buildAppNavigation({
      user: user("vendor", "office"),
      labels,
      badges,
      companyOperationsCategories: ["gate"],
      fleetEnabled: true,
    }).map((item) => item.key);
    expect(keys).toEqual([
      "askv",
      "change-over",
      "gate",
      "gate-history",
      "gate-map",
      "work-hub",
      "profile",
    ]);
    const workerKeys = buildAppNavigation({
      user: user("vendor", "gatekeeper"),
      labels,
      badges,
      companyOperationsCategories: ["gate"],
      fleetEnabled: true,
    }).map((item) => item.key);
    expect(workerKeys).toContain("gate");
    expect(workerKeys).not.toContain("index");
    expect(workerKeys).not.toContain("fleet");
  });
  it("exposes Fleet only after scoped server authorization, including a separately granted Gate worker", () => {
    for (const person of [
      user("vendor", "admin"),
      user("vendor", "gatekeeper"),
      user("field_employee"),
    ]) {
      expect(
        buildAppNavigation({ user: person, labels, badges }).some(
          (item) => item.key === "fleet",
        ),
      ).toBe(false);
      expect(
        buildAppNavigation({
          user: person,
          labels,
          badges,
          fleetEnabled: true,
        }).find((item) => item.key === "fleet")?.href,
      ).toBe("/(tabs)/fleet");
    }
  });
  it("opens Dashboard after sign-in for both gate roles only", () => {
    for (const role of ["gatekeeper", "gate_supervisor"]) {
      expect(gateLandingRoute(user("vendor", role))).toBe(
        "/(tabs)/change-over",
      );
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
      "crew-map",
      "crews",
      "profile",
    ]);
    expect(items.some((entry) => entry.key === "comms")).toBe(false);
  });

  it("gives authorized office admins an explicit Gate Mode entry", () => {
    const items = buildAppNavigation({
      user: user("vendor", "admin"),
      labels,
      badges,
    });
    expect(items.find((entry) => entry.key === "gate-mode")).toMatchObject({
      href: "/(tabs)/change-over?gateMode=1",
      label: "Gate Mode",
    });
  });

  it("shows the company crew map to vendor office accounts only when Field is enabled", () => {
    for (const vendorRole of [undefined, "admin", "office"]) {
      const entries = buildAppNavigation({
        user: user("vendor", vendorRole),
        labels,
        badges,
        companyOperationsCategories: ["field"],
      });
      expect(entries.find((entry) => entry.key === "crew-map")).toMatchObject({
        href: "/(tabs)/crew-map",
      });
    }
    for (const category of ["gate", "fleet"] as const) {
      expect(
        buildAppNavigation({
          user: user("vendor", "admin"),
          labels,
          badges,
          companyOperationsCategories: [category],
        }).some((entry) => entry.key === "crew-map"),
      ).toBe(false);
    }
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
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["work-hub"]),
    ).toBe(true);
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gate_supervisor"), [
        "work-hub",
        "tasks-forms",
      ]),
    ).toBe(true);
  });

  it("allows gatekeepers and gate supervisors to open the notification inbox", () => {
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["notifications"]),
    ).toBe(true);
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gate_supervisor"), [
        "notifications",
      ]),
    ).toBe(true);
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), [
        "(tabs)",
        "gate-notifications",
      ]),
    ).toBe(true);
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), [
        "(tabs)",
        "gate-notification-preferences",
      ]),
    ).toBe(true);
  });

  it("allows gatekeepers into the profile actions exposed by the Profile screen", () => {
    for (const route of [
      "edit-profile",
      "location-consent",
      "compliance",
      "notification-preferences",
    ]) {
      expect(
        isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), [route]),
        route,
      ).toBe(true);
    }
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["employees"]),
    ).toBe(false);
    expect(
      isGatekeeperRouteAllowed(user("vendor", "gatekeeper"), ["services"]),
    ).toBe(false);
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
      "profile",
    ]);
    expect(items.find((entry) => entry.key === "index")?.badge).toBeUndefined();
    expect(items.find((entry) => entry.key === "schedule")?.badge).toBe(3);
    expect(items.find((entry) => entry.key === "flagged")?.badge).toBe(1);
  });
});

it("shows partner site activity only from its separate server capability without operational Fleet navigation", () => {
  const items = buildAppNavigation({
    user: user("partner"),
    labels,
    badges,
    fleetSiteActivityEnabled: true,
  });
  expect(items.find((entry) => entry.key === "fleet-site-activity")?.href).toBe(
    "/(tabs)/fleet-site-activity",
  );
  expect(items.some((entry) => entry.key === "fleet")).toBe(false);
  expect(
    buildAppNavigation({ user: user("partner"), labels, badges }).some(
      (entry) => entry.key === "fleet-site-activity",
    ),
  ).toBe(false);
});

it("combines only the operations explicitly selected for a multi-service company", () => {
  const keys = buildAppNavigation({
    user: user("vendor", "admin"),
    labels,
    badges,
    companyOperationsCategories: ["field", "gate"],
    fleetEnabled: true,
  }).map((item) => item.key);
  expect(keys).toContain("index");
  expect(keys).toContain("gate");
  expect(keys).toContain("gate-history");
  expect(keys).not.toContain("fleet");
  const all = buildAppNavigation({
    user: user("vendor", "admin"),
    labels,
    badges,
    companyOperationsCategories: ["field", "fleet", "gate"],
    fleetEnabled: true,
  }).map((item) => item.key);
  expect(all).toEqual(expect.arrayContaining(["index", "fleet", "gate"]));
});
