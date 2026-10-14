import {
  liveMeetingFingerprint,
  verifyLiveMeetingReplay,
} from "./live-meeting-fingerprint";
import { and, eq, inArray, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  userOrgMembershipsTable as memberships,
  workHubMeetingsTable as meetings,
  workHubMeetingOccurrencesTable as occurrences,
  workHubMeetingParticipantsTable as participants,
  workHubAuditLogTable as audit,
} from "@workspace/db";
import {
  LiveMeetingStartSchema,
  LiveMeetingModeSchema,
  LiveMeetingAdmissionReceiptSchema,
  type WorkHubCommandEnvelope,
  type LiveMeetingSummary,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { WorkHubAccessError } from "./context-access";
import { executeWorkHubCommand } from "./commands";
import {
  meetingAdmissionDecision,
  type AdmissionMode,
  type AdmissionState,
} from "./meeting-admission-policy";
import {
  meetingDeviceConnections,
  type MeetingRuntime,
} from "./meeting-runtime";
import { queueLiveMeetingNotification } from "./live-meeting-notifications";
export type LiveActor = SessionPayload & {
  userId: number;
  source?: "web" | "ios" | "askv";
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;
export function liveMeetingVersion(runtime: Record<string, unknown>) {
  const v = runtime.admissionVersion;
  return Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : 0;
}
export function requireMeetingVersion(
  runtime: Record<string, unknown>,
  expected: number | null,
) {
  if (expected !== liveMeetingVersion(runtime))
    throw Object.assign(new Error("Meeting changed; refresh before deciding"), {
      status: 409,
    });
}
async function member(reader: Reader, actor: LiveActor, lock = false) {
  if (!actor.vendorId || actor.publicDemo)
    throw new WorkHubAccessError("forbidden");
  const q = reader
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actor.userId))
    .limit(1);
  const [u] = await (lock ? q.for("share") : q);
  if (
    !u ||
    u.suspendedAt ||
    u.mustChangePassword ||
    !actor.sv ||
    u.sessionVersion !== actor.sv ||
    (u.activeMembershipId !== null &&
      u.activeMembershipId !== actor.activeMembershipId)
  )
    throw new WorkHubAccessError("forbidden");
  const m = reader
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, actor.userId),
        eq(memberships.orgType, "vendor"),
        eq(memberships.vendorId, actor.vendorId),
      ),
    )
    .limit(1);
  const [membership] = await (lock ? m.for("share") : m);
  if (
    !membership ||
    (actor.activeMembershipId && membership.id !== actor.activeMembershipId)
  )
    throw new WorkHubAccessError("forbidden");
  return membership;
}
async function room(
  reader: Reader,
  actor: LiveActor,
  id: string,
  lock = false,
) {
  const membership = await member(reader, actor, lock);
  const q = reader
    .select()
    .from(occurrences)
    .where(eq(occurrences.id, id))
    .limit(1);
  const [occurrence] = await (lock ? q.for("update") : q);
  const [meeting] = occurrence
    ? await reader
        .select()
        .from(meetings)
        .where(eq(meetings.id, occurrence.meetingId))
        .limit(1)
    : [];
  if (
    !occurrence ||
    !meeting ||
    meeting.ownerOrgType !== "vendor" ||
    meeting.ownerOrgId !== actor.vendorId
  )
    throw new WorkHubAccessError("not_found");
  const [participant] = await reader
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.occurrenceId, id),
        eq(participants.userId, actor.userId),
      ),
    )
    .limit(1);
  const decision = meetingAdmissionDecision({
    currentMember: true,
    owner: meeting.createdById === actor.userId,
    companyAdmin: membership.role === "admin",
    ended: ["ended", "cancelled"].includes(occurrence.status),
    mode: (meeting.admissionMode ?? null) as AdmissionMode | null,
    state: (participant?.admissionState as AdmissionState | null) ?? null,
    removed: !!participant?.removedAt,
    participant: !!participant,
  });
  if (!decision.discover) throw new WorkHubAccessError("forbidden");
  return { meeting, occurrence, participant, decision };
}
async function summary(
  reader: Reader,
  actor: LiveActor,
  r: Awaited<ReturnType<typeof room>>,
): Promise<LiveMeetingSummary> {
  const [host] = await reader
    .select({ name: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, r.meeting.createdById))
    .limit(1);
  const runtime = r.occurrence.runtime as MeetingRuntime;
  const connected = new Set(
    Object.values(meetingDeviceConnections(runtime))
      .filter((c) => Date.now() - c.seenAt < 30000)
      .map((c) => c.userId),
  );
  const live = ["live", "active"].includes(r.occurrence.status);
  return {
    occurrenceId: r.occurrence.id,
    title: r.meeting.title,
    agenda: r.meeting.agenda,
    hostName: host?.name ?? "Meeting host",
    startedAt: runtime.startedAt ?? null,
    plannedEndsAt: r.occurrence.endsAt?.toISOString() ?? null,
    connectedCount: connected.size,
    admissionMode: (r.meeting.admissionMode ?? null) as AdmissionMode | null,
    ownAdmissionState:
      (r.participant?.admissionState as AdmissionState | null) ?? null,
    requestedAt: r.participant?.admissionRequestedAt?.toISOString() ?? null,
    canManage: r.decision.manage,
    canEnter: r.decision.enter && (live || r.decision.manage),
    canRequest: r.decision.request && live,
    status: r.occurrence.status,
    version: liveMeetingVersion(r.occurrence.runtime),
  };
}
export async function listLiveMeetings(actor: LiveActor) {
  await member(db, actor);
  const rows = await db
    .select({ id: occurrences.id })
    .from(occurrences)
    .innerJoin(meetings, eq(meetings.id, occurrences.meetingId))
    .where(
      and(
        eq(meetings.ownerOrgType, "vendor"),
        eq(meetings.ownerOrgId, actor.vendorId!),
        inArray(occurrences.status, ["live", "active"]),
        sql`(${meetings.admissionMode} is not null or exists(select 1 from work_hub_meeting_participants p where p.occurrence_id=${occurrences.id} and p.user_id=${actor.userId} and p.removed_at is null)) and not exists(select 1 from work_hub_calls c where c.occurrence_id=${occurrences.id})`,
      ),
    )
    .orderBy(desc(occurrences.startsAt))
    .limit(100);
  const out: LiveMeetingSummary[] = [];
  for (const row of rows) {
    try {
      out.push(await summary(db, actor, await room(db, actor, row.id)));
    } catch (e) {
      if (!(e instanceof WorkHubAccessError)) throw e;
    }
  }
  return out;
}
async function companyMembers(
  reader: Reader,
  vendorId: number,
  lock = false,
  ids?: number[],
) {
  const q = reader
    .select({
      userId: usersTable.id,
      name: usersTable.displayName,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(usersTable, eq(usersTable.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgType, "vendor"),
        eq(memberships.vendorId, vendorId),
        isNull(usersTable.suspendedAt),
        ids ? inArray(usersTable.id, ids) : undefined,
      ),
    )
    .orderBy(usersTable.id)
    .limit(ids?.length ?? 500);
  return lock ? q.for("share") : q;
}
export async function getLiveMeeting(actor: LiveActor, id: string) {
  const r = await room(db, actor, id),
    people = r.decision.manage ? await companyMembers(db, actor.vendorId!) : [];
  const requests =
    r.decision.manage && ["live", "active"].includes(r.occurrence.status)
      ? await db
          .select()
          .from(participants)
          .where(
            and(
              eq(participants.occurrenceId, id),
              eq(participants.admissionState, "pending"),
              isNull(participants.removedAt),
            ),
          )
      : [];
  const requestPeople = requests.length
    ? await companyMembers(db, actor.vendorId!, false, [
        ...new Set(requests.map((p) => p.userId)),
      ])
    : [];
  return {
    meeting: await summary(db, actor, r),
    members: people.map((p) => ({
      userId: p.userId,
      name: p.name ?? "Company member",
    })),
    requests: requests
      .filter(
        (p) =>
          p.admissionRequestedAt &&
          requestPeople.some((m) => m.userId === p.userId),
      )
      .map((p) => ({
        userId: p.userId,
        name:
          requestPeople.find((m) => m.userId === p.userId)?.name ??
          "Company member",
        requestedAt: p.admissionRequestedAt!.toISOString(),
      })),
  };
}
export async function requireRoomAdmission(
  reader: Reader,
  actor: LiveActor,
  id: string,
) {
  const r = await room(reader, actor, id);
  // Past admitted members retain history access; active() still fences live actions.
  if (
    !r.decision.enter &&
    !(
      ["ended", "cancelled"].includes(r.occurrence.status) &&
      r.participant &&
      !r.participant.removedAt &&
      (r.participant.admissionState === "admitted" || r.decision.manage)
    )
  )
    throw new WorkHubAccessError("forbidden");
  if (!r.participant || r.participant.admissionState !== "admitted")
    throw new WorkHubAccessError("forbidden");
}
function ownerEnvelope(actor: LiveActor, e: WorkHubCommandEnvelope) {
  if (
    e.owner.type !== "vendor" ||
    e.owner.id !== actor.vendorId ||
    e.context.kind !== "organization" ||
    e.context.id !== actor.vendorId
  )
    throw new WorkHubAccessError("forbidden");
}
async function auditChange(
  tx: Tx,
  actor: LiveActor,
  id: string,
  e: WorkHubCommandEnvelope,
  action: string,
  version: number,
) {
  await tx.insert(audit).values({
    actorUserId: actor.userId,
    ownerOrgType: "vendor",
    ownerOrgId: actor.vendorId!,
    action,
    subjectType: "meeting",
    subjectId: id,
    operationId: e.operationId,
    source: actor.source ?? "web",
    priorVersion: Math.max(0, version - 1),
    newVersion: version,
  });
}
export async function startLiveMeeting(
  actor: LiveActor,
  e: WorkHubCommandEnvelope,
) {
  ownerEnvelope(actor, e);
  const p = LiveMeetingStartSchema.parse(e.payload);
  const fingerprint = liveMeetingFingerprint(
    actor.userId,
    "meeting.live.start",
    "new",
    { ...e, payload: p },
  );
  const result = await executeWorkHubCommand(
    { userId: actor.userId, source: actor.source ?? "web" },
    "meeting.live.start",
    e,
    async (tx) => {
      const now = new Date();
      const ids = [...new Set([actor.userId, ...p.participantUserIds])];
      const people = await companyMembers(tx, actor.vendorId!, true, ids);
      if (ids.some((id) => !people.some((m) => m.userId === id)))
        throw new WorkHubAccessError("forbidden");
      const [meeting] = await tx
        .insert(meetings)
        .values({
          ownerOrgType: "vendor",
          ownerOrgId: actor.vendorId!,
          createdById: actor.userId,
          title: p.title,
          agenda: p.agenda ?? null,
          timezone: "America/Chicago",
          admissionMode: p.admissionMode,
        })
        .returning();
      const [occurrence] = await tx
        .insert(occurrences)
        .values({
          meetingId: meeting.id,
          startsAt: now,
          endsAt: new Date(now.getTime() + 3600000),
          status: "live",
          runtime: { startedAt: now.toISOString(), admissionVersion: 0 },
        })
        .returning();
      await tx.insert(participants).values(
        ids.map((id) => ({
          occurrenceId: occurrence.id,
          userId: id,
          role: id === actor.userId ? "host" : "participant",
          admissionState: id === actor.userId ? "admitted" : "pending",
        })),
      );
      await queueLiveMeetingNotification(tx, {
        userIds: ids.filter((id) => id !== actor.userId),
        occurrenceId: occurrence.id,
        identity: `invite:${e.operationId}`,
        title: "Meeting happening now",
        body: `${actor.displayName ?? "Your host"} invited you to ${p.title}`,
      });
      await auditChange(tx, actor, occurrence.id, e, "meeting.live.started", 0);
      return {
        meeting: await summary(tx, actor, await room(tx, actor, occurrence.id)),
        commandFingerprint: fingerprint,
        notificationState: "queued",
      };
    },
    async (tx) => {
      const m = await member(tx, actor, true);
      if (m.role !== "admin") throw new WorkHubAccessError("forbidden");
    },
  );
  verifyLiveMeetingReplay(result, fingerprint);
  return result;
}
async function command(
  actor: LiveActor,
  id: string,
  e: WorkHubCommandEnvelope,
  kind: string,
  manage: boolean,
  apply: (tx: Tx, r: Awaited<ReturnType<typeof room>>) => Promise<void | false>,
  targetUserId?: number,
  effectivePayload: unknown = {},
) {
  ownerEnvelope(actor, e);
  const fingerprint = liveMeetingFingerprint(actor.userId, kind, id, {
    ...e,
    payload: effectivePayload,
    targetUserId,
  });
  const result = await executeWorkHubCommand(
    { userId: actor.userId, source: actor.source ?? "web" },
    kind,
    e,
    async (tx) => {
      const r = await room(tx, actor, id, true);
      if (["ended", "cancelled"].includes(r.occurrence.status))
        throw Object.assign(new Error("This meeting has ended"), {
          status: 409,
        });
      if (manage)
        requireMeetingVersion(r.occurrence.runtime, e.expectedVersion);
      const changed = (await apply(tx, r)) !== false;
      const version =
        liveMeetingVersion(r.occurrence.runtime) + (changed ? 1 : 0);
      if (changed) {
        await tx
          .update(occurrences)
          .set({
            runtime: { ...r.occurrence.runtime, admissionVersion: version },
          })
          .where(eq(occurrences.id, id));
        await auditChange(tx, actor, id, e, kind, version);
      }
      const [affected] = targetUserId
        ? await tx
            .select()
            .from(participants)
            .where(
              and(
                eq(participants.occurrenceId, id),
                eq(participants.userId, targetUserId),
              ),
            )
            .limit(1)
        : [];
      const admission = affected
        ? LiveMeetingAdmissionReceiptSchema.parse({
            occurrenceId: id,
            targetUserId: affected.userId,
            admissionState: affected.admissionState,
            requestedAt: affected.admissionRequestedAt?.toISOString() ?? null,
            decidedAt: affected.admissionDecidedAt?.toISOString() ?? null,
            decidedById: affected.admissionDecidedById,
            version,
          })
        : undefined;
      return {
        meeting: await summary(tx, actor, await room(tx, actor, id)),
        notificationState: "queued",
        commandFingerprint: fingerprint,
        ...(admission ? { admission } : {}),
      };
    },
    async (tx) => {
      const r = await room(tx, actor, id, true);
      if (manage && !r.decision.manage)
        throw new WorkHubAccessError("forbidden");
    },
  );
  verifyLiveMeetingReplay(result, fingerprint);
  return result;
}
export async function requestMeetingAdmission(
  actor: LiveActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  return command(
    actor,
    id,
    e,
    "meeting.admission.request",
    false,
    async (tx, r) => {
      if (
        !["live", "active"].includes(r.occurrence.status) &&
        !r.decision.manage
      )
        throw Object.assign(
          new Error("The host has not started this meeting yet"),
          { status: 409 },
        );
      if (!r.decision.enter && !r.decision.request)
        throw new WorkHubAccessError("forbidden");
      if (
        r.participant?.admissionState === "admitted" ||
        (r.participant?.admissionRequestedAt && !r.decision.enter)
      )
        return false;
      const now = new Date(),
        admitted = r.decision.enter;
      await tx
        .insert(participants)
        .values({
          occurrenceId: id,
          userId: actor.userId,
          role: r.decision.manage ? "host" : "participant",
          admissionState: admitted ? "admitted" : "pending",
          admissionRequestedAt: admitted ? null : now,
        })
        .onConflictDoUpdate({
          target: [participants.occurrenceId, participants.userId],
          set: {
            role: r.decision.manage
              ? "host"
              : (r.participant?.role ?? "participant"),
            admissionState: admitted ? "admitted" : "pending",
            admissionRequestedAt: admitted ? null : now,
          },
        });
      if (!admitted) {
        const people = await companyMembers(tx, actor.vendorId!, true),
          owner = await companyMembers(tx, actor.vendorId!, true, [
            r.meeting.createdById,
          ]);
        await queueLiveMeetingNotification(tx, {
          userIds: [
            ...new Set([
              ...owner.map((m) => m.userId),
              ...people.filter((m) => m.role === "admin").map((m) => m.userId),
            ]),
          ],
          occurrenceId: id,
          identity: `request:${actor.userId}`,
          title: "Meeting join request",
          body: `${actor.displayName ?? "A company member"} is asking to join ${r.meeting.title}`,
        });
      }
      return;
    },
    actor.userId,
  );
}
export async function decideMeetingAdmission(
  actor: LiveActor,
  id: string,
  targetUserId: number,
  e: WorkHubCommandEnvelope,
) {
  const p = z
    .object({ decision: z.enum(["admit", "decline"]) })
    .parse(e.payload);
  return command(
    actor,
    id,
    e,
    "meeting.admission.decide",
    true,
    async (tx, r) => {
      const people = await companyMembers(tx, actor.vendorId!, true, [
        targetUserId,
      ]);
      if (!people.some((m) => m.userId === targetUserId))
        throw new WorkHubAccessError("forbidden");
      const [target] = await tx
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.occurrenceId, id),
            eq(participants.userId, targetUserId),
          ),
        )
        .limit(1);
      if (
        !target ||
        target.removedAt ||
        target.admissionState !== "pending" ||
        !target.admissionRequestedAt
      )
        throw Object.assign(new Error("Join request changed"), { status: 409 });
      await tx
        .update(participants)
        .set({
          admissionState: p.decision === "admit" ? "admitted" : "declined",
          admissionDecidedAt: new Date(),
          admissionDecidedById: actor.userId,
        })
        .where(eq(participants.id, target.id));
      await queueLiveMeetingNotification(tx, {
        userIds: [targetUserId],
        occurrenceId: id,
        identity: `decision:${e.operationId}`,
        title:
          p.decision === "admit"
            ? "You can join the meeting"
            : "Meeting request declined",
        body: r.meeting.title,
      });
    },
    targetUserId,
    p,
  );
}
export async function inviteLiveMeetingMembers(
  actor: LiveActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  const p = z
    .object({
      participantUserIds: z.array(z.number().int().positive()).min(1).max(500),
    })
    .parse(e.payload);
  return command(
    actor,
    id,
    e,
    "meeting.live.invite",
    true,
    async (tx, r) => {
      const people = await companyMembers(
        tx,
        actor.vendorId!,
        true,
        p.participantUserIds,
      );
      if (
        p.participantUserIds.some((id) => !people.some((m) => m.userId === id))
      )
        throw new WorkHubAccessError("forbidden");
      const prior = await tx
        .select()
        .from(participants)
        .where(eq(participants.occurrenceId, id));
      if (
        prior.some(
          (row) => row.removedAt && p.participantUserIds.includes(row.userId),
        )
      )
        throw new WorkHubAccessError("forbidden");
      await tx
        .insert(participants)
        .values(
          [...new Set(p.participantUserIds)].map((userId) => ({
            occurrenceId: id,
            userId,
            admissionState: "pending",
          })),
        )
        .onConflictDoNothing();
      await queueLiveMeetingNotification(tx, {
        userIds: p.participantUserIds.filter(
          (uid) => !prior.some((p) => p.userId === uid && p.removedAt),
        ),
        occurrenceId: id,
        identity: `invite:${e.operationId}`,
        title: "Meeting happening now",
        body: r.meeting.title,
      });
    },
    undefined,
    p,
  );
}
export async function changeMeetingAdmission(
  actor: LiveActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  const p = z.object({ admissionMode: LiveMeetingModeSchema }).parse(e.payload);
  return command(
    actor,
    id,
    e,
    "meeting.admission.mode",
    true,
    async (tx, r) => {
      if (!r.meeting.admissionMode)
        await tx
          .update(participants)
          .set({ admissionState: "admitted" })
          .where(
            and(
              eq(participants.occurrenceId, id),
              isNull(participants.admissionState),
              isNull(participants.removedAt),
            ),
          );
      await tx
        .update(meetings)
        .set({ admissionMode: p.admissionMode })
        .where(eq(meetings.id, r.meeting.id));
    },
    undefined,
    p,
  );
}

export async function canManageLiveMeeting(
  reader: Reader,
  actor: LiveActor,
  id: string,
) {
  return (await room(reader, actor, id)).decision.manage;
}
