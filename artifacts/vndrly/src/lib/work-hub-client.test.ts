import { describe, expect, it } from "vitest";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import {
  canManageWorkHubChannels,
  commandEnvelope,
  createWorkHubOperationId,
  isWorkHubScheduler,
  ownerForUser,
  workHubModulePath,
  type WorkHubUser,
} from "./work-hub-client";

describe("Work Hub client boundary", () => {
  it("only lets platform or organization administrators manage channels", () => {
    expect(
      canManageWorkHubChannels({
        role: "admin",
        vendorId: null,
        partnerId: null,
        membershipRole: null,
      }),
    ).toBe(true);
    expect(
      canManageWorkHubChannels({
        role: "vendor",
        vendorId: 22,
        partnerId: null,
        membershipRole: "admin",
      }),
    ).toBe(true);
    expect(
      canManageWorkHubChannels({
        role: "vendor",
        vendorId: 22,
        partnerId: null,
        membershipRole: "member",
      }),
    ).toBe(false);
    expect(
      canManageWorkHubChannels({
        role: "vendor",
        vendorId: 22,
        partnerId: null,
        activeMembershipId: 91,
        availableMemberships: [
          { id: 90, role: "member" },
          { id: 91, role: "admin" },
        ],
      }),
    ).toBe(true);
  });

  it("lets gate supervisors schedule without granting channel administration", () => {
    const supervisor = {
      role: "field_employee",
      vendorId: 22,
      partnerId: null,
      vendorRole: "gate_supervisor",
    };
    expect(isWorkHubScheduler(supervisor)).toBe(true);
    expect(canManageWorkHubChannels(supervisor)).toBe(false);
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
      payloadVersion: 1,
      payload: { title: "Inspect pump" },
    });
  });

  it("creates an envelope accepted by the shared API schema", () => {
    expect(
      workHubCommandEnvelopeSchema.safeParse(
        commandEnvelope({ type: "vendor", id: 22 }, { name: "Admin" }),
      ).success,
    ).toBe(true);
  });

  it("preserves an explicit gate context for scoped supervisor commands", () => {
    expect(
      commandEnvelope(
        { type: "vendor", id: 22 },
        { title: "Gate shift" },
        "operation-2",
        undefined,
        { kind: "gate", id: 90 },
      ).context,
    ).toEqual({ kind: "gate", id: 90 });
  });

  it("creates a valid operation id when randomUUID is unavailable", () => {
    const operationId = createWorkHubOperationId({
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return bytes;
      },
    });

    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
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
