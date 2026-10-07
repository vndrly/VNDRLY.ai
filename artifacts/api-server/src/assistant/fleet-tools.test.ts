import { describe, expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";
const runId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const session = { userId: 1, role: "vendor", membershipRole: "admin" };
describe("Fleet assistant canonical action boundary", () => {
  it("requires trusted authorization and cannot turn dispatch consent into driver transition", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_run",
        {
          runId,
          operationId,
          expectedVersion: 1,
          action: "dispatch",
          confirmed: true,
        },
        false,
        session,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_run",
        { runId, operationId, expectedVersion: 1, action: "start" },
        true,
        session,
      ),
    ).toHaveProperty("error");
    expect(() =>
      validateChatGptActionInput("manage_fleet_run", {
        runId,
        expectedVersion: 1,
        action: "start",
      }),
    ).toThrow();
  });
  it("uses the canonical action envelope and excludes scope/confirmation overrides", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "transition_fleet_run",
        {
          runId,
          operationId,
          expectedVersion: 3,
          action: "pause",
          reason: "Actual wait",
          owner: { id: 99 },
          confirmed: true,
          latitude: 35,
          idempotencyKey: "model",
        },
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: "/fleet/runs/" + runId + "/actions",
      body: {
        operationId,
        expectedVersion: 3,
        action: "pause",
        reason: "Actual wait",
      },
    });
  });
  it("refuses resource-path traversal before constructing a request", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_run_detail",
        { runId: "../../users" },
        false,
        session,
      ),
    ).toHaveProperty("error");
  });
  it("keeps configuration changes restricted to company admin and validates the exact versioned schema", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_settings",
        { expectedVersion: 1, enabled: true, fleets: [], grants: [] },
        true,
        { userId: 1, role: "vendor", membershipRole: "member" },
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_settings",
        {
          expectedVersion: 1,
          enabled: true,
          fleets: [],
          grants: [],
          owner: { id: 99 },
        },
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: "/fleet/setup",
      body: { expectedVersion: 1, enabled: true, fleets: [], grants: [] },
    });
  });
});
