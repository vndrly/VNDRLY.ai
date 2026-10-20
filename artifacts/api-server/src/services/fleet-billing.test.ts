import { describe, expect, it, vi } from "vitest";
import {
  CreateFleetRunSchema,
  FleetTicketPlanSchema,
  FleetRunSchema,
} from "@workspace/api-zod";
import {
  assertFleetBillingMatch,
  assertFleetTicketFinalizable,
  attachFleetBilling,
  canFinalizeFleetRuns,
  canOfficeFinalize,
  createFleetBillingOperations,
  recordFleetBillingCharge,
} from "./fleet-billing";
import { emptyFleetState } from "./fleet-repository";
import type { PoolClient } from "pg";
const id = "11111111-1111-4111-8111-111111111111";
const create = {
  operationId: id,
  fleetId: id,
  title: "Synthetic haul",
  driverUserId: 1,
  vehicleAssetId: id,
  stops: [{ id, siteId: 9, kind: "pickup", sequence: 0 }],
};
const actor = {
  userId: 1,
  companyId: 7,
  membershipRole: "admin",
  currentSiteIds: [9],
};
function fixture() {
  const state = { ...emptyFleetState(), enabled: true };
  state.fleets = [
    {
      id,
      name: "Synthetic fleet",
      siteIds: [9],
      equipmentAssetIds: [],
      requiredCertifications: [],
    },
  ];
  state.grants = [
    {
      userId: 1,
      fleetIds: [id],
      siteIds: [9],
      roles: ["fleet_manager"],
      financeRead: true,
      safetyRelease: false,
    },
  ];
  const ticket = {
    id: 10,
    site_location_id: 9,
    vendor_id: 7,
    work_type_id:3,
    partner_id: 8,
    status: "initiated",
    fleet_plan: FleetTicketPlanSchema.parse({
      version: 1,
      siteId: 9,
      vendorId: 7,
      partnerId: 8,
      mode: "batch",
      rateCents: 100,
      currency: "USD",
      closure: "manual",
      closesAt: null,
      destinations: [],
      billingWorkflow: true,
      workDate: "2026-10-16",
      afeNumber: "A1",
      createdByUserId: 1,
      createdAt: "2026-10-16T00:00:00Z",
    }),
  };
  const run = () =>
    FleetRunSchema.parse({
      ...create,
      id,
      companyId: 7,
      trailerAssetId: null,
      siteIds: [9],
      status: "draft",
      phase: null,
      version: 1,
      loads: [],
      inspections: [],
      currentStopId: null,
      visitedStopIds: [],
      events: [],
      linkedTicketId: null,
      allowedActions: [],
    });
  const lines: number[] = [];
  let sitePolicy: { mode: "singles" } | null = null;
  let openCrew = false;
  let persisted: ReturnType<typeof run>[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM ticket_check_ins"))
      return { rows: openCrew ? [{ id: 1 }] : [] };
    if (sql.includes("FROM tickets"))
      return { rows: params[1] === 7 ? [ticket] : [] };
    if (sql.includes("FROM site_locations"))
      return {
        rows: [
          {
            id: 9,
            partner_id: 8,
            relationship_id: 1,
            relationship_status: "approved",
            afe: "A1",
            status: "active",
            is_active: true,
            fleet_ticket_policy: sitePolicy,
          },
        ],
      };
    if (sql.includes("FROM vendor_work_types"))
      return {
        rows: [
          {
            id: 3,
            name: "Synthetic haul",
            unit_price: "12.34",
            unit: "per_job",
            afe_number: "A1",
          },
        ],
      };
    if (sql.startsWith("INSERT INTO tickets")) {
      ticket.fleet_plan = JSON.parse(params[5] as string);
      return { rows: [{ id: 10 }] };
    }
    if (sql.includes("FROM assistant_action_audit"))
      return { rows: persisted.map((tool_output) => ({ tool_output })) };
    if (sql.includes("SELECT id FROM ticket_line_items"))
      return { rows: lines.map((id) => ({ id })) };
    if (
      sql.includes(
        "SELECT id,type,description,quantity,unit_price FROM ticket_line_items",
      )
    )
      return {
        rows: lines.map((id) => ({
          id,
          type: "other",
          description: `Fleet run ${persisted[0]?.id}`,
          quantity: "1",
          unit_price: (ticket.fleet_plan.rateCents / 100).toFixed(2),
        })),
      };
    if (sql.startsWith("INSERT INTO ticket_line_items")) {
      lines.push(100);
      return { rows: [{ id: 100 }] };
    }
    if (sql.startsWith("UPDATE tickets")) {
      ticket.fleet_plan = JSON.parse(params[1] as string);
      ticket.status = "submitted";
    }
    return { rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  return {
    state,
    ticket,
    run,
    client,
    query,
    lines,
    singles: () => {
      sitePolicy = { mode: "singles" };
    },
    ops: createFleetBillingOperations(async (a, work) => work(state, client)),
    crew: () => {
      openCrew = true;
    },
    persist: (r: ReturnType<typeof run>) => {
      persisted = [r];
    },
  };
}
describe("explicit Fleet billing", () => {
  it("lets a stored Office capability finalize only within legacy finance, fleet, and site scope", () => {
    const f = fixture();
    f.state.grants[0]!.roles = [];
    const office = { ...actor, membershipRole: "member", fleetCapabilities: new Set(["office" as const]) };
    expect(canOfficeFinalize(f.state, office)).toBe(true);
    expect(canFinalizeFleetRuns(f.state, office, [f.run()])).toBe(true);
    f.state.grants[0]!.financeRead = false;
    expect(canOfficeFinalize(f.state, office)).toBe(false);
    expect(canFinalizeFleetRuns(f.state, office, [f.run()])).toBe(false);
    f.state.grants[0]!.financeRead = true;
    f.state.grants[0]!.fleetIds = [];
    expect(canOfficeFinalize(f.state, office)).toBe(false);
  });
  it("rejects new runs without an explicit billing choice, AFE and work date", () => {
    expect(CreateFleetRunSchema.safeParse(create).success).toBe(false);
    expect(
      CreateFleetRunSchema.safeParse({
        ...create,
        billing: {
          mode: "new_ticket",
          workTypeId: 3,
          afeNumber: "A1",
          workDate: "2026-10-16",
        },
      }).success,
    ).toBe(true);
    expect(
      CreateFleetRunSchema.safeParse({
        ...create,
        billing: { mode: "existing_ticket", ticketId: 10, afeNumber: "A1" },
      }).success,
    ).toBe(false);
  });
  it("keeps legacy plans readable while accepting route-independent billing plans", () => {
    expect(
      FleetTicketPlanSchema.safeParse({
        version: 1,
        siteId: 9,
        vendorId: 7,
        partnerId: 8,
        mode: "batch",
        rateCents: 100,
        currency: "USD",
        closure: "manual",
        closesAt: null,
        destinations: [],
        billingWorkflow: true,
        workDate: "2026-10-16",
        afeNumber: "A1",
        createdByUserId: 1,
        createdAt: "2026-10-16T00:00:00Z",
      }).success,
    ).toBe(true);
  });
  it("rejects a mismatched site, AFE or user-selected day", () => {
    const plan = { siteId: 9, workDate: "2026-10-16", afeNumber: "A1" };
    expect(() =>
      assertFleetBillingMatch(plan, 9, {
        workDate: "2026-10-16",
        afeNumber: "A1",
      }),
    ).not.toThrow();
    for (const [site, afe, date] of [
      [10, "A1", "2026-10-16"],
      [9, "A2", "2026-10-16"],
      [9, "A1", "2026-10-17"],
    ] as const)
      expect(() =>
        assertFleetBillingMatch(plan, site, { afeNumber: afe, workDate: date }),
      ).toThrow("fleet.billing_ticket_mismatch");
  });
  it("requires all noncancelled runs to be reviewed before office submission", () => {
    expect(() =>
      assertFleetTicketFinalizable(
        "initiated",
        [{ status: "completed" }, { status: "cancelled" }],
        0,
      ),
    ).not.toThrow();
    for (const status of ["draft", "in_progress", "submitted_for_review"])
      expect(() =>
        assertFleetTicketFinalizable("initiated", [{ status }], 0),
      ).toThrow("fleet.runs_not_reviewed");
    expect(() =>
      assertFleetTicketFinalizable(
        "awaiting_acceptance",
        [{ status: "completed" }],
        0,
      ),
    ).toThrow("fleet.ticket_not_submittable");
    expect(() =>
      assertFleetTicketFinalizable("initiated", [{ status: "completed" }], 1),
    ).toThrow("fleet.open_crew_sessions");
    expect(() =>
      assertFleetTicketFinalizable("initiated", [{ status: "cancelled" }], 0),
    ).toThrow("fleet.no_reviewed_runs");
  });
  it("creates a canonical ticket from catalog rate and preserves the full route", async () => {
    const f = fixture(),
      r = f.run();
    r.stops.push({
      ...r.stops[0],
      id: "22222222-2222-4222-8222-222222222222",
      kind: "delivery",
      sequence: 1,
    });
    const stops = structuredClone(r.stops);
    await attachFleetBilling(f.client, actor, f.state, r, {
      mode: "new_ticket",
      workTypeId: 3,
      afeNumber: "A1",
      workDate: "2026-10-16",
    });
    expect(r.stops).toEqual(stops);
    expect(r.linkedTicketId).toBe(10);
    expect(f.ticket.fleet_plan.rateCents).toBe(1234);
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO ticket_status_history"),
      ),
    ).toBe(true);
    await recordFleetBillingCharge(f.client, actor, r);
    await recordFleetBillingCharge(f.client, actor, r);
    expect(f.lines).toHaveLength(1);
    expect(r.billing?.billedLineId).toBe(100);
    expect(
      f.query.mock.calls.find(([sql]) =>
        sql.startsWith("INSERT INTO ticket_line_items"),
      )?.[1]?.[2],
    ).toBe("12.34");
  });
  it("leaves shared tickets open until explicit finalization and rejects changed retries", async () => {
    const f = fixture(),
      r = f.run();
    await attachFleetBilling(f.client, actor, f.state, r, {
      mode: "existing_ticket",
      ticketId: 10,
      afeNumber: "A1",
      workDate: "2026-10-16",
    });
    r.status = "completed";
    await recordFleetBillingCharge(f.client, actor, r);
    f.persist(r);
    expect(f.ticket.status).toBe("initiated");
    expect(f.ticket.fleet_plan.closedAt).toBeNull();
    const input = { operationId: id, expectedVersion: 1 };
    const result = await f.ops.finalizeTicket(actor, 10, input);
    expect(result.status).toBe("submitted");
    expect(result.plan.version).toBe(2);
    expect(await f.ops.finalizeTicket(actor, 10, input)).toEqual(result);
    await expect(
      f.ops.finalizeTicket(actor, 10, { ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    expect(
      f.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE tickets")),
    ).toHaveLength(1);
    f.ticket.status = "kicked_back";
    const correction = await f.ops.finalizeTicket(actor, 10, {
      operationId: "33333333-3333-4333-8333-333333333333",
      expectedVersion: 2,
    });
    expect(correction).toMatchObject({
      status: "submitted",
      plan: { version: 3 },
    });
    await expect(
      attachFleetBilling(f.client, actor, f.state, f.run(), {
        mode: "existing_ticket",
        ticketId: 10,
        afeNumber: "A1",
        workDate: "2026-10-16",
      }),
    ).rejects.toMatchObject({ code: "fleet.ticket_closed" });
  });
  it("includes current unreviewed runs alongside historical reviewed runs when finalizing", async () => {
    const f = fixture(),
      r = f.run();
    r.status = "completed";
    r.linkedTicketId = 10;
    r.billing = { afeNumber: "A1", workDate: "2026-10-16", billedLineId: 100 };
    f.persist(r);
    f.state.runs.push({
      ...f.run(),
      id: "22222222-2222-4222-8222-222222222222",
      linkedTicketId: 10,
    });
    await expect(
      f.ops.finalizeTicket(actor, 10, { operationId: id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "fleet.runs_not_reviewed" });
    expect(f.ticket.status).toBe("initiated");
  });
  it("denies finalization of a different fleet even when manager finance and site overlap", () => {
    const f = fixture(),
      r = f.run();
    r.fleetId = "22222222-2222-4222-8222-222222222222";
    expect(
      canFinalizeFleetRuns(f.state, { ...actor, membershipRole: "member" }, [
        r,
      ]),
    ).toBe(false);
    r.fleetId = id;
    expect(
      canFinalizeFleetRuns(f.state, { ...actor, membershipRole: "member" }, [
        r,
      ]),
    ).toBe(true);
  });
  it("honors a current site Singles policy and prevents shared attachment", async () => {
    const f = fixture();
    f.singles();
    const r = f.run();
    await attachFleetBilling(f.client, actor, f.state, r, {
      mode: "new_ticket",
      workTypeId: 3,
      afeNumber: "A1",
      workDate: "2026-10-16",
    });
    expect(f.ticket.fleet_plan.mode).toBe("singles");
    await expect(
      attachFleetBilling(f.client, actor, f.state, f.run(), {
        mode: "existing_ticket",
        ticketId: 10,
        afeNumber: "A1",
        workDate: "2026-10-16",
      }),
    ).rejects.toMatchObject({ code: "fleet.ticket_closed" });
  });
  it("refuses a deleted canonical charge and rechecks historical authority on a retry", async () => {
    const f = fixture(),
      r = f.run();
    await attachFleetBilling(f.client, actor, f.state, r, {
      mode: "existing_ticket",
      ticketId: 10,
      afeNumber: "A1",
      workDate: "2026-10-16",
    });
    r.status = "completed";
    await recordFleetBillingCharge(f.client, actor, r);
    f.persist(r);
    const input = { operationId: id, expectedVersion: 1 };
    f.lines.length = 0;
    await expect(f.ops.finalizeTicket(actor, 10, input)).rejects.toMatchObject({
      code: "fleet.billing_charge_mismatch",
    });
    f.lines.push(100);
    await f.ops.finalizeTicket(actor, 10, input);
    f.state.grants[0].fleetIds = [];
    await expect(f.ops.finalizeTicket(actor, 10, input)).rejects.toMatchObject({
      code: "fleet.finance_required",
    });
  });
  it.each(["per_hour", "per_day"] as const)(
    "requires explicit office quantity for %s without inferring time",
    async (unit) => {
      const f = fixture(),
        r = f.run();
      f.ticket.fleet_plan.billingUnit = unit;
      await attachFleetBilling(f.client, actor, f.state, r, {
        mode: "existing_ticket",
        ticketId: 10,
        afeNumber: "A1",
        workDate: "2026-10-16",
      });
      expect(r.billing?.unit).toBe(unit);
      await expect(
        recordFleetBillingCharge(f.client, actor, r),
      ).rejects.toMatchObject({ code: "fleet.billing_quantity_required" });
      expect(f.lines).toHaveLength(0);
      await recordFleetBillingCharge(f.client, actor, r, 2.5);
      expect(r.billing?.quantity).toBe(2.5);
      expect(
        f.query.mock.calls.find(([sql]) =>
          sql.startsWith("INSERT INTO ticket_line_items"),
        )?.[1]?.[3],
      ).toBe(2.5);
    },
  );
  it("projects catalog amounts only for the current Detail finance grant or company admin", async () => {
    const f = fixture(),
      member = { ...actor, membershipRole: "member" },
      query = {
        siteId: 9,
        fleetId: id,
        afeNumber: "A1",
        workDate: "2026-10-16",
      };
    expect(
      (await f.ops.billingOptions(member, query)).workTypes[0],
    ).toHaveProperty("rateCents", 1234);
    f.state.grants[0].roles = ["dispatcher"];
    f.state.grants[0].financeRead = false;
    expect((await f.ops.billingOptions(member, query)).workTypes[0]).toEqual({
      id: 3,
      name: "Synthetic haul",
      unit: "per_job",
      afeNumber: "A1",
    });
    expect(
      (await f.ops.billingOptions(actor, query)).workTypes[0],
    ).toHaveProperty("rateCents", 1234);
    f.state.grants[0].roles = ["fleet_manager"];
    f.state.grants[0].financeRead = true;
    expect(
      (
        await f.ops.billingOptions(member, {
          ...query,
          fleetId: "22222222-2222-4222-8222-222222222222",
        })
      ).workTypes[0],
    ).not.toHaveProperty("rateCents");
  });
});
