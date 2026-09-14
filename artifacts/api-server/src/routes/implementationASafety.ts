import { Router, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import {
  CloseSafetyIncidentInputSchema,
  CreateSafetyIncidentInputSchema,
  EvidenceHoldInputSchema,
  IncidentEvidenceInputSchema,
} from "@workspace/api-zod";
import {
  db,
  safetyEscalationChainsTable,
  safetyEvidenceHoldsTable,
  safetyEventsTable,
  safetyIncidentDeliveriesTable,
  safetyIncidentEvidenceTable,
  safetyIncidentResponsesTable,
  userOrgMembershipsTable,
  usersTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { notifyUsers } from "./notifications";

const router = Router();

function context(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw Object.assign(new Error("Sign in required"), { status: 401, code: "safety.unauthenticated" });
  const owner = session.vendorId
    ? ({ type: "vendor", id: session.vendorId } as const)
    : session.partnerId
      ? ({ type: "partner", id: session.partnerId } as const)
      : null;
  return { session, owner, userId: session.userId };
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "safety.invalid_request", details: error.issues });
  const value = error as { status?: number; code?: string; message?: string };
  return res.status(value.status ?? 500).json({ code: value.code ?? "safety.internal_error", message: value.message });
}

async function fallbackAdmins(owner: { type: "vendor" | "partner"; id: number }): Promise<number[]> {
  const memberships = await db.select({ userId: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .where(and(
      eq(userOrgMembershipsTable.orgType, owner.type),
      owner.type === "vendor"
        ? eq(userOrgMembershipsTable.vendorId, owner.id)
        : eq(userOrgMembershipsTable.partnerId, owner.id),
      eq(userOrgMembershipsTable.role, "admin"),
      isNull(usersTable.suspendedAt),
    ));
  return [...new Set(memberships.map((row) => row.userId))];
}

async function loadResponse(eventId: number) {
  const [response] = await db.select().from(safetyIncidentResponsesTable)
    .where(eq(safetyIncidentResponsesTable.eventId, eventId)).limit(1);
  if (!response) throw Object.assign(new Error("Incident response not found"), { status: 404, code: "safety.response_not_found" });
  return response;
}

router.post("/implementation-a/safety/incidents", async (req, res) => {
  try {
    const actor = context(req);
    if (!actor.owner) throw Object.assign(new Error("Organization context required"), { status: 403, code: "safety.owner_required" });
    const input = CreateSafetyIncidentInputSchema.parse(req.body);
    if (input.organizationId !== actor.owner.id && actor.session.role !== "admin") {
      throw Object.assign(new Error("Incident is outside the active organization"), { status: 403, code: "safety.out_of_scope" });
    }
    const [event] = await db.select({ id: safetyEventsTable.id }).from(safetyEventsTable)
      .where(eq(safetyEventsTable.id, input.safetyEventId)).limit(1);
    if (!event) throw Object.assign(new Error("Safety event not found"), { status: 404, code: "safety.not_found" });
    const [chain] = await db.select().from(safetyEscalationChainsTable).where(and(
      eq(safetyEscalationChainsTable.ownerType, actor.owner.type),
      eq(safetyEscalationChainsTable.ownerId, actor.owner.id),
      eq(safetyEscalationChainsTable.isActive, true),
    )).limit(1);
    const recipients = chain?.responderUserIds.length ? chain.responderUserIds : await fallbackAdmins(actor.owner);
    const warning = chain?.responderUserIds.length ? null : "missing_safety_chain";
    const startedAt = input.startedAt ?? new Date();
    const [created] = await db.insert(safetyIncidentResponsesTable).values({
      eventId: input.safetyEventId,
      source: input.source,
      severity: input.severity,
      responseStatus: input.source === "possible_crash" ? "awaiting_response" : "open",
      originalReport: input.originalReport,
      responseDeadlineAt: input.source === "possible_crash" ? new Date(startedAt.getTime() + 60_000) : null,
      degradedCapabilities: input.degradedCapabilities,
      safetyChainSnapshot: recipients,
      configurationWarning: warning,
    }).returning();
    if (input.source !== "possible_crash" && recipients.length > 0 && !input.degradedCapabilities.includes("push")) {
      await notifyUsers(recipients, {
        type: "safety_incident",
        title: "Safety incident reported",
        body: input.originalReport.slice(0, 240),
        link: `/safety/${input.safetyEventId}`,
        category: "safety",
        dedupeKey: `safety_response:${created.id}`,
      });
    }
    return res.status(201).json({ ...created, persisted: true });
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/safety/incidents/:eventId/escalate", async (req, res) => {
  try {
    context(req);
    const response = await loadResponse(Number(req.params.eventId));
    if (response.acknowledgedAt || response.closedAt) return res.json(response);
    if (response.responseDeadlineAt && new Date() < response.responseDeadlineAt) {
      throw Object.assign(new Error("Response window is still active"), { status: 409, code: "safety.response_window_active" });
    }
    const [updated] = await db.update(safetyIncidentResponsesTable).set({ responseStatus: "escalated", updatedAt: new Date() })
      .where(eq(safetyIncidentResponsesTable.id, response.id)).returning();
    if (updated.safetyChainSnapshot.length > 0) {
      await notifyUsers(updated.safetyChainSnapshot, { type: "safety_escalation", title: "Safety response required", body: "A possible crash received no response.", link: `/safety/${updated.eventId}`, category: "safety", dedupeKey: `safety_escalated:${updated.id}` });
      await db.insert(safetyIncidentDeliveriesTable).values(updated.safetyChainSnapshot.map((recipientUserId) => ({ responseId: updated.id, recipientUserId, channel: "push", status: "sent" })));
    }
    return res.json(updated);
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/safety/incidents/:eventId/acknowledge", async (req, res) => {
  try {
    const actor = context(req);
    const response = await loadResponse(Number(req.params.eventId));
    const now = new Date();
    const [updated] = await db.update(safetyIncidentResponsesTable).set({ responseStatus: "acknowledged", assignedResponderUserId: actor.userId, acknowledgedByUserId: actor.userId, acknowledgedAt: now, updatedAt: now })
      .where(eq(safetyIncidentResponsesTable.id, response.id)).returning();
    return res.json(updated);
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/safety/incidents/:eventId/evidence", async (req, res) => {
  try {
    const actor = context(req);
    const response = await loadResponse(Number(req.params.eventId));
    const input = IncidentEvidenceInputSchema.parse(req.body);
    const [evidence] = await db.insert(safetyIncidentEvidenceTable).values({ responseId: response.id, actorUserId: actor.userId, ...input }).returning();
    return res.status(201).json(evidence);
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/safety/incidents/:eventId/hold", async (req, res) => {
  try {
    const actor = context(req);
    const response = await loadResponse(Number(req.params.eventId));
    const { reason } = EvidenceHoldInputSchema.parse(req.body);
    const [hold] = await db.insert(safetyEvidenceHoldsTable).values({ responseId: response.id, reason, placedByUserId: actor.userId }).returning();
    return res.status(201).json(hold);
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/safety/incidents/:eventId/close", async (req, res) => {
  try {
    const actor = context(req);
    const response = await loadResponse(Number(req.params.eventId));
    const { resolution } = CloseSafetyIncidentInputSchema.parse(req.body);
    const assigned = response.assignedResponderUserId === actor.userId;
    const authorized = actor.session.role === "admin" || actor.session.membershipRole === "admin" || actor.session.vendorRole === "safety_manager" || assigned;
    if (!authorized) throw Object.assign(new Error("Only the assigned responder, Safety Manager, or company admin may close this incident"), { status: 403, code: "safety.close_forbidden" });
    const now = new Date();
    await db.insert(safetyIncidentEvidenceTable).values({ responseId: response.id, actorUserId: actor.userId, kind: "note", value: resolution, metadata: { type: "closure" } });
    const [updated] = await db.update(safetyIncidentResponsesTable).set({ responseStatus: "closed", closedAt: now, closedByUserId: actor.userId, updatedAt: now }).where(eq(safetyIncidentResponsesTable.id, response.id)).returning();
    return res.json(updated);
  } catch (error) { return sendError(res, error); }
});

export default router;
