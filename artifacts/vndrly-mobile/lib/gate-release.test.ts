import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isGateReleasePath,
  gateReleaseDestination,
  GATE_HOME,
  gateManager,
} from "./gate-release";
import {
  rememberGateHandoff,
  takeGateHandoffDestination,
} from "./gate-handoff-return";
import { mergeGatePeople, toggleGateRole } from "./gate-staff";
import { gateNativeStatus } from "./gate-native-policy";
afterEach(() => {
  vi.useRealTimers();
  takeGateHandoffDestination();
});
describe("Gate release boundaries", () => {
  it.each([
    "/fleet",
    "/(tabs)/tickets",
    "/ticket/1",
    "/work-hub/training",
    "/work-hub/files-notes?section=inventory",
    "/work-hub/settings-connections",
    "https://vndrly.ai/fleet",
  ])("excludes %s", (p) => {
    expect(isGateReleasePath(p)).toBe(false);
    expect(gateReleaseDestination(p)).toBe(GATE_HOME);
  });
  it.each([
    "/gate",
    "/(tabs)/change-over",
    "/gate-map",
    "/gate-history",
    "/handoff?purpose=assume",
    "/work-hub/calendar",
    "/work-hub/meeting/a",
    "/gate-person?id=new",
    "/gate-companies",
    "/profile",
  ])("keeps %s", (p) => expect(isGateReleasePath(p)).toBe(true));
  it("grants the manager menu from actual role or active membership only", () => {
    expect(gateManager({ vendorRole: "gatekeeper" })).toBe(false);
    expect(gateManager({ vendorRole: "gate_supervisor" })).toBe(true);
    expect(gateManager({ role: "admin" })).toBe(true);
    expect(
      gateManager({
        activeMembershipId: 2,
        availableMemberships: [
          { id: 1, role: "admin" },
          { id: 2, role: "member" },
        ],
      }),
    ).toBe(false);
  });
  it("does not replay handoff return after use or fifteen minutes", () => {
    vi.useFakeTimers();
    rememberGateHandoff(4, "gate-1");
    expect(takeGateHandoffDestination()).toBe(
      "/handoff?purpose=assume&siteId=4&stationId=gate-1",
    );
    expect(takeGateHandoffDestination()).toBeNull();
    rememberGateHandoff(5, "gate-2");
    vi.advanceTimersByTime(15 * 60_000);
    expect(takeGateHandoffDestination()).toBeNull();
  });
  it("preserves non-Gate roles when toggling access", () => {
    expect(
      toggleGateRole(
        ["office", "field_employee", "gatekeeper"],
        "gatekeeper",
        false,
      ),
    ).toEqual(["office", "field_employee"]);
    expect(
      toggleGateRole(["gate_supervisor"], "gate_supervisor", true),
    ).toEqual(["gate_supervisor"]);
  });
  it("only shows authoritative people and deduplicates legacy projections", () => {
    const person = (id: number, lastName: string) => ({
      id,
      firstName: "Test",
      lastName,
      email: "test@example.invalid",
      vendorId: 7,
    });
    const access = {
      eligibleSites: [],
      people: [
        {
          vendorPeopleId: 2,
          isAdmin: false,
          operationalRoles: [],
          siteAccessMode: "selected" as const,
          siteLocationIds: [],
        },
      ],
    };
    expect(
      mergeGatePeople(
        [person(1, "Hidden"), person(2, "Old")],
        [person(2, "Current")],
        access,
      ),
    ).toEqual([person(2, "Current")]);
  });
  it("never presents Field/Fleet work or ticket requests as Gate device work", () => {
    const status: any = {
      policy: { enabled: true },
      duty: { active: true },
      consent: { locationSharing: true },
      tasks: [
        { kind: "gate", id: "g" },
        { kind: "fleet", id: "f" },
        { kind: "ticket", id: "t" },
      ],
      selectedTask: { kind: "fleet", id: "f" },
      requests: [
        { id: "a", ticketId: 2 },
        { id: "b", ticketId: null },
      ],
    };
    const gate = gateNativeStatus(status);
    expect(gate.tasks?.map((x) => x.kind)).toEqual(["gate"]);
    expect(gate.selectedTask).toBeNull();
    expect(gate.requests.map((x) => x.id)).toEqual(["b"]);
    expect(gate.duty).toEqual(status.duty);
    expect(status.tasks).toHaveLength(3);
  });
});
