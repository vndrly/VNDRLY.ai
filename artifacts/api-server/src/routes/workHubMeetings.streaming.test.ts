import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as any,
  results: [] as unknown[][],
  open: vi.fn(), send: vi.fn(), close: vi.fn(), closeAll: vi.fn(),
  nativeAvailable: vi.fn(), nativeTranscribe: vi.fn(),
  mutations: [] as Array<{ type: string; value?: any }>,
  transactionDepth: 0,
  transactionCalls: 0,
  holdTransactionCall: 0,
  transactionGate: undefined as Promise<void> | undefined,
}));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: vi.fn() }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: vi.fn() }));
vi.mock("../work-hub/native-transcription", () => ({ nativeTranscriptionAvailable: mocks.nativeAvailable, transcribeNativeAudio: mocks.nativeTranscribe }));
vi.mock("../work-hub/assemblyai-streaming", async (load) => ({
  ...(await load<any>()),
  openAssemblyAIStream: mocks.open,
  sendAssemblyAIFrame: mocks.send,
  closeAssemblyAIStream: mocks.close,
  closeAllAssemblyAIStreams: mocks.closeAll,
}));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<any>("@workspace/db/schema");
  function chain(type: string) {
    const mutation = type === "select" ? undefined : { type, value: undefined as unknown };
    if (mutation) mocks.mutations.push(mutation);
    const query: any = {};
    for (const method of ["from", "where", "for", "set", "values", "returning", "onConflictDoNothing", "onConflictDoUpdate", "orderBy", "limit"]) query[method] = (value: unknown) => { if (mutation && ["set", "values"].includes(method)) mutation.value = value; return query; };
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve);
    return query;
  }
  const tx = { select: () => chain("select"), insert: () => chain("insert"), update: () => chain("update") };
  return { ...schema, db: { ...tx, transaction: async (fn: (value: unknown) => unknown) => { const call = ++mocks.transactionCalls; mocks.transactionDepth++; try { if (call === mocks.holdTransactionCall) await mocks.transactionGate; return await fn(tx); } finally { mocks.transactionDepth--; } } } };
});
import router from "./workHubMeetings";

const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const sessionId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02";
const present = { seenAt: Date.now(), joinedAt: Date.now(), speaking: false };
function seed(options: { muted?: boolean; removed?: boolean; ended?: boolean; consent?: number[]; attendees?: number[] } = {}) {
  const attendeeIds = options.attendees ?? [1, 2];
  mocks.results.push(
    [{ id: occurrenceId, meetingId: occurrenceId, status: options.ended ? "ended" : "live", askvInvitedAt: new Date(), runtime: { startedAt: "2026-09-09T14:00:00.000Z", presence: Object.fromEntries(attendeeIds.map((id) => [id, present])) } }],
    [{ id: occurrenceId, ownerOrgType: "vendor", ownerOrgId: 22, policyVersion: 7, recordingAllowed: true }],
    attendeeIds.map((userId) => ({ id: `p${userId}`, userId, role: userId === 1 ? "host" : "participant", removedAt: userId === 1 && options.removed ? new Date() : null, muted: userId === 1 ? Boolean(options.muted) : false })),
  );
  if (!options.removed && !options.ended) mocks.results.push((options.consent ?? attendeeIds).map((userId) => ({ userId })));
}
function app() {
  const value = express(); value.use(express.json({ limit: "1mb" })); value.use("/meetings", router);
  value.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "failed" }));
  return value;
}
beforeEach(() => {
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = []; mocks.mutations = [];
  mocks.transactionDepth = 0; mocks.transactionCalls = 0; mocks.holdTransactionCall = 0; mocks.transactionGate = undefined;
  mocks.open.mockReset().mockResolvedValue({ sessionId, sampleRate: 16000, frameDurationMs: 500 });
  mocks.send.mockReset().mockResolvedValue({ turns: [] }); mocks.close.mockReset().mockResolvedValue({ closed: true }); mocks.closeAll.mockReset().mockResolvedValue(undefined);
  mocks.nativeAvailable.mockReset().mockReturnValue(true); mocks.nativeTranscribe.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("VNDRLY_MEETING_STT_PROVIDER", "assemblyai"); vi.stubEnv("ASSEMBLYAI_API_KEY", "fake-route-key"); vi.stubEnv("ASSEMBLYAI_MODEL_TRAINING_ALLOWED", "1"); vi.stubEnv("VNDRLY_MEETING_STT_TRIAL_USER_IDS", "1,2");
});

describe("authenticated meeting streaming routes", () => {
  const start = () => request(app()).post(`/meetings/${occurrenceId}/transcription-stream`).send({});
  const frame = (extra: Record<string, unknown> = {}) => request(app()).post(`/meetings/${occurrenceId}/transcription-stream/${sessionId}/frame`).send({ sequence: 0, pcmBase64: Buffer.alloc(16_000).toString("base64"), ...extra });

  it("rejects an unauthenticated start and never opens a provider connection", async () => {
    mocks.session = null; expect((await start()).status).toBe(401); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("opens outside the row-lock transaction only for an unmuted, present, fully consenting trial audience", async () => {
    seed(); seed();
    const response = await start();
    expect(response.status).toBe(200); expect(response.body).toEqual({ sessionId, sampleRate: 16000, frameDurationMs: 500 });
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId, userId: 1, startedAtMs: expect.any(Number), signal: expect.any(AbortSignal) }));
  });
  it.each([
    ["muted", { muted: true }], ["removed", { removed: true }], ["ended", { ended: true }], ["one attendee declined", { consent: [1] }], ["outside trial audience", { attendees: [1, 3] }],
  ] as const)("rejects %s before audio leaves the API", async (_name, options) => {
    seed(options as any); expect((await start()).status).toBe(_name === "removed" ? 403 : 409); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("fails closed when AssemblyAI is not explicitly selected and preserves native availability", async () => {
    vi.stubEnv("VNDRLY_MEETING_STT_PROVIDER", "native"); seed();
    expect((await start()).status).toBe(503); expect(mocks.open).not.toHaveBeenCalled();
    seed(); mocks.results.push([{ id: 1, displayName: "Host" }, { id: 2, displayName: "Guest" }], [], [], [], [{ userId: 1 }], []);
    const snapshot = await request(app()).get(`/meetings/${occurrenceId}/catch-up`);
    expect(snapshot.body).toMatchObject({ streamingCaptureAvailable: false, nativeCaptureAvailable: true });
    expect(snapshot.body.transcriptionProvider).toBeUndefined();
    expect(JSON.stringify(snapshot.body)).not.toContain("fake-route-key");
  });
  it("does not advertise or fall back to native clip capture when streaming is selected but unavailable", async () => {
    vi.stubEnv("ASSEMBLYAI_MODEL_TRAINING_ALLOWED", "0"); seed();
    mocks.results.push([{ id: 1, displayName: "Host" }, { id: 2, displayName: "Guest" }], [], [], [], [{ userId: 1 }], []);
    const snapshot = await request(app()).get(`/meetings/${occurrenceId}/catch-up`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({ nativeCaptureAvailable: false, streamingCaptureAvailable: false });
    expect(mocks.nativeAvailable).not.toHaveBeenCalled();
  });
  it("forwards an authorized frame with server-owned identity and rechecks before disclosing turns", async () => {
    seed(); seed(); seed(); let forwarded = false;
    mocks.send.mockImplementation(async (input) => {
      expect(mocks.transactionDepth).toBe(0);
      await input.authorizeAndSend(() => { expect(mocks.transactionDepth).toBe(1); forwarded = true; });
      return { turns: [{ id: sessionId, turnOrder: 2, text: "Safe words", startsAtMs: 1, endsAtMs: 2 }] };
    });
    const response = await frame({ ackTurnOrder: 1, speakerUserId: 999 });
    expect(response.status).toBe(200); expect(response.body.turns[0].text).toBe("Safe words"); expect(forwarded).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ sessionId, occurrenceId, userId: 1, sequence: 0, pcmBase64: expect.any(String), ackTurnOrder: 1, authorizeAndSend: expect.any(Function) }));
  });
  it("closes only the authenticated requester's owned stream when initial authorization fails", async () => {
    seed({ consent: [1] }); const response = await frame();
    expect(response.status).toBe(409); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledWith({ sessionId, occurrenceId, userId: 1 });
  });
  it("closes and suppresses provider results when authorization changes after forwarding", async () => {
    seed(); seed({ muted: true }); mocks.send.mockResolvedValue({ turns: [{ id: sessionId, turnOrder: 2, text: "Must not disclose", startsAtMs: 1, endsAtMs: 2 }] });
    const response = await frame(); expect(response.status).toBe(409); expect(JSON.stringify(response.body)).not.toContain("Must not disclose");
    expect(mocks.close).toHaveBeenCalledWith({ sessionId, occurrenceId, userId: 1 });
  });
  it("enforces owner identity on close and preserves the existing consent policy version", async () => {
    seed(); mocks.session.userId = 2;
    const response = await request(app()).post(`/meetings/${occurrenceId}/transcription-stream/${sessionId}/close`).send({});
    expect(response.status).toBe(200); expect(mocks.close).toHaveBeenCalledWith({ sessionId, occurrenceId, userId: 2 });
    mocks.results = []; mocks.session.userId = 1;
    seed(); mocks.results.push([{ response: "accepted" }]);
    const consent = await request(app()).post(`/meetings/${occurrenceId}/consent`).send({ policyVersion: 7, response: "accepted" });
    expect(consent.status).toBe(200);
  });
  it("cancels provider initialization when the response closes before a handle can be delivered", async () => {
    seed(); let observedSignal: AbortSignal | undefined;
    mocks.open.mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      observedSignal = signal; signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
    }));
    const pending = start(); const outcome = pending.then(() => undefined).catch(() => undefined);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce()); pending.abort();
    await outcome; await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
  });
  it("closes an opened handle when the response disconnects during post-open authorization", async () => {
    seed(); seed(); let release!: () => void; let observedSignal: AbortSignal | undefined;
    mocks.open.mockImplementation(async ({ signal }) => { observedSignal = signal; return { sessionId, sampleRate: 16000, frameDurationMs: 500 }; });
    mocks.holdTransactionCall = 2; mocks.transactionGate = new Promise<void>((resolve) => { release = resolve; });
    const pending = start(); const outcome = pending.then(() => undefined).catch(() => undefined);
    await vi.waitFor(() => expect(mocks.transactionCalls).toBe(2)); pending.abort();
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true)); release(); await outcome;
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledWith({ sessionId, occurrenceId, userId: 1 }));
  });
});
