import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  userOrgMembershipsTable,
  workHubShiftsTable,
  workHubShiftAssignmentsTable,
  workHubClientOperationsTable,
} from "@workspace/db";
import {
  WorkHubShiftOpeningInputSchema,
  WorkHubShiftOpeningReceiptSchema,
  workHubShiftOpeningFingerprintValues,
  type WorkHubCommandEnvelope,
  type WorkHubShiftOpeningInput,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import {
  createWorkHubAccess,
  requireWorkHubCapability,
  WorkHubAccessError,
} from "../work-hub/context-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  gateAssignmentTransactionClient,
  lockShiftSchedulingRows,
  authorizeGateSchedulingSite,
  GateShiftAssignmentError,
} from "./gate-shift-assignment";
const kind = "shift.claim_window";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function assertShiftOpeningState(
  shift: {
    milestoneStatus: string | null;
    startsAt: Date | string;
    endsAt: Date | string;
  },
  assigned: number,
  now = Date.now(),
) {
  const start = Date.parse(String(shift.startsAt)),
    end = Date.parse(String(shift.endsAt));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    shift.milestoneStatus !== "upcoming" ||
    start <= now ||
    end <= now ||
    assigned !== 0
  )
    throw new GateShiftAssignmentError("work_hub.invalid_operation");
}
async function authorize(tx: Tx, session: SessionPayload, shiftId: string) {
  await lockShiftSchedulingRows(
    gateAssignmentTransactionClient(tx),
    session.userId!,
    shiftId,
  );
  await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId!))
    .for("update");
  await tx
    .select({ id: userOrgMembershipsTable.id })
    .from(userOrgMembershipsTable)
    .where(eq(userOrgMembershipsTable.userId, session.userId!))
    .for("share");
  const fresh = await validateAssistantSession(session, tx).catch(() => {
    throw new WorkHubAccessError("forbidden");
  });
  const [shift] = await tx
    .select()
    .from(workHubShiftsTable)
    .where(eq(workHubShiftsTable.id, shiftId))
    .limit(1)
    .for("update");
  if (
    !shift ||
    !(["vendor", "partner"] as string[]).includes(shift.ownerOrgType)
  )
    throw new WorkHubAccessError("not_found");
  const context = shift.gateStationId
    ? { kind: "gate" as const, id: shift.siteLocationId! }
    : { kind: "organization" as const, id: shift.ownerOrgId };
  requireWorkHubCapability(
    createWorkHubAccess({
      session: { ...fresh, userId: session.userId! },
      owner: {
        type: shift.ownerOrgType as "vendor" | "partner",
        id: shift.ownerOrgId,
      },
      context,
      participant: true,
    }),
    "shift.manage",
  );
  if (shift.gateStationId && shift.siteLocationId)
    await authorizeGateSchedulingSite(
      gateAssignmentTransactionClient(tx),
      session,
      shift.siteLocationId,
      shift.gateStationId,
      true,
    );
  return shift;
}
function fingerprint(
  shiftId: string,
  session: SessionPayload,
  owner: { type: "vendor" | "partner"; id: number },
  input: WorkHubShiftOpeningInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        workHubShiftOpeningFingerprintValues(
          shiftId,
          session.userId!,
          owner.type,
          owner.id,
          input,
        ),
      ),
    )
    .digest("hex");
}
export async function setWorkHubShiftOpening(
  session: SessionPayload,
  shiftId: string,
  envelope: WorkHubCommandEnvelope<unknown>,
  source: "web" | "ios" | "askv",
) {
  const p = envelope.payload as Record<string, unknown>;
  if (
    Object.keys(p).some((k) => !["action", "open"].includes(k)) ||
    (p.action !== undefined && p.action !== "update")
  )
    throw new GateShiftAssignmentError("work_hub.invalid_operation");
  if (p.action !== "update")
    throw new GateShiftAssignmentError("work_hub.invalid_operation");
  const input = WorkHubShiftOpeningInputSchema.parse({
    operationId: envelope.operationId,
    expectedVersion: envelope.expectedVersion,
    open: p.open,
  });
  const hash = fingerprint(shiftId, session, envelope.owner, input);
  const exactContext = (shift: {
    gateStationId: string | null;
    siteLocationId: number | null;
    ownerOrgId: number;
  }) => {
    if (
      envelope.context.kind !==
        (shift.gateStationId ? "gate" : "organization") ||
      String(envelope.context.id) !==
        String(shift.gateStationId ? shift.siteLocationId : shift.ownerOrgId)
    )
      throw new WorkHubAccessError("not_found");
  };
  const result = await executeWorkHubCommand(
    { userId: session.userId!, source },
    kind,
    envelope,
    async (tx) => {
      const shift = await authorize(tx, session, shiftId);
      exactContext(shift);
      if (
        shift.ownerOrgType !== envelope.owner.type ||
        shift.ownerOrgId !== envelope.owner.id
      )
        throw new WorkHubAccessError("not_found");
      if (shift.version !== input.expectedVersion)
        throw new Error("work_hub.version_conflict");
      const assignments = await tx
        .select({ id: workHubShiftAssignmentsTable.id })
        .from(workHubShiftAssignmentsTable)
        .where(eq(workHubShiftAssignmentsTable.shiftId, shiftId));
      assertShiftOpeningState(shift, assignments.length);
      const now = new Date();
      const [saved] = await tx
        .update(workHubShiftsTable)
        .set({ open: input.open, version: shift.version + 1, updatedAt: now })
        .where(eq(workHubShiftsTable.id, shiftId))
        .returning();
      const receipt = WorkHubShiftOpeningReceiptSchema.parse({
        operationId: input.operationId,
        actorUserId: session.userId,
        ownerOrgType: shift.ownerOrgType,
        ownerOrgId: shift.ownerOrgId,
        shiftId,
        previousVersion: shift.version,
        resultingVersion: saved!.version,
        open: input.open,
        commandFingerprint: hash,
        recordedAt: now.toISOString(),
        physicalAttendanceVerified: false,
      });
      await appendWorkHubAudit(
        {
          actorUserId: session.userId!,
          owner: envelope.owner,
          action: "shift.claim_window_changed",
          subjectType: "shift",
          subjectId: shiftId,
          priorVersion: shift.version,
          newVersion: saved!.version,
          source,
          operationId: input.operationId,
          metadata: { open: input.open, commandFingerprint: hash },
        },
        tx,
      );
      return receipt;
    },
    async (tx) => {
      const shift = await authorize(tx, session, shiftId);
      exactContext(shift);
      if (
        shift.ownerOrgType !== envelope.owner.type ||
        shift.ownerOrgId !== envelope.owner.id
      )
        throw new WorkHubAccessError("not_found");
    },
  );
  const receipt = WorkHubShiftOpeningReceiptSchema.parse(result.resource);
  if (
    receipt.commandFingerprint !== hash ||
    receipt.shiftId !== shiftId ||
    receipt.operationId !== input.operationId ||
    receipt.actorUserId !== session.userId ||
    receipt.ownerOrgType !== envelope.owner.type ||
    receipt.ownerOrgId !== envelope.owner.id ||
    receipt.previousVersion !== input.expectedVersion ||
    receipt.resultingVersion !== input.expectedVersion + 1 ||
    receipt.open !== input.open
  )
    throw new GateShiftAssignmentError("work_hub.invalid_operation");
  return receipt;
}
export async function readWorkHubShiftOpening(
  session: SessionPayload,
  shiftId: string,
  operationId: string,
) {
  return db.transaction(async (tx) => {
    const shift = await authorize(tx, session, shiftId);
    const [operation] = await tx
      .select()
      .from(workHubClientOperationsTable)
      .where(
        and(
          eq(workHubClientOperationsTable.userId, session.userId!),
          eq(workHubClientOperationsTable.commandKind, kind),
          eq(workHubClientOperationsTable.operationId, operationId),
        ),
      )
      .limit(1);
    if (!operation) return null;
    const receipt = WorkHubShiftOpeningReceiptSchema.parse(
      operation.resultJson,
    );
    if (
      !operation.appliedAt ||
      operation.ownerOrgType !== shift.ownerOrgType ||
      operation.ownerOrgId !== shift.ownerOrgId ||
      receipt.shiftId !== shiftId ||
      receipt.actorUserId !== session.userId ||
      receipt.operationId !== operationId ||
      receipt.ownerOrgType !== shift.ownerOrgType ||
      receipt.ownerOrgId !== shift.ownerOrgId
    )
      throw new GateShiftAssignmentError("work_hub.invalid_operation");
    const expected = fingerprint(
      shiftId,
      session,
      {
        type: shift.ownerOrgType as "vendor" | "partner",
        id: shift.ownerOrgId,
      },
      {
        operationId,
        expectedVersion: receipt.previousVersion,
        open: receipt.open,
      },
    );
    if (
      receipt.commandFingerprint !== expected ||
      receipt.resultingVersion !== receipt.previousVersion + 1
    )
      throw new GateShiftAssignmentError("work_hub.invalid_operation");
    return receipt;
  });
}
