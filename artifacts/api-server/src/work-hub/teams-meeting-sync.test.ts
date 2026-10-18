import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, workHubCalendarConnectionsTable: {}, workHubSyncCursorsTable: {}, workHubMeetingsTable: {}, workHubMeetingOccurrencesTable: {}, workHubMeetingParticipantsTable: {} }));
import { teamsMeetingDecision, teamsMeetingHash, teamsMeetingTransactionId, teamsMeetingReadyState, teamsMeetingOtherBusy } from "./teams-meeting-sync";
describe("Teams linked-meeting reconciliation", () => {
  it("does not claim Teams provisioning before a real join link exists", () => {
    expect(teamsMeetingReadyState()).toBe("awaiting_teams_provisioning");
    expect(teamsMeetingReadyState("https://teams.microsoft.com/l/meetup-join/demo")).toBe("synced");
  });
  it("excludes only the current occurrence, preserving another identical conflicting meeting", () => {
    const startsAt = new Date("2026-10-18T13:00:00Z"), endsAt = new Date("2026-10-18T14:00:00Z");
    const same = { userId: 7, kind: "meeting" as const, startsAt, endsAt };
    expect(teamsMeetingOtherBusy([same, same], [7], startsAt, endsAt)).toHaveLength(1);
    expect(teamsMeetingOtherBusy([same, { ...same, kind: "shift" }], [7], startsAt, endsAt)).toEqual([{ ...same, kind: "shift" }]);
  });
  it("keeps create identity stable across different caller retries and isolated by connection", () => {
    expect(teamsMeetingTransactionId("connection-a", "occurrence-a")).toBe(teamsMeetingTransactionId("connection-a", "occurrence-a"));
    expect(teamsMeetingTransactionId("connection-a", "occurrence-a")).not.toBe(teamsMeetingTransactionId("connection-b", "occurrence-a"));
    expect(teamsMeetingTransactionId("connection-a", "occurrence-a")).not.toBe(teamsMeetingTransactionId("connection-a", "occurrence-b"));
  });
  it("detects simultaneous changes instead of overwriting either side", () => {
    expect(teamsMeetingDecision("local-new", "remote-new", { localHash: "old", remoteHash: "old" })).toBe("conflict");
    expect(teamsMeetingDecision("local-new", "old", { localHash: "old", remoteHash: "old" })).toBe("export");
    expect(teamsMeetingDecision("old", "remote-new", { localHash: "old", remoteHash: "old" })).toBe("import");
  });
  it("does not echo a change that has already converged", () => {
    expect(teamsMeetingDecision("same-new", "same-new", { localHash: "old", remoteHash: "old" })).toBe("matched");
    expect(teamsMeetingDecision("old", "old", { localHash: "old", remoteHash: "old" })).toBe("matched");
  });
  it("hashes exactly the supported linked fields, excluding native recording and audio", () => {
    const before = { title: "Dispatch", startsAt: "2026-10-18T13:00:00.000Z", endsAt: "2026-10-18T14:00:00.000Z" };
    expect(teamsMeetingHash(before)).not.toBe(teamsMeetingHash({ ...before, title: "Dispatch changed" }));
    expect(teamsMeetingHash(before)).not.toBe(teamsMeetingHash({ ...before, startsAt: "2026-10-18T13:15:00.000Z" }));
  });
});
