import { Router, raw, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  userOrgMembershipsTable,
  workHubCallsTable,
  workHubVoicemailTable,
  workHubCallSettingsTable,
  workHubChatInvitationsTable,
  workHubCollaborationChannelsTable,
  workHubMeetingsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingParticipantsTable,
} from "@workspace/db";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { WorkHubAccessError } from "../work-hub/context-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { getObjectStore } from "../lib/objectStore";
import { notifyUsers } from "./notifications";
import { transcribeAudioBuffer } from "../lib/openai-whisper";
import {
  callCanTransition,
  validVoicemailAudio,
} from "../work-hub/calls-policy";
const router: IRouter = Router();
type Actor = SessionPayload & { userId: number };
const uuid = z.string().uuid();
async function authorizedContact(a: Actor, recipientUserId: number) {
  if (a.userId === recipientUserId) throw new WorkHubAccessError("forbidden");
  const orgType = a.vendorId ? "vendor" : "partner",
    orgId = a.vendorId ?? a.partnerId;
  if (!orgId) throw new WorkHubAccessError("forbidden");
  const memberships = await db
    .select()
    .from(userOrgMembershipsTable)
    .where(
      and(
        inArray(userOrgMembershipsTable.userId, [a.userId, recipientUserId]),
        eq(userOrgMembershipsTable.orgType, orgType),
        orgType === "vendor"
          ? eq(userOrgMembershipsTable.vendorId, orgId)
          : eq(userOrgMembershipsTable.partnerId, orgId),
      ),
    );
  if (!memberships.some((m) => m.userId === a.userId))
    throw new WorkHubAccessError("forbidden");
  if (!memberships.some((m) => m.userId === recipientUserId)) {
    const [accepted] = await db
      .select()
      .from(workHubChatInvitationsTable)
      .innerJoin(
        workHubCollaborationChannelsTable,
        eq(
          workHubCollaborationChannelsTable.channelId,
          workHubChatInvitationsTable.channelId,
        ),
      )
      .where(
        and(
          eq(workHubChatInvitationsTable.status, "accepted"),
          eq(workHubCollaborationChannelsTable.kind, "chat"),
          or(
            and(
              eq(workHubChatInvitationsTable.senderUserId, a.userId),
              eq(workHubChatInvitationsTable.recipientUserId, recipientUserId),
            ),
            and(
              eq(workHubChatInvitationsTable.senderUserId, recipientUserId),
              eq(workHubChatInvitationsTable.recipientUserId, a.userId),
            ),
          ),
        ),
      )
      .limit(1);
    if (!accepted) throw new WorkHubAccessError("forbidden");
  }
  const [recipient] = await db
    .select()
    .from(usersTable)
    .where(
      and(eq(usersTable.id, recipientUserId), isNull(usersTable.suspendedAt)),
    )
    .limit(1);
  if (!recipient) throw new WorkHubAccessError("not_found");
  return {
    owner: { type: orgType as "vendor" | "partner", id: orgId },
    recipient,
  };
}
async function ownedCall(a: Actor, id: string) {
  const [call] = await db
    .select()
    .from(workHubCallsTable)
    .where(
      and(
        eq(workHubCallsTable.id, uuid.parse(id)),
        or(
          eq(workHubCallsTable.callerUserId, a.userId),
          eq(workHubCallsTable.recipientUserId, a.userId),
        ),
      ),
    )
    .limit(1);
  if (!call) throw new WorkHubAccessError("not_found");
  return call;
}
async function expireCalls(userId: number) {
  await db.transaction(async (tx) => {
    const expired = await tx
      .update(workHubCallsTable)
      .set({ status: "missed", endedAt: new Date() })
      .where(
        and(
          eq(workHubCallsTable.status, "ringing"),
          lt(workHubCallsTable.createdAt, new Date(Date.now() - 60_000)),
          or(
            eq(workHubCallsTable.callerUserId, userId),
            eq(workHubCallsTable.recipientUserId, userId),
          ),
        ),
      )
      .returning();
    if (expired.length)
      await tx
        .update(workHubMeetingOccurrencesTable)
        .set({ status: "ended", endsAt: new Date() })
        .where(
          inArray(
            workHubMeetingOccurrencesTable.id,
            expired.map((c) => c.occurrenceId),
          ),
        );
  });
}
router.use("/work-hub", async (req, res, next) => {
  if (!(await isWorkHubEnabled()))
    return sendApiError(res, 404, "work_hub.not_found", "Not found");
  const a = getSessionFromRequest(req);
  if (!a?.userId)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  res.locals.callActor = a;
  return next();
});
router.get("/work-hub/calls/settings", async (_req, res) => {
  const [settings] = await db
    .select()
    .from(workHubCallSettingsTable)
    .where(eq(workHubCallSettingsTable.userId, res.locals.callActor.userId))
    .limit(1);
  return res.json(settings ?? { available: true, speedDial: [] });
});
router.put("/work-hub/calls/settings", async (req, res) => {
  const a = res.locals.callActor as Actor;
  const p = z
    .object({
      available: z.boolean(),
      speedDial: z.array(z.number().int().positive()).max(30),
    })
    .parse(req.body);
  for (const id of p.speedDial) await authorizedContact(a, id);
  const [settings] = await db
    .insert(workHubCallSettingsTable)
    .values({ userId: a.userId, ...p })
    .onConflictDoUpdate({ target: workHubCallSettingsTable.userId, set: p })
    .returning();
  return res.json(settings);
});
router.get("/work-hub/calls", async (req, res) => {
  const a = res.locals.callActor as Actor;
  await expireCalls(a.userId);
  const filter = z
    .enum(["all", "incoming", "outgoing", "missed"])
    .parse(req.query.filter ?? "all");
  const rows = await db
    .select()
    .from(workHubCallsTable)
    .where(
      and(
        or(
          eq(workHubCallsTable.callerUserId, a.userId),
          eq(workHubCallsTable.recipientUserId, a.userId),
        ),
        filter === "incoming" || filter === "missed"
          ? eq(workHubCallsTable.recipientUserId, a.userId)
          : filter === "outgoing"
            ? eq(workHubCallsTable.callerUserId, a.userId)
            : undefined,
        filter === "missed"
          ? inArray(workHubCallsTable.status, [
              "missed",
              "declined",
              "busy",
              "unavailable",
            ])
          : undefined,
      ),
    )
    .orderBy(desc(workHubCallsTable.createdAt))
    .limit(100);
  const ids = [
    ...new Set(rows.flatMap((r) => [r.callerUserId, r.recipientUserId])),
  ];
  const people = ids.length
    ? await db
        .select({ id: usersTable.id, displayName: usersTable.displayName })
        .from(usersTable)
        .where(inArray(usersTable.id, ids))
    : [];
  return res.json(
    rows.map((r) => ({
      ...r,
      incoming: r.recipientUserId === a.userId,
      callerName: people.find((p) => p.id === r.callerUserId)?.displayName,
      recipientName: people.find((p) => p.id === r.recipientUserId)
        ?.displayName,
    })),
  );
});
router.post("/work-hub/calls", async (req, res) => {
  const a = res.locals.callActor as Actor;
  const p = z
    .object({ recipientUserId: z.number().int().positive(), operationId: uuid })
    .parse(req.body);
  const { owner, recipient } = await authorizedContact(a, p.recipientUserId);
  await expireCalls(a.userId);
  await expireCalls(p.recipientUserId);
  const result = await executeWorkHubCommand(
    { userId: a.userId, source: "web" },
    "call.create",
    {
      operationId: p.operationId,
      owner,
      context: { kind: "organization", id: owner.id },
      expectedVersion: null,
      payloadVersion: 1,
      payload: p,
    },
    async (tx) => {
      for (const userId of [a.userId, p.recipientUserId].sort((x, y) => x - y))
        await tx.execute(sql`select pg_advisory_xact_lock(73009, ${userId})`);
      const [settings] = await tx
        .select()
        .from(workHubCallSettingsTable)
        .where(eq(workHubCallSettingsTable.userId, p.recipientUserId))
        .limit(1);
      const [busy] = await tx
        .select()
        .from(workHubCallsTable)
        .where(
          and(
            inArray(workHubCallsTable.status, ["ringing", "active"]),
            gt(
              workHubCallsTable.createdAt,
              new Date(Date.now() - 2 * 60 * 60_000),
            ),
            or(
              inArray(workHubCallsTable.callerUserId, [
                a.userId,
                p.recipientUserId,
              ]),
              inArray(workHubCallsTable.recipientUserId, [
                a.userId,
                p.recipientUserId,
              ]),
            ),
          ),
        )
        .limit(1);
      const status =
        settings?.available === false
          ? "unavailable"
          : busy
            ? "busy"
            : "ringing";
      const [meeting] = await tx
        .insert(workHubMeetingsTable)
        .values({
          ownerOrgType: owner.type,
          ownerOrgId: owner.id,
          title: `Internal call with ${recipient.displayName}`,
          timezone: "UTC",
          recordingAllowed: false,
          createdById: a.userId,
        })
        .returning();
      const [occurrence] = await tx
        .insert(workHubMeetingOccurrencesTable)
        .values({
          meetingId: meeting.id,
          startsAt: new Date(),
          status: status === "ringing" ? "scheduled" : "ended",
          endsAt: status === "ringing" ? null : new Date(),
        })
        .returning();
      const [call] = await tx
        .insert(workHubCallsTable)
        .values({
          callerUserId: a.userId,
          recipientUserId: p.recipientUserId,
          occurrenceId: occurrence.id,
          status,
          endedAt: status === "ringing" ? null : new Date(),
        })
        .returning();
      // Neither party can join audio before acceptance; consent grants both participants atomically.
      return call;
    },
  );
  if (!result.replayed && result.resource.status === "ringing")
    await notifyUsers([p.recipientUserId], {
      type: "work_hub_call",
      category: "system",
      title: "Incoming internal call",
      body: a.displayName ?? "A VNDRLY contact is calling",
      link: "/work-hub/calls",
      dedupeKey: `call:${result.resource.id}`,
    });
  return res.status(result.replayed ? 200 : 201).json(result.resource);
});
router.post("/work-hub/calls/:id/respond", async (req, res) => {
  const a = res.locals.callActor as Actor;
  const { action } = z
    .object({ action: z.enum(["accept", "decline", "end"]) })
    .parse(req.body);
  await expireCalls(a.userId);
  await ownedCall(a, req.params.id);
  const result = await db.transaction(async (tx) => {
    const [call] = await tx
      .select()
      .from(workHubCallsTable)
      .where(eq(workHubCallsTable.id, req.params.id))
      .for("update")
      .limit(1);
    if (
      action === "accept" &&
      call.status === "active" &&
      call.recipientUserId === a.userId
    )
      return call;
    if (action === "end" && call.endedAt) return call;
    if (
      action === "decline" &&
      call.status === "declined" &&
      call.recipientUserId === a.userId
    )
      return call;
    if (
      !callCanTransition(call.status, action, call.recipientUserId === a.userId)
    )
      throw new WorkHubAccessError("forbidden");
    if (action === "accept")
      await tx
        .insert(workHubMeetingParticipantsTable)
        .values([
          {
            occurrenceId: call.occurrenceId,
            userId: call.callerUserId,
            role: "host",
            rsvp: "accepted",
          },
          {
            occurrenceId: call.occurrenceId,
            userId: call.recipientUserId,
            role: "participant",
            rsvp: "accepted",
          },
        ])
        .onConflictDoNothing();
    else
      await tx
        .update(workHubMeetingOccurrencesTable)
        .set({
          status: "ended",
          endsAt: new Date(),
          recordingState: "off",
          transcriptState: "off",
        })
        .where(eq(workHubMeetingOccurrencesTable.id, call.occurrenceId));
    const [updated] = await tx
      .update(workHubCallsTable)
      .set(
        action === "accept"
          ? { status: "active", answeredAt: new Date() }
          : {
              status:
                action === "decline"
                  ? "declined"
                  : call.status === "ringing"
                    ? "missed"
                    : "ended",
              endedAt: new Date(),
            },
      )
      .where(eq(workHubCallsTable.id, call.id))
      .returning();
    return updated;
  });
  return res.json(result);
});
router.get("/work-hub/voicemail", async (_req, res) => {
  const rows = await db
    .select({
      id: workHubVoicemailTable.id,
      callId: workHubVoicemailTable.callId,
      senderUserId: workHubVoicemailTable.senderUserId,
      senderName: usersTable.displayName,
      durationMs: workHubVoicemailTable.durationMs,
      transcript: workHubVoicemailTable.transcript,
      createdAt: workHubVoicemailTable.createdAt,
      readAt: workHubVoicemailTable.readAt,
    })
    .from(workHubVoicemailTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, workHubVoicemailTable.senderUserId),
    )
    .where(
      and(
        eq(workHubVoicemailTable.recipientUserId, res.locals.callActor.userId),
        isNull(workHubVoicemailTable.deletedAt),
      ),
    )
    .orderBy(desc(workHubVoicemailTable.createdAt))
    .limit(100);
  return res.json(rows);
});
router.post(
  "/work-hub/calls/:id/voicemail",
  raw({ type: "audio/*", limit: "4mb" }),
  async (req, res) => {
    const a = res.locals.callActor as Actor;
    const call = await ownedCall(a, req.params.id);
    const id = uuid.parse(req.header("x-operation-id"));
    const durationMs = z.coerce
      .number()
      .int()
      .min(1)
      .max(120000)
      .parse(req.header("x-duration-ms"));
    const contentType = (req.header("content-type") ?? "").split(";")[0]!;
    if (
      call.callerUserId !== a.userId ||
      !["missed", "declined", "busy", "unavailable"].includes(call.status)
    )
      throw new WorkHubAccessError("forbidden");
    if (
      !Buffer.isBuffer(req.body) ||
      !validVoicemailAudio(contentType, req.body)
    )
      return sendApiError(
        res,
        400,
        "work_hub.invalid_audio",
        "Record a supported audio message up to two minutes and 4 MB",
      );
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
      const [existing] = await tx
        .select()
        .from(workHubVoicemailTable)
        .where(eq(workHubVoicemailTable.id, id))
        .limit(1);
      if (existing) {
        if (existing.callId !== call.id || existing.senderUserId !== a.userId)
          throw new WorkHubAccessError("forbidden");
        return { id: existing.id, replayed: true };
      }
      const storageKey = `/objects/work-hub-voicemail/${call.recipientUserId}/${id}`;
      await getObjectStore().putObject(storageKey, contentType, req.body, {
        owner: `voicemail:${id}`,
        visibility: "private",
      });
      await tx
        .insert(workHubVoicemailTable)
        .values({
          id,
          callId: call.id,
          recipientUserId: call.recipientUserId,
          senderUserId: a.userId,
          storageKey,
          contentType,
          durationMs,
        });
      return { id, replayed: false };
    });
    if (!result.replayed)
      await notifyUsers([call.recipientUserId], {
        type: "work_hub_voicemail",
        category: "system",
        title: "New private voicemail",
        body: "An internal contact left you an audio message",
        link: "/work-hub/calls",
        dedupeKey: `voicemail:${id}`,
      });
    return res.status(result.replayed ? 200 : 201).json(result);
  },
);
async function privateVoicemail(userId: number, id: string) {
  const [row] = await db
    .select()
    .from(workHubVoicemailTable)
    .where(
      and(
        eq(workHubVoicemailTable.id, uuid.parse(id)),
        eq(workHubVoicemailTable.recipientUserId, userId),
        isNull(workHubVoicemailTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new WorkHubAccessError("not_found");
  return row;
}
router.get("/work-hub/voicemail/:id/audio", async (req, res) => {
  const row = await privateVoicemail(
    res.locals.callActor.userId,
    req.params.id,
  );
  const object = await getObjectStore().getObject(row.storageKey);
  if (!object)
    return sendApiError(
      res,
      404,
      "work_hub.audio_missing",
      "Audio is unavailable",
    );
  await db
    .update(workHubVoicemailTable)
    .set({ readAt: new Date() })
    .where(eq(workHubVoicemailTable.id, row.id));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.type(row.contentType).send(object.body);
});
router.delete("/work-hub/voicemail/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(workHubVoicemailTable)
    .where(
      and(
        eq(workHubVoicemailTable.id, uuid.parse(req.params.id)),
        eq(workHubVoicemailTable.recipientUserId, res.locals.callActor.userId),
      ),
    )
    .limit(1);
  if (!row) throw new WorkHubAccessError("not_found");
  if (row.deletedAt) return res.json({ deleted: true });
  await db
    .update(workHubVoicemailTable)
    .set({ deletedAt: new Date() })
    .where(eq(workHubVoicemailTable.id, row.id));
  return res.json({ deleted: true });
});
router.post("/work-hub/voicemail/:id/transcribe", async (req, res) => {
  const row = await privateVoicemail(
    res.locals.callActor.userId,
    req.params.id,
  );
  if (row.transcript) return res.json({ text: row.transcript });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    return sendApiError(
      res,
      503,
      "work_hub.transcription_unavailable",
      "Transcription is not configured",
    );
  const object = await getObjectStore().getObject(row.storageKey);
  if (!object) throw new WorkHubAccessError("not_found");
  const extension = row.contentType.split("/")[1];
  const text = await transcribeAudioBuffer(
    object.body,
    `voicemail.${extension}`,
    apiKey,
    row.contentType,
  );
  if (!text)
    return sendApiError(res, 422, "work_hub.no_speech", "No speech detected");
  await db
    .update(workHubVoicemailTable)
    .set({ transcript: text })
    .where(eq(workHubVoicemailTable.id, row.id));
  return res.json({ text });
});
router.use(
  (
    error: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (error instanceof WorkHubAccessError)
      return sendApiError(res, error.status, error.code, error.message);
    if (error instanceof z.ZodError)
      return sendApiError(
        res,
        400,
        "work_hub.invalid_operation",
        "Invalid call request",
      );
    return next(error);
  },
);
export default router;
