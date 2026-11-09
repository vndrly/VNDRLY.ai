import { beforeEach, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../lib/create-ticket", () => ({ createTicketWithHistory: create }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: (client: unknown) => client }));
import { ensureGateWatchTicket, gateWatchTicketReadiness } from "./gate-watch-ticket";

beforeEach(() => create.mockReset().mockResolvedValue({ id: 99 }));

function fixture() {
  const duty = { id: "duty", watch_id: "watch", started_at: new Date(), post_coverage: { vendorId: 7 } as Record<string, unknown> };
  const shifts = [{ id: "shift", ticket_number: null, starts_at: new Date(), ends_at: new Date(Date.now() + 3600000) }];
  const services: unknown[] = [{ work_type_id: 12 }];
  const jobs: unknown[] = [];
  const existing: unknown[] = [{ id: 99 }];
  const relationship = { status: "approved" };
  let saved: Record<string, unknown> | null = null;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT d.id")) return { rows: [duty] };
    if (sql.startsWith("SELECT s.id")) return { rows: shifts };
    if (sql.startsWith("SELECT r.status")) return { rows: [relationship] };
    if (sql.startsWith("SELECT a.work_type_id")) return { rows: services };
    if (sql.startsWith("SELECT j.id")) return { rows: jobs };
    if (sql.startsWith("SELECT t.id")) return { rows: existing };
    if (sql.startsWith("SELECT p.id")) return { rows: [{ id: 6 }] };
    if (sql.startsWith("UPDATE gate_duty_sessions")) {
      saved = JSON.parse(params![3] as string);
      Object.assign(duty.post_coverage, saved);
      return { rows: [] };
    }
    throw new Error(`Unexpected query ${sql}`);
  });
  return { client: { query } as unknown as PoolClient, query, duty, shifts, services, jobs, existing, relationship, saved: () => saved };
}
const session = { userId: 8, vendorId: 7, role: "vendor", sv: 1 };

it("opens a real ticket with coherent pending-arrival semantics and saves all watch context", async () => {
  const f = fixture();
  expect(await ensureGateWatchTicket(f.client, session, "station", 5)).toEqual({ ticketId: 99, ticketBlocker: null, shiftId: "shift" });
  expect(create).toHaveBeenCalledWith(f.client, expect.objectContaining({ vendorId: 7, siteLocationId: 5, workTypeId: 12, fieldEmployeeId: 6, status: "initiated" }), expect.objectContaining({ reason: "gate_watch_assumed:watch" }));
  expect(create.mock.calls[0][1]).not.toHaveProperty("checkInTime");
  expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining("source_legacy_shift_id=$3"), ["duty", "shift", "watch", JSON.stringify({ ticketId: 99, ticketBlocker: null })]);
});

it("rechecks and reuses the saved ticket on retries instead of creating another", async () => {
  const f = fixture();
  await ensureGateWatchTicket(f.client, session, "station", 5);
  await ensureGateWatchTicket(f.client, session, "station", 5);
  expect(create).toHaveBeenCalledOnce();
  expect(f.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE OF d,w"))).toBe(true);
});

it("never invents ticket confirmation when approved setup is missing or ambiguous", async () => {
  for (const candidates of [[], [{ work_type_id: 12 }, { work_type_id: 13 }]]) {
    const f = fixture();
    f.services.splice(0, f.services.length, ...candidates);
    const result = await ensureGateWatchTicket(f.client, session, "station", 5);
    expect(result.ticketId).toBeNull();
    expect(result.ticketBlocker).toMatch(/gate_ticket\.(approved_service_required|ambiguous_service)/);
    expect(f.saved()?.ticketId).toBeNull();
  }
  expect(create).not.toHaveBeenCalled();
});

it("refuses employer changes and multiple simultaneous shift matches", async () => {
  const f = fixture();
  f.duty.post_coverage.vendorId = 70;
  expect((await ensureGateWatchTicket(f.client, session, "station", 5)).ticketBlocker).toBe("gate_ticket.employer_changed");
  f.duty.post_coverage.vendorId = 7;
  f.shifts.push({ ...f.shifts[0], id: "other" });
  expect((await ensureGateWatchTicket(f.client, session, "station", 5)).ticketBlocker).toBe("gate_ticket.ambiguous_shift");
  expect(create).not.toHaveBeenCalled();
});

it("uses accepted job identity and its commercial snapshot when blanket catalog approval is absent", async () => {
  const f = fixture();
  f.services.length = 0;
  f.jobs.push({ id: 41, work_type_id: 12, canonical_service_id: 2, vendor_capability_id: 3, vendor_partner_service_offer_id: 4 });
  await ensureGateWatchTicket(f.client, session, "station", 5);
  expect(create.mock.calls[0][1]).toMatchObject({ engagementJobOfferId: 41, canonicalServiceId: 2, vendorCapabilityId: 3, vendorPartnerServiceOfferId: 4 });
  expect(f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT j.id"))?.[0]).toContain("snapshot.scope_snapshot->>'afeCode'");
});

it("blocks revoked relationships and unavailable explicit tickets", async () => {
  const f = fixture();
  f.relationship.status = "revoked";
  expect((await ensureGateWatchTicket(f.client, session, "station", 5)).ticketBlocker).toBe("gate_ticket.commercial_authority_revoked");
  f.relationship.status = "approved";
  f.duty.post_coverage.ticketId = 123;
  f.existing.length = 0;
  expect((await ensureGateWatchTicket(f.client, session, "station", 5)).ticketBlocker).toBe("gate_ticket.scheduled_ticket_unavailable");
  const sql = f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT t.id"))![0];
  expect(sql).toContain("t.vendor_id=$2 AND t.site_location_id=$3");
  expect(create).not.toHaveBeenCalled();
});

it("lets the helper preflight setup without row locks or mutations", async () => {
  const f = fixture();
  expect((await gateWatchTicketReadiness(f.client, session, "station", 5)).ticketBlocker).toBeNull();
  expect(f.query.mock.calls.every(([sql]) => !/FOR (SHARE|UPDATE)|INSERT|UPDATE gate/.test(sql))).toBe(true);
  expect(create).not.toHaveBeenCalled();
});

it("deduplicates repeated join rows for the same approved service", async () => {
  const f = fixture();
  f.services.push({ work_type_id: 12 });
  expect((await ensureGateWatchTicket(f.client, session, "station", 5)).ticketId).toBe(99);
  expect(create).toHaveBeenCalledOnce();
});
