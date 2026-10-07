import { expect, it } from "vitest";
import { searchSavedMeetingProjection } from "./work-hub-meeting-search";
const occurrenceId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const artifactId = "33333333-3333-4333-8333-333333333333";
const source = {
  occurrence: { id: occurrenceId },
  participants: [{ userId: 999, privateData: "not a search result" }],
  artifacts: [{ storageKey: "private/object" }],
  transcript: [
    {
      id: sourceId,
      artifactId,
      text: "Review PUMP pressure before arrival.",
      startsAtMs: 1000,
      endsAtMs: 2500,
    },
    {
      id: artifactId,
      artifactId,
      text: "Unrelated confidential topic.",
      startsAtMs: 2600,
      endsAtMs: 4000,
    },
  ],
  chat: [
    {
      id: artifactId,
      occurrenceId,
      body: "The pump needs review.",
      createdAt: "2026-10-07T12:00:00Z",
      recipientUserId: 17,
    },
  ],
};
it("returns only matching authorized saved sources with exact IDs, times and literal match evidence", () => {
  const result = searchSavedMeetingProjection(
    { occurrenceId, query: " pump " },
    source,
  );
  expect(result).toMatchObject({
    ok: true,
    query: "pump",
    matchCount: 2,
    truncated: false,
    captureStarted: false,
    matches: [
      {
        sourceType: "transcript",
        sourceId,
        artifactId,
        startsAtMs: 1000,
        endsAtMs: 2500,
        match: { start: 7, end: 11, text: "PUMP" },
      },
      {
        sourceType: "chat",
        sourceId: artifactId,
        recordedAt: "2026-10-07T12:00:00Z",
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("Unrelated confidential");
  expect(result).not.toHaveProperty("participants");
  expect(result).not.toHaveProperty("artifacts");
});
it("treats regex punctuation literally and returns explicit empty matches", () => {
  expect(
    searchSavedMeetingProjection({ occurrenceId, query: ".*" }, source),
  ).toMatchObject({ ok: true, matchCount: 0, matches: [] });
  expect(
    searchSavedMeetingProjection({ occurrenceId, query: "absent" }, source),
  ).toMatchObject({ ok: true, matchCount: 0, matches: [] });
});
it("refuses empty query, substituted occurrence and missing authorized projection", () => {
  for (const query of ["", "   ", "x".repeat(501)])
    expect(
      searchSavedMeetingProjection({ occurrenceId, query }, source),
    ).toMatchObject({ ok: false });
  expect(
    searchSavedMeetingProjection(
      { occurrenceId: artifactId, query: "pump" },
      source,
    ),
  ).toMatchObject({ ok: false });
  expect(
    searchSavedMeetingProjection(
      { occurrenceId, query: "pump" },
      { error: "Forbidden" },
    ),
  ).toMatchObject({ ok: false });
});
it("bounds matches and omits invalid or foreign chat records without inventing source timestamps", () => {
  const result = searchSavedMeetingProjection(
    { occurrenceId, query: "pump", limit: 1 },
    {
      ...source,
      transcript: [...source.transcript, { text: "pump" }],
      chat: [...source.chat, { ...source.chat[0], occurrenceId: artifactId }],
    },
  );
  expect(result).toMatchObject({
    ok: true,
    matchCount: 2,
    truncated: true,
    invalidRecordCount: 2,
  });
  expect("matches" in result && result.matches).toHaveLength(1);
});
