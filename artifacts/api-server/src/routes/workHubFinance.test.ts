import { randomUUID, createHash } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  usersTable,
  vendorsTable,
  userOrgMembershipsTable,
  workHubFinanceRecordsTable,
  workHubFilesTable,
} from "@workspace/db";
import finance from "./workHubFinance";
import { buildTestCookie } from "../test-utils/session";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
const app = express().use(express.json()).use(cookieParser()).use(finance);
const payrollPdf = Buffer.from("%PDF-1.4 issued payroll fixture");
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class { async getStoredObject() { return { body: Buffer.from("%PDF-1.4 issued payroll fixture") }; } } }));
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")(
  "durable company finance",
  () => {
    let ownerId: number,
      adminId: number,
      memberId: number,
      admin: string,
      member: string,
      foreign: string,
      invoiceId: string,
      paymentId: string;
    const envelope = <T>(payload: T, operationId: string = randomUUID()) => ({
      owner: { type: "vendor", id: ownerId },
      context: { kind: "organization", id: ownerId },
      payloadVersion: 1,
      expectedVersion: null,
      operationId,
      payload,
    });
    const post = (action: string, cookie: string, payload: unknown) =>
      request(app)
        .post(`/work-hub/finance/${action}`)
        .set("Cookie", cookie)
        .set("x-vndrly-client", "web")
        .send(envelope(payload));
    beforeAll(async () => {
      const suffix = randomUUID();
      const companies = await db
        .insert(vendorsTable)
        .values(
          ["A", "B"].map((n) => ({
            name: `Finance ${n} ${suffix}`,
            contactName: "Test",
            contactEmail: `${n}.${suffix}@example.invalid`,
          })),
        )
        .returning();
      ownerId = companies[0]!.id;
      const people = await db
        .insert(usersTable)
        .values(
          ["Admin", "Member", "External"].map((n) => ({
            username: `${n}.${suffix}`,
            displayName: n,
            passwordHash: "unused-test-hash",
            role: "vendor",
          })),
        )
        .returning();
      [adminId, memberId] = people.map((p) => p.id) as [number, number];
      await db.insert(userOrgMembershipsTable).values([
        {
          userId: adminId,
          orgType: "vendor",
          vendorId: ownerId,
          role: "admin",
        },
        {
          userId: memberId,
          orgType: "vendor",
          vendorId: ownerId,
          role: "member",
        },
        {
          userId: people[2]!.id,
          orgType: "vendor",
          vendorId: companies[1]!.id,
          role: "admin",
        },
      ]);
      admin = buildTestCookie({
        userId: adminId,
        role: "vendor",
        vendorId: ownerId,
        membershipRole: "admin",
      });
      member = buildTestCookie({
        userId: memberId,
        role: "vendor",
        vendorId: ownerId,
        membershipRole: "admin",
      });
      foreign = buildTestCookie({
        userId: people[2]!.id,
        role: "vendor",
        vendorId: ownerId,
        membershipRole: "admin",
      });
    });
    it("limits issued payroll PDFs to their recipient, never company administrators", async () => {
      const endpoint = "/work-hub/finance/personal-documents";
      expect((await request(app).get(endpoint)).status).toBe(401);
      const empty = await request(app).get(endpoint).set("Cookie", member);
      expect(empty.body).toMatchObject({ providerConfigured: false, documents: [] });
      const fileId = randomUUID(), documentId = randomUUID();
      await db.insert(workHubFilesTable).values({ id: fileId, ownerOrgType: "vendor", ownerOrgId: ownerId, uploadedById: adminId, storageKey: `/objects/uploads/${randomUUID()}`, fileName: "private.pdf", contentType: "application/pdf", byteSize: payrollPdf.length, checksumSha256: createHash("sha256").update(payrollPdf).digest("hex"), state: "payroll_issued" });
      await db.insert(workHubFinanceRecordsTable).values({ id: documentId, orgType: "vendor", orgId: ownerId, kind: "payroll_document", recordKey: randomUUID(), createdBy: adminId, data: { recipientUserId: memberId, documentType: "w2", provider: "test-issued-provider", providerDocumentId: "issued-reference", state: "issued", issuedAt: new Date().toISOString(), taxYear: 2025, fileId } });
      const own = await request(app).get(endpoint).set("Cookie", member);
      expect(own.body.documents).toEqual([expect.objectContaining({ id: documentId, documentType: "w2", taxYear: 2025 })]);
      expect(JSON.stringify(own.body)).not.toContain("storageKey");
      expect(JSON.stringify(own.body)).not.toContain("providerDocumentId");
      const pdf = await request(app).get(`${endpoint}/${documentId}`).set("Cookie", member);
      expect(pdf.status).toBe(200); expect(pdf.headers["cache-control"]).toBe("no-store"); expect(pdf.headers["content-type"]).toContain("application/pdf");
      for (const other of [admin, foreign]) {
        expect((await request(app).get(endpoint).set("Cookie", other)).body.documents).toEqual([]);
        expect((await request(app).get(`${endpoint}/${documentId}`).set("Cookie", other)).status).toBe(404);
      }
    });
    it("uses database membership instead of stale claims and rejects foreign owner reads", async () => {
      expect(
        (
          await request(app)
            .get(`/work-hub/finance?orgType=vendor&orgId=${ownerId}`)
            .set("Cookie", foreign)
        ).status,
      ).toBe(403);
      const read = await request(app)
        .get(`/work-hub/finance?orgType=vendor&orgId=${ownerId}`)
        .set("Cookie", admin);
      expect(read.body.permissions.billing).toBe(true);
      expect(read.body.permissions.payrollView).toBe(false);
      expect(
        (
          await post("grant", member, {
            userId: memberId,
            roles: ["payroll_approver"],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post("invoice-save", member, {
            customer: "Test",
            description: "Service",
            amountCents: 10000,
            dueDate: "2026-10-01",
          })
        ).status,
      ).toBe(403);
    });
    it("saves and issues one invoice across replay, records partial payments exactly once", async () => {
      const body = envelope({
        customer: "External customer",
        description: "Service",
        amountCents: 10000,
        dueDate: "2026-10-01",
      });
      const created = await request(app)
        .post("/work-hub/finance/invoice-save")
        .set("Cookie", admin)
        .send(body);
      expect(created.status).toBe(200);
      invoiceId = created.body.resource.id;
      const replay = await request(app)
        .post("/work-hub/finance/invoice-save")
        .set("Cookie", admin)
        .send(body);
      expect(replay.body.resource.id).toBe(invoiceId);
      expect(replay.body.replayed).toBe(true);
      expect((await post("issue", admin, { id: invoiceId })).status).toBe(200);
      paymentId = randomUUID();
      const payment = envelope(
        {
          id: invoiceId,
          amountCents: 3000,
          method: "check",
          reference: "unique-check-001",
        },
        paymentId,
      );
      const first = await request(app)
        .post("/work-hub/finance/payment")
        .set("Cookie", admin)
        .send(payment);
      expect(first.body.resource.data.paidCents).toBe(3000);
      expect(first.body.resource.data.payments[0].feeCents).toBe(0);
      expect(
        (
          await request(app)
            .post("/work-hub/finance/payment")
            .set("Cookie", admin)
            .send(payment)
        ).body.replayed,
      ).toBe(true);
      expect((await post("payment", admin, payment.payload)).status).toBe(409);
      expect(
        (
          await post("payment", admin, {
            ...payment.payload,
            reference: "overpay",
            amountCents: 8000,
          })
        ).status,
      ).toBe(409);
    });
    it("delegates billing while reserving refunds to admin and web", async () => {
      expect(
        (
          await post("grant", admin, {
            userId: memberId,
            roles: ["billing_manager"],
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post("refund", member, {
            id: invoiceId,
            paymentId,
            amountCents: 1000,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/work-hub/finance/refund")
            .set("Cookie", admin)
            .set("x-vndrly-client", "ios")
            .send(envelope({ id: invoiceId, paymentId, amountCents: 1000 }))
        ).status,
      ).toBe(403);
      const refund = await post("refund", admin, {
        id: invoiceId,
        paymentId,
        amountCents: 1000,
      });
      expect(refund.body.resource.data.paidCents).toBe(2000);
    });
    it("requires payroll grants, rejects cross-employer records and leaves taxes uncalculated", async () => {
      const payroll = {
        periodEnd: "2026-10-01",
        employees: [{ userId: memberId, grossCents: 50000 }],
      };
      expect((await post("payroll-save", admin, payroll)).status).toBe(403);
      await post("grant", admin, {
        userId: adminId,
        roles: ["payroll_preparer", "payroll_approver"],
      });
      expect(
        (
          await post("payroll-save", admin, {
            ...payroll,
            employees: [{ userId: 2147483647, grossCents: 1 }],
          })
        ).status,
      ).toBe(400);
      const draft = await post("payroll-save", admin, payroll);
      expect(draft.status).toBe(200);
      expect(draft.body.resource.data.netCents).toBeNull();
      const approved = await post("payroll-approve", admin, {
        id: draft.body.resource.id,
      });
      expect(approved.body.resource.data.status).toBe(
        "approved_pending_provider",
      );
      expect(
        (await post("payroll-submit", admin, { id: draft.body.resource.id }))
          .status,
      ).toBe(503);
    });
    it("publishes only a scoped invoice view and revokes the opaque link", async () => {
      const shared = await post("share", admin, { id: invoiceId });
      const token = shared.body.resource.data.shareToken;
      const viewed = await request(app).get(
        `/work-hub/finance/public/${token}`,
      );
      expect(viewed.status).toBe(200);
      expect(viewed.text).toContain("External customer");
      expect(viewed.text).not.toContain("unique-check-001");
      await post("revoke-share", admin, { id: invoiceId });
      expect(
        (await request(app).get(`/work-hub/finance/public/${token}`)).status,
      ).toBe(404);
    });
  },
);
