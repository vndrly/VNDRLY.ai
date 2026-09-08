import { describe, expect, it } from "vitest";

import type { StoredUser } from "@/lib/auth";
import { buildAppNavigation, type AppNavigationLabels } from "./app-navigation";

const labels: AppNavigationLabels = {
  askv: "AskV",
  comms: "Comms",
  crews: "Crews",
  flagged: "Flagged",
  gate: "Gate",
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
  it("uses four Gate actions with AskV as the voice entry", () => {
    const items = buildAppNavigation({
      user: user("vendor", "gatekeeper"),
      labels,
      badges,
    });
    expect(items.map((entry) => entry.key)).toEqual([
      "gate",
      "askv",
      "gate-history",
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

  it("shows the shared map to partner and admin office viewers", () => {
    for (const role of ["partner", "admin"]) {
      const keys = buildAppNavigation({ user: user(role), labels, badges }).map(
        (entry) => entry.key,
      );
      expect(keys).toContain("crew-map");
      expect(keys).not.toContain("crews");
    }
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
