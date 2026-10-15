import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  workHubMeetingArtifactsTable,
  workHubTranscriptSegmentsTable,
  workHubDevicesTable, workHubAudioLeasesTable, workHubMeetingParticipantsTable,
} from "@workspace/db";
import { runInDatabaseRealm } from "@workspace/db/realm";
import { meetingDeviceConnections, type MeetingRuntime } from "./meeting-runtime";
import { callTranscriptPublicationAllowed } from "./call-transcript-publication";
import type { SessionPayload } from "../lib/session";
import { authorizeCallTranscript } from "./call-transcript-access";
import { LocalCallTranscription } from "./local-call-transcription";
import {
  transcribeNativeAudio,
  nativeTranscriptionAvailable,
} from "./native-transcription";
type Actor = SessionPayload & { userId: number };
const sessions = new Map<
  string,
  {
    actor: Actor;
    callId: string;
    deviceId: string;
    closedAt: number | null;
    lastAt: number;
    engine: LocalCallTranscription;
  }
>();
const sweep = setInterval(() => {
  for (const [id, s] of sessions)
    if (Date.now() - s.lastAt > 30000) {
      sessions.delete(id);
      closeAuthorizers.delete(id); frameClocks.delete(id);
      void runInDatabaseRealm(s.actor.realm ?? "production", () => s.engine.close()).catch(() => undefined);
    }
}, 10000);
sweep.unref();
export async function openCallStream(
  actor: Actor,
  callId: string,
  identity: { deviceId: string; connectionId: string; token: string; generation: number },
) {
  const { deviceId } = identity;
  const authorized = await authorizeCallTranscript(actor, callId, "capture");
  if (!nativeTranscriptionAvailable())
    throw Object.assign(new Error("Internal transcription is unavailable"), {
      status: 503,
    });
  if (sessions.size >= 32)
    throw Object.assign(new Error("Transcription capacity reached"), {
      status: 429,
    });
  for (const s of sessions.values())
    if (s.actor.userId === actor.userId && s.callId === callId)
      throw Object.assign(
        new Error("A transcription session is already active"),
        { status: 409 },
      );
  const id = randomUUID(),
    offset = Math.max(
      0,
      Date.now() - (authorized.call.answeredAt?.getTime() ?? Date.now()),
    );
  let closedAt: number | null = null;
  let lastFrameAt = Date.now();
  const validatePublication = async (reader: Pick<typeof db, "select"> = db) => {
    const current = await authorizeCallTranscript(actor, callId, "voicemail", reader);
    if (current.policy?.version !== authorized.policy?.version) throw new Error("Company policy changed");
    const [device] = await reader.select().from(workHubDevicesTable).where(eq(workHubDevicesTable.id, deviceId)).limit(1);
    const [participant] = await reader.select().from(workHubMeetingParticipantsTable).where(and(eq(workHubMeetingParticipantsTable.occurrenceId, current.call.occurrenceId), eq(workHubMeetingParticipantsTable.userId, actor.userId))).limit(1);
    const [lease] = await reader.select().from(workHubAudioLeasesTable).where(and(eq(workHubAudioLeasesTable.occurrenceId, current.call.occurrenceId), eq(workHubAudioLeasesTable.userId, actor.userId))).limit(1);
    const now = Date.now();
    const sameLease = Boolean(lease && lease.deviceId === deviceId && lease.generation === identity.generation && lease.tokenHash === createHash("sha256").update(identity.token).digest("hex"));
    const present = Object.values(meetingDeviceConnections(current.occurrence.runtime as MeetingRuntime)).some(c => c.userId === actor.userId && c.deviceId === deviceId && c.connectionId === identity.connectionId && now - c.seenAt < 30000);
    if (!callTranscriptPublicationAllowed({
      deviceValid: Boolean(device && !device.revokedAt && device.userId === actor.userId && device.ownerOrgType === "vendor" && device.ownerOrgId === actor.vendorId),
      participantActive: Boolean(participant && !participant.removedAt), muted: Boolean(participant?.muted),
      leaseReplaced: !sameLease, leaseValid: Boolean(sameLease && lease?.state === "active" && lease.expiresAt.getTime() > now),
      present, callActive: current.call.status === "active", endedAt: current.call.endedAt?.getTime() ?? null,
      closedAt, lastFrameAt,
    }, now)) throw new Error("Call audio authorization changed");
  };
  const engine = new LocalCallTranscription(
    actor.userId,
    (wav) => transcribeNativeAudio(wav, "audio/wav"),
    async (segment) => {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${callId}))`,
        );
        await validatePublication(tx);
        let [artifact] = await tx
          .select()
          .from(workHubMeetingArtifactsTable)
          .where(
            and(
              eq(
                workHubMeetingArtifactsTable.occurrenceId,
                authorized.call.occurrenceId,
              ),
              eq(workHubMeetingArtifactsTable.artifactType, "transcript"),
            ),
          )
          .limit(1);
        if (!artifact)
          [artifact] = await tx
            .insert(workHubMeetingArtifactsTable)
            .values({
              occurrenceId: authorized.call.occurrenceId,
              artifactType: "transcript",
              state: "active",
              metadata: {
                internalVendorPolicyVersion: authorized.policy?.version,
              },
            })
            .returning();
        await tx
          .insert(workHubTranscriptSegmentsTable)
          .values({
            ...segment,
            startsAtMs: offset + segment.startsAtMs,
            endsAtMs: offset + segment.endsAtMs,
            artifactId: artifact.id,
          });
      });
    },
    () => validatePublication(),
  );
  sessions.set(id, { actor, callId, deviceId, closedAt, lastAt: Date.now(), engine });
  // Close is authorized while the original audio lease is still held.
  closeAuthorizers.set(id, async (hangup) => { await validatePublication(); if (hangup) closedAt = Date.now(); });
  frameClocks.set(id, () => { lastFrameAt = Date.now(); });
  return { sessionId: id, sampleRate: 16000, frameDurationMs: 500 };
}
const closeAuthorizers = new Map<string, (hangup: boolean) => Promise<void>>();
const frameClocks = new Map<string, () => void>();
function owned(actor: Actor, callId: string, id: string, deviceId: string) {
  const s = sessions.get(id);
  if (
    !s ||
    s.actor.userId !== actor.userId ||
    s.actor.vendorId !== actor.vendorId ||
    s.callId !== callId ||
    s.deviceId !== deviceId
  )
    throw Object.assign(new Error("Transcription session unavailable"), {
      status: 403,
    });
  return s;
}
export async function appendCallStream(
  actor: Actor,
  callId: string,
  id: string,
  deviceId: string,
  sequence: number,
  pcm: Buffer,
) {
  const s = owned(actor, callId, id, deviceId);
  await authorizeCallTranscript(actor, callId, "capture");
  s.lastAt = Date.now();
  frameClocks.get(id)?.();
  await s.engine.append(sequence, pcm);
  return { turns: [] };
}
export async function closeCallStream(
  actor: Actor,
  callId: string,
  id: string,
  deviceId: string,
  reason: "hangup" | "pause" = "pause",
) {
  const s = owned(actor, callId, id, deviceId);
  await closeAuthorizers.get(id)?.(reason === "hangup");
  sessions.delete(id);
  closeAuthorizers.delete(id); frameClocks.delete(id);
  await s.engine.close();
  return { closed: true };
}
