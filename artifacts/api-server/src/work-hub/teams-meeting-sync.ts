import type { SessionPayload } from "../lib/session";
import { createWorkHubAccess } from "./context-access";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, workHubCalendarConnectionsTable as connections, workHubSyncCursorsTable as cursors, workHubMeetingsTable as meetings, workHubMeetingOccurrencesTable as occurrences, workHubMeetingParticipantsTable as participants, notificationsTable } from "@workspace/db";
import { getParticipantBusyIntervals, requestedMeetingAvailability, type ParticipantBusyInterval } from "./meeting-availability";
import { appendWorkHubAudit } from "./audit";
import { createTeamsCalendarEvent, getTeamsCalendarEvent, updateTeamsCalendarEvent, TeamsProviderError } from "./teams-graph";

type Session = SessionPayload & { userId: number };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Projection = { title: string; startsAt: string; endsAt: string };
type Mapping = { eventId?: string; transactionId: string; localHash?: string; remoteHash?: string; changeKey?: string; etag?: string; joinUrl?: string; state: string };
const prefix = "teams_meeting:";
export function teamsMeetingReadyState(joinUrl?: string) { return joinUrl ? "synced" : "awaiting_teams_provisioning"; }
export function teamsMeetingOtherBusy(busy: ParticipantBusyInterval[], users: number[], start: Date, end: Date) {
  const remaining = [...busy];
  for (const userId of new Set(users)) {
    const index = remaining.findIndex(item => item.userId === userId && item.kind === "meeting" && item.startsAt.getTime() === start.getTime() && item.endsAt.getTime() === end.getTime());
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}
export function teamsMeetingTransactionId(connectionId: string, occurrenceId: string) { return createHash("sha256").update(`teams-meeting:${connectionId}:${occurrenceId}`).digest("hex"); }
export function teamsMeetingHash(value: Projection) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function teamsMeetingDecision(localHash: string, remoteHash: string, previous: Pick<Mapping, "localHash" | "remoteHash">) {
  const localChanged = previous.localHash !== localHash, remoteChanged = previous.remoteHash !== remoteHash;
  if (localHash === remoteHash) return "matched";
  if (localChanged && remoteChanged) return "conflict";
  if (remoteChanged) return "import";
  if (localChanged) return "export";
  return "matched";
}
function owner(session: Session) {
  if (session.vendorId) return { type: "vendor" as const, id: session.vendorId };
  if (session.partnerId) return { type: "partner" as const, id: session.partnerId };
  throw new TeamsProviderError("teams_owner_context_required", 403);
}
async function connection(tx: Tx, session: Session, connectionId: string) {
  const scope = owner(session);
  const [row] = await tx.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.createdById, session.userId), eq(connections.ownerOrgType, scope.type), eq(connections.ownerOrgId, scope.id), eq(connections.provider, `microsoft_teams:${session.userId}:${session.activeMembershipId ?? 0}`), eq(connections.status, "connected"), isNull(connections.revokedAt))).limit(1);
  if (!row) throw new TeamsProviderError("teams_connection_unavailable", 403);
  return scope;
}
async function eligible(tx: Tx, session: Session, occurrenceId?: string) {
  const scope = owner(session);
  const rows = await tx.select({ meeting: meetings, occurrence: occurrences }).from(occurrences).innerJoin(meetings, eq(meetings.id, occurrences.meetingId)).where(and(eq(meetings.ownerOrgType, scope.type), eq(meetings.ownerOrgId, scope.id), ...(occurrenceId ? [eq(occurrences.id, occurrenceId)] : []))).limit(200);
  const ids = new Set((await tx.select({ occurrenceId: participants.occurrenceId, role: participants.role }).from(participants).where(and(eq(participants.userId, session.userId), isNull(participants.removedAt)))).filter(row => ["host", "cohost"].includes(row.role)).map(row => row.occurrenceId));
  return rows.filter(row => row.meeting.createdById === session.userId || ids.has(row.occurrence.id));
}
function parseMapping(value: string | null): Mapping | undefined {
  if (!value) return undefined;
  try { const parsed = JSON.parse(value) as Mapping; if (typeof parsed.transactionId !== "string" || typeof parsed.state !== "string") return undefined; return parsed; } catch { return undefined; }
}
async function mapping(tx: Tx, connectionId: string, occurrenceId: string) { const [row] = await tx.select().from(cursors).where(and(eq(cursors.connectionId, connectionId), eq(cursors.resourceType, prefix + occurrenceId))).limit(1); return parseMapping(row?.cursor ?? null); }
async function save(tx: Tx, connectionId: string, occurrenceId: string, value: Mapping) {
  await tx.insert(cursors).values({ connectionId, resourceType: prefix + occurrenceId, cursor: JSON.stringify(value), lastSuccessAt: value.state === "synced" ? new Date() : null, lastErrorCode: value.state === "synced" ? null : value.state }).onConflictDoUpdate({ target: [cursors.connectionId, cursors.resourceType], set: { cursor: JSON.stringify(value), updatedAt: new Date(), ...(value.state === "synced" ? { lastSuccessAt: new Date(), lastErrorCode: null } : { lastErrorCode: value.state }) } });
}
function remoteProjection(event: Record<string, unknown>): Projection {
  function time(part: unknown) { const value = part as { dateTime?: string; timeZone?: string }; if (!value?.dateTime || !["UTC", "Etc/UTC"].includes(value.timeZone ?? "")) throw new TeamsProviderError("teams_event_timezone_unsupported", 409); const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`); if (!Number.isFinite(date.getTime())) throw new TeamsProviderError("teams_event_time_invalid", 409); return date.toISOString(); }
  if (typeof event.subject !== "string" || event.subject.length > 200 || !event.subject.trim()) throw new TeamsProviderError("teams_event_title_invalid", 409);
  const result = { title: event.subject, startsAt: time(event.start), endsAt: time(event.end) };
  if (result.endsAt <= result.startsAt) throw new TeamsProviderError("teams_event_time_invalid", 409);
  return result;
}
function metadata(event: Record<string, unknown>) {
  const raw = (event.onlineMeeting as { joinUrl?: string } | undefined)?.joinUrl;
  let joinUrl: string | undefined;
  try { const url = new URL(raw ?? ""); if (url.protocol === "https:" && ["teams.microsoft.com", "teams.live.com"].includes(url.hostname)) joinUrl = url.href; } catch { /* Absent join URL is not a native Work Hub room. */ }
  return { changeKey: typeof event.changeKey === "string" ? event.changeKey : undefined, etag: typeof event["@odata.etag"] === "string" ? event["@odata.etag"] : undefined, joinUrl };
}
export async function listMeetings(session: Session, connectionId: string) {
  return db.transaction(async tx => {
    await connection(tx, session, connectionId);
    const rows = await eligible(tx, session);
    return { meetings: await Promise.all(rows.map(async row => { const linked = await mapping(tx, connectionId, row.occurrence.id); return { occurrenceId: row.occurrence.id, title: row.meeting.title, startsAt: row.occurrence.startsAt.toISOString(), endsAt: row.occurrence.endsAt?.toISOString() ?? null, status: row.occurrence.status, teamsJoinUrl: linked?.joinUrl, syncState: linked?.state ?? "not_linked" }; })) };
  });
}
async function locked<T>(session: Session, connectionId: string, action: (tx: Tx) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'teams-sync:' + connectionId}))`);
    await tx.execute(sql`select ${connections.id} from ${connections} where ${connections.id} = ${connectionId} for update`);
    await connection(tx, session, connectionId);
    return action(tx);
  });
}
async function reconcile(tx: Tx, session: Session, connectionId: string, token: string, occurrenceId: string, publish: boolean) {
  const [row] = await eligible(tx, session, occurrenceId);
  if (!row) throw new TeamsProviderError("teams_meeting_not_found", 404);
  const previous = await mapping(tx, connectionId, occurrenceId);
  let link: Mapping = previous ?? { transactionId: teamsMeetingTransactionId(connectionId, occurrenceId), state: "pending" };
  const persist = async (state: string) => { link = { ...link, state }; await save(tx, connectionId, occurrenceId, link); return { occurrenceId, syncState: state, teamsJoinUrl: link.joinUrl }; };
  if (row.meeting.recurrence) return persist("conflict_recurrence_unsupported");
  if (row.occurrence.status !== "scheduled") return persist("conflict_meeting_not_scheduled");
  if (!row.occurrence.endsAt) return persist("conflict_missing_end_time");
  const local: Projection = { title: row.meeting.title, startsAt: row.occurrence.startsAt.toISOString(), endsAt: row.occurrence.endsAt.toISOString() }, localHash = teamsMeetingHash(local);
  try {
    let remote: Record<string, unknown>;
    if (!link.eventId) {
      if (!publish) return { occurrenceId, syncState: "not_linked" };
      remote = await createTeamsCalendarEvent(token, { transactionId: link.transactionId, subject: local.title, start: local.startsAt, end: local.endsAt });
      if (typeof remote.id !== "string" || !remote.id) throw new TeamsProviderError("teams_event_missing_id");
      link = { ...link, eventId: remote.id, localHash, remoteHash: teamsMeetingHash(remoteProjection(remote)), ...metadata(remote) };
      await appendWorkHubAudit({ actorUserId: session.userId, owner: owner(session), source: "connector", action: "teams.meeting.publish", subjectType: "meeting", subjectId: occurrenceId, metadata: { connectionId, eventId: link.eventId } }, tx);
      return persist(teamsMeetingReadyState(link.joinUrl));
    }
    remote = await getTeamsCalendarEvent(token, link.eventId);
    if (remote.isCancelled === true) return persist("conflict_remote_cancelled");
    const projection = remoteProjection(remote), remoteHash = teamsMeetingHash(projection);
    const decision = teamsMeetingDecision(localHash, remoteHash, link);
    if (decision === "conflict") return persist("conflict_both_changed");
    if (decision === "import") {
      // Import is a native Work Hub edit, not merely a private Microsoft calendar copy.
      // Match the native PATCH route's current capability and creator/admin checks.
      let canHost = false;
      try { const scope = owner(session); canHost = createWorkHubAccess({ session, owner: scope, context: { kind: "organization", id: scope.id }, participant: true }).capabilities.has("meeting.host"); } catch { /* Access derivation denies safely. */ }
      if (!canHost || (row.meeting.createdById !== session.userId && session.role !== "admin" && session.membershipRole !== "admin")) return persist("conflict_permission_denied");
      const attendees = await tx.select({ userId: participants.userId, rsvp: participants.rsvp }).from(participants).where(and(eq(participants.occurrenceId, occurrenceId), isNull(participants.removedAt)));
      const userIds = [...new Set(attendees.filter(item => item.rsvp !== "declined").map(item => item.userId))].sort((a, b) => a - b);
      for (const userId of userIds) await tx.execute(sql`select pg_advisory_xact_lock(73009, ${userId})`);
      const busy = await getParticipantBusyIntervals(tx, owner(session), userIds, new Date(projection.startsAt), new Date(projection.endsAt));
      const others = teamsMeetingOtherBusy(busy, userIds, row.occurrence.startsAt, row.occurrence.endsAt);
      if (!requestedMeetingAvailability(new Date(projection.startsAt), new Date(projection.endsAt), others).available) return persist("conflict_schedule_unavailable");
      // Compare both records under row locks. A local editor winning this race is a conflict, never overwritten.
      await tx.execute(sql`select ${meetings.id} from ${meetings} where ${meetings.id} = ${row.meeting.id} for update`);
      const [current] = await tx.select().from(occurrences).where(and(eq(occurrences.id, occurrenceId), eq(occurrences.status, "scheduled"), eq(occurrences.startsAt, row.occurrence.startsAt), eq(occurrences.endsAt, row.occurrence.endsAt))).limit(1);
      const [currentMeeting] = await tx.select().from(meetings).where(and(eq(meetings.id, row.meeting.id), eq(meetings.title, row.meeting.title))).limit(1);
      if (!current || !currentMeeting) return persist("conflict_local_changed");
      const [updated] = await tx.update(occurrences).set({ startsAt: new Date(projection.startsAt), endsAt: new Date(projection.endsAt) }).where(and(eq(occurrences.id, occurrenceId), eq(occurrences.status, "scheduled"), eq(occurrences.startsAt, row.occurrence.startsAt), eq(occurrences.endsAt, row.occurrence.endsAt))).returning({ id: occurrences.id });
      if (!updated) return persist("conflict_local_changed");
      await tx.update(meetings).set({ title: projection.title }).where(and(eq(meetings.id, row.meeting.id), eq(meetings.title, row.meeting.title)));
      await appendWorkHubAudit({ actorUserId: session.userId, owner: owner(session), source: "connector", action: "teams.meeting.import_update", subjectType: "meeting", subjectId: occurrenceId, metadata: { connectionId, eventId: link.eventId } }, tx);
      if (attendees.length) await tx.insert(notificationsTable).values(attendees.map(item => ({ userId: item.userId, type: "work_hub_meeting_updated", category: "system", title: "Meeting updated from Teams", body: "A linked meeting changed. Review its updated schedule in Work Hub.", link: `/work-hub/meetings?meeting=${occurrenceId}`, dedupeKey: `teams-meeting:${connectionId}:${occurrenceId}:${remoteHash}` }))).onConflictDoNothing();
      link = { ...link, localHash: remoteHash, remoteHash, ...metadata(remote) };
      return persist(teamsMeetingReadyState(link.joinUrl));
    }
    if (decision === "export") {
      const etag = metadata(remote).etag;
      if (!etag) return persist("conflict_remote_version_missing");
      remote = await updateTeamsCalendarEvent(token, link.eventId, { subject: local.title, start: { dateTime: local.startsAt.replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: local.endsAt.replace(/Z$/, ""), timeZone: "UTC" } }, etag);
      await appendWorkHubAudit({ actorUserId: session.userId, owner: owner(session), source: "connector", action: "teams.meeting.export_update", subjectType: "meeting", subjectId: occurrenceId, metadata: { connectionId, eventId: link.eventId } }, tx);
    }
    link = { ...link, localHash, remoteHash: teamsMeetingHash(remoteProjection(remote)), ...metadata(remote) };
    return persist(teamsMeetingReadyState(link.joinUrl));
  } catch (error) {
    if (!(error instanceof TeamsProviderError)) throw error;
    return persist(error.code === "provider_not_found" ? "conflict_remote_missing" : error.code === "provider_version_conflict" ? "conflict_remote_changed" : error.code);
  }
}
export async function publishMeeting(session: Session, connectionId: string, token: string, occurrenceId: string, operationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new TeamsProviderError("invalid_operation_id", 400);
  return locked(session, connectionId, tx => reconcile(tx, session, connectionId, token, occurrenceId, true));
}
export async function syncMeetings(session: Session, connectionId: string, token: string) {
  const links = await db.transaction(async tx => {
    await connection(tx, session, connectionId);
    return tx.select({ resourceType: cursors.resourceType }).from(cursors).where(and(eq(cursors.connectionId, connectionId), sql`${cursors.resourceType} like ${prefix + "%"}`)).orderBy(cursors.updatedAt).limit(10);
  });
  const results = [];
  // Release each transaction before the next provider round trip; old cursors are picked first.
  for (const item of links) {
    const occurrenceId = item.resourceType.slice(prefix.length);
    try { results.push(await locked(session, connectionId, tx => reconcile(tx, session, connectionId, token, occurrenceId, false))); }
    catch (error) { if (!(error instanceof TeamsProviderError)) throw error; results.push({ occurrenceId, syncState: error.code }); }
  }
  return { meetings: results, batchLimit: 10 };
}
