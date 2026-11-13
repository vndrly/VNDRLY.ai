import { describe, it, expect } from "vitest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { ticketWorkerTotals, equipmentTicketLocation, ticketMapContext } from "./ticket-map-summary";
const at = (hour: number) => `2026-11-12T${String(hour).padStart(2,"0")}:00:00Z`;
it("counts unique workers and merges overlapping sessions without losing separate workers' hours", () => {
  expect(ticketWorkerTotals([
    { employeeId: 1, checkInAt: at(6), checkOutAt: at(9) },
    { employeeId: 1, checkInAt: at(8), checkOutAt: at(10) },
    { employeeId: 2, checkInAt: at(8), checkOutAt: null },
  ], false, null, Date.parse(at(12)))).toEqual({ peopleCount: 2, onSiteCount: 1, totalOnSiteMinutes: 480 });
});
it("freezes completed work at the recorded finish and never invents time for missing finish evidence", () => {
  const people = [{ employeeId: 1, checkInAt: at(6), checkOutAt: null }];
  expect(ticketWorkerTotals(people, true, at(10), Date.parse(at(18)))).toEqual({ peopleCount: 1, onSiteCount: 0, totalOnSiteMinutes: 240 });
  expect(ticketWorkerTotals(people, true, null, Date.parse(at(18))).totalOnSiteMinutes).toBe(0);
});
it("keeps equipment positions inside the ticket association and historical cutoff", () => {
  const location = (hour: number) => ({ latitude: hour, longitude: -99, observedAt: at(hour), source: "manual" });
  const profile = { ticketId: 2, location: location(16), history: [
    { occurredAt: at(6), ticketId: 1, location: location(6) },
    { occurredAt: at(9), ticketId: 1, location: location(9) },
    { occurredAt: at(12), ticketId: 2, location: location(12) },
  ] };
  expect(equipmentTicketLocation(profile, 1, at(10))).toEqual(location(9));
  expect(equipmentTicketLocation(profile, 3, null)).toBeNull();
});
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("ticket map database scope", () => {
  it("reads existing yard/equipment/fleet stores without requiring schema changes or another company's locations", async () => {
    const tag = randomUUID();
    const vendor = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test',$2) RETURNING id", [tag, `${tag}@example.invalid`])).rows[0].id;
    const result = await ticketMapContext(987654321, vendor, {latitude: 27, longitude: -99}, null);
    expect(result.equipment).toEqual([]);
    expect(result.roadDistance).toEqual({ originName: null, miles: null, reason: "missing_origin" });
  });
});
