import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  userOrgMembershipsTable,
  vendorPeopleTable,
  workHubAuditLogTable,
  workHubClientOperationsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { getOperationsHealth } from "../services/operations-health";
import { notifyUsers } from "./notifications";
import {
  recordSupervisorException,
  type SupervisorExceptionInput,
} from "../services/supervisor-exceptions";

const router = Router();

function context(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw Object.assign(new Error("Sign in required"), { status: 401, code: "operations_health.unauthenticated" });
  if (session.role !== "admin" && session.membershipRole !== "admin") {
    throw Object.assign(new Error("Company administrator access required"), { status: 403, code: "operations_health.admin_required" });
  }
  const owner = session.vendorId
    ? ({ type: "vendor", id: session.vendorId } as const)
    : session.partnerId
      ? ({ type: "partner", id: session.partnerId } as const)
      : null;
  if (!owner) throw Object.assign(new Error("Active company context required"), { status: 403, code: "operations_health.owner_required" });
  return owner;
}

function eventContext(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session?.userId)
    throw Object.assign(new Error("Sign in required"), {
      status: 401,
      code: "operations_health.unauthenticated",
    });
  const owner = session.vendorId
    ? ({ type: "vendor", id: session.vendorId } as const)
    : session.partnerId
      ? ({ type: "partner", id: session.partnerId } as const)
      : null;
  if (!owner)
    throw Object.assign(new Error("Active company context required"), {
      status: 403,
      code: "operations_health.owner_required",
    });
  return { actorUserId: session.userId, owner };
}

const eventBody = z.object({
  operationId: z.uuid().optional(),
  eventId: z.string().trim().min(1).max(200),
  kind: z.enum(["field_mode_exception", "gate_exception"]),
  reason: z.enum([
    "end_work_unanswered",
    "extended_stop_unanswered",
    "unresolved_gate_observation",
  ]),
});

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

router.get("/implementation-a/operations-health", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(await getOperationsHealth(context(req)));
  } catch (error) {
    const value = error as { status?: number; code?: string; message?: string };
    return res.status(value.status ?? 500).json({ code: value.code ?? "operations_health.internal_error", message: value.message });
  }
});

router.post("/implementation-a/operations-health/events", async (req, res) => {
  try {
    const actor = eventContext(req);
    const parsed = eventBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        code: "operations_health.invalid_event",
        message: "Invalid operations event",
      });
    const input: SupervisorExceptionInput = { ...actor, ...parsed.data };
    const result = await recordSupervisorException(input, {
      claim: async (dedupeKey) => {
        const [claimed] = await db
          .insert(workHubClientOperationsTable)
          .values({
            userId: actor.actorUserId,
            commandKind: "supervisor_exception",
            operationId: stableUuid(dedupeKey),
            ownerOrgType: actor.owner.type,
            ownerOrgId: actor.owner.id,
            resultJson: { kind: input.kind, reason: input.reason },
            appliedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: workHubClientOperationsTable.id });
        return Boolean(claimed);
      },
      writeAudit: async (event) => {
        await db.insert(workHubAuditLogTable).values({
          actorUserId: event.actorUserId,
          ownerOrgType: event.owner.type,
          ownerOrgId: event.owner.id,
          action: "supervisor.exception",
          subjectType: event.kind,
          subjectId: event.eventId,
          source: "mobile_field_mode",
          operationId: stableUuid([
            event.actorUserId,
            event.kind,
            event.reason,
            event.eventId,
          ].join(":")),
          metadata: { reason: event.reason },
        });
      },
      resolveRecipients: async (event) => {
        const membershipCondition =
          event.owner.type === "vendor"
            ? eq(userOrgMembershipsTable.vendorId, event.owner.id)
            : eq(userOrgMembershipsTable.partnerId, event.owner.id);
        const admins = await db
          .select({ userId: userOrgMembershipsTable.userId })
          .from(userOrgMembershipsTable)
          .where(
            and(
              eq(userOrgMembershipsTable.orgType, event.owner.type),
              membershipCondition,
              eq(userOrgMembershipsTable.role, "admin"),
            ),
          );
        if (event.owner.type !== "vendor")
          return admins.map((row) => row.userId);
        const supervisors = await db
          .select({ userId: vendorPeopleTable.userId })
          .from(vendorPeopleTable)
          .where(
            and(
              eq(vendorPeopleTable.vendorId, event.owner.id),
              eq(vendorPeopleTable.isActive, true),
              isNull(vendorPeopleTable.deletedAt),
              inArray(vendorPeopleTable.vendorRole, [
                "foreman",
                "both",
                "gate_supervisor",
              ]),
            ),
          );
        return [
          ...admins.map((row) => row.userId),
          ...supervisors.flatMap((row) =>
            row.userId == null ? [] : [row.userId],
          ),
        ];
      },
      notify: (userIds, event, dedupeKey) =>
        notifyUsers(userIds, {
          type: "supervisor_exception",
          category: "system",
          dedupeKey: `supervisor:${stableUuid(dedupeKey)}`,
          title: "Field operation needs confirmation",
          body:
            event.reason === "extended_stop_unanswered"
              ? "A worker did not answer the extended-stop check-in."
              : event.reason === "end_work_unanswered"
                ? "A worker's end-of-work status needs confirmation."
                : "A Gate observation needs supervisor resolution.",
          link: "/work-hub/operations-health",
        }),
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const value = error as {
      status?: number;
      code?: string;
      message?: string;
    };
    return res.status(value.status ?? 500).json({
      code: value.code ?? "operations_health.internal_error",
      message: value.message,
    });
  }
});

export default router;
