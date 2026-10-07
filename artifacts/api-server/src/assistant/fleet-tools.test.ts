import { describe, expect, it } from "vitest";
import { chatGptReadToolAnnotations } from "./chatgpt-tool-access";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";
const runId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const session = { userId: 1, role: "vendor", membershipRole: "admin" };
describe("Fleet assistant canonical action boundary", () => {
  it("routes ETA exact run reads without accepting coordinates and declares external provider", () => {
    expect(resolveExecutableWorkHubToolRequest("query_fleet_run_eta", {runId, latitude: 99}, false, session)).toMatchObject({method:"GET", path:`/fleet/runs/${runId}/eta`});
    expect(resolveExecutableWorkHubToolRequest("query_fleet_run_eta", {}, false, session)).toHaveProperty("error");
    expect(chatGptReadToolAnnotations("query_fleet_run_eta")).toMatchObject({readOnlyHint:true,openWorldHint:true});
  });
  it("keeps new maintenance/view/Gate commands bound and excludes authority overrides", () => {
    const maintenanceId = "33333333-3333-4333-8333-333333333333";
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_maintenance",
        {
          maintenanceId,
          action: "release",
          expectedVersion: 2,
          notes: "Authorized user review",
          operationId,
          confirmed: true,
          safetyRelease: true,
        },
        false,
        session,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_maintenance",
        {
          maintenanceId,
          action: "release",
          expectedVersion: 2,
          notes: "Authorized user review",
          operationId,
          safetyRelease: true,
          ownerId: 88,
        },
        true,
        session,
      ),
    ).toMatchObject({
      method: "POST",
      path: `/fleet/maintenance/${maintenanceId}/actions`,
      body: {
        operationId,
        expectedVersion: 2,
        action: "release",
        notes: "Authorized user review",
      },
    });
    const gate = resolveExecutableWorkHubToolRequest(
      "reconcile_fleet_gate_visit",
      {
        runId,
        stopId: maintenanceId,
        visitId: 7,
        expectedVersion: 3,
        operationId,
        reason: "Selected actual candidate",
        actorUserId: 99,
        confirmed: true,
      },
      true,
      session,
    );
    expect(gate).toMatchObject({
      path: `/fleet/runs/${runId}/gate-links`,
      body: {
        operationId,
        expectedVersion: 3,
        stopId: maintenanceId,
        visitId: 7,
        reason: "Selected actual candidate",
      },
    });
    if (gate && "body" in gate) expect(gate.body).not.toHaveProperty("actorUserId");
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_report",
        {
          siteId: 9,
          startsAt: "2026-10-06T00:00:00Z",
          endsAt: "2026-10-07T00:00:00Z",
        },
        false,
        session,
      ),
    ).toMatchObject({ method: "GET" });
    expect(() =>
      validateChatGptActionInput("manage_fleet_maintenance", {
        maintenanceId,
        action: "release",
        notes: "Missing revision",
      }),
    ).toThrow();
  });
  it("forwards only validated historical pagination through canonical reads", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_runs",
        { limit: 25, cursor: "120:70" },
        false,
        session,
      ),
    ).toMatchObject({
      method: "GET",
      path: "/fleet/overview?limit=25&cursor=120%3A70",
    });
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_briefing",
        { cursor: "//foreign" },
        false,
        session,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_runs",
        { limit: 51 },
        false,
        session,
      ),
    ).toHaveProperty("error");
  });
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
