import express, { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db, usersTable, workHubMeetingsTable as meetings, workHubMeetingOccurrencesTable as occurrences,
  workHubMeetingParticipantsTable as participants, workHubMeetingAttendanceTable as attendance,
  workHubMeetingConsentsTable as consents, workHubMeetingChatTable as chat,
  workHubMeetingArtifactsTable as artifacts, workHubTranscriptSegmentsTable as segments,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { getObjectStore } from "../lib/objectStore";
import { sessionCanSeeOwner } from "../work-hub/owner-boundary";
import { appendWorkHubAudit } from "../work-hub/audit";
import { resolveVndrlyIceServers } from "../work-hub/audio-provider";
import { canReadMeetingMessage, canRemoveMeetingParticipant } from "../work-hub/meeting-collaboration";
import { appendMeetingSignal, captureAllowed, presentUserIds, signalsForParticipant, visibleMeetingActivities, type MeetingRuntime } from "../work-hub/meeting-runtime";

const router = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class MeetingError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** All meeting mutations share a row lock, including consent, join, and removal. */
async function context(req: Request, tx: Tx) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw new MeetingError(401, "Authentication required");
  const id = z.string().uuid().parse(req.params.occurrenceId);
  const [occurrence] = await tx.select().from(occurrences).where(eq(occurrences.id, id)).for("update");
  if (!occurrence) throw new MeetingError(404, "Meeting not found");
  const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, occurrence.meetingId));
  const all = await tx.select().from(participants).where(eq(participants.occurrenceId, id));
  const participant = all.find((item) => item.userId === session.userId && !item.removedAt);
  if (!meeting || !participant || !sessionCanSeeOwner(session, meeting.ownerOrgType, meeting.ownerOrgId)) {
    throw new MeetingError(403, "You no longer have access to this meeting");
  }
  const runtime = (occurrence.runtime ?? {}) as MeetingRuntime;
  return { session: { ...session, userId: session.userId }, id, meeting, occurrence, participant, all, runtime };
}
type Context = Awaited<ReturnType<typeof context>>;
function active(ctx: Context) {
  if (["ended", "cancelled"].includes(ctx.occurrence.status)) throw new MeetingError(409, "This meeting has ended");
}
function host(ctx: Context) {
  if (ctx.participant.role !== "host") throw new MeetingError(403, "Only the meeting host can do this");
}
async function audit(tx: Tx, ctx: Context, action: string, metadata: Record<string, unknown> = {}) {
  await appendWorkHubAudit({ actorUserId: ctx.session.userId, owner: { type: ctx.meeting.ownerOrgType as "vendor" | "partner", id: ctx.meeting.ownerOrgId }, action, subjectType: "meeting_occurrence", subjectId: ctx.id, source: "web", metadata }, tx);
}
async function captureState(tx: Tx, ctx: Context, runtime = ctx.runtime) {
  const accepted = await tx.select().from(consents).where(and(eq(consents.occurrenceId, ctx.id), eq(consents.policyVersion, ctx.meeting.policyVersion), eq(consents.response, "accepted")));
  return !["ended", "cancelled"].includes(ctx.occurrence.status) && captureAllowed(Boolean(ctx.occurrence.askvInvitedAt), runtime, ctx.all.filter((p) => !p.removedAt).map((p) => p.userId), accepted.map((p) => p.userId));
}
async function saveRuntime(tx: Tx, ctx: Context, runtime: MeetingRuntime, extra: Partial<typeof occurrences.$inferInsert> = {}) {
  await tx.update(occurrences).set({ runtime: runtime as Record<string, unknown>, ...extra }).where(eq(occurrences.id, ctx.id));
}
type Handler = (req: Request, res: Response, tx: Tx, ctx: Context) => Promise<unknown>;
function route(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      // Respond after commit: a successful HTTP response must mean the write persisted.
      let status = 200;
      const result = await db.transaction(async (tx) => {
        const ctx = await context(req, tx);
        const value = await handler(req, res, tx, ctx);
        status = res.statusCode;
        return value;
      });
      if (!res.headersSent) res.status(status).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Invalid meeting request");
      if (error instanceof MeetingError) return sendApiError(res, error.status, "work_hub.meeting", error.message);
      return next(error);
    }
  };
}

router.post("/:occurrenceId/consent", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const payload = z.object({ policyVersion: z.number().int(), response: z.enum(["accepted", "declined"]) }).parse(req.body);
  if (payload.policyVersion !== ctx.meeting.policyVersion) throw new MeetingError(409, "Please review the latest transcription notice");
  const [consent] = await tx.insert(consents).values({ occurrenceId: ctx.id, userId: ctx.session.userId, ...payload }).onConflictDoUpdate({ target: [consents.occurrenceId, consents.userId, consents.policyVersion], set: { response: payload.response, respondedAt: new Date() } }).returning();
  await audit(tx, ctx, "meeting.consent", { response: payload.response, policyVersion: payload.policyVersion });
  return consent;
}));

router.post("/:occurrenceId/join", route(async (_req, _res, tx, ctx) => {
  active(ctx);
  const now = Date.now();
  const runtime = { ...ctx.runtime, startedAt: ctx.runtime.startedAt ?? new Date(now).toISOString(), signals: (ctx.runtime.signals ?? []).filter((s) => s.fromUserId !== ctx.session.userId && s.toUserId !== ctx.session.userId), presence: { ...ctx.runtime.presence, [ctx.session.userId]: { seenAt: now, joinedAt: now, speaking: false } } };
  await tx.update(attendance).set({ leftAt: new Date(now) }).where(and(eq(attendance.occurrenceId, ctx.id), eq(attendance.userId, ctx.session.userId), isNull(attendance.leftAt)));
  await tx.insert(attendance).values({ occurrenceId: ctx.id, userId: ctx.session.userId });
  const roomId = ctx.occurrence.providerRoomId ?? `vndrly-${ctx.id}`;
  await saveRuntime(tx, ctx, runtime, { providerRoomId: roomId, status: "live" });
  return { roomId, userId: ctx.session.userId, startedAt: runtime.startedAt, participants: ctx.all.filter((p) => !p.removedAt && (p.userId === ctx.session.userId || presentUserIds(runtime).includes(p.userId))), transcription: await captureState(tx, ctx, runtime), iceServers: resolveVndrlyIceServers() };
}));

router.post("/:occurrenceId/leave", route(async (_req, _res, tx, ctx) => {
  const presence = { ...ctx.runtime.presence }; delete presence[ctx.session.userId];
  await saveRuntime(tx, ctx, { ...ctx.runtime, presence });
  await tx.update(attendance).set({ leftAt: new Date() }).where(and(eq(attendance.occurrenceId, ctx.id), eq(attendance.userId, ctx.session.userId), isNull(attendance.leftAt)));
  await tx.update(participants).set({ muted: true, handRaisedAt: null }).where(eq(participants.id, ctx.participant.id));
  return { left: true };
}));

router.post("/:occurrenceId/presence", route(async (req, _res, tx, ctx) => {
  active(ctx);
  if (!ctx.runtime.presence?.[ctx.session.userId]) throw new MeetingError(409, "Join the meeting first");
  const payload = z.object({ muted: z.boolean().optional(), handRaised: z.boolean().optional(), speaking: z.boolean().default(false) }).parse(req.body);
  const muted = payload.muted ?? ctx.participant.muted;
  await tx.update(participants).set({ muted, ...(payload.handRaised === undefined ? {} : { handRaisedAt: payload.handRaised ? new Date() : null }) }).where(eq(participants.id, ctx.participant.id));
  const runtime = { ...ctx.runtime, presence: { ...ctx.runtime.presence, [ctx.session.userId]: { ...ctx.runtime.presence[ctx.session.userId], seenAt: Date.now(), speaking: !muted && payload.speaking } } };
  await saveRuntime(tx, ctx, runtime);
  return { transcription: await captureState(tx, ctx, runtime) };
}));

router.post("/:occurrenceId/signal", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const payload = z.object({ toUserId: z.number().int().positive(), kind: z.enum(["offer", "answer", "ice"]), payload: z.unknown() }).parse(req.body);
  const present = presentUserIds(ctx.runtime);
  if (!present.includes(ctx.session.userId) || !present.includes(payload.toUserId) || !ctx.all.some((p) => p.userId === payload.toUserId && !p.removedAt)) throw new MeetingError(409, "Participant is no longer connected");
  if (JSON.stringify(payload.payload ?? null).length > 64_000) throw new MeetingError(413, "Audio signal too large");
  const runtime = appendMeetingSignal(ctx.runtime, { ...payload, fromUserId: ctx.session.userId });
  await saveRuntime(tx, ctx, runtime);
  return { sequence: runtime.sequence };
}));

router.get("/:occurrenceId/signals", route(async (req, _res, _tx, ctx) => {
  active(ctx);
  const after = z.coerce.number().int().nonnegative().parse(req.query.after ?? req.query.since ?? 0);
  return { sequence: ctx.runtime.sequence ?? 0, signals: signalsForParticipant(ctx.runtime, ctx.session.userId, after) };
}));

router.post("/:occurrenceId/askv", route(async (req, _res, tx, ctx) => {
  active(ctx); host(ctx);
  const { invited } = z.object({ invited: z.boolean() }).parse(req.body);
  await tx.update(occurrences).set({ askvInvitedAt: invited ? new Date() : null, askvInvitedById: invited ? ctx.session.userId : null, transcriptState: invited ? "waiting_for_consent" : "paused" }).where(eq(occurrences.id, ctx.id));
  await tx.insert(chat).values({ occurrenceId: ctx.id, userId: ctx.session.userId, messageType: "system", body: invited ? "Ask V was invited. Transcription starts when everyone present accepts the notice. Ask V stays silent unless addressed." : "Ask V was removed. Transcription is paused." });
  await audit(tx, ctx, invited ? "meeting.askv_invited" : "meeting.askv_removed");
  return { invited };
}));

router.post("/:occurrenceId/transcript", route(async (req, _res, tx, ctx) => {
  active(ctx);
  if (!presentUserIds(ctx.runtime).includes(ctx.session.userId) || !await captureState(tx, ctx)) throw new MeetingError(409, "Transcription is paused until everyone present consents");
  const payload = z.object({ id: z.string().uuid().optional(), text: z.string().trim().min(1).max(20_000), startsAtMs: z.number().int().nonnegative(), endsAtMs: z.number().int().nonnegative() }).refine((p) => p.endsAtMs >= p.startsAtMs).parse(req.body);
  let [artifact] = await tx.select().from(artifacts).where(and(eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "transcript")));
  if (!artifact) [artifact] = await tx.insert(artifacts).values({ occurrenceId: ctx.id, artifactType: "transcript", state: "active", metadata: { policyVersion: ctx.meeting.policyVersion } }).returning();
  const [segment] = await tx.insert(segments).values({ ...payload, artifactId: artifact.id, speakerUserId: ctx.session.userId }).onConflictDoNothing().returning();
  await tx.update(occurrences).set({ transcriptState: "active" }).where(eq(occurrences.id, ctx.id));
  return { saved: true, segment: segment ?? null };
}));

router.post("/:occurrenceId/chat", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const payload = z.object({ id: z.string().uuid().optional(), body: z.string().trim().min(1).max(1_000_000), recipientUserId: z.number().int().positive().nullable().default(null) }).parse(req.body);
  if (payload.recipientUserId !== null && !ctx.all.some((p) => p.userId === payload.recipientUserId && !p.removedAt)) throw new MeetingError(404, "Recipient not found");
  const [message] = await tx.insert(chat).values({ ...payload, occurrenceId: ctx.id, userId: ctx.session.userId, messageType: "typed" }).onConflictDoNothing().returning();
  if (!message) {
    const [existing] = await tx.select().from(chat).where(and(eq(chat.id, payload.id!), eq(chat.occurrenceId, ctx.id), eq(chat.userId, ctx.session.userId)));
    if (!existing || existing.body !== payload.body || existing.recipientUserId !== payload.recipientUserId) throw new MeetingError(409, "Message identifier conflict");
    return existing;
  }
  const activity = { ...ctx.runtime.activity }; delete activity[ctx.session.userId];
  await saveRuntime(tx, ctx, { ...ctx.runtime, activity });
  return message;
}));

router.post("/:occurrenceId/activity", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const payload = z.object({ kind: z.enum(["typing", "file"]).nullable(), recipientUserId: z.number().int().positive().nullable().default(null) }).parse(req.body);
  if (payload.recipientUserId !== null && !ctx.all.some((p) => p.userId === payload.recipientUserId && !p.removedAt)) throw new MeetingError(404, "Recipient not found");
  const activity = { ...ctx.runtime.activity };
  if (payload.kind === null) delete activity[ctx.session.userId];
  else activity[ctx.session.userId] = { kind: payload.kind, recipientUserId: payload.recipientUserId, expiresAt: Date.now() + 8_000 };
  await saveRuntime(tx, ctx, { ...ctx.runtime, activity });
  return { saved: true };
}));

router.post("/:occurrenceId/participants/:userId/remove", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const userId = z.coerce.number().int().positive().parse(req.params.userId);
  const target = ctx.all.find((p) => p.userId === userId);
  if (!target || !canRemoveMeetingParticipant(ctx.participant, target)) throw new MeetingError(403, "Only the host can remove another attendee");
  const removedAt = new Date();
  await tx.update(participants).set({ removedAt, removedById: ctx.session.userId, muted: true }).where(eq(participants.id, target.id));
  await tx.update(attendance).set({ leftAt: removedAt }).where(and(eq(attendance.occurrenceId, ctx.id), eq(attendance.userId, userId), isNull(attendance.leftAt)));
  const presence = { ...ctx.runtime.presence }; delete presence[userId];
  await saveRuntime(tx, ctx, { ...ctx.runtime, presence, signals: (ctx.runtime.signals ?? []).filter((s) => s.fromUserId !== userId && s.toUserId !== userId) });
  const [user] = await tx.select({ name: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, userId));
  await tx.insert(chat).values({ occurrenceId: ctx.id, userId: ctx.session.userId, messageType: "system", body: `${user?.name ?? "An attendee"} was removed by the host.` });
  await audit(tx, ctx, "meeting.participant_removed", { removedUserId: userId });
  return { userId, removedAt };
}));

router.get("/:occurrenceId/catch-up", route(async (_req, _res, tx, ctx) => {
  const rows = await tx.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, ctx.all.map((p) => p.userId)));
  const names = new Map(rows.map((u) => [u.id, u.displayName]));
  const meetingArtifacts = await tx.select().from(artifacts).where(eq(artifacts.occurrenceId, ctx.id));
  const artifactIds = meetingArtifacts.filter((a) => a.artifactType === "transcript").map((a) => a.id);
  const messages = await tx.select().from(chat).where(and(eq(chat.occurrenceId, ctx.id), or(isNull(chat.recipientUserId), eq(chat.userId, ctx.session.userId), eq(chat.recipientUserId, ctx.session.userId)))).orderBy(asc(chat.createdAt));
  const transcript = artifactIds.length ? await tx.select().from(segments).where(inArray(segments.artifactId, artifactIds)).orderBy(asc(segments.startsAtMs)) : [];
  const consent = await tx.select().from(consents).where(and(eq(consents.occurrenceId, ctx.id), eq(consents.policyVersion, ctx.meeting.policyVersion), eq(consents.userId, ctx.session.userId)));
  const present = presentUserIds(ctx.runtime);
  const privileged = ["host", "co_host"].includes(ctx.participant.role) || ctx.session.role === "admin";
  const records = privileged ? await tx.select().from(attendance).where(eq(attendance.occurrenceId, ctx.id)).orderBy(asc(attendance.joinedAt)) : [];
  // Runtime includes SDP/ICE for other participants and must never be serialized.
  const { runtime: _runtime, providerRoomId: _room, ...occurrence } = ctx.occurrence;
  return {
    occurrence: { ...occurrence, startedAt: ctx.runtime.startedAt ?? null, endedAt: ctx.runtime.endedAt ?? null },
    meeting: ctx.meeting, userId: ctx.session.userId, canManage: ctx.participant.role === "host", canViewAttendance: privileged,
    transcription: await captureState(tx, ctx), myConsent: consent[0]?.response ?? "pending",
    participants: ctx.all.map((p) => ({ userId: p.userId, displayName: names.get(p.userId) ?? "Attendee", role: p.role, joinedAt: ctx.runtime.presence?.[p.userId]?.joinedAt, muted: p.muted, handRaisedAt: p.handRaisedAt, removedAt: p.removedAt, present: !p.removedAt && present.includes(p.userId), speaking: !p.removedAt && present.includes(p.userId) && !p.muted && Boolean(ctx.runtime.presence?.[p.userId]?.speaking) })),
    activity: visibleMeetingActivities(ctx.runtime, ctx.session.userId, ctx.all.filter((p) => !p.removedAt).map((p) => p.userId)),
    attendance: records, chat: messages.map((m) => ({ ...m, displayName: m.messageType === "askv" ? "Ask V" : names.get(m.userId) ?? "Attendee" })),
    artifacts: meetingArtifacts, transcript: transcript.map((s) => ({ ...s, displayName: names.get(s.speakerUserId ?? 0) ?? "Attendee" })),
    recap: meetingArtifacts.find((a) => a.artifactType === "summary")?.metadata ?? null,
  };
}));

router.post("/:occurrenceId/end", route(async (_req, _res, tx, ctx) => {
  host(ctx);
  if (ctx.occurrence.status === "ended") return { ended: true };
  const endedAt = new Date();
  await saveRuntime(tx, ctx, { ...ctx.runtime, endedAt: endedAt.toISOString(), presence: {}, signals: [], activity: {} }, { status: "ended", transcriptState: "complete", recordingState: "off" });
  await tx.update(attendance).set({ leftAt: endedAt }).where(and(eq(attendance.occurrenceId, ctx.id), isNull(attendance.leftAt)));
  await tx.update(artifacts).set({ state: "complete" }).where(and(eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "transcript")));
  await tx.insert(chat).values({ occurrenceId: ctx.id, userId: ctx.session.userId, messageType: "system", body: "The host ended the meeting. The shared transcript is saved." });
  await audit(tx, ctx, "meeting.ended");
  return { ended: true };
}));

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "text/plain"]);
router.put("/:occurrenceId/files/:fileId", express.raw({ type: () => true, limit: "25mb" }), route(async (req, _res, tx, ctx) => {
  active(ctx);
  const id = z.string().uuid().parse(req.params.fileId);
  const recipientUserId = req.query.recipient ? z.coerce.number().int().positive().parse(req.query.recipient) : null;
  if (recipientUserId !== null && !ctx.all.some((p) => p.userId === recipientUserId && !p.removedAt)) throw new MeetingError(404, "Recipient not found");
  const fileName = z.string().min(1).max(255).parse(decodeURIComponent(req.header("x-file-name") ?? ""));
  const contentType = (req.header("content-type") ?? "").split(";")[0];
  if (!allowedTypes.has(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new MeetingError(400, "Choose a photo, PDF, or text file");
  const [existing] = await tx.select().from(chat).where(eq(chat.id, id));
  if (existing) throw new MeetingError(409, "This file was already submitted");
  const storageKey = `/objects/meetings/${ctx.id}/${id}`;
  await getObjectStore().putObject(storageKey, contentType, req.body, { owner: String(ctx.session.userId), visibility: "private" });
  const [message] = await tx.insert(chat).values({ id, occurrenceId: ctx.id, userId: ctx.session.userId, recipientUserId, body: fileName, messageType: "attachment", attachment: { fileName, contentType, byteSize: req.body.length, storageKey } }).returning();
  await audit(tx, ctx, "meeting.file_added", { fileId: id, private: recipientUserId !== null });
  const activity = { ...ctx.runtime.activity }; delete activity[ctx.session.userId];
  await saveRuntime(tx, ctx, { ...ctx.runtime, activity });
  return message;
}));

router.get("/:occurrenceId/files/:fileId", async (req, res, next): Promise<Response | void> => {
  try {
    const file = await db.transaction(async (tx) => {
      const ctx = await context(req, tx);
      const id = z.string().uuid().parse(req.params.fileId);
      const [message] = await tx.select().from(chat).where(and(eq(chat.id, id), eq(chat.occurrenceId, ctx.id)));
      if (!message || !canReadMeetingMessage(ctx.session.userId, message.userId, message.recipientUserId) || !message.attachment || message.attachment.removedAt) throw new MeetingError(404, "File not found");
      const expectedKey = `/objects/meetings/${ctx.id}/${message.id}`;
      if (message.attachment.storageKey !== expectedKey) throw new MeetingError(404, "File not found");
      return { key: expectedKey, fileName: String(message.attachment.fileName), contentType: String(message.attachment.contentType) };
    });
    const object = await getObjectStore().getObject(file.key);
    if (!object) throw new MeetingError(404, "File not found");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${file.contentType.startsWith("image/") || file.contentType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return res.type(file.contentType).send(object.body);
  } catch (error) {
    if (error instanceof MeetingError) return sendApiError(res, error.status, "work_hub.meeting", error.message);
    if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Invalid file request");
    return next(error);
  }
});

router.delete("/:occurrenceId/files/:fileId", route(async (req, _res, tx, ctx) => {
  host(ctx);
  const id = z.string().uuid().parse(req.params.fileId);
  const [message] = await tx.select().from(chat).where(and(eq(chat.id, id), eq(chat.occurrenceId, ctx.id)));
  if (!message?.attachment || !canReadMeetingMessage(ctx.session.userId, message.userId, message.recipientUserId)) throw new MeetingError(404, "File not found");
  await tx.update(chat).set({ attachment: { ...message.attachment, removedAt: new Date().toISOString(), removedById: ctx.session.userId } }).where(eq(chat.id, id));
  await audit(tx, ctx, "meeting.file_removed", { fileId: id });
  return { removed: true };
}));

export default router;
