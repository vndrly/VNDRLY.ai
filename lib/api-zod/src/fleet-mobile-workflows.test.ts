import { describe, expect, it } from "vitest";
import type { ZodType } from "zod/v4";
import * as contracts from "./index";

function schema(name: string): ZodType<any> {
  const value = (contracts as unknown as Record<string, ZodType<any>>)[name];
  expect(value, name).toBeDefined();
  return value;
}

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-19T12:00:00Z";
const scope = {
  owner: { type: "vendor", id: 11 },
  userId: 42,
  membershipId: 7,
  sessionVersion: 1,
};

describe("Fleet mobile workflow contracts", () => {
  it("parses each approved capability and rejects unknown authority", () => {
    const capability = schema("FleetCapabilitySchema");
    for (const value of ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"])
      expect(capability.parse(value)).toBe(value);
    expect(capability.safeParse("superuser").success).toBe(false);
    expect(schema("FleetCapabilityAssignmentSchema").parse({
      companyId: 11,
      userId: 42,
      version: 1,
      capabilities: ["driver", "yard", "self_dispatch"],
    }).capabilities).toEqual(["driver", "yard", "self_dispatch"]);
  });

  it("requires Yard Order actions to carry operationId expectedVersion actor scope and outcome", () => {
    const action = schema("FleetYardOrderActionSchema");
    const report = {
      operationId: id,
      expectedVersion: 2,
      scope,
      orderId: otherId,
      kind: "report",
      outcome: "needs_attention",
      notes: "Check the pump seal",
    };
    expect(action.parse(report).outcome).toBe("needs_attention");
    for (const key of ["operationId", "expectedVersion", "scope", "outcome"])
      expect(action.safeParse({ ...report, [key]: undefined }).success, key).toBe(false);
    expect(action.safeParse({ ...report, outcome: "approved" }).success).toBe(false);
    expect(action.safeParse({ ...report, expectedVersion: -1 }).success).toBe(false);
    expect(schema("FleetYardOrderSchema").parse({
      id, companyId: 11, version: 1, yardId: otherId, detailId: null,
      runId: null, status: "requested", outcome: null,
      requestedByUserId: 42, assignedToUserId: null,
      requestedAt: at, scheduledAt: null, startedAt: null, reportedAt: null,
      requestedAssetIds: [], actualAssetIds: [], findings: [], notes: "",
    }).status).toBe("requested");
  });

  it("keeps compliance deductions advisory and exposes estimated improvement", () => {
    const score = schema("FleetComplianceScoreSchema");
    const input = {
      companyId: 11, score: 72, status: "amber", advisoryOnly: true,
      evaluatedAt: at, history: [],
      categories: [{ category: "vehicle", score: 72 }],
      deductions: [{ id, category: "vehicle", points: 8,
        reason: "Inspection expires soon", urgency: "soon",
        estimatedImprovement: 8, remediation: "Upload the renewed inspection",
        evidenceDestination: "Fleet vehicle records", responsibleCapability: "admin",
        dueAt: at }],
    };
    expect(score.parse(input).deductions[0].estimatedImprovement).toBe(8);
    expect(score.safeParse({ ...input, advisoryOnly: false }).success).toBe(false);
    expect(score.safeParse({ ...input, deductions: [{ ...input.deductions[0], estimatedImprovement: -1 }] }).success).toBe(false);
    expect(score.safeParse({ ...input, deductions: [{ ...input.deductions[0], estimatedImprovement: undefined }] }).success).toBe(false);
  });

  it("keeps multi-yard custody observations tied to a canonical actor and location", () => {
    const yard = schema("FleetYardSchema").parse({
      id, companyId: 11, version: 1, name: "North Yard",
      timeZone: "America/Chicago", destinationId: otherId,
      isHomeBase: false, active: true,
    });
    expect(yard.destinationId).toBe(otherId);
    expect(schema("FleetYardInputSchema").safeParse({
      operationId: otherId, expectedVersion: 0, scope,
      yard: { companyId: 11, name: "Home Base", timeZone: "America/Chicago",
        destinationId: null, isHomeBase: true, active: true },
    }).success).toBe(true);
    const observation = {
      id, companyId: 11, assetId: otherId, state: "at_yard",
      method: "gate_scan", observedAt: at, observedByUserId: 42,
      yardId: id, runId: null, detailId: null,
      latitude: 35.5, longitude: -97.5, notes: "Received",
    };
    expect(schema("FleetCustodyObservationSchema").parse(observation).state).toBe("at_yard");
    expect(schema("FleetCustodyObservationSchema").safeParse({ ...observation, method: "telematics" }).success).toBe(false);
    const { id: _observationId, ...newObservation } = observation;
    expect(schema("FleetCustodyObservationInputSchema").safeParse({
      operationId: id, expectedVersion: 1, scope, observation: newObservation,
    }).success).toBe(true);
  });

  it("projects a role-aware home action without making optional setup mandatory", () => {
    const home = schema("FleetHomeProjectionSchema");
    const input = {
      companyId: 11, userId: 42, mode: "my_fleet_day",
      capabilities: ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"],
      nextAction: { kind: "start_run", label: "Start today's run", runId: id },
      priorities: [], warnings: [], moduleStates: [],
    };
    expect(home.parse(input).mode).toBe("my_fleet_day");
    expect(home.safeParse({ ...input, capabilities: ["superuser"] }).success).toBe(false);
  });
});
