import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as any,
  results: [] as unknown[][],
  mutations: [] as Array<{ type: string; value?: any }>,
  audit: vi.fn(), putObject: vi.fn(), deleteObject: vi.fn(), getObject: vi.fn(), logError: vi.fn(),
  failCommit: false, returnInserted: true,
}));

vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: mocks.audit }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => ({ putObject: mocks.putObject, deleteObject: mocks.deleteObject, getObject: mocks.getObject }) }));
vi.mock("../work-hub/native-transcription", () => ({ nativeTranscriptionAvailable: () => false, transcribeNativeAudio: vi.fn() }));
vi.mock("../work-hub/assemblyai-streaming", () => ({
  AssemblyAIStreamError: class extends Error {}, assemblyAIStreamingAvailable: () => false,
  closeAllAssemblyAIStreams: vi.fn(), closeAssemblyAIStream: vi.fn(), openAssemblyAIStream: vi.fn(), sendAssemblyAIFrame: vi.fn(),
}));
vi.mock("../work-hub/meeting-answer", () => ({ answerMeetingQuestion: vi.fn() }));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  function chain(type: string) {
    const mutation = type === "select" ? undefined : { type, value: undefined as any };
    if (mutation) mocks.mutations.push(mutation);
    const query: Record<string, any> = {};
    for (const method of ["from", "where", "for", "set", "values", "returning", "orderBy", "limit", "onConflictDoUpdate", "onConflictDoNothing"]) {
      query[method] = (value: unknown) => {
        if (mutation && (method === "set" || method === "values")) mutation.value = value;
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(type === "insert" && mocks.returnInserted ? [mutation!.value] : mocks.results.shift() ?? []).then(resolve, reject);
    return query;
  }
  const tx = { select: () => chain("select"), insert: () => chain("insert"), update: () => chain("update"), execute: async (_value: SQL) => [] };
  return { ...schema, db: { ...tx, transaction: async (fn: (tx: any) => Promise<unknown>) => { const result = await fn(tx); if (mocks.failCommit) throw new Error("commit failed"); return result; } } };
});

import router from "./workHubMeetings";

const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const otherOccurrenceId = "27795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const fileId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02";
const host = { id: "host", userId: 1, role: "host", removedAt: null, muted: true };
const guest = { id: "guest", userId: 2, role: "participant", removedAt: null, muted: true };
const bytes = Buffer.from("same bytes");
const sha256 = "58100dc8fc06562ce3e578231dc948e083520ee49c4b4ee5a5a28bb4b4003feb";

function seedContext(id = occurrenceId) {
  mocks.results.push(
    [{ id, meetingId: id, status: "live", recordingState: "active", askvInvitedAt: null, runtime: { activity: {} } }],
    [{ id, ownerOrgType: "vendor", ownerOrgId: 22, policyVersion: 1, recordingAllowed: true }],
    [host, guest],
  );
}
function app() {
  const server = express();
  server.use((req, _res, next) => { (req as any).log = { error: mocks.logError }; next(); });
  server.use("/meetings", router);
  server.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "Transaction failed" }));
  return server;
}
function upload(name = "proof.png", body: Buffer = bytes, recipient: number | null = null, id = occurrenceId) {
  const path = `/meetings/${id}/files/${fileId}${recipient === null ? "" : `?recipient=${recipient}`}`;
  return request(app()).put(path).set("content-type", "image/png").set("x-file-name", encodeURIComponent(name)).send(body);
}
function storedMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: fileId, occurrenceId, userId: 1, recipientUserId: null, body: "proof.png", messageType: "attachment",
    createdAt: new Date("2026-09-10T12:00:00Z"),
    attachment: { fileName: "proof.png", contentType: "image/png", byteSize: bytes.length, storageKey: `/objects/meetings/${occurrenceId}/${fileId}`, sha256, visibility: "private", removedAt: null, removedById: null },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = []; mocks.mutations = []; mocks.failCommit = false; mocks.returnInserted = true;
  mocks.audit.mockReset(); mocks.putObject.mockReset().mockResolvedValue(undefined);
  mocks.deleteObject.mockReset().mockResolvedValue(undefined); mocks.getObject.mockReset();
  mocks.logError.mockReset();
});

describe("retry-safe meeting file upload", () => {
  it("stores a private digest but returns only canonical public attachment metadata", async () => {
    seedContext(); mocks.results.push([]);
    const response = await upload();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: fileId, replayed: false, attachment: { fileName: "proof.png", contentType: "image/png", byteSize: bytes.length, removedAt: null } });
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|sha256|visibility|removedById/);
    const inserted = mocks.mutations.find((item) => item.type === "insert")!.value;
    expect(inserted.attachment).toMatchObject({ sha256, storageKey: `/objects/meetings/${occurrenceId}/${fileId}` });
  });

  it("reconciles an identical lost-response retry without another object, chat, or audit write", async () => {
    seedContext(); mocks.results.push([storedMessage()]);
    const response = await upload();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: fileId, replayed: true, attachment: { fileName: "proof.png", contentType: "image/png", byteSize: bytes.length, removedAt: null } });
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|sha256|visibility|removedById/);
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.mutations).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["equal-length bytes", {}, Buffer.from("evil bytes"), "proof.png", null, occurrenceId],
    ["recipient", { recipientUserId: 2 }, bytes, "proof.png", null, occurrenceId],
    ["filename", { body: "other.png", attachment: { ...storedMessage().attachment, fileName: "other.png" } }, bytes, "proof.png", null, occurrenceId],
    ["MIME", { attachment: { ...storedMessage().attachment, contentType: "image/jpeg" } }, bytes, "proof.png", null, occurrenceId],
    ["occurrence", { occurrenceId: otherOccurrenceId }, bytes, "proof.png", null, occurrenceId],
    ["uploader", { userId: 2 }, bytes, "proof.png", null, occurrenceId],
  ])("keeps a duplicate UUID with changed %s conflict-safe", async (_label, overrides, requestBytes, name, recipient, id) => {
    seedContext(id); mocks.results.push([storedMessage(overrides)]);
    const response = await upload(name, requestBytes, recipient, id);
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|sha256|other\.png|evil bytes|removedById/);
    expect(mocks.putObject).not.toHaveBeenCalled(); expect(mocks.mutations).toEqual([]); expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("deletes the deterministic object when the database commit fails", async () => {
    seedContext(); mocks.results.push([]); mocks.failCommit = true;
    const response = await upload();
    expect(response.status).toBe(500);
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteObject).toHaveBeenCalledWith(`/objects/meetings/${occurrenceId}/${fileId}`);
  });

  it("reports failure and logs cleanup failure when rollback cleanup also fails", async () => {
    seedContext(); mocks.results.push([]); mocks.failCommit = true; mocks.deleteObject.mockRejectedValueOnce(new Error("cleanup failed"));
    const response = await upload();
    expect(response.status).toBe(500);
    expect(mocks.logError).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), "Meeting rollback cleanup failed");
    expect(JSON.stringify(response.body)).not.toContain("cleanup failed");
  });

  it("returns a structured 400 for malformed encoded filenames", async () => {
    seedContext();
    const response = await request(app()).put(`/meetings/${occurrenceId}/files/${fileId}`).set("content-type", "image/png").set("x-file-name", "%E0%A4%A").send(bytes);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: expect.any(String) });
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", "image/png", Buffer.alloc(0)],
    ["unsupported", "application/zip", bytes],
  ])("keeps %s inputs rejected before object storage", async (_label, type, body) => {
    seedContext();
    const response = await request(app()).put(`/meetings/${occurrenceId}/files/${fileId}`).set("content-type", type).set("x-file-name", "proof.png").send(body);
    expect(response.status).toBe(400); expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("keeps payloads over 25 MB rejected before object storage", async () => {
    const response = await request(app()).put(`/meetings/${occurrenceId}/files/${fileId}`)
      .set("content-type", "image/png").set("x-file-name", "proof.png")
      .send(Buffer.alloc(25 * 1024 * 1024 + 1));
    expect(response.status).not.toBe(200);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});

describe("safe meeting file catch-up projection", () => {
  it("retains display and removal state without returning private attachment metadata", async () => {
    seedContext();
    mocks.results.push([{ id: 1, displayName: "Host" }], [], [storedMessage({ attachment: { ...storedMessage().attachment, removedAt: "2026-09-10T12:05:00.000Z", removedById: 9 } })], [], [], []);
    const response = await request(app()).get(`/meetings/${occurrenceId}/catch-up`);
    expect(response.status).toBe(200);
    expect(response.body.chat[0].attachment).toEqual({ fileName: "proof.png", contentType: "image/png", byteSize: bytes.length, removedAt: "2026-09-10T12:05:00.000Z" });
    expect(JSON.stringify(response.body.chat[0])).not.toMatch(/storageKey|sha256|visibility|removedById/);
  });
});
