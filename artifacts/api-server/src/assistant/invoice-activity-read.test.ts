import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { readInvoiceActivity } from "./invoice-activity-read";
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
const now = new Date("2026-10-07T12:00:00Z");
type Row = { kind: string; recordId: string | null; eventId: string | null; at: string | null; records: string; undated: string };
const empty = (): Row[] => ["manual_issue", "ticket_send_attempt", "provider_acceptance"].map(kind => ({ kind, recordId: null, eventId: null, at: null, records: "0", undated: "0" }));
function harness(rows = empty(), authorized = true, roles: string[] = []) {
  const query = vi.fn(async (text: string) => ({ rows: text.startsWith("SELECT u.id") ? authorized ? [{ id: 17 }] : [] : text.startsWith("SELECT data") ? [{ data: { roles } }] : text.startsWith("WITH events") ? rows : [] }));
  const release = vi.fn();
  const database = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pick<Pool, "connect">;
  return { database, query, release };
}
it("uses full company chronology and distinct issue/attempt/acceptance evidence for strict >15 days", async () => {
  const rows = empty(); rows[0] = { kind: "manual_issue", recordId: "uuid", eventId: "uuid", at: "2026-09-01T12:00:00Z", records: "2", undated: "0" };
  rows[1] = { kind: "ticket_send_attempt", recordId: "8", eventId: null, at: "2026-09-22T12:00:00Z", records: "1", undated: "0" };
  const h = harness(rows), result = await readInvoiceActivity({}, session, ["finance:read"], h.database, now);
  expect(result).toMatchObject({ state: "observed", elapsedDays: 15, exceeds15Days: false, preparationRecommended: false, draftPrepared: false, deliveryVerified: false });
  expect(result.events[2]).toMatchObject({ observedRecords: 0, latestAt: null });
  const sql = h.query.mock.calls.find(([text]) => text.startsWith("WITH events"))![0];
  expect(sql).toContain("i.vendor_id=$2"); expect(sql).not.toContain("created_at"); expect(sql).toContain("l.failure_message IS NULL"); expect(sql).toContain("NULLIF(trim(l.sendgrid_message_id),'') IS NOT NULL");
  expect((await readInvoiceActivity({}, session, ["finance:read"], h.database, new Date(now.getTime() + 1))).preparationRecommended).toBe(true);
});
it("distinguishes no recorded history from unknown undated legacy history", async () => {
  const h = harness(); expect(await readInvoiceActivity({}, session, ["finance:read"], h.database, now)).toMatchObject({ state: "no_recorded_event", exceeds15Days: null, preparationRecommended: false });
  const rows = empty(); rows[1].records = "1"; rows[1].undated = "1";
  expect(await readInvoiceActivity({}, session, ["finance:read"], harness(rows).database, now)).toMatchObject({ state: "unknown", exceeds15Days: null, preparationRecommended: false });
  const acceptance = empty(); acceptance[2].records = "1"; acceptance[2].undated = "1";
  expect(await readInvoiceActivity({ basis: "provider_acceptance" }, session, ["finance:read"], harness(acceptance).database, now)).toMatchObject({ state: "unknown", latestAt: null, preparationRecommended: false });
});
it("uses the latest logged retry even when first sentAt is older and the retry was failed or stubbed", async () => {
  const rows = empty(); rows[1] = { kind: "ticket_send_attempt", recordId: "8", eventId: "44", at: "2026-10-06T12:00:00Z", records: "2", undated: "0" };
  const h = harness(rows), result = await readInvoiceActivity({}, session, ["finance:read"], h.database, now);
  expect(result).toMatchObject({ latestAt: "2026-10-06T12:00:00.000Z", elapsedDays: 1, preparationRecommended: false });
  expect(result.events[1].sourceReference).toBe("invoices:8/invoice_send_log:44");
  const sql = h.query.mock.calls.find(([text]) => text.startsWith("WITH events"))![0];
  expect(sql).toContain("SELECT 'ticket_send_attempt',i.id::text,l.id::text,l.sent_at::text FROM invoice_send_log");
  expect(sql).toContain("AND NOT EXISTS(SELECT 1 FROM invoice_send_log l WHERE l.invoice_id=i.id)");
  const attemptQuery = sql.split("UNION ALL SELECT 'ticket_send_attempt'")[1].split("UNION ALL")[0];
  expect(attemptQuery).not.toContain("failure_message"); expect(attemptQuery).not.toContain("sendgrid_message_id");
});
it("refuses removed scope, current authority mismatch, field roles and missing billing grants", async () => {
  const h = harness(); await expect(readInvoiceActivity({}, session, [], h.database, now)).rejects.toThrow(); expect(h.database.connect).not.toHaveBeenCalled();
  await expect(readInvoiceActivity({}, { ...session, role: "field_employee" }, ["finance:read"], h.database, now)).rejects.toThrow();
  const denied = harness(empty(), false); await expect(readInvoiceActivity({}, session, ["finance:read"], denied.database, now)).rejects.toThrow("current_authority"); expect(denied.query).not.toHaveBeenCalledWith(expect.stringContaining("WITH events")); expect(denied.release).toHaveBeenCalled();
  await expect(readInvoiceActivity({}, { ...session, membershipRole: "member" }, ["finance:read"], harness().database, now)).rejects.toThrow("billing_permission");
  expect(await readInvoiceActivity({}, { ...session, membershipRole: "member" }, ["finance:read"], harness(empty(), true, ["billing_manager"]).database, now)).toMatchObject({ state: "no_recorded_event" });
});
it("rejects invalid/future evidence and unbounded or foreign-company request inputs", async () => {
  const rows = empty(); rows[0] = { kind: "manual_issue", recordId: "uuid", eventId: "uuid", at: "2026-10-08T12:00:00Z", records: "1", undated: "0" };
  await expect(readInvoiceActivity({}, session, ["finance:read"], harness(rows).database, now)).rejects.toThrow("invalid_evidence");
  const h = harness(); await expect(readInvoiceActivity({ vendorId: 9 }, session, ["finance:read"], h.database, now)).rejects.toThrow(); expect(h.database.connect).not.toHaveBeenCalled();
  expect(await readInvoiceActivity({ basis: "provider_acceptance" }, session, ["finance:read"], harness().database, now)).toMatchObject({ state: "no_recorded_event", preparationRecommended: false });
});
