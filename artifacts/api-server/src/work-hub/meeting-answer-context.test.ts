import { describe, expect, it } from "vitest";
import {
  buildMeetingAnswerInput,
  parseMeetingWakeQuestion,
  reserveMeetingAnswer,
  releaseMeetingAnswerReservation,
  selectMeetingAnswerContext,
} from "./meeting-answer-context";

describe("meeting Ask V wake parsing", () => {
  it.each([
    ["V, what was decided?", "what was decided?"],
    ["ask v: What is the total?", "What is the total?"],
    ["Ask V - who owns the action?", "who owns the action?"],
    ["AskV, when is the inspection?", "when is the inspection?"],
  ])("accepts a leading standalone wake phrase", (value, question) => {
    expect(parseMeetingWakeQuestion(value)).toBe(question);
  });

  it.each([
    "Vendor deliveries are late",
    "We should ask V later",
    "Ask V",
    "V",
    "Ask Vincent about it",
    "Please AskV about it",
    "AskVendors about it",
    "AskV",
    "V, Ask V, what was decided?",
  ])("rejects absent, embedded, incomplete, or partial wake phrases", (value) => {
    expect(parseMeetingWakeQuestion(value)).toBeNull();
  });
});

describe("meeting answer context selection", () => {
  const rows = [
    { id: "shared-1", kind: "chat" as const, userId: 1, recipientUserId: null, speaker: "Alex", text: "Shared plan", occurredAt: 10 },
    { id: "answer", kind: "chat" as const, userId: 1, recipientUserId: null, speaker: "Ask V", text: "Recursive answer", occurredAt: 11, messageType: "askv" },
    { id: "private-pair", kind: "chat" as const, userId: 2, recipientUserId: 1, speaker: "Bob", text: "Private plan", occurredAt: 12 },
    { id: "private-other", kind: "chat" as const, userId: 2, recipientUserId: 3, speaker: "Bob", text: "Other pair", occurredAt: 13 },
    { id: "transcript", kind: "transcript" as const, userId: 2, recipientUserId: null, speaker: "Bob", text: "Spoken update", occurredAt: 14 },
  ];

  it("selects only shared non-recursive chat and transcript context", () => {
    const selected = selectMeetingAnswerContext({ audience: "shared", requesterUserId: 1, rows });
    expect(selected).toEqual([
      { speaker: "Alex", text: "Shared plan", kind: "chat" },
      { speaker: "Bob", text: "Spoken update", kind: "transcript" },
    ]);
    expect(JSON.stringify(selected)).not.toMatch(/shared-1|private|answer/);
  });

  it("selects only the exact two-person private thread and no transcript", () => {
    const selected = selectMeetingAnswerContext({ audience: "private", requesterUserId: 1, otherUserId: 2, rows });
    expect(selected).toEqual([{ speaker: "Bob", text: "Private plan", kind: "chat" }]);
  });

  it("keeps the newest rows within hard row and UTF-8 byte bounds", () => {
    const selected = selectMeetingAnswerContext({
      audience: "shared",
      requesterUserId: 1,
      maxRows: 2,
      maxBytes: 13,
      rows: [
        { id: "1", kind: "chat", userId: 1, recipientUserId: null, speaker: "A", text: "older", occurredAt: 1 },
        { id: "2", kind: "chat", userId: 1, recipientUserId: null, speaker: "B", text: "123456789", occurredAt: 2 },
        { id: "3", kind: "chat", userId: 1, recipientUserId: null, speaker: "C", text: "new", occurredAt: 3 },
      ],
    });
    expect(selected).toEqual([
      { speaker: "B", text: "123456789", kind: "chat" },
      { speaker: "C", text: "new", kind: "chat" },
    ]);
    expect(Buffer.byteLength(selected.map((row) => row.text).join(""), "utf8")).toBeLessThanOrEqual(13);
  });

  it("rejects an invalid private audience instead of widening it", () => {
    expect(() => selectMeetingAnswerContext({ audience: "private", requesterUserId: 1, rows })).toThrow(/private/i);
    expect(() => selectMeetingAnswerContext({ audience: "private", requesterUserId: 1, otherUserId: 1, rows })).toThrow(/private/i);
  });

  it("fits the complete serialized provider payload by removing oldest context first", () => {
    const selected = Array.from({ length: 100 }, (_, index) => ({
      speaker: `Speaker ${index} ${"s".repeat(140)}`,
      text: `${String(index).padStart(3, "0")}:${"x".repeat(390)}`,
      kind: "chat" as const,
    }));
    const input = buildMeetingAnswerInput({
      question: `What happened? ${"q".repeat(1_900)}`,
      audience: "shared",
      selected,
    });
    expect(Buffer.byteLength(JSON.stringify(input), "utf8")).toBeLessThanOrEqual(48 * 1024);
    expect(input.chat.at(-1)?.text).toMatch(/^099:/);
    expect(input.chat[0]?.text).not.toMatch(/^000:/);
    expect(input.roster.every((row) => input.chat.some((item) => item.speaker === row.displayName))).toBe(true);
  });
});

describe("meeting answer reservations", () => {
  it("claims once, blocks a live competing claim, and permits bounded stale recovery", () => {
    const first = reserveMeetingAnswer({}, "chat:source", "fingerprint", "owner-a", 1_000);
    expect(first.claimed).toBe(true);
    const busy = reserveMeetingAnswer(first.runtime, "chat:source", "fingerprint", "owner-b", 1_001);
    expect(busy).toMatchObject({ claimed: false, reason: "busy" });
    const recovered = reserveMeetingAnswer(first.runtime, "chat:source", "fingerprint", "owner-b", 32_000);
    expect(recovered).toMatchObject({ claimed: true });
    expect(JSON.stringify(recovered.runtime)).not.toContain("question");
  });

  it("only lets the reservation owner release its claim", () => {
    const claimed = reserveMeetingAnswer({}, "chat:source", "fingerprint", "owner-a", 1_000);
    expect(releaseMeetingAnswerReservation(claimed.runtime, "chat:source", "owner-b")).toEqual(claimed.runtime);
    expect(releaseMeetingAnswerReservation(claimed.runtime, "chat:source", "owner-a")).toEqual({});
  });
});
