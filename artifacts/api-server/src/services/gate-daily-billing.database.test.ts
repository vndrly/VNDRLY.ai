import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { createGateDailyBillingRouter } from "../routes/gateDailyBilling";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { createGateDailyBillingService } from "./gate-daily-billing";
import { generateInvoiceForTicket } from "../lib/invoice-generator";
import { reviewedSubmission } from "../lib/ticket-submissions";
const now = () => new Date("2026-10-03T15:00:00Z"),
  service = createGateDailyBillingService({ now });
async function approveSubmittedProof(ticketId: number) {
  const row = (await pool.query(
    "SELECT id,submission_revision,proof_submissions FROM tickets WHERE id=$1",
    [ticketId],
  )).rows[0];
  const proof = reviewedSubmission(row, row.submission_revision);
  expect(proof).not.toBeNull();
  const approved = await pool.query(
    "UPDATE tickets SET status='approved',approved_at=$2,approved_submission_revision=$3 WHERE id=$1 AND status='submitted' AND submission_revision=$3 RETURNING id",
    [ticketId, now(), proof!.revision],
  );
  expect(approved.rowCount).toBe(1);
  return proof!;
}
async function fixture() {
  const label = randomUUID(),
    partner = (
      await pool.query(
        "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",
        [label],
      )
    ).rows[0].id,
    vendor = (
      await pool.query(
        "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",
        [label],
      )
    ).rows[0].id;
  const site = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code,afe) VALUES($1,'Test Gate Site','Synthetic',35,-97,$2,'TEST-AFE') RETURNING id",
        [partner, label],
      )
    ).rows[0].id,
    station = (
      await pool.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,'Main test gate') RETURNING id",
        [site],
      )
    ).rows[0].id,
    workType = (
      await pool.query(
        "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
        [label],
      )
    ).rows[0].id;
  await pool.query(
    "INSERT INTO site_work_assignments(site_location_id,vendor_id,work_type_id,is_gate_contractor) VALUES($1,$2,$3,true)",
    [site, vendor, workType],
  );
  await pool.query(
    "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,unit) VALUES($1,$2,'999.99','per_day')",
    [vendor, workType],
  );
  const approval = (await pool.query(
    "INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_unit_price,approved_unit) VALUES($1,$2,$3,'100.01','per_day') RETURNING id,approved_at",
    [partner, vendor, workType],
  )).rows[0];
  const user = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'synthetic-not-a-login','vendor','Gate Billing Test') RETURNING id",
        [label],
      )
    ).rows[0].id,
    membership = (
      await pool.query(
        "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",
        [user, vendor],
      )
    ).rows[0].id,
    session: SessionPayload = {
      userId: user,
      role: "vendor",
      vendorId: vendor,
      activeMembershipId: membership,
      membershipRole: "admin",
      sv: 1,
    };
  await pool.query(
    "INSERT INTO gate_duty_sessions(station_id,user_id,started_at,source,idempotency_key,post_coverage) VALUES($1,$2,'2026-10-01T17:00:00Z','web',$3,$4::jsonb)",
    [station, user, randomUUID(), JSON.stringify({ vendorId: vendor })],
  );
  // Retained historical agreement: new setups now require an accepted job,
  // while these regression tests exercise grandfathered period continuity.
  await pool.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'vendor','gate-billing','typed','canonical','gate_daily_billing','office-billing','gate-billing-config',$3,$4::jsonb,'completed')",
    [user, vendor, station, JSON.stringify({ version: 1, stationId: station, vendorId: vendor, partnerId: partner, siteId: site, workTypeId: workType, periodStartDay: "2026-10-01", openTicketId: null, agreementReference: "Retained historical agreement", partialDayRule: "full_day", dailyRateCents: 10001, approvalId: approval.id, approvalAt: new Date(approval.approved_at).toISOString(), afe: "TEST-AFE", lastBilledThroughDay: null, autoInvoiceEveryDays: null, directionActor: null })],
  );
  const configure = () =>
    service.configure(session, station, {
      operationId: randomUUID(),
      expectedVersion: 1,
      workTypeId: workType,
      startDay: "2026-10-01",
      agreementReference: "Synthetic day-rate agreement",
      partialDayRule: "full_day",
      confirmedUnbilledStart: true,
      autoInvoiceEveryDays: null,
    });
  return { vendor, partner, site, station, workType, session, configure };
}
beforeAll(() => {
  if (process.env.VNDRLY_ISOLATED_TEST_DB !== "1")
    throw Error("Use retained fresh-local test database");
});
describe("Gate office daily billing transaction", () => {
  it("refuses disabled or superseded scheduled direction even when its current quote is otherwise billable", async () => {
    const f = await fixture(),
      saved = await f.configure(),
      quote = await service.preview(f.session, f.station);
    await expect(
      service.invoiceNow(
        f.session,
        f.station,
        {
          operationId: randomUUID(),
          expectedVersion: saved.version,
          previewFingerprint: quote.fingerprint,
          continueBilling: true,
          acknowledgeCoverageGaps: true,
          minimumCompletedDays: 1,
        },
        "scheduled",
      ),
    ).rejects.toMatchObject({
      code: "gate_billing.schedule_direction_changed",
    });
    expect(
      (
        await pool.query("SELECT status FROM tickets WHERE id=$1", [
          saved.openTicketId,
        ])
      ).rows[0].status,
    ).toBe("initiated");
  });
  it("refuses explicit partner revocation without deleting the historical period or generating a new bill", async () => {
    const f = await fixture(),
      saved = await f.configure(),
      quote = await service.preview(f.session, f.station);
    await pool.query(
      "INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'revoked')",
      [f.partner, f.vendor],
    );
    await expect(
      service.invoiceNow(f.session, f.station, {
        operationId: randomUUID(),
        expectedVersion: saved.version,
        previewFingerprint: quote.fingerprint,
        continueBilling: true,
        acknowledgeCoverageGaps: true,
        minimumCompletedDays: null,
      }),
    ).rejects.toMatchObject({
      code: "gate_billing.commercial_authority_revoked",
    });
    expect(
      (await service.preview(f.session, f.station)).config.openTicketId,
    ).toBe(saved.openTicketId);
    const other = await fixture();
    await pool.query(
      "INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'revoked')",
      [other.partner, other.vendor],
    );
    await expect(other.configure()).rejects.toMatchObject({
      code: "gate_billing.commercial_authority_revoked",
    });
  });

  it("keeps the closed period's rate, AFE and payer while adopting newly approved terms only for the continuation", async () => {
    const f = await fixture(),
      saved = await f.configure();
    await pool.query(
      "UPDATE partner_vendor_work_type_approvals SET approved_unit_price='125.00',approved_at='2026-10-03T10:00:00Z' WHERE vendor_id=$1",
      [f.vendor],
    );
    await pool.query(
      "UPDATE site_work_assignments SET afe='NEXT-AFE' WHERE vendor_id=$1",
      [f.vendor],
    );
    const quote = await service.preview(f.session, f.station);
    expect(quote.period.totalCents).toBe(20002);
    const result = await service.invoiceNow(f.session, f.station, {
      operationId: randomUUID(),
      expectedVersion: saved.version,
      previewFingerprint: quote.fingerprint,
      continueBilling: true,
      acknowledgeCoverageGaps: true,
      minimumCompletedDays: null,
    });
    const next = (await service.preview(f.session, f.station)).config;
    expect(next).toMatchObject({ dailyRateCents: 12500, afe: "NEXT-AFE" });
    const approvedProof = await approveSubmittedProof(result.ticketId!);
    const invoice = await generateInvoiceForTicket(result.ticketId!);
    expect(invoice.ok).toBe(true);
    if (!invoice.ok) throw Error(invoice.reason);
    expect(
      (
        await pool.query(
          "SELECT DISTINCT afe FROM invoice_lines WHERE invoice_id=$1",
          [invoice.invoiceId],
        )
      ).rows,
    ).toEqual([{ afe: "TEST-AFE" }]);
    const changed = (
      await pool.query(
        "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    await pool.query("UPDATE site_locations SET partner_id=$2 WHERE id=$1", [
      f.site,
      changed,
    ]);
    // A later site transfer cannot rewrite the payer of the approved proof.
    expect(await generateInvoiceForTicket(result.ticketId!)).toMatchObject({
      ok: true,
      invoiceId: invoice.invoiceId,
    });
    expect((await pool.query("SELECT partner_id FROM invoices WHERE id=$1", [invoice.invoiceId])).rows)
      .toEqual([{ partner_id: f.partner }]);
    expect((await pool.query("SELECT proof_submissions FROM tickets WHERE id=$1", [result.ticketId])).rows[0].proof_submissions)
      .toEqual([approvedProof]);
    await expect(service.preview(f.session, f.station)).rejects.toMatchObject({
      code: "gate_billing.context_changed",
    });
  });

  it("retains canonical conditional no-op receipts and reads them only in the authorized post", async () => {
    const f = await fixture(),
      saved = await f.configure(),
      quote = await service.preview(f.session, f.station),
      operationId = randomUUID(),
      input = {
        operationId,
        expectedVersion: saved.version,
        previewFingerprint: quote.fingerprint,
        continueBilling: true,
        acknowledgeCoverageGaps: true,
        minimumCompletedDays: 31,
      };
    const result = await service.invoiceNow(f.session, f.station, input);
    expect(result.status).toBe("not_due");
    const receipt = await service.receipt(f.session, f.station, operationId);
    expect(receipt).toMatchObject({
      state: "completed",
      operationId,
      stationId: f.station,
      result: { status: "not_due" },
    });
    expect(await service.invoiceNow(f.session, f.station, input)).toEqual(
      result,
    );
    const other = await fixture();
    await expect(
      service.receipt(other.session, f.station, operationId),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await service.receipt(f.session, f.station, randomUUID()),
    ).toMatchObject({ state: "not_found", result: null });
  });

  it("exposes one authenticated HTTP preview/close path without accepting a client company, rate or cutoff", async () => {
    const f = await fixture();
    await f.configure();
    const app = express();
    app.use(
      express.json(),
      cookieParser(),
      createGateDailyBillingRouter(service),
    );
    const cookie = buildTestCookie(f.session);
    expect((await request(app).get("/gate-billing/posts")).status).toBe(401);
    const quote = await request(app)
      .get(`/gate-billing/${f.station}/preview`)
      .set("Cookie", cookie);
    expect(quote.status).toBe(200);
    expect(quote.headers["cache-control"]).toContain("no-store");
    expect(quote.body.config).not.toHaveProperty("directionActor");
    const input = {
      operationId: randomUUID(),
      expectedVersion: quote.body.config.version,
      previewFingerprint: quote.body.fingerprint,
      continueBilling: true,
      acknowledgeCoverageGaps: true,
    };
    expect(
      (
        await request(app)
          .post(`/gate-billing/${f.station}/invoice-now`)
          .set("Cookie", cookie)
          .send({ ...input, vendorId: 999, cutoff: "2099-01-01" })
      ).status,
    ).toBe(400);
    const saved = await request(app)
      .post(`/gate-billing/${f.station}/invoice-now`)
      .set("Cookie", cookie)
      .send(input);
    expect(saved.status).toBe(200);
    expect(saved.body.status).toBe("submitted");
    expect(saved.body.invoiceStatus).toBe("awaiting_partner_approval");
  });

  it("lists only office-authorized posts and approved daily services for setup", async () => {
    const f = await fixture(),
      other = await fixture(),
      posts = await service.posts(f.session, {});
    expect(posts.items.some((post) => post.id === f.station)).toBe(true);
    expect(posts.items.some((post) => post.id === other.station)).toBe(false);
    const setup = await service.setup(f.session, f.station);
    expect(setup.config).toMatchObject({
      version: 1, openTicketId: null, agreementReference: "Retained historical agreement",
      afe: "TEST-AFE", partnerId: f.partner, vendorId: f.vendor, siteId: f.site,
    });
    expect(setup.config).not.toHaveProperty("jobOfferId");
    expect(setup.services).toMatchObject([
      { id: f.workType, dailyRateCents: 10001 },
    ]);
    await expect(service.setup(other.session, f.station)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it("runs only explicitly saved due schedules, verifies live office authority and never repeats a billed period", async () => {
    const f = await fixture();
    await pool.query(
      "UPDATE gate_duty_sessions SET started_at='2026-10-01T05:00:00Z' WHERE station_id=$1",
      [f.station],
    );
    await service.configure(f.session, f.station, {
      operationId: randomUUID(),
      expectedVersion: 1,
      workTypeId: f.workType,
      startDay: "2026-10-01",
      agreementReference: "Explicit scheduled test agreement",
      partialDayRule: "full_day",
      confirmedUnbilledStart: true,
      autoInvoiceEveryDays: 2,
    });
    await pool.query(
      "UPDATE users SET session_version=session_version+1 WHERE id=$1",
      [f.session.userId],
    );
    const first = await service.runDue();
    expect(
      first.some(
        (row) => row.stationId === f.station && row.status === "submitted",
      ),
    ).toBe(true);
    const refreshed = { ...f.session, sv: f.session.sv! + 1 };
    const after = (await service.preview(refreshed, f.station)).config;
    expect(after.lastBilledThroughDay).toBe("2026-10-02");
    await service.runDue();
    expect((await service.preview(refreshed, f.station)).config.version).toBe(
      after.version,
    );
    const revoked = await fixture();
    await service.configure(revoked.session, revoked.station, {
      operationId: randomUUID(),
      expectedVersion: 1,
      workTypeId: revoked.workType,
      startDay: "2026-10-01",
      agreementReference: "Revoked authorization test",
      partialDayRule: "full_day",
      confirmedUnbilledStart: true,
      autoInvoiceEveryDays: 2,
    });
    await pool.query(
      "UPDATE user_org_memberships SET role='member' WHERE id=$1",
      [revoked.session.activeMembershipId],
    );
    const result = await service.runDue();
    expect(
      result.some(
        (row) =>
          row.stationId === revoked.station && row.status === "review_required",
      ),
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM tickets WHERE vendor_id=$1 AND status='submitted'",
          [revoked.vendor],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("uses partner-approved daily terms, closes only completed days, continues the ticket, and leaves Gate coverage untouched", async () => {
    const f = await fixture(),
      config = await f.configure(),
      preview = await service.preview(f.session, f.station);
    expect(config.dailyRateCents).toBe(10001);
    expect(preview.period).toMatchObject({
      totalCents: 20002,
      billableDays: 2,
      throughDay: "2026-10-02",
    });
    const command = {
      operationId: randomUUID(),
      expectedVersion: config.version,
      previewFingerprint: preview.fingerprint,
      continueBilling: true,
      acknowledgeCoverageGaps: true,
      minimumCompletedDays: null,
    };
    const [a, b] = await Promise.all([
      service.invoiceNow(f.session, f.station, command),
      service.invoiceNow(f.session, f.station, command),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      status: "submitted",
      ticketId: config.openTicketId,
      billedThroughDay: "2026-10-02",
      invoiceStatus: "awaiting_partner_approval",
    });
    expect(a.nextTicketId).not.toBeNull();
    const closed = (
      await pool.query(
        "SELECT status,lifecycle_state,closed_at FROM tickets WHERE id=$1",
        [a.ticketId],
      )
    ).rows[0];
    expect(closed.status).toBe("submitted");
    expect(closed.lifecycle_state).toBe("off_site");
    expect(new Date(closed.closed_at).toISOString()).toBe(
      "2026-10-03T05:00:00.000Z",
    );
    expect(
      (
        await pool.query(
          "SELECT ended_at FROM gate_duty_sessions WHERE station_id=$1",
          [f.station],
        )
      ).rows[0].ended_at,
    ).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT sum(quantity*unit_price)::text AS amount FROM ticket_line_items WHERE ticket_id=$1",
          [a.ticketId],
        )
      ).rows[0].amount,
    ).toBe("200.0200");
    expect(
      (await service.preview(f.session, f.station)).period.days,
    ).toHaveLength(0);
    await expect(
      service.invoiceNow(f.session, f.station, {
        ...command,
        operationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "gate_billing.version_conflict" });
    expect(await generateInvoiceForTicket(a.ticketId!)).toMatchObject({
      ok: false,
      reason: "ticket_status_not_approved:submitted",
    });
    expect(
      (
        await pool.query(
          "SELECT to_status FROM ticket_status_history WHERE ticket_id=$1 ORDER BY id",
          [a.ticketId],
        )
      ).rows.map((row) => row.to_status),
    ).toEqual(["initiated", "pending_review", "submitted"]);
    // Review the actual saved proof revision before canonical invoicing.
    await approveSubmittedProof(a.ticketId!);
    const invoice = await generateInvoiceForTicket(a.ticketId!);
    expect(invoice.ok).toBe(true);
    if (!invoice.ok) throw Error(invoice.reason);
    expect(
      (
        await pool.query("SELECT total FROM invoices WHERE id=$1", [
          invoice.invoiceId,
        ])
      ).rows[0].total,
    ).toBe("200.02");
    const again = await generateInvoiceForTicket(a.ticketId!);
    expect(again).toMatchObject({ ok: true, invoiceId: invoice.invoiceId });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM invoice_ticket_links WHERE ticket_id=$1",
          [a.ticketId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("does not invent an invoice for a conditional request before 30 completed days and never trusts another company or demo", async () => {
    const f = await fixture(),
      config = await f.configure(),
      preview = await service.preview(f.session, f.station),
      result = await service.invoiceNow(f.session, f.station, {
        operationId: randomUUID(),
        expectedVersion: config.version,
        previewFingerprint: preview.fingerprint,
        continueBilling: true,
        acknowledgeCoverageGaps: true,
        minimumCompletedDays: 30,
      });
    expect(result.status).toBe("not_due");
    expect((await service.preview(f.session, f.station)).config.version).toBe(
      config.version,
    );
    const other = await fixture();
    await expect(
      service.preview(other.session, f.station),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.configure({ ...f.session, realm: "demo" }, f.station, {
        operationId: randomUUID(),
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("refuses stale coverage previews, client operation reuse with changed input, and a revoked billing membership", async () => {
    const f = await fixture(),
      config = await f.configure(),
      preview = await service.preview(f.session, f.station),
      command = {
        operationId: randomUUID(),
        expectedVersion: config.version,
        previewFingerprint: preview.fingerprint,
        continueBilling: false,
        acknowledgeCoverageGaps: true,
        minimumCompletedDays: null,
      };
    await pool.query(
      "UPDATE gate_duty_sessions SET started_at='2026-10-02T05:00:00Z' WHERE station_id=$1",
      [f.station],
    );
    await expect(
      service.invoiceNow(f.session, f.station, command),
    ).rejects.toMatchObject({ code: "gate_billing.preview_changed" });
    const refreshed = await service.preview(f.session, f.station);
    const saved = await service.invoiceNow(f.session, f.station, {
      ...command,
      previewFingerprint: refreshed.fingerprint,
    });
    expect(saved.nextTicketId).toBeNull();
    await expect(
      service.invoiceNow(f.session, f.station, {
        ...command,
        previewFingerprint: refreshed.fingerprint,
        continueBilling: true,
      }),
    ).rejects.toMatchObject({ code: "gate_billing.operation_conflict" });
    await pool.query(
      "UPDATE user_org_memberships SET role='member' WHERE id=$1",
      [f.session.activeMembershipId],
    );
    await expect(service.preview(f.session, f.station)).rejects.toMatchObject({
      status: 403,
    });
  });
});
