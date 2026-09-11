import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  userOrgMembershipsTable as memberships,
  usersTable,
  invoicesTable,
  workHubFinanceRecordsTable as records,
} from "@workspace/db";

import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  financePermissions,
  type FinanceRole,
  cents,
  refundedPlatformFee,
} from "../lib/workHubFinancePolicy";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import payrollDocuments from "./workHubPayrollDocuments";
const router: IRouter = Router();
const emailReady = () =>
  Boolean(
    process.env.SENDGRID_API_KEY &&
    process.env.SENDGRID_FROM_EMAIL &&
    !["1", "true", "yes"].includes(
      (process.env.SENDGRID_SANDBOX_MODE ?? "").toLowerCase(),
    ),
  );
const ownerSchema = z.object({
  type: z.enum(["vendor", "partner"]),
  id: z.coerce.number().int().positive(),
});
const amount = z.number().int().min(0).max(1_000_000_000_000);
const roles = z.enum([
  "billing_manager",
  "payroll_viewer",
  "payroll_preparer",
  "payroll_approver",
]);
class FinanceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const deny = () => {
  throw new FinanceError(403, "Finance permission required");
};
const scope = (owner: z.infer<typeof ownerSchema>) =>
  and(eq(records.orgType, owner.type), eq(records.orgId, owner.id));
const memberScope = (owner: z.infer<typeof ownerSchema>) =>
  and(
    eq(memberships.orgType, owner.type),
    eq(
      owner.type === "vendor" ? memberships.vendorId : memberships.partnerId,
      owner.id,
    ),
  );
async function access(
  userId: number,
  owner: z.infer<typeof ownerSchema>,
  executor:
    | typeof db
    | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
) {
  const [member] = await executor
    .select()
    .from(memberships)
    .where(and(memberScope(owner), eq(memberships.userId, userId)))
    .limit(1);
  if (!member) throw new FinanceError(403, "Company membership required");
  const [grant] = await executor
    .select()
    .from(records)
    .where(
      and(
        scope(owner),
        eq(records.kind, "grant"),
        eq(records.recordKey, String(userId)),
      ),
    )
    .limit(1);
  return financePermissions(
    member.role === "admin",
    (grant?.data.roles ?? []) as FinanceRole[],
  );
}
router.use("/work-hub/finance", async (_req, res, next) => {
  if (!(await isWorkHubEnabled())) return res.sendStatus(404);
  return next();
});
router.use("/work-hub/finance", payrollDocuments);
router.get("/work-hub/finance/public/:token", async (req, res) => {
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .safeParse(req.params.token);
  if (!token.success) return res.sendStatus(404);
  const [record] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.kind, "invoice"),
        sql`${records.data}->>'shareToken' = ${token.data}`,
      ),
    )
    .limit(1);
  if (
    !record ||
    new Date(String(record.data.shareExpiresAt)).getTime() <= Date.now()
  )
    return res.sendStatus(404);
  const d = record.data;
  const escape = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]!,
    );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res
    .type("html")
    .send(
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Invoice</title><body><h1>Invoice</h1><p>${escape(d.customer)}</p><p>${escape(d.description)}</p><p>Due ${escape(d.dueDate)}</p><p>Total USD ${(Number(d.amountCents) / 100).toFixed(2)}</p><p>Balance USD ${((Number(d.amountCents) - Number(d.paidCents)) / 100).toFixed(2)}</p><p>Card and ACH payment are not connected. Contact the issuer for payment arrangements.</p></body></html>`,
    );
});
router.get("/work-hub/finance", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req);
    if (!actor?.userId) return res.sendStatus(401);
    const owner = ownerSchema.parse({
      type: req.query.orgType,
      id: req.query.orgId,
    });
    const permissions = await access(actor.userId, owner);
    const rows = await db
      .select()
      .from(records)
      .where(scope(owner))
      .orderBy(desc(records.createdAt));
    const members =
      permissions.administer || permissions.payrollPrepare
        ? await db
            .select({
              userId: memberships.userId,
              role: memberships.role,
              displayName: usersTable.displayName,
            })
            .from(memberships)
            .innerJoin(usersTable, eq(usersTable.id, memberships.userId))
            .where(memberScope(owner))
        : [];
    const canonicalInvoices = permissions.billing
      ? await db
          .select({
            id: invoicesTable.id,
            invoiceNumber: invoicesTable.invoiceNumber,
            total: invoicesTable.total,
            status: invoicesTable.status,
          })
          .from(invoicesTable)
          .where(
            eq(
              owner.type === "vendor"
                ? invoicesTable.vendorId
                : invoicesTable.partnerId,
              owner.id,
            ),
          )
          .orderBy(desc(invoicesTable.id))
          .limit(100)
      : [];
    return res.json({
      permissions,
      members,
      canonicalInvoices,
      providers: {
        payments: false,
        payroll: false,
        email: emailReady(),
        message:
          "Card/ACH collection, payroll tax calculations, filings and direct deposit are not connected. No funds will move.",
      },
      invoices: permissions.billing
        ? rows.filter((r) => r.kind === "invoice")
        : [],
      payroll: permissions.payrollView
        ? rows.filter((r) => r.kind === "payroll")
        : [],
      grants: permissions.administer
        ? rows.filter((r) => r.kind === "grant")
        : [],
      fee: rows.find((r) => r.kind === "fee")?.data ?? {
        basisPoints: 50,
        capCents: null,
      },
    });
  } catch (error) {
    return res
      .status(error instanceof FinanceError ? error.status : 400)
      .json({
        message: error instanceof Error ? error.message : "Invalid request",
      });
  }
});
router.post("/work-hub/finance/email", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req);
    if (!actor?.userId) return res.sendStatus(401);
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const owner = ownerSchema.parse(envelope.owner);
    if (
      envelope.context.kind !== "organization" ||
      String(envelope.context.id) !== String(owner.id)
    )
      deny();
    if (!(await access(actor.userId, owner)).billing) deny();
    const p = z
      .object({ id: z.string().uuid(), to: z.string().email() })
      .strict()
      .parse(envelope.payload);
    if (!emailReady())
      throw new FinanceError(
        503,
        "Invoice email is not connected; nothing was sent",
      );
    const [invoice] = await db
      .select()
      .from(records)
      .where(
        and(scope(owner), eq(records.kind, "invoice"), eq(records.id, p.id)),
      )
      .limit(1);
    if (!invoice || invoice.data.status === "draft")
      throw new FinanceError(409, "Issued invoice required");
    // Persist the attempt before network I/O. A replay never resends an uncertain request.
    const attempt = await executeWorkHubCommand(
      { userId: actor.userId, source: "web" },
      "finance.email",
      envelope,
      async (tx) => {
        const [saved] = await tx
          .insert(records)
          .values({
            orgType: owner.type,
            orgId: owner.id,
            kind: "email",
            recordKey: envelope.operationId,
            createdBy: actor.userId!,
            data: { invoiceId: p.id, to: p.to, status: "delivery_unconfirmed" },
          })
          .returning();
        await appendWorkHubAudit(
          {
            actorUserId: actor.userId!,
            owner,
            action: "finance.email_attempted",
            subjectType: "invoice",
            subjectId: p.id,
            operationId: envelope.operationId,
            source: "web",
          },
          tx,
        );
        return saved;
      },
    );
    if (attempt.replayed) {
      const [saved] = await db
        .select()
        .from(records)
        .where(and(scope(owner), eq(records.id, attempt.resource.id)))
        .limit(1);
      return res.json({
        replayed: true,
        status: saved?.data.status ?? "delivery_unconfirmed",
      });
    }
    const d = invoice.data;
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: p.to }] }],
        from: {
          email: process.env.SENDGRID_FROM_EMAIL,
          name: process.env.SENDGRID_FROM_NAME || "VNDRLY",
        },
        subject: `Invoice ${invoice.id}`,
        content: [
          {
            type: "text/plain",
            value: `Invoice ${invoice.id}\nCustomer: ${d.customer}\n${d.description}\nDue: ${d.dueDate}\nTotal USD ${(Number(d.amountCents) / 100).toFixed(2)}\nBalance USD ${((Number(d.amountCents) - Number(d.paidCents)) / 100).toFixed(2)}\nContact the issuer for payment arrangements.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const messageId = response.headers.get("x-message-id");
    const status =
      response.status === 202 && messageId
        ? "provider_accepted"
        : "delivery_unconfirmed";
    await db
      .update(records)
      .set({
        data: { invoiceId: p.id, to: p.to, status, messageId },
        updatedAt: new Date(),
      })
      .where(eq(records.id, attempt.resource.id));
    if (status !== "provider_accepted")
      throw new FinanceError(
        502,
        "Email delivery is unconfirmed; this attempt will not resend automatically",
      );
    return res.json({ status, messageId });
  } catch (error) {
    return res
      .status(error instanceof FinanceError ? error.status : 502)
      .json({
        message:
          error instanceof Error ? error.message : "Email delivery unconfirmed",
      });
  }
});
router.post("/work-hub/finance/:action", async (req, res) => {
  try {
    const actor = getSessionFromRequest(req);
    if (!actor?.userId) return res.sendStatus(401);
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    const owner = ownerSchema.parse(envelope.owner);
    if (
      envelope.context.kind !== "organization" ||
      String(envelope.context.id) !== String(owner.id)
    )
      deny();
    const action = String(req.params.action);
    const permission = await access(actor.userId, owner);
    if (
      action.startsWith("payroll")
        ? !permission.payrollView
        : action === "grant" || action === "fee"
          ? !permission.administer
          : !permission.billing
    )
      deny();
    if (
      ["payroll-approve", "payroll-submit", "refund"].includes(action) &&
      (req.header("x-vndrly-client") !== "web" ||
        req.header("x-vndrly-source") === "askv")
    )
      deny();
    if (
      [
        "email",
        "payment-link",
        "card",
        "ach",
        "payroll-submit",
        "payroll-tax-form",
        "payroll-bank-form",
      ].includes(action)
    )
      throw new FinanceError(
        503,
        "Provider is not connected; no external execution occurred",
      );
    const result = await executeWorkHubCommand(
      { userId: actor.userId, source: "web" },
      `finance.${action}`,
      envelope,
      async (tx) => {
        // Serialize every financial mutation per issuer, including grants and drafts.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`finance:${owner.type}:${owner.id}`}))`,
        );
        const permission = await access(actor.userId!, owner, tx);
        if (
          action.startsWith("payroll")
            ? !permission.payrollView
            : action === "grant" || action === "fee"
              ? !permission.administer
              : !permission.billing
        )
          deny();
        let kind = "invoice",
          key = envelope.operationId,
          data: Record<string, unknown>;
        let existing: typeof records.$inferSelect | undefined;
        if (["invoice-save", "payroll-save"].includes(action)) {
          if (action === "payroll-save" && !permission.payrollPrepare) deny();
          const payload =
            action === "invoice-save"
              ? z
                  .object({
                    id: z.string().uuid().optional(),
                    customer: z.string().trim().min(1).max(200),
                    description: z.string().trim().min(1).max(2000),
                    amountCents: amount.positive(),
                    dueDate: z.string().date(),
                  })
                  .strict()
                  .parse(envelope.payload)
              : z
                  .object({
                    id: z.string().uuid().optional(),
                    periodEnd: z.string().date(),
                    employees: z
                      .array(
                        z.object({
                          userId: z.number().int().positive(),
                          grossCents: amount,
                        }),
                      )
                      .min(1)
                      .max(1000),
                  })
                  .strict()
                  .parse(envelope.payload);
          kind = action === "payroll-save" ? "payroll" : "invoice";
          if (payload.id) {
            [existing] = await tx
              .select()
              .from(records)
              .where(
                and(
                  scope(owner),
                  eq(records.id, payload.id),
                  eq(records.kind, kind),
                ),
              )
              .limit(1);
            if (!existing) throw new FinanceError(404, "Record not found");
            if (existing.data.status !== "draft")
              throw new FinanceError(409, "Only drafts can be edited");
            key = existing.recordKey;
          }
          if ("employees" in payload) {
            const validMembers = await tx
              .select({ id: memberships.userId })
              .from(memberships)
              .where(memberScope(owner));
            if (
              new Set(payload.employees.map((e) => e.userId)).size !==
                payload.employees.length ||
              payload.employees.some(
                (e) => !validMembers.some((m) => m.id === e.userId),
              )
            )
              throw new FinanceError(
                400,
                "Employees must be distinct members of this employer",
              );
            cents(
              payload.employees.reduce(
                (sum, employee) => sum + employee.grossCents,
                0,
              ),
            );
          }
          data = {
            ...payload,
            status: "draft",
            currency: "USD",
            ...(kind === "payroll"
              ? { classification: "US_W2", taxCents: null, netCents: null }
              : { paidCents: 0, payments: [] }),
          };
        } else if (action === "grant") {
          const p = z
            .object({
              userId: z.number().int().positive(),
              roles: z.array(roles).max(4),
            })
            .strict()
            .parse(envelope.payload);
          const [member] = await tx
            .select()
            .from(memberships)
            .where(and(memberScope(owner), eq(memberships.userId, p.userId)))
            .limit(1);
          if (
            !member ||
            (p.roles.includes("billing_manager") &&
              member.role === "field_employee")
          )
            throw new FinanceError(
              400,
              "Billing Manager requires an office member of this company",
            );
          kind = "grant";
          key = String(p.userId);
          data = p;
        } else if (action === "fee") {
          // Company administrators may inspect fees; platform fee changes require platform administration.
          if (actor.role !== "admin") deny();
          data = z
            .object({
              basisPoints: z.number().int().min(0).max(10000),
              capCents: amount.nullable(),
            })
            .strict()
            .parse(envelope.payload);
          kind = "fee";
          key = "configuration";
        } else {
          const p = z
            .object({
              id: z.string().uuid(),
              amountCents: amount.positive().optional(),
              method: z.enum(["cash", "check", "bank"]).optional(),
              reference: z.string().trim().min(1).max(100).optional(),
              paymentId: z.string().uuid().optional(),
            })
            .strict()
            .parse(envelope.payload);
          kind = action.startsWith("payroll") ? "payroll" : "invoice";
          [existing] = await tx
            .select()
            .from(records)
            .where(
              and(scope(owner), eq(records.kind, kind), eq(records.id, p.id)),
            )
            .limit(1);
          if (!existing) throw new FinanceError(404, "Record not found");
          key = existing.recordKey;
          data = { ...existing.data };
          if (action === "issue" || action === "payroll-approve") {
            if (action === "payroll-approve" && !permission.payrollApprove)
              deny();
            if (data.status !== "draft")
              throw new FinanceError(409, "Draft required");
            data.status =
              action === "issue" ? "issued" : "approved_pending_provider";
            data.approvedBy = actor.userId;
            data.approvedAt = new Date().toISOString();
          } else if (action === "share" || action === "revoke-share") {
            if (data.status === "draft")
              throw new FinanceError(409, "Issue the invoice first");
            data.shareToken =
              action === "share" ? randomBytes(32).toString("hex") : null;
            data.shareExpiresAt =
              action === "share"
                ? new Date(Date.now() + 30 * 86400000).toISOString()
                : null;
          } else if (action === "payment" || action === "refund") {
            if (!p.amountCents)
              throw new FinanceError(400, "Amount is required");
            if (!["issued", "paid"].includes(String(data.status)))
              throw new FinanceError(409, "Issue the invoice first");
            type Payment = {
              id: string;
              amountCents: number;
              feeCents: number;
              refundedCents: number;
              method: string;
              reference: string;
            };
            const payments = (data.payments as Payment[]).map((payment) => ({
              ...payment,
            }));
            if (action === "payment") {
              if (!p.method || !p.reference)
                throw new FinanceError(
                  400,
                  "Payment method and unique reference required",
                );
              if (payments.some((payment) => payment.reference === p.reference))
                throw new FinanceError(
                  409,
                  "Payment reference already recorded",
                );
              if (
                Number(data.paidCents) + p.amountCents >
                Number(data.amountCents)
              )
                throw new FinanceError(409, "Payment exceeds balance");
              payments.push({
                id: envelope.operationId,
                amountCents: p.amountCents,
                feeCents: 0,
                refundedCents: 0,
                method: p.method,
                reference: p.reference,
              });
              data.paidCents = Number(data.paidCents) + p.amountCents;
            } else {
              if (!permission.refund) deny();
              const payment = payments.find(
                (payment) => payment.id === p.paymentId,
              );
              if (
                !payment ||
                payment.refundedCents + p.amountCents > payment.amountCents
              )
                throw new FinanceError(409, "Refund exceeds remaining payment");
              const feeRefund = refundedPlatformFee(
                payment.amountCents,
                payment.feeCents,
                payment.refundedCents,
                p.amountCents,
              );
              payment.refundedCents += p.amountCents;
              data.paidCents = Number(data.paidCents) - p.amountCents;
              data.refunds = [
                ...(Array.isArray(data.refunds) ? data.refunds : []),
                {
                  id: envelope.operationId,
                  paymentId: payment.id,
                  amountCents: p.amountCents,
                  feeRefundCents: feeRefund,
                  recordedBy: actor.userId,
                },
              ];
            }
            data.payments = payments;
            data.status =
              data.paidCents === data.amountCents ? "paid" : "issued";
          } else throw new FinanceError(400, "Unknown finance action");
        }
        const [saved] = await tx
          .insert(records)
          .values({
            orgType: owner.type,
            orgId: owner.id,
            kind,
            recordKey: key,
            data,
            createdBy: actor.userId!,
          })
          .onConflictDoUpdate({
            target: [
              records.orgType,
              records.orgId,
              records.kind,
              records.recordKey,
            ],
            set: { data, updatedAt: new Date() },
          })
          .returning();
        await appendWorkHubAudit(
          {
            actorUserId: actor.userId!,
            owner,
            action: `finance.${action}`,
            subjectType: kind,
            subjectId: saved.id,
            source: "web",
            operationId: envelope.operationId,
          },
          tx,
        );
        return saved;
      },
    );
    return res.json(result);
  } catch (error) {
    return res
      .status(error instanceof FinanceError ? error.status : 400)
      .json({
        message:
          error instanceof Error ? error.message : "Invalid finance request",
      });
  }
});
export default router;
