import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ db: { transaction: vi.fn() }, connections: { id: "connectionId" }, cursors: { resourceType: "resourceType", updatedAt: "updatedAt" }, meetings: { id: "meetingId" }, occurrences: { id: "occurrenceId" }, participants: {}, notifications: {}, create: vi.fn(), get: vi.fn(), patch: vi.fn(), audit: vi.fn(), busy: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: f.db, workHubCalendarConnectionsTable: f.connections, workHubSyncCursorsTable: f.cursors, workHubMeetingsTable: f.meetings, workHubMeetingOccurrencesTable: f.occurrences, workHubMeetingParticipantsTable: f.participants, notificationsTable: f.notifications }));
vi.mock("./audit", () => ({ appendWorkHubAudit: f.audit }));
vi.mock("./meeting-availability", () => ({ getParticipantBusyIntervals: f.busy, requestedMeetingAvailability: (_a: unknown, _b: unknown, busy: unknown[]) => ({ available: !busy.length }) }));
vi.mock("./teams-graph", async () => { const actual = await vi.importActual<typeof import("./teams-graph")>("./teams-graph"); return { ...actual, createTeamsCalendarEvent: f.create, getTeamsCalendarEvent: f.get, updateTeamsCalendarEvent: f.patch }; });
import { publishMeeting, syncMeetings, teamsMeetingHash, teamsMeetingTransactionId } from "./teams-meeting-sync";
import { TeamsProviderError } from "./teams-graph";
const session = { userId: 7, vendorId: 11, activeMembershipId: 22, role: "vendor" as const, membershipRole: "admin" };
const occurrenceId = "75d6e4d1-32be-4fc4-adba-123456789abc", operationId = "85d6e4d1-32be-4fc4-adba-123456789abc";
const start = "2026-10-18T13:00:00.000Z", end = "2026-10-18T14:00:00.000Z";
let allowed: boolean, host: boolean, participantRole: string, meeting: Record<string, any>, occurrence: Record<string, any>, saved: Map<string, any>, remote: Record<string, any>;
function event(title = "Dispatch") { return { id: "graph-event", subject: title, start: { dateTime: start.replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: end.replace(/Z$/, ""), timeZone: "UTC" }, changeKey: "change-1", "@odata.etag": 'W/"one"', onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/example" } }; }
function select(projection?: Record<string, unknown>) {
  let table: unknown;
  const chain: any = { from: (t: unknown) => { table = t; return chain; }, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
    if (table === f.connections) return allowed ? [{ id: "conn" }] : [];
    if (table === f.occurrences) return projection?.meeting ? [{ meeting: { ...meeting }, occurrence: { ...occurrence } }] : [{ ...occurrence }];
    if (table === f.meetings) return [{ ...meeting }];
    if (table === f.participants) return host ? [{ userId: 7, occurrenceId, role: participantRole, rsvp: "accepted" }] : [];
    if (table === f.cursors) return [...saved.entries()].map(([resourceType, value]) => projection?.resourceType ? { resourceType } : { cursor: JSON.stringify(value) });
    return [];
  }).then(resolve, reject) };
  return chain;
}
const tx: any = { select, execute: vi.fn(), insert: (table: unknown) => ({ values: (value: any) => ({ onConflictDoUpdate: () => { if (table === f.cursors) saved.set(value.resourceType, JSON.parse(value.cursor)); return Promise.resolve(); }, onConflictDoNothing: () => Promise.resolve() }) }), update: (table: unknown) => ({ set: (value: any) => ({ where: () => { const target = table === f.meetings ? meeting : occurrence; Object.assign(target, value); return { returning: () => Promise.resolve([{ id: target.id }]) }; } }) }) };
beforeEach(() => {
  vi.clearAllMocks(); allowed = true; host = true; participantRole = "host"; saved = new Map();
  meeting = { id: "local-meeting", ownerOrgType: "vendor", ownerOrgId: 11, createdById: 8, title: "Dispatch", recurrence: null };
  occurrence = { id: occurrenceId, meetingId: meeting.id, startsAt: new Date(start), endsAt: new Date(end), status: "scheduled", runtime: { retained: true }, providerRoomId: "native-room" };
  remote = event(); f.db.transaction.mockImplementation((action: (value: any) => unknown) => action(tx)); f.busy.mockResolvedValue([]); f.create.mockImplementation(async () => ({ ...remote })); f.get.mockImplementation(async () => ({ ...remote })); f.patch.mockImplementation(async (_token, _id, body) => { remote = { ...remote, subject: body.subject, start: body.start, end: body.end }; return { ...remote }; });
});
describe("Teams meeting transaction flows", () => {
  it("denies unavailable/foreign connections before provider access", async () => {
    allowed = false;
    await expect(publishMeeting(session, "foreign", "token", occurrenceId, operationId)).rejects.toMatchObject({ code: "teams_connection_unavailable" });
    expect(f.create).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
  });
  it("denies non-host, non-creator access without provider access", async () => {
    host = false;
    await expect(publishMeeting(session, "conn", "token", occurrenceId, operationId)).rejects.toMatchObject({ code: "teams_meeting_not_found" });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("uses stable provider create identity after an uncertain save with a new caller operation", async () => {
    f.create.mockRejectedValueOnce(new TeamsProviderError("provider_connection_uncertain"));
    expect(await publishMeeting(session, "conn", "token", occurrenceId, operationId)).toMatchObject({ syncState: "provider_connection_uncertain" });
    expect(await publishMeeting(session, "conn", "token", occurrenceId, "95d6e4d1-32be-4fc4-adba-123456789abc")).toMatchObject({ syncState: "synced" });
    expect(f.create.mock.calls.map(call => call[1].transactionId)).toEqual([teamsMeetingTransactionId("conn", occurrenceId), teamsMeetingTransactionId("conn", occurrenceId)]);
    expect(occurrence.runtime).toEqual({ retained: true }); expect(occurrence.providerRoomId).toBe("native-room");
  });
  it("imports a linked change then converges without echoing it back", async () => {
    await publishMeeting(session, "conn", "token", occurrenceId, operationId);
    remote = event("Updated in Teams");
    await syncMeetings(session, "conn", "token");
    expect(meeting.title).toBe("Updated in Teams");
    await syncMeetings(session, "conn", "token");
    expect(f.patch).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "teams.meeting.import_update" }), tx);
  });
  it("exports an explicitly synced linked change with ETag and does not create another event", async () => {
    await publishMeeting(session, "conn", "token", occurrenceId, operationId);
    meeting.title = "Updated in Work Hub";
    await syncMeetings(session, "conn", "token");
    expect(f.patch).toHaveBeenCalledWith("token", "graph-event", expect.objectContaining({ subject: "Updated in Work Hub" }), 'W/"one"');
    expect(f.create).toHaveBeenCalledTimes(1);
    const state = saved.get(`teams_meeting:${occurrenceId}`);
    expect(state.localHash).toBe(teamsMeetingHash({ title: meeting.title, startsAt: start, endsAt: end }));
  });
  it("does not import edits for a downgraded creator or an ordinary cohost", async () => {
    await publishMeeting(session, "conn", "token", occurrenceId, operationId);
    remote = event("Must not overwrite Work Hub");
    const member = { ...session, membershipRole: "member" };
    meeting.createdById = member.userId;
    await syncMeetings(member, "conn", "token");
    expect(meeting.title).toBe("Dispatch");
    expect(saved.get(`teams_meeting:${occurrenceId}`).state).toBe("conflict_permission_denied");
    meeting.createdById = 8;
    participantRole = "cohost";
    await syncMeetings(member, "conn", "token");
    expect(meeting.title).toBe("Dispatch");
    expect(f.patch).not.toHaveBeenCalled();
  });
  it("rejects recurrence and incoming scheduling conflicts", async () => {
    meeting.recurrence = { frequency: "weekly" };
    expect(await publishMeeting(session, "conn", "token", occurrenceId, operationId)).toMatchObject({ syncState: "conflict_recurrence_unsupported" });
    expect(f.create).not.toHaveBeenCalled();
    meeting.recurrence = null;
    await publishMeeting(session, "conn", "token", occurrenceId, operationId);
    remote = event("Teams changed");
    f.busy.mockResolvedValue([{ userId: 7, kind: "shift", startsAt: new Date(start), endsAt: new Date(end) }]);
    await syncMeetings(session, "conn", "token");
    expect(meeting.title).toBe("Dispatch");
    expect(saved.get(`teams_meeting:${occurrenceId}`).state).toBe("conflict_schedule_unavailable");
  });
});
