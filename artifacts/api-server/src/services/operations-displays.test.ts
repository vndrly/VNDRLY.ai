import { describe, expect, it } from "vitest";
import {
  createMemoryOperationsDisplayRepository,
  createOperationsDisplayService,
} from "./operations-displays";

const owner = { type: "vendor" as const, id: 7 };
const companion = {
  userId: 11,
  owner,
  signedInCompanionDeviceId: "10000000-0000-4000-8000-000000000001",
};

describe("operations displays", () => {
  it("allows only a trusted companion to route an allowlisted restricted view", async () => {
    const service = createOperationsDisplayService(
      createMemoryOperationsDisplayRepository(),
      () => new Date("2026-09-14T12:00:00Z"),
    );
    const display = await service.registerOperationsDisplay({
      owner,
      name: "Dispatch wall",
      registeredByUserId: companion.userId,
      registeredCompanionDeviceId: companion.signedInCompanionDeviceId,
      monitorNames: ["Monitor A", "Monitor B"],
      siteAllowlist: [42],
      viewAllowlist: ["crew_map", "gate_log", "meeting_room"],
      privacyMode: true,
    });

    await expect(
      service.routeViewToMonitor(
        {
          displayId: display.display.id,
          monitorName: "Monitor A",
          view: "crew_map",
          siteLocationId: 42,
        },
        { userId: 0, owner },
      ),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      service.routeViewToMonitor(
        {
          displayId: display.display.id,
          monitorName: "Monitor A",
          view: "crew_map",
          siteLocationId: 42,
        },
        { ...companion, owner: { type: "vendor", id: 9 } },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "trusted_companion_required",
    });
    await expect(
      service.routeViewToMonitor(
        {
          displayId: display.display.id,
          monitorName: "Monitor A",
          view: "crew_map",
          siteLocationId: 42,
        },
        companion,
      ),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      service.routeViewToMonitor(
        {
          displayId: display.display.id,
          monitorName: "Monitor A",
          view: "crew_map",
          siteLocationId: 99,
        },
        companion,
      ),
    ).resolves.toMatchObject({ allowed: false, reason: "site_not_allowed" });
  });

  it("keeps the display identity read-only and room media disabled by default", async () => {
    const service = createOperationsDisplayService(
      createMemoryOperationsDisplayRepository(),
    );
    const registered = await service.registerOperationsDisplay({
      owner,
      name: "Meeting room",
      registeredByUserId: 11,
      registeredCompanionDeviceId: companion.signedInCompanionDeviceId,
      monitorNames: ["Room"],
      siteAllowlist: [],
      viewAllowlist: ["meeting_room"],
      privacyMode: false,
    });
    expect(
      service.authorizeAdministrativeMutation({
        kind: "operations_display",
        displayId: registered.display.id,
      }),
    ).toEqual({ allowed: false, reason: "display_read_only" });
    await expect(
      service.joinAsRoomDevice(
        {
          displayId: registered.display.id,
          monitorName: "Room",
          meetingOccurrenceId: "20000000-0000-4000-8000-000000000001",
        },
        companion,
      ),
    ).resolves.toMatchObject({
      allowed: true,
      roomDevice: {
        cameraEnabled: false,
        microphoneEnabled: false,
        label: "Meeting room - Room",
      },
    });
    await service.revokeDisplay(registered.display.id, companion);
    await expect(
      service.routeViewToMonitor(
        {
          displayId: registered.display.id,
          monitorName: "Room",
          view: "meeting_room",
        },
        companion,
      ),
    ).resolves.toMatchObject({ allowed: false, reason: "display_revoked" });
  });
});
