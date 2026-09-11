import express, { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db, usersTable, workHubMeetingsTable as meetings, workHubMeetingOccurrencesTable as occurrences,
  workHubMeetingParticipantsTable as participants, workHubMeetingAttendanceTable as attendance,
  workHubMeetingConsentsTable as consents, workHubMeetingChatTable as chat,
  workHubMeetingArtifactsTable as artifacts, workHubTranscriptSegmentsTable as segments,
  workHubCallsTable as calls,
  vendorPeopleTable, partnerContactsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { getObjectStore } from "../lib/objectStore";
import { sessionCanSeeOwner } from "../work-hub/owner-boundary";
import { appendWorkHubAudit } from "../work-hub/audit";
import { resolveVndrlyIceServers } from "../work-hub/audio-provider";
import { audioIceServers } from "../work-hub/internal-audio";
import { nativeTranscriptionAvailable, transcribeNativeAudio } from "../work-hub/native-transcription";
import {
  AssemblyAIStreamError, assemblyAIStreamingAvailable, closeAllAssemblyAIStreams,
  closeAssemblyAIStream, openAssemblyAIStream, sendAssemblyAIFrame,
} from "../work-hub/assemblyai-streaming";
import { canReadMeetingMessage, canRemoveMeetingParticipant } from "../work-hub/meeting-collaboration";
import { appendMeetingSignal, captureAllowed, MeetingSignalCapacityError, presentUserIds, signalsForParticipant, visibleMeetingActivities, type MeetingRuntime } from "../work-hub/meeting-runtime";
import { answerMeetingQuestion } from "../work-hub/meeting-answer";
import {
  buildMeetingAnswerInput,
  meetingAnswerReservationOwned,
  parseMeetingWakeQuestion,
  releaseMeetingAnswerReservation,
  reserveMeetingAnswer,
  selectMeetingAnswerContext,
  type MeetingAnswerSourceRow,
} from "../work-hub/meeting-answer-context";
import { meetingParticipantPhotoUrls } from "../work-hub/meeting-participant-photos";

const router = Router();
type TranscriptionProvider = "native" | "assemblyai";
export function effectiveMeetingTranscriptionPolicyVersion(baseVersion: number, provider: TranscriptionProvider) {
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0 || !["native", "assemblyai"].includes(provider)) throw new Error("Invalid meeting transcription policy version");
  // This integration retains the existing audio-consent policy. Any broader
  // provider-disclosure policy change must be reviewed separately before rollout.
  return baseVersion;
}
function transcriptionProvider(env: NodeJS.ProcessEnv = process.env): TranscriptionProvider {
  return env.VNDRLY_MEETING_STT_PROVIDER === "assemblyai" ? "assemblyai" : "native";
}
function streamingTrialAudienceAllows(userIds: number[], env: NodeJS.ProcessEnv = process.env) {
  const allowed = new Set((env.VNDRLY_MEETING_STT_TRIAL_USER_IDS ?? "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0));
  return allowed.size > 0 && userIds.length > 0 && userIds.every((userId) => allowed.has(userId));
}
const committedTasks = new WeakMap<Request, Array<() => Promise<unknown>>>();
const rollbackTasks = new WeakMap<Request, Array<() => Promise<unknown>>>();
function afterCommit(req: Request, task: () => Promise<unknown>) {
  const tasks = committedTasks.get(req) ?? []; tasks.push(task); committedTasks.set(req, tasks);
}
function afterRollback(req: Request, task: () => Promise<unknown>) {
  const tasks = rollbackTasks.get(req) ?? []; tasks.push(task); rollbackTasks.set(req, tasks);
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class MeetingError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function clientSource(req: Request): "web" | "ios" {
  return req.header("x-vndrly-client") === "ios" ? "ios" : "web";
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
  const participantRecord = all.find((item) => item.userId === session.userId);
  if (!meeting || !participantRecord) {
    throw new MeetingError(404, "Meeting not found");
  }
  if (participantRecord.removedAt) {
    throw new MeetingError(403, "You no longer have access to this meeting");
  }
  const participant = participantRecord;
  if (!sessionCanSeeOwner(session, meeting.ownerOrgType, meeting.ownerOrgId)) {
    // Calls can connect an explicitly accepted external contact. Invitation to a
    // regular meeting alone does not grant access across organization boundaries.
    const [call] = await tx.select().from(calls).where(and(eq(calls.occurrenceId, id), eq(calls.status, "active"), isNotNull(calls.answeredAt), or(eq(calls.callerUserId, session.userId), eq(calls.recipientUserId, session.userId)))).limit(1);
    if (!call) throw new MeetingError(403, "You no longer have access to this meeting");
  }
  const runtime = (occurrence.runtime ?? {}) as MeetingRuntime;
  return { session: { ...session, userId: session.userId }, id, meeting, occurrence, participant, all, runtime, source: clientSource(req) };
}
type Context = Awaited<ReturnType<typeof context>>;
function active(ctx: Context) {
  if (["ended", "cancelled"].includes(ctx.occurrence.status)) throw new MeetingError(409, "This meeting has ended");
}
function host(ctx: Context) {
  if (ctx.participant.role !== "host") throw new MeetingError(403, "Only the meeting host can do this");
}
async function audit(tx: Tx, ctx: Context, action: string, metadata: Record<string, unknown> = {}) {
  await appendWorkHubAudit({ actorUserId: ctx.session.userId, owner: { type: ctx.meeting.ownerOrgType as "vendor" | "partner", id: ctx.meeting.ownerOrgId }, action, subjectType: "meeting_occurrence", subjectId: ctx.id, source: ctx.source, metadata }, tx);
}
async function captureState(tx: Tx, ctx: Context, runtime = ctx.runtime) {
  const policyVersion = effectiveMeetingTranscriptionPolicyVersion(ctx.meeting.policyVersion, transcriptionProvider());
  const accepted = await tx.select().from(consents).where(and(eq(consents.occurrenceId, ctx.id), eq(consents.policyVersion, policyVersion), eq(consents.response, "accepted")));
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
      const tasks = committedTasks.get(req) ?? []; committedTasks.delete(req);
      rollbackTasks.delete(req);
      await Promise.allSettled(tasks.map((task) => task()));
      if (!res.headersSent) res.status(status).json(result);
    } catch (error) {
      committedTasks.delete(req);
      const cleanups = rollbackTasks.get(req) ?? []; rollbackTasks.delete(req);
      const cleanupResults = await Promise.allSettled(cleanups.map((task) => task()));
      for (const result of cleanupResults) {
        if (result.status === "rejected") req.log?.error?.({ err: result.reason }, "Meeting rollback cleanup failed");
      }
      if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Invalid meeting request");
      if (error instanceof MeetingError) return sendApiError(res, error.status, "work_hub.meeting", error.message);
      return next(error);
    }
  };
}

router.post("/:occurrenceId/consent", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const payload = z.object({ policyVersion: z.number().int(), response: z.enum(["accepted", "declined"]) }).parse(req.body);
  const policyVersion = effectiveMeetingTranscriptionPolicyVersion(ctx.meeting.policyVersion, transcriptionProvider());
  if (payload.policyVersion !== policyVersion) throw new MeetingError(409, "Please review the latest transcription notice");
  const [consent] = await tx.insert(consents).values({ occurrenceId: ctx.id, userId: ctx.session.userId, ...payload }).onConflictDoUpdate({ target: [consents.occurrenceId, consents.userId, consents.policyVersion], set: { response: payload.response, respondedAt: new Date() } }).returning();
  if (payload.response === "declined") await tx.update(occurrences).set({ recordingState: "off", transcriptState: "off" }).where(eq(occurrences.id, ctx.id));
  if (payload.response === "declined") afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
  await audit(tx, ctx, "meeting.consent", { response: payload.response, policyVersion: payload.policyVersion });
  return consent;
}));

router.post("/:occurrenceId/join", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const now = Date.now();
  const [attending] = await tx.select().from(attendance).where(and(eq(attendance.occurrenceId, ctx.id), eq(attendance.userId, ctx.session.userId), isNull(attendance.leftAt))).limit(1);
  const joinedAt = attending ? ctx.runtime.presence?.[ctx.session.userId]?.joinedAt ?? attending.joinedAt.getTime() : now;
  const runtime = { ...ctx.runtime, startedAt: ctx.runtime.startedAt ?? new Date(now).toISOString(), signals: attending ? ctx.runtime.signals : (ctx.runtime.signals ?? []).filter((s) => s.fromUserId !== ctx.session.userId && s.toUserId !== ctx.session.userId), presence: { ...ctx.runtime.presence, [ctx.session.userId]: { seenAt: now, joinedAt, speaking: false } } };
  if (!attending) {
    await tx.insert(attendance).values({ occurrenceId: ctx.id, userId: ctx.session.userId });
    await tx.insert(consents).values({ occurrenceId: ctx.id, userId: ctx.session.userId, policyVersion: ctx.meeting.policyVersion, response: "declined" }).onConflictDoUpdate({ target: [consents.occurrenceId, consents.userId, consents.policyVersion], set: { response: "declined", respondedAt: new Date(now) } });
  }
  const roomId = ctx.occurrence.providerRoomId ?? `vndrly-${ctx.id}`;
  await saveRuntime(tx, ctx, runtime, { providerRoomId: roomId, status: "live", ...(!attending ? { recordingState: "off", transcriptState: "off" } : {}) });
  const [consent] = await tx.select().from(consents).where(and(eq(consents.occurrenceId, ctx.id), eq(consents.userId, ctx.session.userId), eq(consents.policyVersion, ctx.meeting.policyVersion)));
  afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
  const legacyIceServers = audioIceServers(process.env, ctx.session.userId);
  return { roomId, userId: ctx.session.userId, startedAt: runtime.startedAt, participants: ctx.all.filter((p) => !p.removedAt && (p.userId === ctx.session.userId || presentUserIds(runtime).includes(p.userId))), recordingAllowed: ctx.meeting.recordingAllowed, policyVersion: ctx.meeting.policyVersion, consentAccepted: consent?.response === "accepted", transcription: await captureState(tx, ctx, runtime), iceServers: legacyIceServers.length ? legacyIceServers : resolveVndrlyIceServers() };
}));

router.post("/:occurrenceId/leave", route(async (req, _res, tx, ctx) => {
  const presence = { ...ctx.runtime.presence }; delete presence[ctx.session.userId];
  await saveRuntime(tx, ctx, { ...ctx.runtime, presence }, { recordingState: "off", transcriptState: "off" });
  await tx.update(attendance).set({ leftAt: new Date() }).where(and(eq(attendance.occurrenceId, ctx.id), eq(attendance.userId, ctx.session.userId), isNull(attendance.leftAt)));
  await tx.update(participants).set({ muted: true, handRaisedAt: null }).where(eq(participants.id, ctx.participant.id));
  afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
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
  if (payload.muted !== undefined && payload.muted !== ctx.participant.muted) afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
  return { transcription: await captureState(tx, ctx, runtime) };
}));

router.post("/:occurrenceId/signal", route(async (req, _res, tx, ctx) => {
  active(ctx);
  const payload = z.object({ toUserId: z.number().int().positive(), kind: z.enum(["offer", "answer", "ice"]), payload: z.unknown() }).parse(req.body);
  const present = presentUserIds(ctx.runtime);
  if (!present.includes(ctx.session.userId) || !present.includes(payload.toUserId) || !ctx.all.some((p) => p.userId === payload.toUserId && !p.removedAt)) throw new MeetingError(409, "Participant is no longer connected");
  if (JSON.stringify(payload.payload ?? null).length > 64_000) throw new MeetingError(413, "Audio signal too large");
  let runtime: MeetingRuntime;
  try {
    runtime = appendMeetingSignal(ctx.runtime, { ...payload, fromUserId: ctx.session.userId });
  } catch (error) {
    if (error instanceof MeetingSignalCapacityError) throw new MeetingError(429, "Audio signaling is busy");
    throw error;
  }
  await saveRuntime(tx, ctx, runtime);
  return { sequence: runtime.sequence };
}));

router.get("/:occurrenceId/audio-state", route(async (_req, _res, tx, ctx) => {
  if (["ended", "cancelled"].includes(ctx.occurrence.status)) return { presentUserIds: [], recordingState: "off" };
  // Shipped clients use this poll as their heartbeat and send presence only
  // when toggling controls. A late poll must not undo an explicit leave.
  const presence = ctx.runtime.presence?.[ctx.session.userId];
  const runtime = presence ? { ...ctx.runtime, presence: { ...ctx.runtime.presence, [ctx.session.userId]: { ...presence, seenAt: Date.now() } } } : ctx.runtime;
  if (presence) await saveRuntime(tx, ctx, runtime);
  return { presentUserIds: presentUserIds(runtime).filter((id) => ctx.all.some((p) => p.userId === id && !p.removedAt)), recordingState: ctx.occurrence.recordingState ?? "off" };
}));

router.get("/:occurrenceId/signals", route(async (req, _res, _tx, ctx) => {
  active(ctx);
  const after = z.coerce.number().int().nonnegative().parse(req.query.after ?? req.query.since ?? 0);
  const signals = signalsForParticipant(ctx.runtime, ctx.session.userId, after);
  return req.query.after === undefined && req.query.since !== undefined ? signals : { sequence: ctx.runtime.sequence ?? 0, signals };
}));

router.post("/:occurrenceId/askv", route(async (req, _res, tx, ctx) => {
  active(ctx); host(ctx);
  const { invited } = z.object({ invited: z.boolean() }).parse(req.body);
  await tx.update(occurrences).set({ askvInvitedAt: invited ? new Date() : null, askvInvitedById: invited ? ctx.session.userId : null, transcriptState: invited ? "waiting_for_consent" : "paused" }).where(eq(occurrences.id, ctx.id));
  await tx.insert(chat).values({ occurrenceId: ctx.id, userId: ctx.session.userId, messageType: "system", body: invited ? "Ask V was invited. Transcription starts when everyone present accepts the notice. Ask V stays silent unless addressed." : "Ask V was removed. Transcription is paused." });
  await audit(tx, ctx, invited ? "meeting.askv_invited" : "meeting.askv_removed");
  if (!invited) afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
  return { invited };
}));

const nativeAudioLimit = 4 * 1024 * 1024;
const nativeAudioPayload = z.object({
  audioBase64: z.string().min(1).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mimeType: z.enum(["audio/webm", "audio/webm;codecs=opus", "audio/ogg", "audio/ogg;codecs=opus", "audio/mp4", "audio/wav", "audio/x-wav"]),
});
type CaptureBudget = { startedAt: number; count: number; active: number };
const nativeCaptureBudgets = new Map<string, CaptureBudget>();
function admitNativeCapture(meetingId: string, userId: number) {
  const now = Date.now();
  for (const [key, value] of nativeCaptureBudgets) if (!value.active && now - value.startedAt >= 60_000) nativeCaptureBudgets.delete(key);
  const keys = [`meeting:${meetingId}`, `participant:${meetingId}:${userId}`];
  if (nativeCaptureBudgets.size + keys.filter((key) => !nativeCaptureBudgets.has(key)).length > 2_000) throw new MeetingError(503, "Native transcription is busy. Please try again shortly.");
  const [meeting, participant] = keys.map((key) => {
    const value = nativeCaptureBudgets.get(key) ?? { startedAt: now, count: 0, active: 0 };
    if (now - value.startedAt >= 60_000) { value.startedAt = now; value.count = 0; }
    nativeCaptureBudgets.set(key, value);
    return value;
  });
  if (participant.active || participant.count >= 12 || meeting.count >= 60) throw new MeetingError(429, "Native transcription is receiving too much audio. Please wait before trying again.");
  meeting.count++; participant.count++; meeting.active++; participant.active++;
  return () => { meeting.active--; participant.active--; };
}
async function requireMeetingCapture(req: Request, tx: Tx) {
  const ctx = await context(req, tx);
  active(ctx);
  if (ctx.participant.muted || !presentUserIds(ctx.runtime).includes(ctx.session.userId) || !await captureState(tx, ctx)) throw new MeetingError(409, "Audio capture is paused until you are present, unmuted, and everyone present consents to Ask V.");
  return ctx;
}

async function requireStreamingCapture(req: Request, tx: Tx) {
  const ctx = await requireMeetingCapture(req, tx);
  if (transcriptionProvider() !== "assemblyai" || !assemblyAIStreamingAvailable()) throw new MeetingError(503, "Streaming transcription is not configured on this server.");
  if (!streamingTrialAudienceAllows(ctx.all.filter((participant) => !participant.removedAt).map((participant) => participant.userId))) throw new MeetingError(409, "Streaming transcription is not enabled for every attendee.");
  return ctx;
}

function streamStatus(error: AssemblyAIStreamError) {
  if (error.code === "assemblyai_session_owner") return 403;
  if (["assemblyai_invalid_audio", "assemblyai_invalid_ack", "assemblyai_sequence_gap", "assemblyai_sequence_conflict", "assemblyai_invalid_start"].includes(error.code)) return 400;
  if (["assemblyai_queue_full", "assemblyai_busy"].includes(error.code)) return 429;
  if (["assemblyai_session_missing", "assemblyai_not_ready"].includes(error.code)) return 409;
  return 503;
}

function streamRouteError(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_audio", "Invalid meeting audio request");
  if (error instanceof MeetingError) return sendApiError(res, error.status, "work_hub.meeting", error.message);
  if (error instanceof AssemblyAIStreamError) return sendApiError(res, streamStatus(error), "work_hub.streaming_transcription", error.message);
  return next(error);
}

router.post("/:occurrenceId/transcription-stream", async (req, res, next): Promise<Response | void> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const disconnected = () => { if (!res.writableEnded) abort(); };
  req.once("aborted", abort); res.once("close", disconnected);
  let opened: Awaited<ReturnType<typeof openAssemblyAIStream>> | undefined;
  try {
    const ctx = await db.transaction((tx) => requireStreamingCapture(req, tx));
    const meetingStart = Date.parse(ctx.runtime.startedAt ?? "");
    if (!Number.isFinite(meetingStart)) throw new MeetingError(409, "Join the meeting before starting transcription.");
    opened = await openAssemblyAIStream({ occurrenceId: ctx.id, userId: ctx.session.userId, startedAtMs: Math.max(0, Date.now() - meetingStart), signal: controller.signal });
    await db.transaction((tx) => requireStreamingCapture(req, tx));
    if (controller.signal.aborted || res.destroyed || res.writableEnded) {
      await closeAssemblyAIStream({ sessionId: opened.sessionId, occurrenceId: ctx.id, userId: ctx.session.userId }).catch(() => undefined);
      return;
    }
    return res.json(opened);
  } catch (error) {
    const userId = getSessionFromRequest(req)?.userId;
    if (opened && userId) await closeAssemblyAIStream({ sessionId: opened.sessionId, occurrenceId: req.params.occurrenceId, userId }).catch(() => undefined);
    if (controller.signal.aborted || res.destroyed) return;
    return streamRouteError(res, next, error);
  } finally { req.off("aborted", abort); res.off("close", disconnected); }
});

router.post("/:occurrenceId/transcription-stream/:sessionId/frame", async (req, res, next): Promise<Response | void> => {
  const sessionId = req.params.sessionId;
  const payloadSchema = z.object({ sequence: z.number().int().nonnegative(), pcmBase64: z.string().min(1), ackTurnOrder: z.number().int().nonnegative().optional() });
  const requestSession = getSessionFromRequest(req);
  const owner = requestSession?.userId ? { occurrenceId: req.params.occurrenceId, userId: requestSession.userId } : undefined;
  try {
    const ctx = await db.transaction((tx) => requireStreamingCapture(req, tx));
    if (!owner || owner.occurrenceId !== ctx.id || owner.userId !== ctx.session.userId) throw new MeetingError(403, "Meeting transcription session does not belong to this attendee.");
    const payload = payloadSchema.parse(req.body);
    const result = await sendAssemblyAIFrame({
      sessionId, ...owner, ...payload,
      // Pacing happens in the manager before this callback. The final current
      // authorization check and synchronous socket write share the short row lock.
      authorizeAndSend: async (send) => db.transaction(async (tx) => {
        const fresh = await requireStreamingCapture(req, tx);
        if (fresh.id !== owner.occurrenceId || fresh.session.userId !== owner.userId) throw new MeetingError(403, "Meeting transcription session does not belong to this attendee.");
        send();
      }),
    });
    try { await db.transaction((tx) => requireStreamingCapture(req, tx)); }
    catch (error) { await closeAssemblyAIStream({ sessionId, ...owner }).catch(() => undefined); throw error; }
    return res.json(result);
  } catch (error) {
    if (owner && error instanceof MeetingError) await closeAssemblyAIStream({ sessionId, ...owner }).catch(() => undefined);
    return streamRouteError(res, next, error);
  }
});

router.post("/:occurrenceId/transcription-stream/:sessionId/close", async (req, res, next): Promise<Response | void> => {
  try {
    const ctx = await db.transaction((tx) => context(req, tx));
    return res.json(await closeAssemblyAIStream({ sessionId: req.params.sessionId, occurrenceId: ctx.id, userId: ctx.session.userId }));
  } catch (error) { return streamRouteError(res, next, error); }
});

router.post("/:occurrenceId/transcribe-audio", async (req, res, next): Promise<Response | void> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const disconnected = () => { if (!res.writableEnded) abort(); };
  req.once("aborted", abort); res.once("close", disconnected);
  let release: (() => void) | undefined;
  try {
    if (req.aborted || res.destroyed) { abort(); return; }
    const ctx = await db.transaction((tx) => requireMeetingCapture(req, tx));
    if (transcriptionProvider() !== "native") throw new MeetingError(503, "Native transcription is not selected on this server.");
    if (!nativeTranscriptionAvailable()) throw new MeetingError(503, "Native transcription is not configured on this server.");
    if (typeof req.body?.audioBase64 === "string" && req.body.audioBase64.length > Math.ceil(nativeAudioLimit / 3) * 4) throw new MeetingError(413, "Audio must be no larger than 4 MiB.");
    const payload = nativeAudioPayload.parse(req.body);
    const audio = Buffer.from(payload.audioBase64, "base64");
    if (audio.length > nativeAudioLimit) throw new MeetingError(413, "Audio must be no larger than 4 MiB.");
    if (!audio.length || audio.toString("base64") !== payload.audioBase64) throw new MeetingError(400, "Audio must use valid, padded base64.");
    release = admitNativeCapture(ctx.id, ctx.session.userId);
    controller.signal.throwIfAborted();
    let text: string;
    try {
      // This is a local executable, never an external audio service. The first
      // transaction has committed so processing cannot hold the occurrence lock.
      text = await transcribeNativeAudio(audio, payload.mimeType, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      const invalid = (error as { code?: string })?.code === "native_transcription_invalid";
      throw new MeetingError(invalid ? 422 : 503, invalid ? "Native transcription could not process this audio." : "Native transcription is unavailable. Please try again shortly.");
    }
    if (controller.signal.aborted) return;
    if (typeof text !== "string" || text.length > 20_000) throw new MeetingError(422, "The native engine returned an invalid audio transcript.");
    // Consent, attendance, mute, removal, and meeting status may change while
    // the executable runs. Never return audio-derived text after access changes.
    await db.transaction((tx) => requireMeetingCapture(req, tx));
    if (!controller.signal.aborted && !res.destroyed) return res.json({ text: text.trim() });
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_audio", "Invalid meeting audio request");
    if (error instanceof MeetingError) {
      if (error.status === 429) res.setHeader("Retry-After", "60");
      return sendApiError(res, error.status, "work_hub.native_transcription", error.message);
    }
    return next(error);
  } finally {
    release?.(); req.off("aborted", abort); res.off("close", disconnected);
  }
});

router.post("/:occurrenceId/transcript", route(async (req, _res, tx, ctx) => {
  const payload = z.object({ id: z.string().uuid().optional(), text: z.string().trim().min(1).max(20_000), startsAtMs: z.number().int().min(0).max(2147483647), endsAtMs: z.number().int().min(0).max(2147483647) }).refine((p) => p.endsAtMs >= p.startsAtMs).parse(req.body);
  const [audio] = payload.id ? await tx.select().from(artifacts).where(and(eq(artifacts.id, payload.id), eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "audio"), eq(artifacts.state, "ready"))) : [];
  if (audio) {
    // Older hosts transcribe their already-authorized mixed audio asynchronously,
    // including after capture stops. That authorization belongs to the chunk.
    host(ctx);
    if (audio.metadata?.startsAtMs !== payload.startsAtMs || audio.metadata?.endsAtMs !== payload.endsAtMs) throw new MeetingError(409, "Transcript requires its previously authorized audio chunk");
    const [prior] = await tx.select().from(segments).where(eq(segments.id, payload.id!));
    if (prior) {
      if (prior.text !== payload.text || prior.startsAtMs !== payload.startsAtMs || prior.endsAtMs !== payload.endsAtMs || prior.speakerUserId !== null) throw new MeetingError(409, "Transcript identifier already used");
      return prior;
    }
    let [artifact] = await tx.select().from(artifacts).where(and(eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "transcript")));
    if (!artifact) [artifact] = await tx.insert(artifacts).values({ occurrenceId: ctx.id, artifactType: "transcript", state: ctx.occurrence.status === "ended" ? "complete" : "active", metadata: { consentNotice: true, mixedAudio: true } }).returning();
    const [segment] = await tx.insert(segments).values({ ...payload, artifactId: artifact.id, speakerUserId: null }).returning();
    return segment;
  }
  active(ctx);
  if (!presentUserIds(ctx.runtime).includes(ctx.session.userId) || !await captureState(tx, ctx)) throw new MeetingError(409, "Transcription is paused until everyone present consents");
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

type MeetingQuestionSource = {
  id: string;
  sourceType: "chat" | "transcript";
  userId: number | null;
  recipientUserId: number | null;
  text: string;
  createdAt: string | null;
  startsAtMs: number | null;
  endsAtMs: number | null;
  messageType: string;
};

function answerMessageId(sourceType: "chat" | "transcript", sourceId: string) {
  const hex = createHash("sha256").update(`meeting-answer:${sourceType}:${sourceId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sourceFingerprint(source: MeetingQuestionSource) {
  return createHash("sha256").update(JSON.stringify({
    id: source.id,
    sourceType: source.sourceType,
    userId: source.userId,
    recipientUserId: source.recipientUserId,
    text: source.text,
    createdAt: source.createdAt,
    startsAtMs: source.startsAtMs,
    endsAtMs: source.endsAtMs,
    messageType: source.messageType,
  })).digest("hex");
}

async function releaseOwnedMeetingAnswerReservation(occurrenceId: string, reservationKey: string, owner: string, fingerprint: string) {
  await db.transaction(async (tx) => {
    const [occurrence] = await tx.select().from(occurrences).where(eq(occurrences.id, occurrenceId)).for("update");
    if (!occurrence) return;
    const runtime = (occurrence.runtime ?? {}) as MeetingRuntime;
    if (!meetingAnswerReservationOwned(runtime, reservationKey, owner, fingerprint)) return;
    await tx.update(occurrences).set({ runtime: releaseMeetingAnswerReservation(runtime, reservationKey, owner) }).where(eq(occurrences.id, occurrenceId));
  });
}

async function loadMeetingQuestionSource(tx: Tx, ctx: Context, sourceType: "chat" | "transcript", sourceId: string): Promise<MeetingQuestionSource | null> {
  if (sourceType === "chat") {
    const [message] = await tx.select().from(chat).where(and(eq(chat.id, sourceId), eq(chat.occurrenceId, ctx.id))).limit(1);
    if (!message) return null;
    return {
      id: message.id,
      sourceType,
      userId: message.userId,
      recipientUserId: message.recipientUserId,
      text: message.body,
      createdAt: message.createdAt.toISOString(),
      startsAtMs: null,
      endsAtMs: null,
      messageType: message.messageType,
    };
  }
  const [segment] = await tx.select().from(segments).where(eq(segments.id, sourceId)).limit(1);
  if (!segment) return null;
  const [artifact] = await tx.select().from(artifacts).where(and(eq(artifacts.id, segment.artifactId), eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "transcript"))).limit(1);
  if (!artifact) return null;
  return {
    id: segment.id,
    sourceType,
    userId: segment.speakerUserId,
    recipientUserId: null,
    text: segment.text,
    createdAt: null,
    startsAtMs: segment.startsAtMs,
    endsAtMs: segment.endsAtMs,
    messageType: "transcript",
  };
}

function existingMeetingAnswer(message: typeof chat.$inferSelect | undefined, fingerprint: string) {
  if (!message) return null;
  const metadata = message.attachment as Record<string, unknown> | null;
  if (message.messageType !== "askv" || metadata?.kind !== "askv_answer" || metadata.sourceFingerprint !== fingerprint) {
    throw new MeetingError(409, "The saved question changed after it was answered");
  }
  return safeMeetingMessage(message);
}

router.post("/:occurrenceId/askv/question", async (req, res, next): Promise<Response | void> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const disconnected = () => { if (!res.writableEnded) abort(); };
  req.once("aborted", abort);
  res.once("close", disconnected);
  const reservationOwner = randomUUID();
  try {
    const prepared = await db.transaction(async (tx) => {
      const ctx = await context(req, tx);
      active(ctx);
      if (!ctx.occurrence.askvInvitedAt) throw new MeetingError(409, "Invite V before asking a meeting question");
      const payload = z.object({
        sourceId: z.string().uuid(),
        sourceType: z.enum(["chat", "transcript"]),
      }).strict().parse(req.body);
      const source = await loadMeetingQuestionSource(tx, ctx, payload.sourceType, payload.sourceId);
      if (!source || source.userId !== ctx.session.userId || source.messageType === "askv") throw new MeetingError(422, "Ask V from your own saved meeting message");
      const question = parseMeetingWakeQuestion(source.text);
      if (!question) throw new MeetingError(422, "Begin the saved question with V or Ask V");
      if (question.length > 2_000) throw new MeetingError(422, "Meeting questions must be 2,000 characters or fewer");
      const audience = source.recipientUserId === null ? "shared" as const : "private" as const;
      const otherUserId = audience === "private" ? source.recipientUserId! : undefined;
      if (otherUserId !== undefined && !ctx.all.some((participant) => participant.userId === otherUserId && !participant.removedAt)) {
        throw new MeetingError(403, "The private meeting participant is unavailable");
      }
      const fingerprint = sourceFingerprint(source);
      const answerId = answerMessageId(payload.sourceType, payload.sourceId);
      const [prior] = await tx.select().from(chat).where(and(eq(chat.id, answerId), eq(chat.occurrenceId, ctx.id))).limit(1);
      const replay = existingMeetingAnswer(prior, fingerprint);
      if (replay) return { replay };

      const nameRows = await tx.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, ctx.all.filter((participant) => !participant.removedAt).map((participant) => participant.userId)));
      const names = new Map(nameRows.map((row) => [row.id, row.displayName]));
      const messageRows = audience === "shared"
        ? await tx.select().from(chat).where(and(eq(chat.occurrenceId, ctx.id), isNull(chat.recipientUserId))).orderBy(asc(chat.createdAt))
        : await tx.select().from(chat).where(and(
          eq(chat.occurrenceId, ctx.id),
          or(
            and(eq(chat.userId, ctx.session.userId), eq(chat.recipientUserId, otherUserId!)),
            and(eq(chat.userId, otherUserId!), eq(chat.recipientUserId, ctx.session.userId)),
          ),
        )).orderBy(asc(chat.createdAt));
      const contextRows: MeetingAnswerSourceRow[] = messageRows.map((message) => ({
        id: message.id,
        kind: "chat",
        userId: message.userId,
        recipientUserId: message.recipientUserId,
        speaker: names.get(message.userId) ?? "Attendee",
        text: message.body,
        occurredAt: message.createdAt.getTime(),
        messageType: message.messageType,
      }));
      if (audience === "shared") {
        const transcriptArtifacts = await tx.select().from(artifacts).where(and(eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "transcript")));
        if (transcriptArtifacts.length) {
          const transcriptRows = await tx.select().from(segments).where(inArray(segments.artifactId, transcriptArtifacts.map((artifact) => artifact.id))).orderBy(asc(segments.startsAtMs));
          contextRows.push(...transcriptRows.map((segment) => ({
            id: segment.id,
            kind: "transcript" as const,
            userId: segment.speakerUserId,
            recipientUserId: null,
            speaker: names.get(segment.speakerUserId ?? 0) ?? "Attendee",
            text: segment.text,
            occurredAt: segment.startsAtMs,
            messageType: "transcript",
          })));
        }
      }
      const selected = selectMeetingAnswerContext({
        audience,
        requesterUserId: ctx.session.userId,
        otherUserId,
        rows: contextRows,
        maxBytes: 40 * 1024,
      });
      const reservationKey = `${payload.sourceType}:${payload.sourceId}`;
      const claim = reserveMeetingAnswer(ctx.runtime, reservationKey, fingerprint, reservationOwner);
      if (!claim.claimed) throw new MeetingError(409, "V is already answering this question");
      await saveRuntime(tx, ctx, claim.runtime);
      return {
        replay: null,
        payload,
        source,
        fingerprint,
        answerId,
        audience,
        otherUserId,
        input: buildMeetingAnswerInput({ question, audience, selected }),
      };
    });
    if (prepared.replay) return res.json({ answer: prepared.replay, replayed: true });
    controller.signal.throwIfAborted();
    let answerText: string;
    try {
      answerText = await answerMeetingQuestion(prepared.input, controller.signal);
    } catch {
      await releaseOwnedMeetingAnswerReservation(
        req.params.occurrenceId,
        `${prepared.payload.sourceType}:${prepared.payload.sourceId}`,
        reservationOwner,
        prepared.fingerprint,
      );
      if (controller.signal.aborted || res.destroyed) return;
      throw new MeetingError(503, "V could not answer this meeting question right now");
    }
    controller.signal.throwIfAborted();
    const saved = await db.transaction(async (tx) => {
      const ctx = await context(req, tx);
      active(ctx);
      if (!ctx.occurrence.askvInvitedAt) throw new MeetingError(409, "V is no longer invited to this meeting");
      const freshSource = await loadMeetingQuestionSource(tx, ctx, prepared.payload.sourceType, prepared.payload.sourceId);
      if (!freshSource || freshSource.userId !== ctx.session.userId || sourceFingerprint(freshSource) !== prepared.fingerprint) {
        throw new MeetingError(409, "The saved question changed while V was answering");
      }
      if (prepared.audience === "private" && !ctx.all.some((participant) => participant.userId === prepared.otherUserId && !participant.removedAt)) {
        throw new MeetingError(403, "The private meeting participant is unavailable");
      }
      const [prior] = await tx.select().from(chat).where(and(eq(chat.id, prepared.answerId), eq(chat.occurrenceId, ctx.id))).limit(1);
      const replay = existingMeetingAnswer(prior, prepared.fingerprint);
      if (replay) return { answer: replay, replayed: true };
      const reservationKey = `${prepared.payload.sourceType}:${prepared.payload.sourceId}`;
      if (!meetingAnswerReservationOwned(ctx.runtime, reservationKey, reservationOwner, prepared.fingerprint)) {
        throw new MeetingError(409, "The meeting answer reservation expired");
      }
      const answeredAt = new Date();
      const [message] = await tx.insert(chat).values({
        id: prepared.answerId,
        occurrenceId: ctx.id,
        userId: ctx.session.userId,
        recipientUserId: prepared.otherUserId ?? null,
        body: answerText,
        messageType: "askv",
        attachment: {
          kind: "askv_answer",
          sourceFingerprint: prepared.fingerprint,
          sourceId: prepared.source.id,
          sourceType: prepared.source.sourceType,
          requestedByUserId: ctx.session.userId,
          sourceCreatedAt: prepared.source.createdAt,
          sourceStartsAtMs: prepared.source.startsAtMs,
          sourceEndsAtMs: prepared.source.endsAtMs,
          answeredAt: answeredAt.toISOString(),
        },
        createdAt: answeredAt,
      }).returning();
      if (!message) throw new MeetingError(409, "The meeting answer could not be saved");
      await saveRuntime(tx, ctx, releaseMeetingAnswerReservation(ctx.runtime, reservationKey, reservationOwner));
      await audit(tx, ctx, "meeting.askv_answered", { private: prepared.audience === "private", sourceType: prepared.source.sourceType });
      return { answer: safeMeetingMessage(message), replayed: false };
    });
    if (!controller.signal.aborted && !res.destroyed) return res.json(saved);
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Invalid meeting question request");
    if (error instanceof MeetingError) return sendApiError(res, error.status, "work_hub.meeting", error.message);
    return next(error);
  } finally {
    req.off("aborted", abort);
    res.off("close", disconnected);
  }
});

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
  afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
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
  const transcription = await captureState(tx, ctx);
  const attendeeUserIds = ctx.all.map((participant) => participant.userId);
  const canViewOwnerProfiles = sessionCanSeeOwner(
    ctx.session,
    ctx.meeting.ownerOrgType,
    ctx.meeting.ownerOrgId,
  );
  const vendorPeople = canViewOwnerProfiles && ctx.meeting.ownerOrgType === "vendor"
    ? await tx.select({
      userId: vendorPeopleTable.userId,
      vendorId: vendorPeopleTable.vendorId,
      isActive: vendorPeopleTable.isActive,
      deletedAt: vendorPeopleTable.deletedAt,
      profilePhotoPath: vendorPeopleTable.profilePhotoPath,
      photoUrl: vendorPeopleTable.photoUrl,
    }).from(vendorPeopleTable).where(and(
      eq(vendorPeopleTable.vendorId, ctx.meeting.ownerOrgId),
      inArray(vendorPeopleTable.userId, attendeeUserIds),
      eq(vendorPeopleTable.isActive, true),
      isNull(vendorPeopleTable.deletedAt),
    ))
    : [];
  const partnerContacts = canViewOwnerProfiles && ctx.meeting.ownerOrgType === "partner"
    ? await tx.select({
      userId: partnerContactsTable.userId,
      partnerId: partnerContactsTable.partnerId,
      deletedAt: partnerContactsTable.deletedAt,
      photoUrl: partnerContactsTable.photoUrl,
    }).from(partnerContactsTable).where(and(
      eq(partnerContactsTable.partnerId, ctx.meeting.ownerOrgId),
      inArray(partnerContactsTable.userId, attendeeUserIds),
      isNull(partnerContactsTable.deletedAt),
    ))
    : [];
  const participantPhotos = meetingParticipantPhotoUrls({
    ownerOrgType: ctx.meeting.ownerOrgType,
    ownerOrgId: ctx.meeting.ownerOrgId,
    attendeeUserIds,
    canViewOwnerProfiles,
    vendorPeople,
    partnerContacts,
  });
  // Runtime includes SDP/ICE for other participants and must never be serialized.
  const { runtime: _runtime, providerRoomId: _room, ...occurrence } = ctx.occurrence;
  const provider = transcriptionProvider();
  return {
    occurrence: { ...occurrence, startedAt: ctx.runtime.startedAt ?? null, endedAt: ctx.runtime.endedAt ?? null },
    meeting: ctx.meeting, userId: ctx.session.userId, canManage: ctx.participant.role === "host", canViewAttendance: privileged,
    transcription, nativeCaptureAvailable: provider === "native" && nativeTranscriptionAvailable(),
    streamingCaptureAvailable: provider === "assemblyai" && assemblyAIStreamingAvailable() && streamingTrialAudienceAllows(ctx.all.filter((participant) => !participant.removedAt).map((participant) => participant.userId)),
    myConsent: consent[0]?.response ?? "pending",
    participants: ctx.all.map((p) => ({ userId: p.userId, displayName: names.get(p.userId) ?? "Attendee", photoUrl: participantPhotos.get(p.userId) ?? null, role: p.role, joinedAt: ctx.runtime.presence?.[p.userId]?.joinedAt, muted: p.muted, handRaisedAt: p.handRaisedAt, removedAt: p.removedAt, present: !p.removedAt && present.includes(p.userId), speaking: !p.removedAt && present.includes(p.userId) && !p.muted && Boolean(ctx.runtime.presence?.[p.userId]?.speaking) })),
    activity: visibleMeetingActivities(ctx.runtime, ctx.session.userId, ctx.all.filter((p) => !p.removedAt).map((p) => p.userId)),
    attendance: records, chat: messages.map((m) => {
      const safe = safeMeetingMessage(m);
      return safe ? { ...safe, displayName: m.messageType === "askv" ? "Ask V" : names.get(m.userId) ?? "Attendee" } : null;
    }).filter((message) => message !== null),
    artifacts: meetingArtifacts, transcript: transcript.map((s) => ({ ...s, displayName: names.get(s.speakerUserId ?? 0) ?? "Attendee" })),
    recap: meetingArtifacts.find((a) => a.artifactType === "summary")?.metadata ?? null,
  };
}));

router.post("/:occurrenceId/end", route(async (req, _res, tx, ctx) => {
  host(ctx);
  if (ctx.occurrence.status === "ended") return { ended: true };
  const endedAt = new Date();
  await saveRuntime(tx, ctx, { ...ctx.runtime, endedAt: endedAt.toISOString(), presence: {}, signals: [], activity: {} }, { status: "ended", transcriptState: "complete", recordingState: "off" });
  await tx.update(attendance).set({ leftAt: endedAt }).where(and(eq(attendance.occurrenceId, ctx.id), isNull(attendance.leftAt)));
  await tx.update(artifacts).set({ state: "complete" }).where(and(eq(artifacts.occurrenceId, ctx.id), eq(artifacts.artifactType, "transcript")));
  await tx.insert(chat).values({ occurrenceId: ctx.id, userId: ctx.session.userId, messageType: "system", body: "The host ended the meeting. The shared transcript is saved." });
  await audit(tx, ctx, "meeting.ended");
  afterCommit(req, () => closeAllAssemblyAIStreams(ctx.id));
  return { ended: true };
}));

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "text/plain"]);
function publicMeetingFile(message: typeof chat.$inferSelect) {
  const attachment = message.attachment as Record<string, unknown> | null;
  return {
    ...message,
    attachment: attachment ? {
      fileName: String(attachment.fileName),
      contentType: String(attachment.contentType),
      byteSize: Number(attachment.byteSize),
      removedAt: typeof attachment.removedAt === "string" ? attachment.removedAt : null,
    } : null,
  };
}
const meetingAnswerMetadataSchema = z.object({
  kind: z.literal("askv_answer"),
  sourceFingerprint: z.string().min(1),
  sourceId: z.string().uuid(),
  sourceType: z.enum(["chat", "transcript"]),
  requestedByUserId: z.number().int().positive(),
  sourceCreatedAt: z.iso.datetime({ offset: true }).nullable(),
  sourceStartsAtMs: z.number().int().nonnegative().nullable(),
  sourceEndsAtMs: z.number().int().nonnegative().nullable(),
  answeredAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((metadata, ctx) => {
  const chatShape = metadata.sourceCreatedAt !== null && metadata.sourceStartsAtMs === null && metadata.sourceEndsAtMs === null;
  const transcriptShape = metadata.sourceCreatedAt === null && metadata.sourceStartsAtMs !== null && metadata.sourceEndsAtMs !== null && metadata.sourceEndsAtMs >= metadata.sourceStartsAtMs;
  if ((metadata.sourceType === "chat" && !chatShape) || (metadata.sourceType === "transcript" && !transcriptShape)) {
    ctx.addIssue({ code: "custom", message: "Invalid meeting answer source provenance" });
  }
});
function safeMeetingMessage(message: typeof chat.$inferSelect) {
  if (message.messageType === "askv") {
    const parsed = meetingAnswerMetadataSchema.safeParse(message.attachment);
    if (!parsed.success) return null;
    const metadata = parsed.data;
    return {
      ...message,
      displayName: "Ask V",
      attachment: null,
      askv: {
        sourceId: metadata.sourceId,
        sourceType: metadata.sourceType,
        requestedByUserId: metadata.requestedByUserId,
        sourceCreatedAt: metadata.sourceCreatedAt,
        sourceStartsAtMs: metadata.sourceStartsAtMs,
        sourceEndsAtMs: metadata.sourceEndsAtMs,
        answeredAt: metadata.answeredAt,
      },
    };
  }
  return message.messageType === "attachment" ? publicMeetingFile(message) : message;
}
router.put("/:occurrenceId/files/:fileId", express.raw({ type: () => true, limit: "25mb" }), route(async (req, _res, tx, ctx) => {
  active(ctx);
  const id = z.string().uuid().parse(req.params.fileId);
  const recipientUserId = req.query.recipient ? z.coerce.number().int().positive().parse(req.query.recipient) : null;
  if (recipientUserId !== null && !ctx.all.some((p) => p.userId === recipientUserId && !p.removedAt)) throw new MeetingError(404, "Recipient not found");
  let decodedFileName: string;
  try { decodedFileName = decodeURIComponent(req.header("x-file-name") ?? ""); }
  catch { throw new MeetingError(400, "Invalid file name"); }
  const fileName = z.string().min(1).max(255).parse(decodedFileName);
  const contentType = (req.header("content-type") ?? "").split(";")[0];
  if (!allowedTypes.has(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new MeetingError(400, "Choose a photo, PDF, or text file");
  const sha256 = createHash("sha256").update(req.body).digest("hex");
  const [existing] = await tx.select().from(chat).where(eq(chat.id, id));
  if (existing) {
    const attachment = existing.attachment as Record<string, unknown> | null;
    const matches = existing.occurrenceId === ctx.id &&
      existing.userId === ctx.session.userId &&
      (existing.recipientUserId ?? null) === recipientUserId &&
      existing.messageType === "attachment" &&
      existing.body === fileName &&
      attachment?.fileName === fileName &&
      attachment?.contentType === contentType &&
      attachment?.byteSize === req.body.length &&
      attachment?.sha256 === sha256;
    if (!matches) throw new MeetingError(409, "This file was already submitted");
    return { ...publicMeetingFile(existing), replayed: true };
  }
  const storageKey = `/objects/meetings/${ctx.id}/${id}`;
  await getObjectStore().putObject(storageKey, contentType, req.body, { owner: String(ctx.session.userId), visibility: "private" });
  afterRollback(req, () => getObjectStore().deleteObject(storageKey));
  const [message] = await tx.insert(chat).values({ id, occurrenceId: ctx.id, userId: ctx.session.userId, recipientUserId, body: fileName, messageType: "attachment", attachment: { fileName, contentType, byteSize: req.body.length, storageKey, sha256 } }).returning();
  await audit(tx, ctx, "meeting.file_added", { fileId: id, private: recipientUserId !== null });
  const activity = { ...ctx.runtime.activity }; delete activity[ctx.session.userId];
  await saveRuntime(tx, ctx, { ...ctx.runtime, activity });
  return { ...publicMeetingFile(message), replayed: false };
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
