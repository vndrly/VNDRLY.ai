import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as any,
  results: [] as unknown[][],
  mutations: [] as Array<{ type: string; value?: unknown }>,
  audit: vi.fn(), putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn(), failCommit: false,
}));

vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: mocks.audit }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => ({ putObject: mocks.putObject, getObject: mocks.getObject, deleteObject: mocks.deleteObject }) }));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  function chain(type: string) {
    const mutation = type === "select" ? undefined : { type, value: undefined as unknown };
    if (mutation) mocks.mutations.push(mutation);
    const query: Record<string, any> = {};
    for (const method of ["from", "where", "for", "set", "values", "returning", "onConflictDoNothing", "orderBy", "limit", "innerJoin"]) {
      query[method] = (value: unknown) => { if (mutation && ["set", "values"].includes(method)) mutation.value = value; return query; };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.results.shift() ?? []).then(resolve);
    return query;
  }
  const tx = { select: () => chain("select"), insert: () => chain("insert"), update: () => chain("update") };
  return { ...schema, db: { ...tx, transaction: async (fn: (value: unknown) => unknown) => { const value = await fn(tx); if (mocks.failCommit) throw new Error("commit failed"); return value; } } };
});

import replayRouter from "./workHubMeetingReplay";

const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec01";
const manifestId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec02";
const chunkId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec03";
const operationId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec04";
const startedAt = "2026-09-09T12:00:00.000Z";
const leaseToken = "rpl_test_browser_a_opaque_recording_token_123456789";
const leaseTokenHash = createHash("sha256").update(leaseToken).digest("hex");
function pcmWav(durationMs: number) {
  const sampleRate = 16_000; const sampleCount = sampleRate * durationMs / 1_000; const dataSize = sampleCount * 2;
  const value = Buffer.alloc(44 + dataSize);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVE", 8);
  value.write("fmt ", 12); value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(sampleRate, 24); value.writeUInt32LE(sampleRate * 2, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write("data", 36); value.writeUInt32LE(dataSize, 40); return value;
}
const body = pcmWav(5_000);
const checksum = createHash("sha256").update(body).digest("hex");
const manifest = { id: manifestId, occurrenceId, ownerOrgType: "vendor", ownerOrgId: 22, recordingOwnerUserId: 1, recordingLeaseGeneration: 1, recordingLeaseTokenHash: leaseTokenHash, recordingLeaseHolderUserId: 1, recordingLeaseIssuedAt: new Date(startedAt), recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 120_000), status: "recording", schemaVersion: 2, rendererVersion: 1, meetingStartedAt: new Date(startedAt), meetingEndedAt: null, durationMs: null, gapMarkers: [], audioByteCount: 0, audioChunkCount: 0 };
const chunk = { id: chunkId, manifestId, occurrenceId, operationId, leaseGeneration: 1, sequence: 0, startsAtMs: 0, endsAtMs: 5_000, durationMs: 5_000, sampleRate: 16_000, channelCount: 1, bitsPerSample: 16, sampleCount: 80_000, contentType: "audio/wav", byteSize: body.length, sha256: checksum, storageKey: `/objects/meetings/${occurrenceId}/replay/${chunkId}`, state: "ready" };

function seedContext(options: { userId?: number; role?: string; removed?: boolean; status?: string; recordingState?: string; ownerId?: number; durationMs?: number; omitEnd?: boolean } = {}) {
  const endedAt = new Date(Date.parse(startedAt) + (options.durationMs ?? 5_000)).toISOString();
  mocks.results.push(
    [{ id: occurrenceId, meetingId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05", status: options.status ?? "live", recordingState: options.recordingState ?? "active", runtime: { startedAt, ...(!options.omitEnd && ["ended", "cancelled"].includes(options.status ?? "") ? { endedAt } : {}) } }],
    [{ id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05", ownerOrgType: "vendor", ownerOrgId: options.ownerId ?? 22, recordingAllowed: true }],
    [{ occurrenceId, userId: options.userId ?? 1, role: options.role ?? "host", removedAt: options.removed ? new Date() : null }],
  );
}

function app() {
  const server = express(); server.use("/meetings", replayRouter);
  server.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "failed" }));
  return server;
}

function upload(headers: Record<string, string> = {}) {
  return request(app()).put(`/meetings/${occurrenceId}/replay/audio/${chunkId}`)
    .set("content-type", "audio/wav").set("x-replay-operation-id", operationId)
    .set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1")
    .set("x-replay-session-id", leaseToken)
    .set("x-replay-sequence", "0").set("x-replay-start-ms", "0").set("x-replay-end-ms", "5000")
    .set(headers).set("x-content-sha256", checksum).send(body);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(startedAt) + 5_000);
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = []; mocks.mutations = []; mocks.failCommit = false; mocks.audit.mockReset(); mocks.putObject.mockReset(); mocks.getObject.mockReset(); mocks.deleteObject.mockReset().mockResolvedValue(undefined);
});

describe("meeting replay recording routes", () => {
  it("issues the authorized host a server recording clock and lease", async () => {
    seedContext(); mocks.results.push([], [manifest], []);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/session`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({});
    expect(response.status).toBe(200); expect(response.body.recordingSessionId).toMatch(/^[A-Za-z0-9_-]{40,}$/); expect(response.body.recordingSessionId).not.toBe(manifestId);
    expect(response.body).toMatchObject({ leaseGeneration: 2, issuedAt: "2026-09-09T12:00:05.000Z", expiresAt: "2026-09-09T12:02:05.000Z", startedAt, nextSequence: 0, admittedThroughMs: 5_000 });
    const leaseUpdate = mocks.mutations.find((entry) => entry.type === "update")?.value as Record<string, unknown>;
    expect(leaseUpdate.recordingLeaseTokenHash).toBe(createHash("sha256").update(response.body.recordingSessionId).digest("hex")); expect(JSON.stringify(leaseUpdate)).not.toContain(response.body.recordingSessionId);
  });

  it("rotates an exclusive opaque lease and rejects the stale browser and expired holder", async () => {
    seedContext(); mocks.results.push([], [manifest], []);
    const first = await request(app()).post(`/meetings/${occurrenceId}/replay/session`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({});
    const firstToken = first.body.recordingSessionId;
    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 6_000); seedContext();
    mocks.results.push([], [{ ...manifest, recordingLeaseGeneration: 2, recordingLeaseTokenHash: createHash("sha256").update(firstToken).digest("hex"), recordingLeaseIssuedAt: new Date(Date.parse(startedAt) + 5_000), recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 125_000) }], []);
    const second = await request(app()).post(`/meetings/${occurrenceId}/replay/session`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({});
    expect(second.status).toBe(200); expect(second.body.leaseGeneration).toBe(3); expect(second.body.recordingSessionId).not.toBe(firstToken);

    mocks.results = []; seedContext(); mocks.results.push([], [{ ...manifest, recordingLeaseGeneration: 3, recordingLeaseTokenHash: createHash("sha256").update(second.body.recordingSessionId).digest("hex"), recordingLeaseIssuedAt: new Date(Date.parse(startedAt) + 6_000), recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 126_000) }]);
    expect((await upload({ "x-replay-session-id": firstToken })).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();

    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 130_000); seedContext(); mocks.results.push([], [{ ...manifest, recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 120_000) }]);
    expect((await upload()).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("stores a first host audio chunk under an occurrence-scoped private key", async () => {
    seedContext(); mocks.results.push([], [manifest], [], [{ ...chunk }]);
    const response = await upload();
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ replayed: false, chunk: { sequence: 0, startsAtMs: 0, endsAtMs: 5_000, byteSize: body.length, sha256: checksum } });
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|ownerOrgId|operationId/);
    expect(mocks.putObject).toHaveBeenCalledWith(chunk.storageKey, "audio/wav", body, { owner: "1", visibility: "private" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.replay_audio_saved", metadata: { sequence: 0, byteSize: body.length, transportGapMs: 0 } }), expect.anything());
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toMatch(new RegExp(checksum));
  });

  it("returns an exact ready operation replay without rewriting object bytes", async () => {
    seedContext(); mocks.results.push([], [manifest], [chunk]);
    mocks.getObject.mockResolvedValue({ contentType: chunk.contentType, body });
    const response = await upload();
    expect(response.status).toBe(200); expect(response.body.replayed).toBe(true); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it.each([
    ["removed member", { removed: true }, 403],
    ["non-host", { role: "participant" }, 403],
    ["ended meeting", { status: "ended" }, 409],
    ["recording off", { recordingState: "off" }, 409],
    ["wrong owner", { ownerId: 99 }, 403],
  ])("rejects %s before storage", async (_name, options, status) => {
    seedContext(options); const response = await upload(); expect(response.status).toBe(status); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("rejects an overlapping or sequence-conflicting chunk without storage", async () => {
    seedContext(); mocks.results.push([], [manifest], [{ ...chunk, id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec09", operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec09" }]);
    const response = await upload(); expect(response.status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("rejects arbitrary shifted, future, cross-session, and concurrent sequence coverage", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(startedAt) + 10_000);
    seedContext(); mocks.results.push([], [manifest], [], [{ ...chunk, startsAtMs: 60_000, endsAtMs: 65_000 }]);
    expect((await upload({ "x-replay-start-ms": "60000", "x-replay-end-ms": "65000" })).status).toBe(409);
    expect(mocks.putObject).not.toHaveBeenCalled();

    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt)); seedContext(); mocks.results.push([], [manifest], [], [{ ...chunk }]);
    expect((await upload()).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();

    mocks.results = []; seedContext(); mocks.results.push([], [manifest]); expect((await upload({ "x-replay-session-id": "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec99" })).status).toBe(409);
    expect(mocks.putObject).not.toHaveBeenCalled();

    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 10_000); seedContext(); mocks.results.push([], [manifest], [{ ...chunk, id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec09", operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec09" }]);
    expect((await upload()).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("rejects first-chunk and contiguous backfill that is stale against the server clock", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 60_000);
    seedContext(); mocks.results.push([], [{ ...manifest, recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 120_000) }], []);
    expect((await upload()).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();

    const secondBody = pcmWav(5_000); const secondChecksum = createHash("sha256").update(secondBody).digest("hex");
    mocks.results = []; seedContext(); mocks.results.push([], [{ ...manifest, recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 120_000) }], [chunk]);
    const response = await request(app()).put(`/meetings/${occurrenceId}/replay/audio/17795fa1-bb5f-4abc-a5f8-7e9b33a0ec14`).set("content-type", "audio/wav").set("x-replay-operation-id", "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec15").set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).set("x-replay-sequence", "1").set("x-replay-start-ms", "5000").set("x-replay-end-ms", "10000").set("x-content-sha256", secondChecksum).send(secondBody);
    expect(response.status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("anchors a renewed recorder at server time and records the real outage gap", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 60_000); seedContext(); mocks.results.push([], [manifest], []);
    const session = await request(app()).post(`/meetings/${occurrenceId}/replay/session`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({});
    expect(session.status).toBe(200); expect(session.body.admittedThroughMs).toBe(60_000);
    expect(mocks.mutations.find((entry) => entry.type === "update")?.value).toMatchObject({ gapMarkers: [{ startsAtMs: 0, endsAtMs: 60_000, reason: "recorder_interruption" }] });

    const freshBody = pcmWav(5_000); const freshChecksum = createHash("sha256").update(freshBody).digest("hex");
    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 65_000); seedContext();
    const active = { ...manifest, recordingLeaseGeneration: 2, recordingLeaseTokenHash: createHash("sha256").update(session.body.recordingSessionId).digest("hex"), recordingLeaseIssuedAt: new Date(Date.parse(startedAt) + 60_000), recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 180_000), gapMarkers: [{ startsAtMs: 0, endsAtMs: 60_000, reason: "recorder_interruption" }] };
    mocks.results.push([], [active], [], [{ ...chunk, leaseGeneration: 2, startsAtMs: 60_000, endsAtMs: 65_000 }]);
    const response = await request(app()).put(`/meetings/${occurrenceId}/replay/audio/${chunkId}`).set("content-type", "audio/wav").set("x-replay-operation-id", operationId).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", session.body.recordingSessionId).set("x-replay-sequence", "0").set("x-replay-start-ms", "60000").set("x-replay-end-ms", "65000").set("x-content-sha256", freshChecksum).send(freshBody);
    expect(response.status).toBe(201); expect(response.body.chunk).toMatchObject({ startsAtMs: 60_000, endsAtMs: 65_000 });
  });

  it("normalizes consecutive lease-rotation gaps without overlapping persisted markers", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 61_000); seedContext();
    mocks.results.push([], [{ ...manifest, recordingLeaseGeneration: 2, gapMarkers: [{ startsAtMs: 0, endsAtMs: 60_000, reason: "recorder_interruption" }] }], []);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/session`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({});
    expect(response.status).toBe(200);
    expect(mocks.mutations.find((entry) => entry.type === "update")?.value).toMatchObject({ gapMarkers: [{ startsAtMs: 0, endsAtMs: 61_000, reason: "recorder_interruption" }] });

    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 70_000); seedContext();
    mocks.results.push([], [{ ...manifest, recordingLeaseGeneration: 3, gapMarkers: [{ startsAtMs: 0, endsAtMs: 60_000, reason: "recorder_interruption" }] }], [{ ...chunk, startsAtMs: 60_000, endsAtMs: 65_000 }]);
    const afterAudio = await request(app()).post(`/meetings/${occurrenceId}/replay/session`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({});
    expect(afterAudio.status).toBe(200);
    expect(mocks.mutations.filter((entry) => entry.type === "update").at(-1)?.value).toMatchObject({ gapMarkers: [
      { startsAtMs: 0, endsAtMs: 60_000, reason: "recorder_interruption" },
      { startsAtMs: 65_000, endsAtMs: 70_000, reason: "recorder_interruption" },
    ] });
  });

  it("admits a bounded delayed-transport gap while deriving placement from prior verified coverage", async () => {
    const secondBody = pcmWav(1_000); const secondChecksum = createHash("sha256").update(secondBody).digest("hex");
    const first = { ...chunk, endsAtMs: 1_000, durationMs: 1_000, sampleCount: 16_000, byteSize: pcmWav(1_000).length, sha256: createHash("sha256").update(pcmWav(1_000)).digest("hex") };
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(startedAt) + 3_000); seedContext(); mocks.results.push([], [manifest], [first], [{ ...chunk, id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec14", operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec15", sequence: 1, startsAtMs: 1_500, endsAtMs: 2_500, durationMs: 1_000, sampleCount: 16_000, byteSize: secondBody.length, sha256: secondChecksum }]);
    const response = await request(app()).put(`/meetings/${occurrenceId}/replay/audio/17795fa1-bb5f-4abc-a5f8-7e9b33a0ec14`).set("content-type", "audio/wav").set("x-replay-operation-id", "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec15").set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).set("x-replay-sequence", "1").set("x-replay-start-ms", "1500").set("x-replay-end-ms", "2500").set("x-replay-transport-gap-ms", "500").set("x-content-sha256", secondChecksum).send(secondBody);
    expect(response.status).toBe(201); expect(response.body.chunk).toMatchObject({ sequence: 1, startsAtMs: 1_500, endsAtMs: 2_500 });
  });

  it("cleans up only the newly written object when the database transaction rolls back", async () => {
    seedContext(); mocks.results.push([], [manifest], [], [{ ...chunk }]); mocks.failCommit = true;
    const response = await upload();
    expect(response.status).toBe(500); expect(mocks.deleteObject).toHaveBeenCalledWith(chunk.storageKey);
    mocks.failCommit = false; mocks.results = []; mocks.deleteObject.mockClear(); seedContext(); mocks.results.push([], [manifest], [], [{ ...chunk }]);
    expect((await upload()).status).toBe(201); expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("fails closed before storage when client or persisted replay versions drift", async () => {
    expect((await upload({ "x-replay-schema-version": "3" })).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();
    seedContext(); mocks.results.push([], [{ ...manifest, rendererVersion: 2 }]);
    expect((await upload()).status).toBe(409); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("snapshots a shared message as an idempotent timed event without internal metadata", async () => {
    const sourceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10";
    const eventId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec11";
    const shared = { id: sourceId, occurrenceId, userId: 1, recipientUserId: null, body: "Shared update", messageType: "typed", attachment: null, createdAt: new Date("2026-09-09T12:00:02.000Z") };
    const saved = { id: eventId, manifestId, occurrenceId, operationId, eventKey: `message:${sourceId}`, eventType: "message", offsetMs: 2_000, endOffsetMs: null, sourceId, actorUserId: 1, payload: { displayName: "Host", body: "Shared update", messageType: "typed" } };
    seedContext(); mocks.results.push([], [manifest], [shared], [{ id: 1, displayName: "Host" }], [], [saved]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ operationId, eventType: "message", sourceId, offsetMs: 9_999 });
    expect(response.status).toBe(201); expect(response.body).toEqual({ replayed: false, event: { key: eventId, type: "message", offsetMs: 2_000, endOffsetMs: null, payload: saved.payload } });
    expect(JSON.stringify(response.body)).not.toMatch(/sourceId|actorUserId|operationId|recipientUserId/);
    expect(JSON.stringify(response.body)).not.toContain(sourceId);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.replay_event_saved", metadata: { eventType: "message", offsetMs: 2_000 } }), expect.anything());
  });

  it("refuses private side-thread messages from the shared replay", async () => {
    const sourceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10";
    const eventId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec11";
    seedContext(); mocks.results.push([], [manifest], [{ id: sourceId, occurrenceId, userId: 1, recipientUserId: 2, body: "PRIVATE", messageType: "typed" }]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ operationId, eventType: "message", sourceId, offsetMs: 2_000 });
    expect(response.status).toBe(422); expect(JSON.stringify(mocks.mutations)).not.toContain("PRIVATE");
  });

  it("rejects transient participant activity and out-of-order durable sources", async () => {
    const eventId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec11";
    seedContext(); mocks.results.push([], [manifest]);
    const transient = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ operationId, eventType: "activity", actorUserId: 1, offsetMs: 1_000, state: "typing" });
    expect(transient.status).toBe(422);

    mocks.results = []; seedContext(); mocks.results.push([], [manifest]);
    const privateActivity = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ operationId, eventType: "activity", sourceId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10", actorUserId: 1, offsetMs: 1_000, state: "typing" });
    expect(privateActivity.status).toBe(422);

    mocks.results = []; const sourceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10";
    seedContext(); mocks.results.push([], [manifest], [{ id: sourceId, occurrenceId, userId: 1, recipientUserId: null, body: "Old", messageType: "typed", attachment: null, createdAt: new Date("2026-09-09T12:00:02.000Z") }], [{ id: 1, displayName: "Host" }], [{ id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec12", operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec13", eventKey: "later", eventType: "message", offsetMs: 3_000 }]);
    const outOfOrder = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ operationId, eventType: "message", sourceId, offsetMs: 2_000 });
    expect(outOfOrder.status).toBe(409);
  });

  it("uses replay-event identity for shared file capabilities and never exposes the chat id", async () => {
    const sourceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10"; const eventId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec11";
    const file = { id: sourceId, occurrenceId, userId: 1, recipientUserId: null, body: "receipt.pdf", messageType: "attachment", createdAt: new Date("2026-09-09T12:00:02.000Z"), attachment: { fileName: "receipt.pdf", contentType: "application/pdf", byteSize: 3, storageKey: `/objects/meetings/${occurrenceId}/${sourceId}`, sha256: "a".repeat(64) } };
    const saved = { id: eventId, manifestId, occurrenceId, operationId, eventKey: `file:${sourceId}`, eventType: "file", offsetMs: 2_000, endOffsetMs: null, sourceId, actorUserId: 1, payload: { displayName: "Host", fileName: "receipt.pdf", contentType: "application/pdf", byteSize: 3, downloadPath: `/api/work-hub/meetings/${occurrenceId}/replay/files/${eventId}` } };
    seedContext(); mocks.results.push([], [manifest], [file], [{ id: 1, displayName: "Host" }], [], [saved]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ operationId, eventType: "file", sourceId, offsetMs: 0 });
    expect(response.status).toBe(201); expect(response.body.event.payload.downloadPath).toContain(`/replay/files/${eventId}`); expect(JSON.stringify(response.body)).not.toContain(sourceId);
  });

  it("does not accept a source row id as the public replay-event capability", async () => {
    const sourceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10";
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/events/${sourceId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").send({ operationId, eventType: "file", sourceId, offsetMs: 0 });
    expect(response.status).toBe(422); expect(mocks.mutations).toEqual([]);
  });

  it("finalizes only an ended meeting and preserves explicit gaps", async () => {
    seedContext({ status: "ended", recordingState: "off", durationMs: 6_000 });
    mocks.results.push([manifest], [chunk], [], []);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/finalize`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ gaps: [{ startsAtMs: 5_000, endsAtMs: 6_000, reason: "recorder_interruption" }] });
    expect(response.status).toBe(200); expect(response.body).toEqual({ finalized: true, replayed: false });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.replay_finalized", metadata: { durationMs: 6_000, gapCount: 1, chunkCount: 1 } }), expect.anything());
  });

  it("rejects a client-forged final duration and derives it from the durable lifecycle clock", async () => {
    seedContext({ status: "ended", recordingState: "off", durationMs: 6_000 }); mocks.results.push([manifest]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/finalize`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ durationMs: 60_000, gaps: [] });
    expect(response.status).toBe(409); expect(mocks.mutations.some((mutation) => mutation.type === "update")).toBe(false);
  });

  it("persists one cancellation clock and replays finalization idempotently", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 6_000);
    seedContext({ status: "cancelled", recordingState: "off", omitEnd: true }); mocks.results.push([manifest], [chunk], [], []);
    const first = await request(app()).post(`/meetings/${occurrenceId}/replay/finalize`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ gaps: [] });
    expect(first.status).toBe(200); expect(first.body.replayed).toBe(false);
    expect(mocks.mutations.filter((entry) => entry.type === "update").map((entry) => entry.value)).toContainEqual(expect.objectContaining({ runtime: expect.objectContaining({ endedAt: "2026-09-09T12:00:06.000Z" }) }));

    mocks.results = []; vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 30_000); seedContext({ status: "cancelled", recordingState: "off", omitEnd: true });
    mocks.results.push([{ ...manifest, status: "finalized", meetingEndedAt: new Date("2026-09-09T12:00:06.000Z"), durationMs: 6_000 }]);
    const retry = await request(app()).post(`/meetings/${occurrenceId}/replay/finalize`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ gaps: [] });
    expect(retry.status).toBe(200); expect(retry.body).toEqual({ finalized: true, replayed: true });
  });

  it("preserves normalized server outage gaps through finalization and authorized retrieval", async () => {
    const outage = [{ startsAtMs: 0, endsAtMs: 60_000, reason: "recorder_interruption" }];
    const lateChunk = { ...chunk, startsAtMs: 60_000, endsAtMs: 65_000 };
    const recording = { ...manifest, recordingLeaseIssuedAt: new Date(Date.parse(startedAt) + 60_000), recordingLeaseExpiresAt: new Date(Date.parse(startedAt) + 180_000), gapMarkers: outage };
    seedContext({ status: "ended", recordingState: "off", durationMs: 70_000 }); mocks.results.push([recording], [lateChunk], []);
    const finalized = await request(app()).post(`/meetings/${occurrenceId}/replay/finalize`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1").set("x-replay-session-id", leaseToken).send({ gaps: [] });
    expect(finalized.status).toBe(200);
    expect(mocks.mutations.filter((entry) => entry.type === "update").at(-1)?.value).toMatchObject({ gapMarkers: outage });

    mocks.results = []; seedContext({ role: "participant", status: "ended", recordingState: "off", durationMs: 70_000 });
    mocks.results.push([{ ...recording, status: "finalized", meetingEndedAt: new Date(Date.parse(startedAt) + 70_000), durationMs: 70_000, gapMarkers: outage }], [lateChunk], []);
    const retrieved = await request(app()).get(`/meetings/${occurrenceId}/replay`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1");
    expect(retrieved.status).toBe(200); expect(retrieved.body.gaps).toEqual([
      ...outage,
      { startsAtMs: 65_000, endsAtMs: 70_000, reason: "missing_audio" },
    ]);
    expect(JSON.stringify(retrieved.body)).not.toMatch(/recordingLease|recordingSession|tokenHash|provider|storageKey/);
  });
});

describe("meeting replay retrieval", () => {
  it("fails closed when a finalized manifest uses a different schema or renderer", async () => {
    seedContext({ role: "participant", status: "ended", recordingState: "off" });
    mocks.results.push([{ ...manifest, status: "finalized", durationMs: 5_000, rendererVersion: 2 }]);
    const response = await request(app()).get(`/meetings/${occurrenceId}/replay`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1");
    expect(response.status).toBe(409);
  });

  it("returns a finalized shared-only timed manifest with no private or storage metadata", async () => {
    seedContext({ role: "participant", status: "ended", recordingState: "off" });
    mocks.results.push([{ ...manifest, status: "finalized", durationMs: 5_000, meetingEndedAt: new Date("2026-09-09T12:00:05Z"), audioByteCount: body.length, audioChunkCount: 1 }], [chunk], [
      { eventKey: "speaker:one", eventType: "speaker", offsetMs: 0, endOffsetMs: 1_000, payload: { displayName: "Bob", state: "speaking", userId: 2, storageKey: "/hidden" } },
      { eventKey: "private", eventType: "message", offsetMs: 2_000, endOffsetMs: null, payload: { body: "PRIVATE", private: true } },
    ]);
    const response = await request(app()).get(`/meetings/${occurrenceId}/replay`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1");
    expect(response.status).toBe(200); expect(response.body.status).toBe("complete");
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|storageKey|userId|ownerOrgId/);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.replay_viewed", metadata: { complete: true, eventCount: 0 } }), expect.anything());
  });

  it("reauthorizes and integrity-checks every audio download", async () => {
    seedContext({ role: "participant", status: "ended", recordingState: "off" }); mocks.results.push([{ ...manifest, status: "finalized", durationMs: 5_000 }], [chunk]);
    mocks.getObject.mockResolvedValue({ contentType: chunk.contentType, body });
    const response = await request(app()).get(`/meetings/${occurrenceId}/replay/audio/${chunkId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1");
    expect(response.status).toBe(200); expect(response.body).toEqual(body); expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("resolves a shared file through its opaque replay event capability", async () => {
    const sourceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec10"; const eventId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec11";
    const fileBody = Buffer.from("pdf");
    seedContext({ role: "participant", status: "ended", recordingState: "off" });
    mocks.results.push(
      [{ ...manifest, status: "finalized", durationMs: 5_000 }],
      [{ id: eventId, manifestId, occurrenceId, eventType: "file", sourceId }],
      [{ id: sourceId, occurrenceId, recipientUserId: null, messageType: "attachment", attachment: { fileName: "receipt.pdf", contentType: "application/pdf", byteSize: fileBody.length, storageKey: `/objects/meetings/${occurrenceId}/${sourceId}` } }],
    );
    mocks.getObject.mockResolvedValue({ contentType: "application/pdf", body: fileBody });
    const response = await request(app()).get(`/meetings/${occurrenceId}/replay/files/${eventId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1");
    expect(response.status).toBe(200); expect(response.body).toEqual(fileBody); expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("fails closed when membership, owner context, object size, or checksum is wrong", async () => {
    for (const setup of [
      () => seedContext({ removed: true, status: "ended", recordingState: "off" }),
      () => seedContext({ ownerId: 99, status: "ended", recordingState: "off" }),
      () => { seedContext({ status: "ended", recordingState: "off" }); mocks.results.push([{ ...manifest, status: "finalized", durationMs: 5_000 }], [chunk]); mocks.getObject.mockResolvedValue({ contentType: chunk.contentType, body: Buffer.from("tampered") }); },
    ]) {
      mocks.results = []; mocks.getObject.mockReset(); setup();
      const response = await request(app()).get(`/meetings/${occurrenceId}/replay/audio/${chunkId}`).set("x-replay-schema-version", "2").set("x-replay-renderer-version", "1");
      expect(response.status).toBeGreaterThanOrEqual(403); expect(response.status).not.toBe(200);
    }
  });
});

describe("meeting replay catch-up assignments", () => {
  const assignmentId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec21";
  const viewerToken = "viewer_test_opaque_token_abcdefghijklmnopqrstuvwxyz";
  const baseAssignment = {
    id: assignmentId, occurrenceId, assigneeUserId: 2, assignedById: 1,
    requirement: "required", dueAt: new Date("2026-09-12T12:00:00.000Z"), status: "not_started",
    watchedIntervals: [], watchedMs: 0, lastPositionMs: 0, viewerGeneration: 0,
    viewerTokenHash: null, viewerIssuedAt: null, viewerExpiresAt: null, viewerObservedAt: null,
    completedAt: null, createdAt: new Date(startedAt), updatedAt: new Date(startedAt),
  };

  it("lets the host assign an authorized attendee as required without exposing viewer secrets", async () => {
    seedContext({ status: "ended", recordingState: "off" });
    mocks.results[2] = [...mocks.results[2], { occurrenceId, userId: 2, role: "participant", removedAt: null }];
    mocks.results.push([], [baseAssignment]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/assignments`).send({ assigneeUserId: 2, requirement: "required", dueAt: "2026-09-12T12:00:00.000Z" });
    expect(response.status).toBe(201);
    expect(response.body.assignment).toMatchObject({ assigneeUserId: 2, requirement: "required", status: "not_started", watchedMs: 0 });
    expect(JSON.stringify(response.body)).not.toMatch(/viewerToken|viewerGeneration|assignedById/);
  });

  it("lets an authorized platform administrator assign catch-up without joining the meeting roster", async () => {
    mocks.session = { userId: 99, vendorId: null, partnerId: null, role: "admin" };
    seedContext({ status: "ended", recordingState: "off" });
    mocks.results[2] = [
      { occurrenceId, userId: 1, role: "host", removedAt: null },
      { occurrenceId, userId: 2, role: "participant", removedAt: null },
    ];
    mocks.results.push([], [baseAssignment]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/assignments`).send({
      assigneeUserId: 2,
      requirement: "required",
      dueAt: null,
    });
    expect(response.status).toBe(201);
    expect(response.body.assignment).toMatchObject({ assigneeUserId: 2, requirement: "required" });
  });

  it("issues only the assigned viewer an opaque expiring watch session", async () => {
    mocks.session = { userId: 2, vendorId: 22, partnerId: null, role: "field_employee" };
    seedContext({ userId: 2, role: "participant", status: "ended", recordingState: "off" });
    const finalized = { ...manifest, status: "finalized", durationMs: 60_000 };
    mocks.results.push([finalized], [baseAssignment], [{ ...baseAssignment, viewerGeneration: 1, viewerTokenHash: "stored-only", viewerIssuedAt: new Date(startedAt), viewerExpiresAt: new Date(Date.parse(startedAt) + 14_400_000), viewerObservedAt: new Date(startedAt) }]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/watch/session`).send({});
    expect(response.status).toBe(200); expect(response.body.viewerSessionId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(mocks.mutations)).not.toContain(response.body.viewerSessionId);
    expect(response.body.assignment).toMatchObject({ assigneeUserId: 2, status: "not_started" });
  });

  it("credits a continuous server-observed watch heartbeat and completes only full coverage", async () => {
    mocks.session = { userId: 2, vendorId: 22, partnerId: null, role: "field_employee" };
    vi.mocked(Date.now).mockReturnValue(Date.parse(startedAt) + 60_000);
    seedContext({ userId: 2, role: "participant", status: "ended", recordingState: "off", durationMs: 60_000 });
    const active = { ...baseAssignment, status: "in_progress", watchedIntervals: [{ startsAtMs: 0, endsAtMs: 55_000 }], watchedMs: 55_000, lastPositionMs: 55_000, viewerGeneration: 1, viewerTokenHash: createHash("sha256").update(viewerToken).digest("hex"), viewerIssuedAt: new Date(Date.parse(startedAt) + 50_000), viewerExpiresAt: new Date(Date.parse(startedAt) + 3_600_000), viewerObservedAt: new Date(Date.parse(startedAt) + 55_000) };
    const completed = { ...active, status: "completed", watchedIntervals: [{ startsAtMs: 0, endsAtMs: 60_000 }], watchedMs: 60_000, lastPositionMs: 60_000, viewerObservedAt: new Date(Date.parse(startedAt) + 60_000), completedAt: new Date(Date.parse(startedAt) + 60_000), updatedAt: new Date(Date.parse(startedAt) + 60_000) };
    mocks.results.push([{ ...manifest, status: "finalized", durationMs: 60_000 }], [active], [completed]);
    const response = await request(app()).post(`/meetings/${occurrenceId}/replay/watch/progress`).set("x-replay-view-session", viewerToken).send({ playheadMs: 60_000 });
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ credited: true, assignment: { status: "completed", watchedMs: 60_000 } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.replay_watch_completed" }), expect.anything());
  });
});
