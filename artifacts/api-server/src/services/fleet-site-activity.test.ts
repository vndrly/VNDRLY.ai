import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { Pool } from "pg";
import {
  createFleetSiteActivityService,
  projectFleetSiteRun,
  type FleetSiteActor,
} from "./fleet-site-activity";
const time = "2026-10-07T12:00:00Z",
  stopId = randomUUID(),
  foreignStop = randomUUID();
function record() {
  return FleetRunSchema.parse({
    id: randomUUID(),
    companyId: 7,
    fleetId: randomUUID(),
    title: "Private other-route briefing",
    driverUserId: 88,
    vehicleAssetId: randomUUID(),
    trailerAssetId: null,
    siteIds: [9, 10],
    status: "in_progress",
    phase: "traveling_to_next_stop",
    version: 4,
    stops: [
      { id: stopId, siteId: 9, kind: "pickup", sequence: 0 },
      { id: foreignStop, siteId: 10, kind: "delivery", sequence: 1 },
    ],
    loads: [
      {
        id: randomUUID(),
        pickupStopId: stopId,
        deliveryStopId: foreignStop,
        commodity: "Synthetic gravel",
        quantity: 10,
        unit: "tons",
        manifestReference: "private-manifest",
        deliveryReference: "private-delivery",
        recordedByUserId: 88,
        recordedAt: time,
        deliveredAt: time,
        source: "user_report",
      },
    ],
    inspections: [],
    currentStopId: foreignStop,
    visitedStopIds: [stopId],
    events: [
      {
        id: randomUUID(),
        operationId: randomUUID(),
        type: "created",
        actorUserId: 1,
        recordedAt: time,
      },
      {
        id: randomUUID(),
        operationId: randomUUID(),
        type: "depart_stop",
        actorUserId: 88,
        recordedAt: time,
        details: { stopId, notes: "private notes" },
      },
      {
        id: randomUUID(),
        operationId: randomUUID(),
        type: "arrive_stop",
        actorUserId: 88,
        recordedAt: time,
        details: { stopId: foreignStop },
      },
    ],
    linkedTicketId: 99,
    allowedActions: ["record_load"],
  });
}
const actor: FleetSiteActor = {
  userId: 2,
  partnerId: 10,
  sv: 1,
  activeMembershipId: 20,
  membershipRole: "member",
  role: "partner",
};
function fixture() {
  let valid = true,
    approved = true;
  const run = record(),
    release = vi.fn(),
    query = vi.fn(async (sql: string, args: unknown[]) => {
      if (sql.includes("FROM users u"))
        return {
          rows:
            valid &&
            args[0] === 2 &&
            args[1] === 1 &&
            args[2] === 20 &&
            args[3] === 10
              ? [{ id: 2 }]
              : [],
        };
      if (sql.startsWith("SELECT id,name FROM site_locations"))
        return {
          rows:
            args[0] === 9 && args[1] === 10
              ? [{ id: 9, name: "Owned site" }]
              : [],
        };
      if (sql.startsWith("SELECT v.id"))
        return {
          rows: approved
            ? [
                {
                  id: 7,
                  name: "Authorized vendor",
                  fleet_ops_state: { runs: [run] },
                },
              ]
            : [],
        };
      if (sql.startsWith("SELECT vendor_id"))
        return {
          rows: [
            { vendor_id: 7, tool_output: run },
            {
              vendor_id: 8,
              tool_output: { ...run, id: randomUUID(), companyId: 8 },
            },
          ],
        };
      return { rows: [] };
    });
  const pool = { connect: async () => ({ query, release }) } as unknown as Pick<
    Pool,
    "connect"
  >;
  return {
    service: createFleetSiteActivityService(pool, () => new Date("2026-10-07T12:01:00Z")),
    query,
    release,
    revoke: () => {
      valid = false;
    },
    revokeRelationship: () => {
      approved = false;
    },
  };
}
describe("Partner owned-site Fleet projection", () => {
  it("excludes driver/other-route/manifest/coordinates and only shows selected-site event facts", () => {
    const value = projectFleetSiteRun(record(), 9, "Authorized vendor");
    expect(value.stops).toHaveLength(1);
    expect(value.stops[0].events.map((e) => e.type)).toEqual(["depart_stop"]);
    expect(value.loads[0]).toMatchObject({
      direction: "pickup",
      delivered: false,
    });
    const serialized = JSON.stringify(value);
    for (const hidden of [
      "Private other-route",
      foreignStop,
      "private-manifest",
      "private-delivery",
      "private notes",
      "driverUserId",
      "vehicleAssetId",
      "linkedTicketId",
    ])
      expect(serialized).not.toContain(hidden);
  });
  it("rechecks current partner session/site/approved company scope before any activity read", async () => {
    const f = fixture();
    const result = await f.service.activity(actor, 9, {});
    expect(result.records).toHaveLength(1);
    expect(result.coordinateDisclosure).toBe(false);
    expect(result.window.dateBasis).toBe("run_created_at");
    await expect(f.service.activity(actor, 10, {})).rejects.toMatchObject({
      status: 404,
    });
    f.revokeRelationship();
    expect((await f.service.activity(actor, 9, {})).records).toEqual([]);
    f.revoke();
    f.query.mockClear();
    await expect(f.service.activity(actor, 9, {})).rejects.toMatchObject({
      code: "fleet.current_session_required",
    });
    expect(
      f.query.mock.calls.some(([sql]) => sql.startsWith("SELECT vendor_id")),
    ).toBe(false);
    expect(f.release).toHaveBeenCalled();
  });
  it("rejects missing active authority and oversized date windows without opening a database connection", async () => {
    const f = fixture();
    await expect(
      f.service.activity(
        { ...actor, sv: undefined } as unknown as FleetSiteActor,
        9,
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.query).not.toHaveBeenCalled();
    expect(() =>
      f.service.activity(actor, 9, {
        startsAt: "2026-01-01T00:00:00Z",
        endsAt: time,
      }),
    ).toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
});
