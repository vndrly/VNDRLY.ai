import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db, usersTable, workHubMeetingsTable as meetings, workHubMeetingOccurrencesTable as occurrences,
  workHubMeetingParticipantsTable as participants, workHubMeetingChatTable as chat,
  workHubMeetingArtifactsTable as artifacts, workHubTranscriptSegmentsTable as transcriptSegments,
  workHubMeetingReplayManifestsTable as replayManifests,
  workHubMeetingReplayAudioChunksTable as replayChunks,
  workHubMeetingReplayEventsTable as replayEvents,
  workHubMeetingReplayAssignmentsTable as replayAssignments,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { getObjectStore } from "../lib/objectStore";
import { appendWorkHubAudit } from "../work-hub/audit";
import { sessionCanSeeOwner } from "../work-hub/owner-boundary";
import {
  MAX_REPLAY_DURATION_MS, MAX_REPLAY_EVENTS, MEETING_REPLAY_RENDERER_VERSION, MEETING_REPLAY_SCHEMA_VERSION,
  MeetingReplayError, buildReplayManifest, serializeReplayEvent, validateReplayChunk, type ReplayEventType, type ReplayGap,
} from "../work-hub/meeting-replay";
import { advanceReplayProgress, normalizeWatchedIntervals, type WatchedInterval } from "../work-hub/meeting-replay-progress";

const router = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const MAX_TRANSPORT_GAP_MS = 5_000;
const MAX_CLOCK_JITTER_MS = 250;
const RECORDING_LEASE_MS = 2 * 60_000;
const VIEWER_LEASE_MS = 4 * 60 * 60_000;

class ReplayRouteError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const rollbackTasks = new WeakMap<Request, Array<() => Promise<unknown>>>();
function afterRollback(req: Request, task: () => Promise<unknown>) {
  const tasks = rollbackTasks.get(req) ?? []; tasks.push(task); rollbackTasks.set(req, tasks);
}
async function cleanupAfterRollback(req: Request) {
  const tasks = rollbackTasks.get(req) ?? []; rollbackTasks.delete(req);
  const results = await Promise.allSettled(tasks.map((task) => task()));
  for (const result of results) if (result.status === "rejected") req.log?.error?.({ err: result.reason }, "Meeting replay rollback cleanup failed");
}
function commitSucceeded(req: Request) { rollbackTasks.delete(req); }

function requireSupportedVersions(req: Request) {
  const schemaVersion = Number(req.header("x-replay-schema-version"));
  const rendererVersion = Number(req.header("x-replay-renderer-version"));
  if (schemaVersion !== MEETING_REPLAY_SCHEMA_VERSION || rendererVersion !== MEETING_REPLAY_RENDERER_VERSION) throw new ReplayRouteError(409, "Unsupported replay version");
}
function requireStoredVersions(manifest: { schemaVersion: number; rendererVersion: number }) {
  if (manifest.schemaVersion !== MEETING_REPLAY_SCHEMA_VERSION || manifest.rendererVersion !== MEETING_REPLAY_RENDERER_VERSION) throw new ReplayRouteError(409, "Unsupported replay version");
}
function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function normalizeGapSet(gaps: ReplayGap[]): ReplayGap[] {
  const sorted = [...gaps].sort((a, b) => a.startsAtMs - b.startsAtMs || a.endsAtMs - b.endsAtMs || a.reason.localeCompare(b.reason));
  const normalized: ReplayGap[] = [];
  for (const gap of sorted) {
    if (!Number.isSafeInteger(gap.startsAtMs) || !Number.isSafeInteger(gap.endsAtMs) || gap.startsAtMs < 0 || gap.endsAtMs <= gap.startsAtMs) throw new ReplayRouteError(409, "Saved replay gaps are invalid");
    const prior = normalized.at(-1);
    if (prior && gap.startsAtMs < prior.endsAtMs) {
      if (prior.reason !== gap.reason) throw new ReplayRouteError(409, "Saved replay gaps overlap");
      prior.endsAtMs = Math.max(prior.endsAtMs, gap.endsAtMs); continue;
    }
    if (prior && gap.startsAtMs === prior.endsAtMs && prior.reason === gap.reason) { prior.endsAtMs = gap.endsAtMs; continue; }
    normalized.push({ ...gap });
  }
  return normalized;
}
function normalizeRecorderGap(existing: ReplayGap[], startsAtMs: number, endsAtMs: number): ReplayGap[] {
  const normalized = normalizeGapSet(existing);
  if (endsAtMs <= startsAtMs) return normalized;
  let uncovered: ReplayGap[] = [{ startsAtMs, endsAtMs, reason: "recorder_interruption" }];
  for (const gap of normalized) uncovered = uncovered.flatMap((candidate) => {
    if (gap.endsAtMs <= candidate.startsAtMs || gap.startsAtMs >= candidate.endsAtMs) return [candidate];
    const parts: ReplayGap[] = [];
    if (candidate.startsAtMs < gap.startsAtMs) parts.push({ ...candidate, endsAtMs: gap.startsAtMs });
    if (candidate.endsAtMs > gap.endsAtMs) parts.push({ ...candidate, startsAtMs: gap.endsAtMs });
    return parts;
  });
  const combined = [...normalized, ...uncovered].sort((a, b) => a.startsAtMs - b.startsAtMs || a.endsAtMs - b.endsAtMs || a.reason.localeCompare(b.reason));
  const merged: ReplayGap[] = [];
  for (const gap of combined) {
    const prior = merged.at(-1);
    if (prior && prior.reason === gap.reason && gap.startsAtMs <= prior.endsAtMs) prior.endsAtMs = Math.max(prior.endsAtMs, gap.endsAtMs);
    else merged.push({ ...gap });
  }
  return merged;
}
function requireRecordingSession(req: Request, manifest: { recordingLeaseGeneration: number; recordingLeaseTokenHash: string | null; recordingLeaseHolderUserId: number | null; recordingLeaseIssuedAt: Date | null; recordingLeaseExpiresAt: Date | null }, userId: number) {
  const token = req.header("x-replay-session-id");
  if (!token || !manifest.recordingLeaseTokenHash || tokenHash(token) !== manifest.recordingLeaseTokenHash || manifest.recordingLeaseHolderUserId !== userId || !manifest.recordingLeaseIssuedAt || !manifest.recordingLeaseExpiresAt || manifest.recordingLeaseExpiresAt.getTime() <= Date.now()) throw new ReplayRouteError(409, "Replay recording session changed or expired");
  return manifest.recordingLeaseGeneration;
}

function source(req: Request): "web" | "ios" {
  return req.header("x-vndrly-client") === "ios" ? "ios" : "web";
}

async function context(req: Request, tx: Tx, options: { allowAdminOutsideRoster?: boolean } = {}) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw new ReplayRouteError(401, "Authentication required");
  const occurrenceId = z.string().uuid().parse(req.params.occurrenceId);
  const [occurrence] = await tx.select().from(occurrences).where(eq(occurrences.id, occurrenceId)).for("update");
  if (!occurrence) throw new ReplayRouteError(404, "Meeting replay not found");
  const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, occurrence.meetingId));
  const roster = await tx.select().from(participants).where(eq(participants.occurrenceId, occurrenceId));
  const participant = roster.find((row) => row.userId === session.userId && !row.removedAt);
  const authorizedAdmin = options.allowAdminOutsideRoster && session.role === "admin";
  if (!meeting || (!participant && !authorizedAdmin) || !sessionCanSeeOwner(session, meeting.ownerOrgType, meeting.ownerOrgId)) throw new ReplayRouteError(403, "You no longer have access to this meeting");
  return { session: { ...session, userId: session.userId }, occurrenceId, occurrence, meeting, participant, roster, source: source(req) };
}

type ReplayContext = Awaited<ReturnType<typeof context>>;
function requireRecorder(ctx: ReplayContext) {
  if (ctx.participant?.role !== "host") throw new ReplayRouteError(403, "Only the meeting host can record replay data");
  if (ctx.occurrence.status !== "live") throw new ReplayRouteError(409, "Replay recording is not active");
  if (!ctx.meeting.recordingAllowed || ctx.occurrence.recordingState !== "active") throw new ReplayRouteError(409, "Replay recording is not active");
}
function requireFinalizable(ctx: ReplayContext) {
  if (ctx.participant?.role !== "host") throw new ReplayRouteError(403, "Only the meeting host can finalize a replay");
  if (!["ended", "cancelled"].includes(ctx.occurrence.status)) throw new ReplayRouteError(409, "End the meeting before finalizing its replay");
}
function requireReplayable(ctx: ReplayContext) {
  if (!["ended", "cancelled"].includes(ctx.occurrence.status)) throw new ReplayRouteError(409, "Meeting replay is not available yet");
}
function requireAssignmentManager(ctx: ReplayContext) {
  if (ctx.participant?.role !== "host" && ctx.session.role !== "admin") throw new ReplayRouteError(403, "Only the host or an administrator can assign replay catch-up");
}
function publicAssignment(row: typeof replayAssignments.$inferSelect) {
  return { id: row.id, assigneeUserId: row.assigneeUserId, requirement: row.requirement, dueAt: row.dueAt?.toISOString() ?? null, status: row.status, watchedMs: row.watchedMs, lastPositionMs: row.lastPositionMs, completedAt: row.completedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function audit(tx: Tx, ctx: ReplayContext, action: string, metadata: Record<string, unknown>) {
  await appendWorkHubAudit({ actorUserId: ctx.session.userId, owner: { type: ctx.meeting.ownerOrgType as "vendor" | "partner", id: ctx.meeting.ownerOrgId }, action, subjectType: "meeting_replay", subjectId: ctx.occurrenceId, source: ctx.source, metadata }, tx);
}
function startedAt(ctx: ReplayContext) {
  const runtime = (ctx.occurrence.runtime ?? {}) as Record<string, unknown>;
  const date = new Date(String(runtime.startedAt ?? ""));
  if (Number.isNaN(date.getTime())) throw new ReplayRouteError(409, "The meeting start clock is unavailable");
  return date;
}
async function ensureManifest(tx: Tx, ctx: ReplayContext) {
  await tx.insert(replayManifests).values({ occurrenceId: ctx.occurrenceId, ownerOrgType: ctx.meeting.ownerOrgType, ownerOrgId: ctx.meeting.ownerOrgId, recordingOwnerUserId: ctx.session.userId, meetingStartedAt: startedAt(ctx), schemaVersion: MEETING_REPLAY_SCHEMA_VERSION, rendererVersion: MEETING_REPLAY_RENDERER_VERSION }).onConflictDoNothing({ target: replayManifests.occurrenceId });
  const [manifest] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId)).for("update");
  if (!manifest || manifest.ownerOrgType !== ctx.meeting.ownerOrgType || manifest.ownerOrgId !== ctx.meeting.ownerOrgId || manifest.recordingOwnerUserId !== ctx.session.userId || manifest.meetingStartedAt.getTime() !== startedAt(ctx).getTime()) throw new ReplayRouteError(409, "Replay recording context changed");
  requireStoredVersions(manifest);
  if (manifest.status !== "recording") throw new ReplayRouteError(409, "Replay recording is already finalized");
  return manifest;
}
function publicChunk(row: typeof replayChunks.$inferSelect) {
  return { sequence: row.sequence, startsAtMs: row.startsAtMs, endsAtMs: row.endsAtMs, contentType: row.contentType, byteSize: row.byteSize, sha256: row.sha256, downloadPath: `/api/work-hub/meetings/${row.occurrenceId}/replay/audio/${row.id}` };
}
function exactChunk(row: typeof replayChunks.$inferSelect, input: ReturnType<typeof validateReplayChunk>) {
  return row.id === input.chunkId && row.operationId === input.operationId && row.sequence === input.sequence && row.startsAtMs === input.startsAtMs && row.endsAtMs === input.endsAtMs && row.durationMs === input.durationMs && row.sampleRate === input.sampleRate && row.channelCount === input.channelCount && row.bitsPerSample === input.bitsPerSample && row.sampleCount === input.sampleCount && row.contentType === input.contentType && row.byteSize === input.byteSize && row.sha256 === input.sha256;
}
function integrityMatches(row: typeof replayChunks.$inferSelect, object: { contentType: string; body: Buffer } | null) {
  if (!object || object.contentType !== row.contentType || object.body.length !== row.byteSize) return false;
  try { return exactChunk(row, validateReplayChunk({ operationId: row.operationId, chunkId: row.id, sequence: row.sequence, startsAtMs: row.startsAtMs, endsAtMs: row.endsAtMs, contentType: row.contentType, claimedSha256: row.sha256, body: object.body })); }
  catch { return false; }
}

router.post("/:occurrenceId/replay/session", express.json({ limit: "1kb" }), async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireRecorder(ctx);
      const manifest = await ensureManifest(tx, ctx);
      const chunks = await tx.select().from(replayChunks).where(eq(replayChunks.manifestId, manifest.id)).orderBy(asc(replayChunks.sequence));
      const last = chunks.at(-1);
      const now = new Date(Date.now()); const expiresAt = new Date(now.getTime() + RECORDING_LEASE_MS);
      const recordingSessionId = randomBytes(32).toString("base64url");
      const leaseGeneration = manifest.recordingLeaseGeneration + 1;
      const lastEndMs = last?.endsAtMs ?? 0;
      const issuedOffsetMs = Math.max(lastEndMs, now.getTime() - manifest.meetingStartedAt.getTime());
      const gapMarkers = normalizeRecorderGap(manifest.gapMarkers as ReplayGap[], lastEndMs, issuedOffsetMs);
      await tx.update(replayManifests).set({ recordingLeaseGeneration: leaseGeneration, recordingLeaseTokenHash: tokenHash(recordingSessionId), recordingLeaseHolderUserId: ctx.session.userId, recordingLeaseIssuedAt: now, recordingLeaseExpiresAt: expiresAt, gapMarkers, updatedAt: now }).where(eq(replayManifests.id, manifest.id));
      await audit(tx, ctx, "meeting.replay_session_opened", { nextSequence: chunks.length, leaseGeneration });
      return { recordingSessionId, leaseGeneration, issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), startedAt: manifest.meetingStartedAt.toISOString(), nextSequence: chunks.length, admittedThroughMs: issuedOffsetMs };
    });
    return res.json(result);
  } catch (error) { return handle(error, res, next); }
});

router.put("/:occurrenceId/replay/audio/:chunkId", express.raw({ type: () => true, limit: "5mb" }), async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const input = validateReplayChunk({
      operationId: req.header("x-replay-operation-id") ?? "", chunkId: z.string().uuid().parse(req.params.chunkId),
      sequence: Number(req.header("x-replay-sequence")), startsAtMs: Number(req.header("x-replay-start-ms")), endsAtMs: Number(req.header("x-replay-end-ms")),
      contentType: req.header("content-type") ?? "", claimedSha256: req.header("x-content-sha256") ?? "", body: req.body,
    });
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireRecorder(ctx);
      const manifest = await ensureManifest(tx, ctx);
      const leaseGeneration = requireRecordingSession(req, manifest, ctx.session.userId);
      const rows = await tx.select().from(replayChunks).where(eq(replayChunks.manifestId, manifest.id)).orderBy(asc(replayChunks.sequence));
      const sameOperation = rows.find((row) => row.operationId === input.operationId || row.id === input.chunkId);
      if (sameOperation) {
        if (sameOperation.leaseGeneration !== leaseGeneration || !exactChunk(sameOperation, input)) throw new ReplayRouteError(409, "Replay operation conflicts with saved audio");
        if (sameOperation.state !== "ready" || !integrityMatches(sameOperation, await getObjectStore().getObject(sameOperation.storageKey))) throw new ReplayRouteError(409, "Replay audio is incomplete");
        return { replayed: true, chunk: publicChunk(sameOperation), status: 200 };
      }
      const prior = rows.at(-1);
      const transportGapMs = Number(req.header("x-replay-transport-gap-ms") ?? 0);
      if (!Number.isSafeInteger(transportGapMs) || transportGapMs < 0 || transportGapMs > MAX_TRANSPORT_GAP_MS) throw new ReplayRouteError(409, "Replay transport gap is invalid");
      const leaseIssuedOffsetMs = Math.max(0, manifest.recordingLeaseIssuedAt!.getTime() - manifest.meetingStartedAt.getTime());
      const expectedStartMs = Math.max(prior?.endsAtMs ?? 0, leaseIssuedOffsetMs) + transportGapMs;
      const expectedEndMs = expectedStartMs + input.durationMs;
      const serverElapsedMs = Math.max(0, Date.now() - manifest.meetingStartedAt.getTime());
      if (input.sequence !== rows.length || input.startsAtMs !== expectedStartMs || input.endsAtMs !== expectedEndMs) throw new ReplayRouteError(409, "Replay audio placement does not match the server recording clock");
      if (expectedEndMs > serverElapsedMs + MAX_CLOCK_JITTER_MS) throw new ReplayRouteError(409, "Replay audio cannot cover future meeting time");
      if (expectedEndMs < serverElapsedMs - MAX_TRANSPORT_GAP_MS) throw new ReplayRouteError(409, "Replay audio is too stale for the server recording clock");
      const storageKey = `/objects/meetings/${ctx.occurrenceId}/replay/${input.chunkId}`;
      await getObjectStore().putObject(storageKey, input.contentType, input.body, { owner: String(ctx.session.userId), visibility: "private" });
      afterRollback(req, () => getObjectStore().deleteObject(storageKey));
      const [saved] = await tx.insert(replayChunks).values({ id: input.chunkId, manifestId: manifest.id, occurrenceId: ctx.occurrenceId, operationId: input.operationId, leaseGeneration, sequence: input.sequence, startsAtMs: input.startsAtMs, endsAtMs: input.endsAtMs, durationMs: input.durationMs, sampleRate: input.sampleRate, channelCount: input.channelCount, bitsPerSample: input.bitsPerSample, sampleCount: input.sampleCount, contentType: input.contentType, byteSize: input.byteSize, sha256: input.sha256, storageKey, state: "ready", createdById: ctx.session.userId }).returning();
      await tx.update(replayManifests).set({ audioByteCount: Number(manifest.audioByteCount) + input.byteSize, audioChunkCount: manifest.audioChunkCount + 1, updatedAt: new Date() }).where(eq(replayManifests.id, manifest.id));
      await audit(tx, ctx, "meeting.replay_audio_saved", { sequence: input.sequence, byteSize: input.byteSize, transportGapMs });
      return { replayed: false, chunk: publicChunk(saved), status: 201 };
    });
    commitSucceeded(req); return res.status(result.status).json({ replayed: result.replayed, chunk: result.chunk });
  } catch (error) { await cleanupAfterRollback(req); return handle(error, res, next); }
});

const eventPayloadSchema = z.object({
  operationId: z.string().uuid(), eventType: z.enum(["transcript", "message", "file", "askv_answer", "speaker", "activity", "gap"]),
  sourceId: z.string().uuid().optional(), actorUserId: z.number().int().positive().optional(), offsetMs: z.number().int().nonnegative().max(MAX_REPLAY_DURATION_MS),
  endOffsetMs: z.number().int().nonnegative().max(MAX_REPLAY_DURATION_MS).nullable().optional(), state: z.enum(["speaking", "silent", "typing", "adding_file", "idle"]).optional(),
  reason: z.enum(["missing_audio", "consent_missing", "capture_paused", "upload_failed", "recorder_interruption", "reconnect", "file_unavailable"]).optional(),
}).strict();

async function displayName(tx: Tx, userId: number | null) {
  if (!userId) return "Attendee";
  const [user] = await tx.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.displayName ?? "Attendee";
}

async function resolveSharedEvent(tx: Tx, ctx: ReplayContext, payload: z.infer<typeof eventPayloadSchema>, eventId: string) {
  const sourceTypes = new Set<ReplayEventType>(["transcript", "message", "file", "askv_answer"]);
  if (sourceTypes.has(payload.eventType) && !payload.sourceId) throw new ReplayRouteError(422, "A saved shared source is required");
  if (!sourceTypes.has(payload.eventType) && payload.sourceId) throw new ReplayRouteError(422, "This replay event cannot reference saved content");
  if (payload.eventType === "transcript") {
    const [segment] = await tx.select().from(transcriptSegments).where(eq(transcriptSegments.id, payload.sourceId!));
    if (!segment) throw new ReplayRouteError(422, "Shared transcript source not found");
    const [artifact] = await tx.select().from(artifacts).where(and(eq(artifacts.id, segment.artifactId), eq(artifacts.occurrenceId, ctx.occurrenceId), eq(artifacts.artifactType, "transcript")));
    if (!artifact) throw new ReplayRouteError(422, "Shared transcript source not found");
    return { actorUserId: segment.speakerUserId, eventKey: `transcript:${segment.id}`, offsetMs: segment.startsAtMs, endOffsetMs: segment.endsAtMs, payload: { displayName: await displayName(tx, segment.speakerUserId), text: segment.text, startsAtMs: segment.startsAtMs, endsAtMs: segment.endsAtMs } };
  }
  if (["message", "file", "askv_answer"].includes(payload.eventType)) {
    const [message] = await tx.select().from(chat).where(and(eq(chat.id, payload.sourceId!), eq(chat.occurrenceId, ctx.occurrenceId), isNull(chat.recipientUserId)));
    const expectedType = payload.eventType === "file" ? "attachment" : payload.eventType === "askv_answer" ? "askv" : "typed";
    if (!message || message.recipientUserId !== null || message.messageType !== expectedType) throw new ReplayRouteError(422, "Shared meeting source not found");
    const name = payload.eventType === "askv_answer" ? "Ask V" : await displayName(tx, message.userId);
    if (payload.eventType === "file") {
      const attachment = message.attachment as Record<string, unknown> | null;
      if (!attachment) throw new ReplayRouteError(422, "Shared file source not found");
      const removed = Boolean(attachment.removedAt);
      return { actorUserId: message.userId, eventKey: `file:${message.id}`, offsetMs: Math.max(0, message.createdAt.getTime() - startedAt(ctx).getTime()), endOffsetMs: null, payload: { displayName: name, fileName: String(attachment.fileName), contentType: String(attachment.contentType), byteSize: Number(attachment.byteSize), ...(removed ? { removed: true } : { downloadPath: `/api/work-hub/meetings/${ctx.occurrenceId}/replay/files/${eventId}` }) } };
    }
    return { actorUserId: message.userId, eventKey: `${payload.eventType}:${message.id}`, offsetMs: Math.max(0, message.createdAt.getTime() - startedAt(ctx).getTime()), endOffsetMs: null, payload: { displayName: name, body: message.body, messageType: message.messageType } };
  }
  if (payload.eventType === "speaker" || payload.eventType === "activity") {
    throw new ReplayRouteError(422, "Transient participant activity cannot be recorded in replay");
  }
  if (payload.eventType === "gap") {
    if (!payload.reason || payload.endOffsetMs == null || payload.endOffsetMs <= payload.offsetMs) throw new ReplayRouteError(422, "A bounded replay gap is required");
    return { actorUserId: null, eventKey: `gap:${payload.offsetMs}:${payload.endOffsetMs}`, offsetMs: payload.offsetMs, endOffsetMs: payload.endOffsetMs, payload: { reason: payload.reason } };
  }
  throw new ReplayRouteError(422, "Unsupported replay event");
}

router.post("/:occurrenceId/replay/events/:eventId", express.json({ limit: "128kb" }), async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = eventPayloadSchema.parse(req.body);
    if (payload.sourceId === eventId) throw new ReplayRouteError(422, "Replay capability must not expose its source identity");
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireRecorder(ctx);
      const manifest = await ensureManifest(tx, ctx);
      const leaseGeneration = requireRecordingSession(req, manifest, ctx.session.userId);
      const resolved = await resolveSharedEvent(tx, ctx, payload, eventId);
      const existing = await tx.select().from(replayEvents).where(eq(replayEvents.manifestId, manifest.id));
      const candidate = { id: eventId, manifestId: manifest.id, occurrenceId: ctx.occurrenceId, operationId: payload.operationId, leaseGeneration, eventKey: resolved.eventKey, eventType: payload.eventType, offsetMs: resolved.offsetMs ?? payload.offsetMs, endOffsetMs: resolved.endOffsetMs ?? null, sourceId: payload.sourceId ?? null, actorUserId: resolved.actorUserId, payload: resolved.payload, createdById: ctx.session.userId };
      const prior = existing.find((event) => event.operationId === payload.operationId || event.id === eventId || event.eventKey === resolved.eventKey);
      if (prior) {
        const exact = prior.id === candidate.id && prior.operationId === candidate.operationId && prior.leaseGeneration === candidate.leaseGeneration && prior.eventKey === candidate.eventKey && prior.eventType === candidate.eventType && prior.offsetMs === candidate.offsetMs && (prior.endOffsetMs ?? null) === candidate.endOffsetMs && (prior.sourceId ?? null) === candidate.sourceId && JSON.stringify(prior.payload) === JSON.stringify(candidate.payload);
        if (!exact) throw new ReplayRouteError(409, "Replay event conflicts with saved data");
        return { replayed: true, event: serializeReplayEvent(prior as any, MAX_REPLAY_DURATION_MS), status: 200 };
      }
      if (existing.length >= MAX_REPLAY_EVENTS) throw new ReplayRouteError(409, "Replay event limit reached");
      const latestOffset = existing.reduce((latest, event) => Math.max(latest, event.offsetMs), -1);
      if (candidate.offsetMs < latestOffset) throw new ReplayRouteError(409, "Replay event timing is not monotonic");
      const [saved] = await tx.insert(replayEvents).values(candidate).returning();
      await audit(tx, ctx, "meeting.replay_event_saved", { eventType: payload.eventType, offsetMs: candidate.offsetMs });
      return { replayed: false, event: serializeReplayEvent(saved as any, MAX_REPLAY_DURATION_MS), status: 201 };
    });
    return res.status(result.status).json({ replayed: result.replayed, event: result.event });
  } catch (error) { return handle(error, res, next); }
});

const gapsSchema = z.array(z.object({ startsAtMs: z.number().int().nonnegative(), endsAtMs: z.number().int().positive(), reason: z.enum(["missing_audio", "consent_missing", "capture_paused", "upload_failed", "recorder_interruption", "reconnect", "file_unavailable"]) }).strict()).max(2_000);
async function lifecycleEnd(tx: Tx, ctx: ReplayContext, manifest: typeof replayManifests.$inferSelect) {
  const runtime = (ctx.occurrence.runtime ?? {}) as Record<string, unknown>;
  const ended = new Date(String(runtime.endedAt ?? ""));
  if (!Number.isNaN(ended.getTime())) return ended;
  if (ctx.occurrence.status === "cancelled") {
    if (manifest.meetingEndedAt) return manifest.meetingEndedAt;
    const cancelledAt = new Date(Date.now());
    await tx.update(occurrences).set({ runtime: { ...runtime, endedAt: cancelledAt.toISOString() } }).where(eq(occurrences.id, ctx.occurrenceId));
    return cancelledAt;
  }
  throw new ReplayRouteError(409, "The meeting end clock is unavailable");
}
router.post("/:occurrenceId/replay/finalize", express.json({ limit: "128kb" }), async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const payload = z.object({ durationMs: z.number().int().positive().max(12 * 60 * 60 * 1000).optional(), gaps: gapsSchema.default([]) }).strict().parse(req.body);
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireFinalizable(ctx);
      const [manifest] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId)).for("update");
      if (!manifest) throw new ReplayRouteError(409, "No replay recording was captured");
      requireStoredVersions(manifest);
      requireRecordingSession(req, manifest, ctx.session.userId);
      const endedAt = await lifecycleEnd(tx, ctx, manifest);
      const durationMs = endedAt.getTime() - manifest.meetingStartedAt.getTime();
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_REPLAY_DURATION_MS) throw new ReplayRouteError(409, "The meeting lifecycle duration is invalid");
      if (payload.durationMs !== undefined && payload.durationMs !== durationMs) throw new ReplayRouteError(409, "Replay duration does not match the server meeting clock");
      const finalGaps = normalizeGapSet([...(manifest.gapMarkers as ReplayGap[]), ...(payload.gaps as ReplayGap[])]);
      if (manifest.status === "finalized") {
        if (manifest.durationMs !== durationMs || manifest.meetingEndedAt?.getTime() !== endedAt.getTime() || JSON.stringify(manifest.gapMarkers) !== JSON.stringify(finalGaps)) throw new ReplayRouteError(409, "Replay finalization conflicts with saved data");
        return { finalized: true, replayed: true };
      }
      const chunks = await tx.select().from(replayChunks).where(eq(replayChunks.manifestId, manifest.id)).orderBy(asc(replayChunks.sequence));
      const events = await tx.select().from(replayEvents).where(eq(replayEvents.manifestId, manifest.id)).orderBy(asc(replayEvents.offsetMs));
      buildReplayManifest({ occurrenceId: ctx.occurrenceId, meetingStartedAt: manifest.meetingStartedAt, meetingStatus: ctx.occurrence.status, manifestStatus: "finalized", rendererVersion: manifest.rendererVersion, schemaVersion: manifest.schemaVersion, durationMs, chunks: chunks as any, events: events as any, explicitGaps: finalGaps });
      await tx.update(replayManifests).set({ status: "finalized", meetingEndedAt: endedAt, durationMs, gapMarkers: finalGaps, updatedAt: new Date() }).where(eq(replayManifests.id, manifest.id));
      await audit(tx, ctx, "meeting.replay_finalized", { durationMs, gapCount: finalGaps.length, chunkCount: chunks.length });
      return { finalized: true, replayed: false };
    });
    return res.json(result);
  } catch (error) { return handle(error, res, next); }
});

router.get("/:occurrenceId/replay", async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const manifest = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireReplayable(ctx);
      const [saved] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId));
      if (!saved || saved.status !== "finalized" || !saved.durationMs) throw new ReplayRouteError(404, "Meeting replay not found");
      requireStoredVersions(saved);
      const chunks = await tx.select().from(replayChunks).where(and(eq(replayChunks.manifestId, saved.id), eq(replayChunks.state, "ready"))).orderBy(asc(replayChunks.sequence));
      const events = await tx.select().from(replayEvents).where(eq(replayEvents.manifestId, saved.id)).orderBy(asc(replayEvents.offsetMs));
      const value = buildReplayManifest({ occurrenceId: ctx.occurrenceId, meetingStartedAt: saved.meetingStartedAt, meetingStatus: ctx.occurrence.status, manifestStatus: saved.status, rendererVersion: saved.rendererVersion, schemaVersion: saved.schemaVersion, durationMs: saved.durationMs, chunks: chunks as any, events: events as any, explicitGaps: saved.gapMarkers as ReplayGap[] });
      await audit(tx, ctx, "meeting.replay_viewed", { complete: value.complete, eventCount: value.events.length });
      return value;
    });
    res.setHeader("Cache-Control", "private, no-store"); return res.json(manifest);
  } catch (error) { return handle(error, res, next); }
});

const assignmentSchema = z.object({ assigneeUserId: z.number().int().positive(), requirement: z.enum(["optional", "required"]), dueAt: z.iso.datetime().nullable().optional() }).strict();
router.post("/:occurrenceId/replay/assignments", express.json({ limit: "4kb" }), async (req, res, next): Promise<Response | void> => {
  try {
    const payload = assignmentSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx, { allowAdminOutsideRoster: true }); requireReplayable(ctx); requireAssignmentManager(ctx);
      if (!ctx.roster.some((person) => person.userId === payload.assigneeUserId && !person.removedAt)) throw new ReplayRouteError(422, "Choose an authorized meeting attendee");
      const dueAt = payload.dueAt ? new Date(payload.dueAt) : null;
      const [existing] = await tx.select().from(replayAssignments).where(and(eq(replayAssignments.occurrenceId, ctx.occurrenceId), eq(replayAssignments.assigneeUserId, payload.assigneeUserId))).for("update");
      const now = new Date();
      if (existing) {
        const [saved] = await tx.update(replayAssignments).set({ requirement: payload.requirement, dueAt, assignedById: ctx.session.userId, updatedAt: now }).where(eq(replayAssignments.id, existing.id)).returning();
        await audit(tx, ctx, "meeting.replay_assignment_updated", { assigneeUserId: payload.assigneeUserId, requirement: payload.requirement, hasDueDate: Boolean(dueAt) });
        return { replayed: existing.requirement === payload.requirement && (existing.dueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null), assignment: publicAssignment(saved) };
      }
      const [saved] = await tx.insert(replayAssignments).values({ occurrenceId: ctx.occurrenceId, assigneeUserId: payload.assigneeUserId, assignedById: ctx.session.userId, requirement: payload.requirement, dueAt }).returning();
      await audit(tx, ctx, "meeting.replay_assignment_created", { assigneeUserId: payload.assigneeUserId, requirement: payload.requirement, hasDueDate: Boolean(dueAt) });
      return { replayed: false, assignment: publicAssignment(saved) };
    });
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { return handle(error, res, next); }
});

router.get("/:occurrenceId/replay/assignments", async (req, res, next): Promise<Response | void> => {
  try {
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx, { allowAdminOutsideRoster: true }); requireReplayable(ctx);
      const rows = await tx.select().from(replayAssignments).where(eq(replayAssignments.occurrenceId, ctx.occurrenceId));
      const visible = ctx.participant?.role === "host" || ctx.session.role === "admin" ? rows : rows.filter((row) => row.assigneeUserId === ctx.session.userId);
      return visible.map(publicAssignment);
    });
    res.setHeader("Cache-Control", "private, no-store"); return res.json({ assignments: result });
  } catch (error) { return handle(error, res, next); }
});

router.post("/:occurrenceId/replay/watch/session", express.json({ limit: "1kb" }), async (req, res, next): Promise<Response | void> => {
  try {
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireReplayable(ctx);
      const [manifest] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId));
      if (!manifest || manifest.status !== "finalized" || !manifest.durationMs) throw new ReplayRouteError(404, "Meeting replay not found");
      const [assignment] = await tx.select().from(replayAssignments).where(and(eq(replayAssignments.occurrenceId, ctx.occurrenceId), eq(replayAssignments.assigneeUserId, ctx.session.userId))).for("update");
      if (!assignment) return { assignment: null, viewerSessionId: null };
      const viewerSessionId = randomBytes(32).toString("base64url"); const now = new Date(); const expiresAt = new Date(now.getTime() + VIEWER_LEASE_MS);
      const [saved] = await tx.update(replayAssignments).set({ viewerGeneration: assignment.viewerGeneration + 1, viewerTokenHash: tokenHash(viewerSessionId), viewerIssuedAt: now, viewerExpiresAt: expiresAt, viewerObservedAt: now, updatedAt: now }).where(eq(replayAssignments.id, assignment.id)).returning();
      await audit(tx, ctx, "meeting.replay_watch_started", { requirement: assignment.requirement, resumed: assignment.watchedMs > 0 });
      return { assignment: publicAssignment(saved), viewerSessionId, expiresAt: expiresAt.toISOString(), durationMs: manifest.durationMs };
    });
    res.setHeader("Cache-Control", "private, no-store"); return res.json(result);
  } catch (error) { return handle(error, res, next); }
});

const progressSchema = z.object({ playheadMs: z.number().int().nonnegative().max(MAX_REPLAY_DURATION_MS) }).strict();
router.post("/:occurrenceId/replay/watch/progress", express.json({ limit: "1kb" }), async (req, res, next): Promise<Response | void> => {
  try {
    const payload = progressSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireReplayable(ctx);
      const [manifest] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId));
      if (!manifest || manifest.status !== "finalized" || !manifest.durationMs) throw new ReplayRouteError(404, "Meeting replay not found");
      const [assignment] = await tx.select().from(replayAssignments).where(and(eq(replayAssignments.occurrenceId, ctx.occurrenceId), eq(replayAssignments.assigneeUserId, ctx.session.userId))).for("update");
      const token = req.header("x-replay-view-session"); const nowMs = Date.now();
      if (!assignment || !token || !assignment.viewerTokenHash || tokenHash(token) !== assignment.viewerTokenHash || !assignment.viewerObservedAt || !assignment.viewerExpiresAt || assignment.viewerExpiresAt.getTime() <= nowMs) throw new ReplayRouteError(409, "Replay watch session changed or expired");
      const progress = advanceReplayProgress({ intervals: assignment.watchedIntervals as WatchedInterval[], durationMs: manifest.durationMs, previousPlayheadMs: assignment.lastPositionMs, currentPlayheadMs: payload.playheadMs, previousObservedAtMs: assignment.viewerObservedAt.getTime(), observedAtMs: nowMs });
      const status = progress.completed ? "completed" : progress.watchedMs > 0 ? "in_progress" : assignment.status;
      const [saved] = await tx.update(replayAssignments).set({ watchedIntervals: progress.intervals, watchedMs: progress.watchedMs, lastPositionMs: payload.playheadMs, viewerObservedAt: new Date(nowMs), status, completedAt: progress.completed ? assignment.completedAt ?? new Date(nowMs) : assignment.completedAt, updatedAt: new Date(nowMs) }).where(eq(replayAssignments.id, assignment.id)).returning();
      if (progress.completed && assignment.status !== "completed") await audit(tx, ctx, "meeting.replay_watch_completed", { requirement: assignment.requirement, durationMs: manifest.durationMs });
      return { credited: progress.credited, assignment: publicAssignment(saved), durationMs: manifest.durationMs };
    });
    res.setHeader("Cache-Control", "private, no-store"); return res.json(result);
  } catch (error) { return handle(error, res, next); }
});

router.get("/:occurrenceId/replay/files/:eventId", async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const file = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireReplayable(ctx);
      const [manifest] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId));
      if (!manifest || manifest.status !== "finalized") throw new ReplayRouteError(404, "Replay file not found");
      requireStoredVersions(manifest);
      const eventId = z.string().uuid().parse(req.params.eventId);
      const [event] = await tx.select().from(replayEvents).where(and(eq(replayEvents.id, eventId), eq(replayEvents.manifestId, manifest.id), eq(replayEvents.occurrenceId, ctx.occurrenceId), eq(replayEvents.eventType, "file")));
      if (!event?.sourceId) throw new ReplayRouteError(404, "Replay file not found");
      const [message] = await tx.select().from(chat).where(and(eq(chat.id, event.sourceId), eq(chat.occurrenceId, ctx.occurrenceId), isNull(chat.recipientUserId)));
      const attachment = message?.attachment as Record<string, unknown> | null;
      if (!message || message.messageType !== "attachment" || !attachment || attachment.removedAt) throw new ReplayRouteError(404, "Replay file not found");
      const expectedKey = `/objects/meetings/${ctx.occurrenceId}/${message.id}`;
      if (attachment.storageKey !== expectedKey) throw new ReplayRouteError(404, "Replay file not found");
      const object = await getObjectStore().getObject(expectedKey);
      const contentType = String(attachment.contentType); const byteSize = Number(attachment.byteSize);
      if (!object || object.contentType !== contentType || object.body.length !== byteSize || typeof attachment.sha256 === "string" && createHash("sha256").update(object.body).digest("hex") !== attachment.sha256) throw new ReplayRouteError(409, "Replay file failed its integrity check");
      await audit(tx, ctx, "meeting.replay_file_viewed", { byteSize });
      return { object, contentType, fileName: String(attachment.fileName) };
    });
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${file.contentType.startsWith("image/") || file.contentType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return res.type(file.contentType).send(file.object.body);
  } catch (error) { return handle(error, res, next); }
});

router.get("/:occurrenceId/replay/audio/:chunkId", async (req, res, next): Promise<Response | void> => {
  try {
    requireSupportedVersions(req);
    const result = await db.transaction(async (tx) => {
      const ctx = await context(req, tx); requireReplayable(ctx);
      const [manifest] = await tx.select().from(replayManifests).where(eq(replayManifests.occurrenceId, ctx.occurrenceId));
      if (!manifest || manifest.status !== "finalized") throw new ReplayRouteError(404, "Replay audio not found");
      requireStoredVersions(manifest);
      const id = z.string().uuid().parse(req.params.chunkId);
      const [chunk] = await tx.select().from(replayChunks).where(and(eq(replayChunks.id, id), eq(replayChunks.manifestId, manifest.id), eq(replayChunks.occurrenceId, ctx.occurrenceId), eq(replayChunks.state, "ready")));
      if (!chunk) throw new ReplayRouteError(404, "Replay audio not found");
      const object = await getObjectStore().getObject(chunk.storageKey);
      if (!integrityMatches(chunk, object)) throw new ReplayRouteError(409, "Replay audio failed its integrity check");
      await audit(tx, ctx, "meeting.replay_audio_viewed", { sequence: chunk.sequence, byteSize: chunk.byteSize });
      return { chunk, object: object! };
    });
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    return res.type(result.chunk.contentType).send(result.object.body);
  } catch (error) { return handle(error, res, next); }
});

function handle(error: unknown, res: Response, next: NextFunction): Response | void {
  if (error instanceof ReplayRouteError || error instanceof MeetingReplayError) return sendApiError(res, error.status, "work_hub.meeting_replay", error.message);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return sendApiError(res, 400, "work_hub.invalid_operation", "Invalid meeting replay request");
  return next(error);
}

export default router;
