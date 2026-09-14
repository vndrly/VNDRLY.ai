import { Router, type Request, type Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { ActivateWorkerSubscriptionSchema, PreviewWorkerSubscriptionSchema, ReactivateWorkerSubscriptionSchema } from "@workspace/api-zod";
import { db, workerSubscriptionsTable } from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { issueAccountInvitation } from "../services/account-invitations";
import {
  createWorkerSubscriptionService,
  WorkerSubscriptionError,
  type SubscriptionPayor,
  type WorkerSubscription,
  type WorkerSubscriptionRepository,
} from "../services/worker-subscriptions";

const router = Router();
const IdSchema = z.string().uuid();

function actor(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session?.userId || session.role !== "vendor" || !session.vendorId || session.membershipRole !== "admin") {
    throw new WorkerSubscriptionError("worker_subscription.vendor_admin_required", 403);
  }
  return { userId: session.userId, vendorId: session.vendorId, payor: { type: "vendor", id: session.vendorId } as SubscriptionPayor };
}

function fromRow(row: typeof workerSubscriptionsTable.$inferSelect): WorkerSubscription {
  return {
    id: row.id,
    payor: row.payorOrgType === "partner" ? { type: "partner", id: row.payorPartnerId! } : { type: "vendor", id: row.payorVendorId! },
    workerUserId: row.workerUserId, plan: row.plan as WorkerSubscription["plan"], monthlyPriceCents: row.monthlyPriceCents,
    currency: "USD", renewalAt: row.renewalAt, state: row.state as WorkerSubscription["state"], renews: row.renews,
    accessEndsAt: row.accessEndsAt, billingEndsAt: row.billingEndsAt, foundingSiteLocationId: row.foundingSiteLocationId,
    previewAccess: row.previewAccess, archivedAt: row.archivedAt, auditActorUserId: row.auditActorUserId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

const repository: WorkerSubscriptionRepository = {
  async create(seat) {
    const [saved] = await db.insert(workerSubscriptionsTable).values({
      id: seat.id, payorOrgType: seat.payor.type,
      payorVendorId: seat.payor.type === "vendor" ? seat.payor.id : null,
      payorPartnerId: seat.payor.type === "partner" ? seat.payor.id : null,
      workerUserId: seat.workerUserId, plan: seat.plan, monthlyPriceCents: seat.monthlyPriceCents, currency: seat.currency,
      renewalAt: seat.renewalAt, state: seat.state, renews: seat.renews, accessEndsAt: seat.accessEndsAt,
      billingEndsAt: seat.billingEndsAt, foundingSiteLocationId: seat.foundingSiteLocationId, previewAccess: seat.previewAccess,
      archivedAt: seat.archivedAt, auditActorUserId: seat.auditActorUserId, createdAt: seat.createdAt, updatedAt: seat.updatedAt,
    }).returning();
    if (!saved) throw new WorkerSubscriptionError("worker_subscription.create_failed", 500);
    return fromRow(saved);
  },
  async get(id) { const [row] = await db.select().from(workerSubscriptionsTable).where(eq(workerSubscriptionsTable.id, id)).limit(1); return row ? fromRow(row) : null; },
  async save(seat) {
    const [saved] = await db.update(workerSubscriptionsTable).set({ state: seat.state, renews: seat.renews, renewalAt: seat.renewalAt, accessEndsAt: seat.accessEndsAt, billingEndsAt: seat.billingEndsAt, archivedAt: seat.archivedAt, auditActorUserId: seat.auditActorUserId, updatedAt: seat.updatedAt }).where(eq(workerSubscriptionsTable.id, seat.id)).returning();
    if (!saved) throw new WorkerSubscriptionError("worker_subscription.not_found", 404);
    return fromRow(saved);
  },
  async listForPayor(payor) {
    const rows = await db.select().from(workerSubscriptionsTable).where(and(
      eq(workerSubscriptionsTable.payorOrgType, payor.type),
      payor.type === "vendor" ? eq(workerSubscriptionsTable.payorVendorId, payor.id) : eq(workerSubscriptionsTable.payorPartnerId, payor.id),
    ));
    return rows.map(fromRow);
  },
};
const service = createWorkerSubscriptionService(repository);

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "worker_subscription.invalid_request" });
  if (error instanceof WorkerSubscriptionError) return res.status(error.status).json({ code: error.code });
  console.error("Worker subscription request failed", error);
  return res.status(500).json({ code: "worker_subscription.internal_error" });
}

router.post("/implementation-a/subscriptions/preview", async (req, res) => {
  try {
    const context = actor(req); const input = PreviewWorkerSubscriptionSchema.parse(req.body);
    return res.json(await service.previewSeatChange({ payor: context.payor, plan: input.plan, monthlyPriceCents: input.monthlyPriceCents, renewalAt: new Date(input.renewalAt) }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/subscriptions", async (req, res) => {
  try {
    const context = actor(req); const input = ActivateWorkerSubscriptionSchema.parse(req.body);
    const invitation = await issueAccountInvitation(context, input);
    const result = await service.activateSeat({ payor: context.payor, workerUserId: invitation.userId, plan: input.plan, monthlyPriceCents: input.monthlyPriceCents, renewalAt: new Date(input.renewalAt), confirmed: input.confirmed, auditActorUserId: context.userId, foundingSiteLocationId: input.foundingSiteLocationId, previewAccess: input.previewAccess });
    if (result.status !== "applied") throw new WorkerSubscriptionError(result.code);
    return res.status(201).json({ seat: result.seat, invitation: { id: invitation.invitationId, state: "pending", expiresAt: invitation.expiresAt } });
  } catch (error) { return sendError(res, error); }
});

router.get("/implementation-a/subscriptions", async (req, res) => {
  try { const context = actor(req); return res.json({ subscriptions: await repository.listForPayor(context.payor) }); }
  catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/subscriptions/:subscriptionId/pause", async (req, res) => {
  try { const context = actor(req); const id = IdSchema.parse(req.params.subscriptionId); const seat = await repository.get(id); if (!seat || seat.payor.type !== context.payor.type || seat.payor.id !== context.payor.id) throw new WorkerSubscriptionError("worker_subscription.not_found", 404); return res.json(await service.pauseSeat(id, context.userId)); }
  catch (error) { return sendError(res, error); }
});
router.post("/implementation-a/subscriptions/:subscriptionId/terminate", async (req, res) => {
  try { const context = actor(req); const id = IdSchema.parse(req.params.subscriptionId); const seat = await repository.get(id); if (!seat || seat.payor.type !== context.payor.type || seat.payor.id !== context.payor.id) throw new WorkerSubscriptionError("worker_subscription.not_found", 404); return res.json(await service.terminateSeat(id, context.userId)); }
  catch (error) { return sendError(res, error); }
});
router.post("/implementation-a/subscriptions/:subscriptionId/reactivate", async (req, res) => {
  try { const context = actor(req); const id = IdSchema.parse(req.params.subscriptionId); const input = ReactivateWorkerSubscriptionSchema.parse(req.body); const seat = await repository.get(id); if (!seat || seat.payor.type !== context.payor.type || seat.payor.id !== context.payor.id) throw new WorkerSubscriptionError("worker_subscription.not_found", 404); return res.json(await service.reactivateSeat(id, { renewalAt: new Date(input.renewalAt), auditActorUserId: context.userId })); }
  catch (error) { return sendError(res, error); }
});

export default router;
