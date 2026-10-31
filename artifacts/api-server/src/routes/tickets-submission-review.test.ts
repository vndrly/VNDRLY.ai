import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { makeTicketRow } from "../test-utils/ticket-row";
import { buildTestCookie } from "../test-utils/session";
import { submissionDigest, type TicketSubmission } from "../lib/ticket-submissions";

const state = vi.hoisted(() => ({ row: {} as any, locked: {} as any, writes: [] as any[], transitions: [] as any[], invoice: vi.fn() }));
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const chain = (): any => {
    const q: any = { then: (resolve: any) => Promise.resolve([state.row]).then(resolve) };
    for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "for"]) q[method] = () => q;
    return q;
  };
  const db: any = {
    select: chain,
    execute: async () => ({ rows: [state.locked] }),
    transaction: async (fn: any) => fn(db),
    update: () => ({ set: (values: any) => ({ where: () => ({ returning: async () => {
      state.writes.push(values); Object.assign(state.row, values); return [state.row];
    } }) }) }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  };
  return { ...schema, db, pool: { query: async () => ({ rows: [] }) } };
});
vi.mock("../lib/field-ticket-access", () => ({
  loadFieldTicketAccessRow: async () => ({ vendorId: 11, partnerId: 1, fieldEmployeeId: null, foremanUserId: null }),
  fieldEmployeeCanAccessTicket: async () => false,
  ticketParticipantUserIdsExpanded: async () => ({ ids: [], vendorId: 11, partnerId: 1 }),
}));
vi.mock("../lib/invoice-generator", () => ({ enqueueInvoiceGenerationForTicket: state.invoice }));
vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(), notifyFieldEmployee: vi.fn(), findVendorUserIds: async () => [], findPartnerUserIds: async () => [],
}));

const partner = buildTestCookie({ userId: 20, role: "partner", partnerId: 1, vendorId: null, activeMembershipId: 4, membershipRole: "admin" });
const vendor = buildTestCookie({ userId: 10, role: "vendor", vendorId: 11, partnerId: null });
let app: express.Express;
beforeEach(async () => {
  state.row = makeTicketRow({ id: 42, partnerId: 1, vendorId: 11, status: "submitted" });
  const content: Omit<TicketSubmission, "digest"> = {
    revision: 2, submittedAt: "2026-10-30T12:00:00Z", submittedById: 10, ticketId: 42,
    jobId: 8, afe: "PARTNER-AFE", ticket: {}, job: {}, lineItems: [], notes: [], checkIns: [], gps: [], gate: null,
  };
  state.locked = { id: 42, role: "admin", status: "submitted", engagement_job_offer_id: 8, submission_revision: 2,
    proof_submissions: [{ ...content, digest: submissionDigest(content) }] };
  state.writes = []; state.transitions = []; state.invoice.mockClear();
  const router = (await import("./tickets")).default;
  app = express().use(cookieParser()).use(express.json()).use("/api", router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
});

describe("submitted proof review boundary", () => {
  it("does not let an AP-only membership approve work", async () => {
    state.locked.role = "ap";
    const response = await request(app).post("/api/tickets/42/approve").set("Cookie", partner).set("X-Submission-Revision", "2");
    expect(response.status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it("does not let the partner submit the vendor's claim", async () => {
    const response = await request(app).post("/api/tickets/42/submit").set("Cookie", partner);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ticket.vendor_submission_required");
  });
  it("requires the exact revision when returning work", async () => {
    const response = await request(app).post("/api/tickets/42/kickback").set("Cookie", partner).set("X-Submission-Revision", "1").send({ reason: "Missing coverage" });
    expect(response.status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it("records final rejection separately from a correctable kickback", async () => {
    const response = await request(app).post("/api/tickets/42/reject-submission").set("Cookie", partner).set("X-Submission-Revision", "2").send({ reason: "Work was not authorized" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(state.writes).toContainEqual(expect.objectContaining({ status: "denied", kickbackReason: "Work was not authorized" }));
    expect(state.invoice).not.toHaveBeenCalled();
  });
  it("prevents the vendor from kicking back its own submission", async () => {
    const response = await request(app).post("/api/tickets/42/kickback").set("Cookie", vendor).send({ reason: "Return this" });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ticket.partner_review_required");
    expect(state.writes).toHaveLength(0);
  });
  it("rejects approval of a stale revision", async () => {
    const response = await request(app).post("/api/tickets/42/approve").set("Cookie", partner).set("X-Submission-Revision", "1");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ticket.submission_changed");
    expect(state.writes).toHaveLength(0);
  });
  it("rejects approval if the status changed while the reviewer was acting", async () => {
    state.locked.status = "cancelled";
    const response = await request(app).post("/api/tickets/42/approve").set("Cookie", partner).set("X-Submission-Revision", "2");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ticket.submission_changed");
    expect(state.writes).toHaveLength(0);
  });
  it("does not let a linked job use the historical no-proof approval path", async () => {
    state.locked.submission_revision = 0; state.locked.proof_submissions = null;
    state.row.status = state.locked.status = "pending_review";
    const response = await request(app).post("/api/tickets/42/approve").set("Cookie", partner);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ticket.proof_required");
    expect(state.writes).toHaveLength(0);
  });
  it("records the exact approved revision and schedules billing only after approval", async () => {
    const response = await request(app).post("/api/tickets/42/approve").set("Cookie", partner).set("X-Submission-Revision", "2");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(state.writes).toContainEqual(expect.objectContaining({ status: "approved", approvedSubmissionRevision: 2 }));
    expect(state.invoice).toHaveBeenCalledWith(42);
  });
});
