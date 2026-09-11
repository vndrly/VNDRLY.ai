import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as { userId: number; vendorId: number; partnerId: null; role: string } | null,
  results: [] as unknown[][],
  predicates: [] as SQL[],
  executed: [] as SQL[],
  mutations: [] as Array<{ type: string; value?: unknown }>,
  audit: vi.fn(),
  getObject: vi.fn(),
  nativeAvailable: vi.fn(),
  nativeTranscribe: vi.fn(),
  answerQuestion: vi.fn(),
  returnInserted: false,
  transactionDepth: 0,
  failCommit: false,
}));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: mocks.audit }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => ({ getObject: mocks.getObject }) }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class { getStoredObject() { return mocks.getObject(); } } }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("./notifications", () => ({ notifyUsers: vi.fn() }));
vi.mock("../work-hub/native-transcription", () => ({ nativeTranscriptionAvailable: mocks.nativeAvailable, transcribeNativeAudio: mocks.nativeTranscribe }));
vi.mock("../work-hub/meeting-answer", () => ({ answerMeetingQuestion: mocks.answerQuestion }));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  function chain(type: string) {
    const mutation = type === "select" ? undefined : { type, value: undefined as unknown };
    if (mutation) mocks.mutations.push(mutation);
    const query: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "set", "values", "returning", "onConflictDoNothing", "onConflictDoUpdate", "orderBy", "limit"]) {
      query[method] = (value: unknown) => {
        if (method === "where") mocks.predicates.push(value as SQL);
        if (mutation && ["set", "values"].includes(method)) mutation.value = value;
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(type === "insert" && mocks.returnInserted ? [mutation!.value] : mocks.results.shift() ?? []).then(resolve);
    return query;
  }
  const tx = { select: () => chain("select"), insert: () => chain("insert"), update: () => chain("update"), execute: async (value: SQL) => { mocks.executed.push(value); return []; } };
  return { ...schema, db: { ...tx, transaction: async (fn: (tx: unknown) => Promise<unknown>) => { mocks.transactionDepth++; try { const value = await fn(tx); if (mocks.failCommit) throw new Error("commit failed"); return value; } finally { mocks.transactionDepth--; } } } };
});
import router from "./workHubMeetings";
import operations from "./workHubOperations";

const meetingId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const messageId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02";
const host = { id: "host", userId: 1, role: "host", removedAt: null, muted: true };
const guest = { id: "guest", userId: 2, role: "participant", removedAt: null, muted: true };
function seed(options: { removed?: boolean; guestRemoved?: boolean; ended?: boolean; invited?: boolean; muted?: boolean; runtime?: Record<string, unknown> } = {}) {
  mocks.results.push(
    [{ id: meetingId, meetingId, status: options.ended ? "ended" : "live", recordingState: "active", askvInvitedAt: options.invited ? new Date() : null, runtime: options.runtime ?? { presence: { 1: { seenAt: Date.now(), joinedAt: Date.now(), speaking: false } } } }],
    [{ id: meetingId, ownerOrgType: "vendor", ownerOrgId: 22, policyVersion: 1, recordingAllowed: true }],
    [{ ...host, muted: options.muted ?? true, removedAt: options.removed ? new Date() : null }, { ...guest, removedAt: options.guestRemoved ? new Date() : null }],
  );
}
function app(legacy = false) {
  const app = express(); app.use(express.json({ limit: "6mb" })); if (legacy) app.use(operations); else app.use("/meetings", router);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "Transaction failed" }); });
  return app;
}
beforeEach(() => {
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = []; mocks.predicates = []; mocks.executed = []; mocks.mutations = []; mocks.failCommit = false;
  mocks.audit.mockReset(); mocks.getObject.mockReset();
  mocks.nativeAvailable.mockReset().mockReturnValue(false); mocks.nativeTranscribe.mockReset(); mocks.transactionDepth = 0;
  mocks.answerQuestion.mockReset(); mocks.returnInserted = false;
  vi.unstubAllEnvs();
});

describe("source-bound meeting Ask V answers", () => {
  const source = { id: messageId, occurrenceId: meetingId, userId: 1, recipientUserId: null as number | null, messageType: "typed", body: "Ask V, what was decided?", createdAt: new Date("2026-09-09T12:00:00Z") };
  const post = (sourceType = "chat") => request(app()).post(`/meetings/${meetingId}/askv/question`).send({ sourceId: messageId, sourceType });
  const prepare = (item = source, messages: unknown[] = [], roster: unknown[] = [{ id: 1, displayName: "Host" }]) => {
    seed({ invited: true }); mocks.results.push([item], [], roster, messages);
    if (item.recipientUserId === null) mocks.results.push([]);
    mocks.results.push([]);
  };
  const finish = (item = source) => {
    const runtime = (mocks.mutations.find((m) => m.type === "update")?.value as any)?.runtime;
    seed({ invited: true, runtime }); mocks.results.push([item], [], []);
  };
  beforeEach(() => { mocks.returnInserted = true; });
  it("requires authentication before accessing saved questions", async () => {
    mocks.session = null; expect((await post()).status).toBe(401); expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });
  it.each(["removed", "ended", "not-invited"])("rejects %s meeting questions before text AI", async (reason) => {
    seed({ removed: reason === "removed", ended: reason === "ended", invited: reason !== "not-invited" });
    expect((await post()).status).toBe(reason === "removed" ? 403 : 409); expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });
  it.each([{ ...source, userId: 2 }, { ...source, messageType: "askv" }, { ...source, body: "Vendor deliveries" }, { ...source, body: "We should ask V later" }, { ...source, body: "Ask V" }])("refuses unowned, recursive, or unaddressed saved sources", async (item) => {
    seed({ invited: true }); mocks.results.push([item]); expect((await post()).status).toBe(422); expect(mocks.answerQuestion).not.toHaveBeenCalled(); expect(mocks.mutations).toEqual([]);
  });
  it("persists a labelled answer outside the model lock with provenance and no file attachment", async () => {
    prepare(); mocks.answerQuestion.mockImplementation(async () => { expect(mocks.transactionDepth).toBe(0); finish(); return "Inspect the pump."; });
    const response = await post(); expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ replayed: false, answer: { body: "Inspect the pump.", displayName: "Ask V", messageType: "askv", userId: 1, recipientUserId: null, attachment: null, askv: { sourceId: messageId, sourceType: "chat", requestedByUserId: 1, sourceCreatedAt: "2026-09-09T12:00:00.000Z", sourceStartsAtMs: null, sourceEndsAtMs: null, answeredAt: expect.any(String) } } });
    expect(response.body.answer.askv.sourceFingerprint).toBeUndefined(); expect(mocks.mutations.filter((m) => m.type === "insert")).toHaveLength(1); expect(mocks.results).toEqual([]);
  });
  it("excludes private side chats and historical attendance from shared context", async () => {
    prepare(source, [source, { ...source, recipientUserId: 2, body: "PRIVATE SIDE CONTENT" }, { ...source, messageType: "system", body: "RESTRICTED ATTENDANCE" }], [{ id: 1, displayName: "Host" }, { id: 2, displayName: "ABSENT NAME" }]);
    mocks.answerQuestion.mockImplementation(async (input) => { expect(JSON.stringify(input)).toContain("what was decided"); expect(JSON.stringify(input)).not.toMatch(/PRIVATE SIDE|RESTRICTED ATTENDANCE|ABSENT NAME/); finish(); return "Answer"; });
    expect((await post()).status).toBe(200);
    const queries = mocks.predicates.map((q) => new PgDialect().sqlToQuery(q)); expect(queries.some((q) => q.sql.includes('"recipient_user_id" is null'))).toBe(true); expect(queries.some((q) => q.sql.includes('work_hub_meeting_attendance'))).toBe(false);
  });
  it("keeps private context and answers in the exact original two-person thread", async () => {
    const privateSource = { ...source, recipientUserId: 2 };
    prepare(privateSource, [privateSource, { ...source, userId: 2, recipientUserId: 1, body: "Our private plan" }, { ...source, userId: 2, recipientUserId: 3, body: "OTHER PAIR" }, { ...source, body: "SHARED ROOM" }], [{ id: 1, displayName: "Host" }, { id: 2, displayName: "Guest" }, { id: 3, displayName: "THIRD PERSON" }]);
    mocks.answerQuestion.mockImplementation(async (input) => { expect(JSON.stringify(input)).toContain("Our private plan"); expect(JSON.stringify(input)).not.toMatch(/OTHER PAIR|SHARED ROOM|THIRD PERSON/); finish(privateSource); return "Private answer"; });
    const response = await post(); expect(response.status).toBe(200); expect(response.body.answer).toMatchObject({ recipientUserId: 2, userId: 1, body: "Private answer" });
    const queries = mocks.predicates.map((q) => new PgDialect().sqlToQuery(q)); expect(queries.some((q) => q.params.filter((p) => p === 2).length === 2 && q.sql.includes('recipient_user_id'))).toBe(true); expect(queries.some((q) => q.sql.includes('work_hub_transcript_segments'))).toBe(false);
  });
  it("suppresses a private answer if the exact counterpart is removed during generation", async () => {
    const privateSource = { ...source, recipientUserId: 2 };
    prepare(privateSource, [privateSource], [{ id: 1, displayName: "Host" }, { id: 2, displayName: "Guest" }]);
    mocks.answerQuestion.mockImplementation(async () => {
      const runtime = (mocks.mutations.find((mutation) => mutation.type === "update")?.value as any).runtime;
      seed({ invited: true, guestRemoved: true, runtime });
      mocks.results.push([privateSource]);
      return "PRIVATE GENERATED TEXT";
    });
    const response = await post();
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE GENERATED TEXT");
    expect(mocks.mutations.filter((mutation) => mutation.type === "insert")).toEqual([]);
  });
  it("accepts an owned transcript source only when its artifact belongs to this meeting", async () => {
    const artifactId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea03";
    const transcriptSource = { id: messageId, artifactId, speakerUserId: 1, text: "V, what was said?", startsAtMs: 100, endsAtMs: 200 };
    seed({ invited: true });
    mocks.results.push([transcriptSource], [{ id: artifactId, occurrenceId: meetingId, artifactType: "transcript" }], [], [{ id: 1, displayName: "Host" }], [], [], []);
    mocks.answerQuestion.mockImplementation(async (input) => {
      expect(input).toMatchObject({ question: "what was said?", audience: "shared" });
      expect(JSON.stringify(input)).not.toMatch(new RegExp(messageId));
      const runtime = (mocks.mutations.find((mutation) => mutation.type === "update")?.value as any).runtime;
      seed({ invited: true, runtime });
      mocks.results.push([transcriptSource], [{ id: artifactId, occurrenceId: meetingId, artifactType: "transcript" }], [], []);
      return "Transcript answer";
    });
    const response = await post("transcript");
    expect(response.status).toBe(200);
    expect(response.body.answer).toMatchObject({ body: "Transcript answer", askv: { sourceType: "transcript", sourceStartsAtMs: 100, sourceEndsAtMs: 200 } });
  });
  it("rejects a transcript source whose artifact is outside the meeting", async () => {
    const transcriptSource = { id: messageId, artifactId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea03", speakerUserId: 1, text: "V, what was said?", startsAtMs: 100, endsAtMs: 200 };
    seed({ invited: true });
    mocks.results.push([transcriptSource], []);
    const response = await post("transcript");
    expect(response.status).toBe(422);
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
    expect(mocks.mutations).toEqual([]);
  });
  it("returns the same persisted answer on retry without a second model call", async () => {
    prepare(); mocks.answerQuestion.mockImplementation(async () => { finish(); return "Saved answer"; });
    const first = await post(); expect(first.status).toBe(200); const saved = mocks.mutations.find((m) => m.type === "insert")!.value;
    seed({ invited: true }); mocks.results.push([source], [saved]); const retry = await post(); expect(retry.status).toBe(200); expect(retry.body).toEqual({ answer: first.body.answer, replayed: true }); expect(mocks.answerQuestion).toHaveBeenCalledTimes(1);
  });
  it.each(["body", "audience"])("refuses replay if original %s changed", async (change) => {
    prepare(); mocks.answerQuestion.mockImplementation(async () => { finish(); return "Saved answer"; }); expect((await post()).status).toBe(200); const saved = mocks.mutations.find((m) => m.type === "insert")!.value;
    seed({ invited: true }); mocks.results.push([{ ...source, ...(change === "body" ? { body: "V, a different question?" } : { recipientUserId: 2 }) }], [saved]); expect((await post()).status).toBe(409); expect(mocks.answerQuestion).toHaveBeenCalledTimes(1);
  });
  it.each(["removed", "ended", "uninvited", "changed-source"])("suppresses generated text after %s during generation", async (reason) => {
    prepare(); mocks.answerQuestion.mockImplementation(async () => {
      const runtime = (mocks.mutations[0].value as any).runtime; seed({ invited: reason !== "uninvited", removed: reason === "removed", ended: reason === "ended", runtime });
      if (reason === "changed-source") mocks.results.push([{ ...source, body: "V, changed" }]); return "SENSITIVE GENERATED TEXT";
    });
    const result = await post(); expect(result.status).toBe(reason === "removed" ? 403 : 409); expect(JSON.stringify(result.body)).not.toContain("SENSITIVE"); expect(mocks.mutations.filter((m) => m.type === "insert")).toEqual([]);
  });
  it("treats a source message-type change during generation as a changed question", async () => {
    prepare();
    mocks.answerQuestion.mockImplementation(async () => {
      const runtime = (mocks.mutations[0].value as any).runtime;
      seed({ invited: true, runtime });
      mocks.results.push([{ ...source, messageType: "system" }]);
      return "GENERATED FROM A STALE SOURCE";
    });
    const response = await post();
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toContain("GENERATED FROM A STALE SOURCE");
    expect(mocks.mutations.filter((mutation) => mutation.type === "insert")).toEqual([]);
  });
  it("fails visibly without saving a fabricated answer when text AI fails", async () => {
    prepare(); mocks.answerQuestion.mockRejectedValue(new Error("private diagnostic")); const result = await post(); expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain("private diagnostic"); expect(mocks.mutations.filter((m) => m.type === "insert")).toEqual([]);
  });
  it("transactionally releases its own failed reservation so an immediate retry can answer", async () => {
    prepare();
    mocks.answerQuestion.mockImplementationOnce(async () => {
      const claimedRuntime = (mocks.mutations.find((mutation) => mutation.type === "update")?.value as any).runtime;
      mocks.results.push([{ id: meetingId, runtime: claimedRuntime }]);
      throw new Error("provider failed");
    });
    expect((await post()).status).toBe(503);
    const releasedRuntime = (mocks.mutations.filter((mutation) => mutation.type === "update").at(-1)?.value as any).runtime;
    expect(releasedRuntime.askvAnswerReservations).toBeUndefined();

    mocks.mutations = [];
    prepare(source, [], [{ id: 1, displayName: "Host" }]);
    mocks.results.splice(0, 3, ...[
      [{ id: meetingId, meetingId, status: "live", recordingState: "active", askvInvitedAt: new Date(), runtime: releasedRuntime }],
      [{ id: meetingId, ownerOrgType: "vendor", ownerOrgId: 22, policyVersion: 1, recordingAllowed: true }],
      [host, guest],
    ]);
    mocks.answerQuestion.mockImplementationOnce(async () => { finish(); return "Retry answer"; });
    const retry = await post();
    expect(retry.status).toBe(200);
    expect(retry.body.answer.body).toBe("Retry answer");
  });
  it("separates answer metadata from downloadable attachments in catch-up", async () => {
    seed(); mocks.results.push([{ id: 1, displayName: "Host" }], [], [{ ...source, messageType: "askv", attachment: { kind: "askv_answer", sourceFingerprint: "internal", sourceId: messageId, sourceType: "chat", requestedByUserId: 1, sourceCreatedAt: "2026-09-09T12:00:00Z", sourceStartsAtMs: null, sourceEndsAtMs: null, answeredAt: "2026-09-09T12:01:00Z" } }], [], [], []);
    const result = await request(app()).get(`/meetings/${meetingId}/catch-up`); expect(result.status).toBe(200); expect(result.body.chat[0]).toMatchObject({ displayName: "Ask V", attachment: null, askv: { sourceId: messageId, sourceType: "chat" } }); expect(JSON.stringify(result.body)).not.toContain("internal");
  });
  it("hides Ask V rows whose source, requester, or timestamps are malformed", async () => {
    const base = { ...source, messageType: "askv" };
    const valid = { kind: "askv_answer", sourceFingerprint: "internal", sourceId: messageId, sourceType: "chat", requestedByUserId: 1, sourceCreatedAt: "2026-09-09T12:00:00Z", sourceStartsAtMs: null, sourceEndsAtMs: null, answeredAt: "2026-09-09T12:01:00Z" };
    seed();
    mocks.results.push([{ id: 1, displayName: "Host" }], [], [
      { ...base, id: "bad-source", attachment: { ...valid, sourceId: undefined } },
      { ...base, id: "bad-requester", attachment: { ...valid, requestedByUserId: Number.NaN } },
      { ...base, id: "bad-time", attachment: { ...valid, answeredAt: "not-a-time" } },
      { ...base, id: "bad-provenance", attachment: { ...valid, sourceCreatedAt: undefined } },
    ], [], [], []);
    const result = await request(app()).get(`/meetings/${meetingId}/catch-up`);
    expect(result.status).toBe(200);
    expect(result.body.chat).toEqual([]);
    expect(JSON.stringify(result.body)).not.toMatch(/undefined|NaN|not-a-time/);
  });
});

describe("native meeting transcription", () => {
  const audio = { audioBase64: Buffer.from("local audio").toString("base64"), mimeType: "audio/webm" };
  let now = Date.now();
  const ready = (accepted = true) => { seed({ invited: true, muted: false }); mocks.results.push(accepted ? [{ userId: 1 }] : []); };
  const post = (body: unknown = audio) => request(app()).post(`/meetings/${meetingId}/transcribe-audio`).send(body as any);
  beforeEach(() => { now += 60_001; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); mocks.nativeAvailable.mockReturnValue(true); });
  afterEach(() => vi.useRealTimers());
  it("rejects unauthenticated capture without invoking the engine", async () => {
    mocks.session = null; expect((await post()).status).toBe(401); expect(mocks.nativeTranscribe).not.toHaveBeenCalled();
  });
  it.each(["muted", "absent", "not-invited", "declined", "removed"])("rejects %s capture without invoking the engine", async (reason) => {
    seed({ invited: reason !== "not-invited", muted: reason === "muted", removed: reason === "removed", ...(reason === "absent" ? { runtime: {} } : {}) });
    mocks.results.push(reason === "declined" ? [] : [{ userId: 1 }]);
    expect((await post()).status).toBe(reason === "removed" ? 403 : 409); expect(mocks.nativeTranscribe).not.toHaveBeenCalled();
  });
  it("returns unavailable when no native engine is configured", async () => {
    ready(); mocks.nativeAvailable.mockReturnValue(false);
    expect((await post()).status).toBe(503); expect(mocks.nativeTranscribe).not.toHaveBeenCalled();
  });
  it.each([1, 2])("requires consent from both the speaker and every present attendee when only user %s accepted", async (acceptedUserId) => {
    const presence = { seenAt: Date.now(), joinedAt: Date.now(), speaking: false };
    seed({ invited: true, muted: false, runtime: { presence: { 1: presence, 2: presence } } });
    mocks.results.push([{ userId: acceptedUserId }]);
    expect((await post()).status).toBe(409); expect(mocks.nativeTranscribe).not.toHaveBeenCalled();
  });
  it("runs outside the occurrence lock and returns only text after a second consent check", async () => {
    ready(); ready();
    mocks.nativeTranscribe.mockImplementation(async (bytes, mime, signal) => { expect(mocks.transactionDepth).toBe(0); expect(bytes).toEqual(Buffer.from("local audio")); expect(mime).toBe("audio/webm"); expect(signal).toBeInstanceOf(AbortSignal); return "  Local words  "; });
    const result = await post(); expect(result.status).toBe(200); expect(result.body).toEqual({ text: "Local words" }); expect(mocks.results).toEqual([]); expect(mocks.mutations).toEqual([]);
  });
  it("suppresses text when consent is revoked while the engine processes audio", async () => {
    ready(); ready(false); mocks.nativeTranscribe.mockResolvedValue("Private words");
    const result = await post(); expect(result.status).toBe(409); expect(JSON.stringify(result.body)).not.toContain("Private words");
  });
  it("aborts local processing when the client disconnects and rejects overlapping capture", async () => {
    ready();
    let started!: (signal: AbortSignal) => void, aborted!: () => void;
    const begin = new Promise<AbortSignal>((resolve) => { started = resolve; });
    const cancellation = new Promise<void>((resolve) => { aborted = resolve; });
    mocks.nativeTranscribe.mockImplementation((_bytes, _mime, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      started(signal); signal.addEventListener("abort", () => { aborted(); reject(new Error("cancelled")); }, { once: true });
    }));
    const pending = post(); const outcome = pending.then(() => undefined).catch(() => undefined);
    const signal = await Promise.race([begin, outcome.then(() => { throw new Error("Capture ended before native processing started"); })]);
    ready(); expect((await post()).status).toBe(429); expect(mocks.nativeTranscribe).toHaveBeenCalledTimes(1);
    pending.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([cancellation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native capture was not aborted")), 1000); })]); }
    finally { clearTimeout(timer); }
    await outcome; expect(signal.aborted).toBe(true);
  });
  it("returns 422 for the native engine's typed invalid-audio error", async () => {
    ready(); mocks.nativeTranscribe.mockRejectedValue(Object.assign(new Error("private diagnostic"), { code: "native_transcription_invalid" }));
    const result = await post(); expect(result.status).toBe(422); expect(JSON.stringify(result.body)).not.toContain("private diagnostic");
  });
  it.each([{ audioBase64: "YWJj===", mimeType: "audio/webm" }, { audioBase64: "YQ==\n", mimeType: "audio/webm" }, { audioBase64: "YR==", mimeType: "audio/webm" }, { audioBase64: "YQ==", mimeType: "application/octet-stream" }])("rejects malformed audio before invoking the engine", async (payload) => {
    ready(); expect((await post(payload)).status).toBe(400); expect(mocks.nativeTranscribe).not.toHaveBeenCalled();
  });
  it("limits decoded audio to four MiB", async () => {
    ready(); const result = await post({ ...audio, audioBase64: Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64") });
    expect(result.status).toBe(413); expect(mocks.nativeTranscribe).not.toHaveBeenCalled();
  });
  it.each(["", "   "])("accepts a silent clip without interrupting ongoing capture", async (text) => {
    ready(); ready(); mocks.nativeTranscribe.mockResolvedValue(text);
    const response = await post(); expect(response.status).toBe(200); expect(response.body).toEqual({ text: "" }); expect(mocks.results).toEqual([]);
  });
  it("returns a truthful unavailable response without exposing engine diagnostics", async () => {
    ready(); mocks.nativeTranscribe.mockRejectedValue(new Error("private subprocess details"));
    const result = await post(); expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain("private subprocess details");
  });
  it("bounds each attendee to twelve capture requests per minute", async () => {
    mocks.nativeTranscribe.mockResolvedValue("Words");
    for (let i = 0; i < 12; i++) { ready(); ready(); expect((await post()).status).toBe(200); }
    ready(); const result = await post(); expect(result.status).toBe(429); expect(mocks.nativeTranscribe).toHaveBeenCalledTimes(12);
  });
  it.each([false, true])("advertises actual native availability as %s", async (available) => {
    seed(); mocks.nativeAvailable.mockReturnValue(available); mocks.results.push([{ id: 1, displayName: "Host" }], [], [], [], [], []);
    const result = await request(app()).get(`/meetings/${meetingId}/catch-up`); expect(result.status).toBe(200); expect(result.body.nativeCaptureAvailable).toBe(available);
  });
});

describe("shipped audio compatibility", () => {
  it("denies a removed participant access to legacy recordings", async () => {
    mocks.results.push([{ ...guest, removedAt: new Date() }], [{ id: messageId, storageKey: "private-recording" }]);
    mocks.getObject.mockResolvedValue({ contentType: "audio/webm", body: Buffer.from("private audio") });
    const response = await request(app(true)).get(`/work-hub/meetings/${meetingId}/audio-chunks/${messageId}`);
    expect(response.status).toBe(404); expect(mocks.getObject).not.toHaveBeenCalled();
  });
  it("blocks removed hosts and serializes legacy recording against the new occurrence lock", async () => {
    mocks.results.push([{ ...host, removedAt: new Date() }]);
    const response = await request(app(true)).post(`/work-hub/meetings/${meetingId}/recording`).send({ enabled: true });
    expect(response.status).toBe(404);
    const locks = mocks.executed.map((q) => new PgDialect().sqlToQuery(q));
    expect(locks.some((q) => q.sql.includes('work_hub_meeting_occurrences') && q.sql.includes('for update') && q.params.includes(meetingId))).toBe(true);
    expect(mocks.mutations).toEqual([]);
  });
  it.each(["since", "after"])("keeps the %s signal response contract", async (cursor) => {
    const signal = { sequence: 5, fromUserId: 2, toUserId: 1, kind: "offer", payload: {}, createdAt: Date.now() };
    seed({ runtime: { sequence: 5, signals: [signal] } });
    const response = await request(app()).get(`/meetings/${meetingId}/signals?${cursor}=4`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(cursor === "since" ? [signal] : { sequence: 5, signals: [signal] });
  });
  it("returns a stable busy response when persisted signaling reaches its byte budget", async () => {
    const now = Date.now();
    const candidate = "\u00e9".repeat(30_000);
    const signals = Array.from({ length: 35 }, (_, index) => ({ sequence: index + 1, fromUserId: 1, toUserId: 2, kind: "ice", payload: { candidate }, createdAt: now }));
    seed({ runtime: { sequence: signals.length, signals, presence: { 1: { seenAt: now, joinedAt: now, speaking: false }, 2: { seenAt: now, joinedAt: now, speaking: false } } } });
    const response = await request(app()).post(`/meetings/${meetingId}/signal`).send({ toUserId: 2, kind: "ice", payload: { candidate: "next" } });
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ code: "work_hub.meeting", message: "Audio signaling is busy" });
  });
  it("refreshes a polling native participant without reviving another expired attendee", async () => {
    const joinedAt = Date.now() - 60_000;
    seed({ runtime: { presence: { 1: { seenAt: joinedAt, joinedAt, speaking: false }, 2: { seenAt: joinedAt, joinedAt, speaking: false } } } });
    const response = await request(app()).get(`/meetings/${meetingId}/audio-state`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ presentUserIds: [1], recordingState: "active" });
    const runtime = (mocks.mutations[0].value as any).runtime;
    expect(runtime.presence[1].seenAt).toBeGreaterThan(joinedAt);
    expect(runtime.presence[1].joinedAt).toBe(joinedAt);
    expect(runtime.presence[2].seenAt).toBe(joinedAt);
  });
  it("does not let a late audio-state poll resurrect a participant who left", async () => {
    seed({ runtime: {} });
    expect((await request(app()).get(`/meetings/${meetingId}/audio-state`)).body.presentUserIds).toEqual([]);
    expect(mocks.mutations).toEqual([]);
  });
  it("preserves duplicate join consent and returns native fields plus existing TURN credentials", async () => {
    vi.stubEnv("WORK_HUB_TURN_URLS", "turn:relay.example.invalid:3478"); vi.stubEnv("WORK_HUB_TURN_SECRET", "test-only");
    seed(); mocks.results.push([{ userId: 1, joinedAt: new Date() }], [], [{ response: "accepted" }], [{ userId: 1 }]);
    const response = await request(app()).post(`/meetings/${meetingId}/join`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userId: 1, policyVersion: 1, recordingAllowed: true, consentAccepted: true });
    expect(response.body.iceServers).toContainEqual({ urls: ["turn:relay.example.invalid:3478"], username: expect.stringMatching(/^\d+:1$/), credential: expect.any(String) });
    expect(mocks.mutations).toHaveLength(1);
    expect(mocks.mutations[0].value).not.toHaveProperty("recordingState");
  });
  it("stops capture and requires fresh consent on new attendance", async () => {
    seed({ runtime: {} }); mocks.results.push([], [], [], [], [{ response: "declined" }], []);
    const response = await request(app()).post(`/meetings/${meetingId}/join`).send({});
    expect(response.status).toBe(200); expect(response.body.consentAccepted).toBe(false);
    expect(mocks.mutations.some((m) => (m.value as any)?.response === "declined")).toBe(true);
    expect(mocks.mutations.some((m) => (m.value as any)?.recordingState === "off")).toBe(true);
  });
  it.each(["consent", "leave"])("stops legacy host capture on %s", async (path) => {
    seed(); mocks.results.push([{ response: "declined" }]);
    expect((await request(app()).post(`/meetings/${meetingId}/${path}`).send(path === "consent" ? { policyVersion: 1, response: "declined" } : {})).status).toBe(200);
    expect(mocks.mutations.some((m) => (m.value as any)?.recordingState === "off" && (m.value as any)?.transcriptState === "off")).toBe(true);
  });
  it("admits only an authenticated accepted external call participant", async () => {
    seed(); mocks.session!.vendorId = 77;
    mocks.results.push([{ occurrenceId: meetingId, status: "active", answeredAt: new Date(), callerUserId: 2, recipientUserId: 1 }]);
    expect((await request(app()).get(`/meetings/${meetingId}/signals?since=0`)).status).toBe(200);
    const query = mocks.predicates.map((p) => new PgDialect().sqlToQuery(p)).find((q) => q.sql.includes('"work_hub_calls"'));
    expect(query?.params).toEqual([meetingId, "active", 1, 1]);
    expect(query?.sql).toContain('"answered_at" is not null');
  });
  it("saves authorized mixed audio transcription after recording and attendance end", async () => {
    seed({ ended: true, runtime: {} });
    mocks.results.push([{ id: messageId, occurrenceId: meetingId, artifactType: "audio", state: "ready", metadata: { startsAtMs: 0, endsAtMs: 100 } }], [], [{ id: "transcript-artifact" }], [{ id: messageId, speakerUserId: null, text: "Recorded words" }]);
    const response = await request(app()).post(`/meetings/${meetingId}/transcript`).send({ id: messageId, text: "Recorded words", startsAtMs: 0, endsAtMs: 100 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: messageId, speakerUserId: null, text: "Recorded words" });
    expect(mocks.mutations[0].value).toMatchObject({ speakerUserId: null, artifactId: "transcript-artifact" });
    expect(mocks.mutations).toHaveLength(1);
  });
  it.each(["participant", "offset", "text"])("rejects legacy transcript %s violations", async (violation) => {
    seed({ runtime: {} }); if (violation === "participant") mocks.session!.userId = 2;
    mocks.results.push([{ id: messageId, occurrenceId: meetingId, artifactType: "audio", state: "ready", metadata: { startsAtMs: 0, endsAtMs: 100 } }]);
    if (violation === "text") mocks.results.push([{ id: messageId, text: "Original", speakerUserId: null, startsAtMs: 0, endsAtMs: 100 }]);
    const response = await request(app()).post(`/meetings/${meetingId}/transcript`).send({ id: messageId, text: "Changed", startsAtMs: 0, endsAtMs: violation === "offset" ? 101 : 100 });
    expect(response.status).toBe(violation === "participant" ? 403 : 409); expect(mocks.mutations).toEqual([]);
  });
  it("replays a legacy transcript without inserting it twice", async () => {
    seed({ runtime: {} });
    const segment = { id: messageId, text: "Recorded words", speakerUserId: null, startsAtMs: 0, endsAtMs: 100 };
    mocks.results.push([{ id: messageId, occurrenceId: meetingId, artifactType: "audio", state: "ready", metadata: { startsAtMs: 0, endsAtMs: 100 } }], [segment]);
    const response = await request(app()).post(`/meetings/${meetingId}/transcript`).send({ id: messageId, text: "Recorded words", startsAtMs: 0, endsAtMs: 100 });
    expect(response.status).toBe(200); expect(response.body).toEqual(segment); expect(mocks.mutations).toEqual([]);
  });
});

describe("meeting lifecycle HTTP boundaries", () => {
  it("requires authentication", async () => {
    mocks.session = null;
    expect((await request(app()).get(`/meetings/${meetingId}/catch-up`)).status).toBe(401);
    expect(mocks.mutations).toEqual([]);
  });
  it("hides an occurrence from a user who has no participant row", async () => {
    seed();
    mocks.results[2] = [guest];
    expect((await request(app()).post(`/meetings/${meetingId}/join`).send({})).status).toBe(404);
    expect(mocks.mutations).toEqual([]);
  });
  it.each(["join", "signal", "presence", "transcript", "chat"])("denies removed attendees at %s before any mutation", async (path) => {
    seed({ removed: true });
    expect((await request(app()).post(`/meetings/${meetingId}/${path}`).send({})).status).toBe(403);
    expect(mocks.mutations).toEqual([]);
  });
  it("denies cross-organization access even when an invitation row exists", async () => {
    seed(); mocks.session!.vendorId = 77;
    expect((await request(app()).get(`/meetings/${meetingId}/catch-up`)).status).toBe(403);
  });
  it("rejects transcription until Ask V is invited and consent is accepted", async () => {
    seed(); mocks.results.push([]);
    expect((await request(app()).post(`/meetings/${meetingId}/transcript`).send({ text: "private words", startsAtMs: 0, endsAtMs: 100 })).status).toBe(409);
    expect(mocks.mutations).toEqual([]);
  });
  it("refuses expired policy versions", async () => {
    seed();
    expect((await request(app()).post(`/meetings/${meetingId}/consent`).send({ policyVersion: 2, response: "accepted" })).status).toBe(409);
    expect(mocks.mutations).toEqual([]);
  });
  it("rejects private messages addressed to a person outside the meeting", async () => {
    seed();
    expect((await request(app()).post(`/meetings/${meetingId}/chat`).send({ body: "hello", recipientUserId: 99 })).status).toBe(404);
    expect(mocks.mutations).toEqual([]);
  });
  it("persists a private recipient without changing it into a shared message", async () => {
    seed(); mocks.results.push([{ id: messageId }]);
    expect((await request(app()).post(`/meetings/${meetingId}/chat`).send({ id: messageId, body: "hello", recipientUserId: 2 })).status).toBe(200);
    expect(mocks.mutations[0].value).toMatchObject({ occurrenceId: meetingId, userId: 1, recipientUserId: 2, body: "hello" });
  });
  it("does not acknowledge success when the transaction fails to commit", async () => {
    seed(); mocks.results.push([{ id: messageId }]); mocks.failCommit = true;
    expect((await request(app()).post(`/meetings/${meetingId}/chat`).send({ body: "hello" })).status).toBe(500);
  });
  it("does not allow the host to remove themself", async () => {
    seed();
    expect((await request(app()).post(`/meetings/${meetingId}/participants/1/remove`).send({})).status).toBe(403);
    expect(mocks.mutations).toEqual([]);
  });
  it("annotates removal, preserves records, and records the removal audit", async () => {
    seed(); mocks.results.push([], [], [], [{ name: "Bob" }], []);
    expect((await request(app()).post(`/meetings/${meetingId}/participants/2/remove`).send({})).status).toBe(200);
    expect(mocks.mutations[0].value).toMatchObject({ removedById: 1, muted: true });
    expect(mocks.mutations.at(-1)?.value).toMatchObject({ messageType: "system", body: "Bob was removed by the host." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.participant_removed", metadata: { removedUserId: 2 } }), expect.anything());
  });
  it("denies another pair's private file even to the meeting host", async () => {
    seed(); mocks.results.push([{ id: messageId, userId: 2, recipientUserId: 3, attachment: { storageKey: "private" } }]);
    expect((await request(app()).get(`/meetings/${meetingId}/files/${messageId}`)).status).toBe(404);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });
  it("filters private messages inside the database query and omits raw signalling state", async () => {
    seed(); mocks.results.push([{ id: 1, displayName: "Host" }], [], [], [], [], []);
    const response = await request(app()).get(`/meetings/${meetingId}/catch-up`);
    expect(response.status).toBe(200);
    expect(response.body.occurrence.runtime).toBeUndefined();
    const queries = mocks.predicates.map((value) => new PgDialect().sqlToQuery(value));
    const visibility = queries.find((q) => q.sql.includes('"work_hub_meeting_chat"."recipient_user_id"'));
    expect(visibility?.sql).toContain('"recipient_user_id" is null');
    expect(visibility?.params).toEqual([meetingId, 1, 1]);
  });
});
