import { describe, expect, it } from "vitest";
import {
  canManageWorkHubChannels,
  commandEnvelope,
  ownerForUser,
  workHubModulePath,
  type WorkHubUser,
} from "./work-hub-client";

describe("Work Hub client boundary", () => {
  it("only lets platform or organization administrators manage channels", () => {
    expect(canManageWorkHubChannels({ role: "admin", vendorId: null, partnerId: null, membershipRole: null })).toBe(true);
    expect(canManageWorkHubChannels({ role: "vendor", vendorId: 22, partnerId: null, membershipRole: "admin" })).toBe(true);
    expect(canManageWorkHubChannels({ role: "vendor", vendorId: 22, partnerId: null, membershipRole: "member" })).toBe(false);
  });

  it("uses the active tenant as the only command owner", () => {
    expect(
      ownerForUser({
        role: "vendor",
        vendorId: 22,
        partnerId: null,
      } as WorkHubUser),
    ).toEqual({ type: "vendor", id: 22 });
    expect(
      ownerForUser({
        role: "partner",
        vendorId: null,
        partnerId: 31,
      } as WorkHubUser),
    ).toEqual({ type: "partner", id: 31 });
    expect(
      ownerForUser({
        role: "admin",
        vendorId: null,
        partnerId: null,
      } as WorkHubUser),
    ).toBeNull();
  });

  it("creates a replay-safe mutation envelope", () => {
    const envelope = commandEnvelope(
      { type: "vendor", id: 22 },
      { title: "Inspect pump" },
      "operation-1",
      4,
    );
    expect(envelope).toEqual({
      operationId: "operation-1",
      owner: { type: "vendor", id: 22 },
      context: { kind: "organization", id: 22 },
      expectedVersion: 4,
      payload: { title: "Inspect pump" },
    });
  });

  it("maps searchable subjects back to usable module destinations", () => {
    expect(workHubModulePath("message", "m1")).toBe(
      "/work-hub/channels?message=m1",
    );
    expect(workHubModulePath("meeting", "m2")).toBe(
      "/work-hub/meetings?meeting=m2",
    );
    expect(workHubModulePath("form", "f1")).toBe("/work-hub/tasks?form=f1");
  });
});
