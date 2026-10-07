import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { FleetRunSchema } from "@workspace/api-zod";
import {
  createFleetSupportService,
  type FleetSupportActor,
} from "./fleet-support";
import { emptyFleetState } from "./fleet-repository";
const time = "2026-10-07T12:00:00Z",
  actor: FleetSupportActor = { userId: 1, sv: 1, role: "admin" };
function fixture() {
  const fleetId = randomUUID(),
    vehicle = randomUUID();
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: fleetId,
        name: "Synthetic",
        siteIds: [9],
        equipmentAssetIds: [vehicle],
        requiredCertifications: [],
      },
    ],
    supportGrants: [
      {
        userId: 1,
        fleetIds: [fleetId],
        siteIds: [9],
        expiresAt: "2026-10-08T12:00:00Z",
        reason: "Company-authorized synthetic diagnostic",
        financeRead: false,
      },
    ],
  };
  const run = FleetRunSchema.parse({
    id: randomUUID(),
    companyId: 7,
    fleetId,
    title: "Synthetic",
    driverUserId: 2,
    vehicleAssetId: vehicle,
    trailerAssetId: null,
    siteIds: [9],
    status: "in_progress",
    phase: "traveling_to_pickup",
    version: 4,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    inspections: [],
    records: [
      {
        id: randomUUID(),
        vehicleAssetId: vehicle,
        kind: "fuel",
        quantity: 5,
        reading: null,
        unit: "gallons",
        notes: "Private fuel",
        recordedByUserId: 2,
        recordedAt: time,
        capturedAt: null,
        source: "user_report",
      },
    ],
    currentStopId: null,
    visitedStopIds: [],
    events: [
      {
        id: randomUUID(),
        operationId: randomUUID(),
        type: "record_fuel",
        actorUserId: 2,
        recordedAt: time,
        details: { notes: "Private fuel" },
      },
    ],
    linkedTicketId: null,
    allowedActions: ["cancel"],
  });
  let valid = true,
    sites = true;
  const release = vi.fn(),
    query = vi.fn(async (sql: string, args: unknown[]) => {
      if (sql.startsWith("SELECT id FROM users"))
        return {
          rows: valid && args[0] === 1 && args[1] === 1 ? [{ id: 1 }] : [],
        };
      if (sql.startsWith("SELECT id,name,fleet_ops_state FROM vendors"))
        return {
          rows:
            args[0] === 7 || sql.includes("jsonb_array_elements")
              ? [{ id: 7, name: "Synthetic company", fleet_ops_state: state }]
              : [],
        };
      if (sql.startsWith("SELECT s.id"))
        return { rows: sites ? [{ id: 9 }] : [] };
      if (sql.includes("COALESCE(MAX")) return { rows: [{ id: 10 }] };
      if (sql.includes("DISTINCT ON"))
        return { rows: [{ id: 10, tool_output: run }] };
      return { rows: [] };
    });
  const pool = { connect: async () => ({ query, release }) } as unknown as Pick<
    Pool,
    "connect"
  >;
  return {
    service: createFleetSupportService(pool, () => new Date(time)),
    state,
    query,
    release,
    revokeAccount: () => {
      valid = false;
    },
    revokeSites: () => {
      sites = false;
    },
  };
}
describe("explicit company-bound Fleet support", () => {
  it("never grants global surveillance merely from platform role and denies missing/expired grants", async () => {
    const f = fixture();
    f.state.supportGrants = [];
    expect((await f.service.companies(actor)).companies).toEqual([]);
    await expect(f.service.read(actor, 7)).rejects.toMatchObject({
      status: 404,
    });
    f.state.supportGrants = [
      {
        userId: 1,
        fleetIds: [f.state.fleets[0].id],
        siteIds: [9],
        expiresAt: "2026-10-06T12:00:00Z",
        reason: "Expired",
        financeRead: false,
      },
    ];
    await expect(f.service.read(actor, 7)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("projects read-only scope, removes fuel and records support purpose without customer result payload", async () => {
    const f = fixture(),
      result = await f.service.read(actor, 7);
    expect(result.readOnly).toBe(true);
    expect(result.coordinateDisclosure).toBe(false);
    expect(result.runs[0].allowedActions).toEqual([]);
    expect(result.runs[0].records).toEqual([]);
    expect(result.runs[0].events).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Private fuel");
    const audit = f.query.mock.calls.find(([sql]) => sql.startsWith("INSERT"));
    expect(audit?.[0]).toContain("support-read");
    expect(String(audit?.[1][3])).toContain(
      "Company-authorized synthetic diagnostic",
    );
    expect(String(audit?.[1][3])).not.toContain("Private fuel");
  });
  it("rechecks actual current account and site/relationship authority on every read", async () => {
    const f = fixture();
    f.revokeSites();
    await expect(f.service.read(actor, 7)).rejects.toMatchObject({
      status: 404,
    });
    f.revokeAccount();
    f.query.mockClear();
    await expect(f.service.read(actor, 7)).rejects.toMatchObject({
      code: "fleet.current_session_required",
    });
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes("FROM vendors")),
    ).toBe(false);
    expect(f.release).toHaveBeenCalled();
  });
});
