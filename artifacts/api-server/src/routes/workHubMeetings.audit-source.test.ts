import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as
    | { userId: number; vendorId: number; partnerId: null; role: string }
    | null,
  results: [] as unknown[][],
  mutations: [] as Array<{ type: string; value?: unknown }>,
  audit: vi.fn(),
  closeAllStreams: vi.fn(),
  returnInserted: false,
  tx: undefined as unknown,
}));

vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: mocks.audit }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: vi.fn() }));
vi.mock("../work-hub/native-transcription", () => ({
  nativeTranscriptionAvailable: () => false,
  transcribeNativeAudio: vi.fn(),
}));
vi.mock("../work-hub/assemblyai-streaming", () => ({
  AssemblyAIStreamError: class AssemblyAIStreamError extends Error {},
  assemblyAIStreamingAvailable: () => false,
  closeAllAssemblyAIStreams: mocks.closeAllStreams,
  closeAssemblyAIStream: vi.fn(),
  openAssemblyAIStream: vi.fn(),
  sendAssemblyAIFrame: vi.fn(),
}));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  function chain(type: string) {
    const mutation = type === "select" ? undefined : { type, value: undefined as unknown };
    if (mutation) mocks.mutations.push(mutation);
    const query: Record<string, unknown> = {};
    for (const method of [
      "from", "where", "for", "set", "values", "returning", "onConflictDoUpdate",
      "orderBy", "limit",
    ]) {
      query[method] = (value: unknown) => {
        if (mutation && (method === "set" || method === "values")) mutation.value = value;
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        type === "insert" && mocks.returnInserted
          ? [mutation!.value]
          : mocks.results.shift() ?? [],
      ).then(resolve);
    return query;
  }
  const tx = {
    select: () => chain("select"),
    insert: () => chain("insert"),
    update: () => chain("update"),
  };
  mocks.tx = tx;
  return {
    ...schema,
    db: { transaction: async (run: (value: unknown) => Promise<unknown>) => run(tx) },
  };
});

import router from "./workHubMeetings";

const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const host = { id: "host", userId: 1, role: "host", removedAt: null, muted: true };
const guest = { id: "guest", userId: 2, role: "participant", removedAt: null, muted: true };

function seedContext(options: { ended?: boolean; removed?: boolean; participantRole?: string } = {}) {
  mocks.results.push(
    [{
      id: occurrenceId,
      meetingId: occurrenceId,
      status: options.ended ? "ended" : "live",
      recordingState: "active",
      askvInvitedAt: new Date(),
      runtime: { presence: {} },
    }],
    [{
      id: occurrenceId,
      ownerOrgType: "vendor",
      ownerOrgId: 22,
      policyVersion: 1,
      recordingAllowed: true,
    }],
    [
      {
        ...host,
        role: options.participantRole ?? "host",
        removedAt: options.removed ? new Date("2026-09-09T12:00:00Z") : null,
      },
      guest,
    ],
  );
}

function app() {
  const server = express();
  server.use(express.json());
  server.use("/meetings", router);
  server.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Transaction failed" });
  });
  return server;
}

function expectedAudit(action: string, source: "web" | "ios", metadata: Record<string, unknown> = {}) {
  return {
    actorUserId: 1,
    owner: { type: "vendor", id: 22 },
    action,
    subjectType: "meeting_occurrence",
    subjectId: occurrenceId,
    source,
    metadata,
  };
}

beforeEach(() => {
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = [];
  mocks.mutations = [];
  mocks.returnInserted = false;
  mocks.audit.mockReset();
  mocks.closeAllStreams.mockReset();
});

describe("meeting audit client source", () => {
  it("attributes an iOS host removal without changing the audit identity or transaction", async () => {
    seedContext();
    mocks.results.push([], [], [], [{ name: "Bob" }], []);

    const response = await request(app())
      .post(`/meetings/${occurrenceId}/participants/2/remove`)
      .set("x-vndrly-client", "ios")
      .send({});

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expectedAudit("meeting.participant_removed", "ios", { removedUserId: 2 }),
      mocks.tx,
    );
  });

  it("attributes an iOS meeting end and preserves its existing empty metadata", async () => {
    seedContext();
    mocks.results.push([], [], [], []);

    const response = await request(app())
      .post(`/meetings/${occurrenceId}/end`)
      .set("x-vndrly-client", "ios")
      .send({});

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expectedAudit("meeting.ended", "ios"),
      mocks.tx,
    );
  });

  it("carries the same iOS attribution through the shared consent audit callsite", async () => {
    seedContext();
    mocks.returnInserted = true;

    const response = await request(app())
      .post(`/meetings/${occurrenceId}/consent`)
      .set("x-vndrly-client", "ios")
      .send({ policyVersion: 1, response: "accepted" });

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expectedAudit("meeting.consent", "ios", { response: "accepted", policyVersion: 1 }),
      mocks.tx,
    );
  });

  it.each([
    ["an absent header", undefined],
    ["the explicit web value", "web"],
    ["an unexpected value", "android"],
    ["an uppercase iOS-like value", "IOS"],
  ])("defaults %s to the browser audit source", async (_label, header) => {
    seedContext();
    mocks.results.push([], [], [], []);
    let call = request(app()).post(`/meetings/${occurrenceId}/end`);
    if (header) call = call.set("x-vndrly-client", header);

    expect((await call.send({})).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expectedAudit("meeting.ended", "web"), mocks.tx);
  });

  it.each([
    ["unauthenticated", "unauthenticated"],
    ["removed participant", "removed"],
    ["non-host participant", "non-host"],
  ])("does not audit an iOS request rejected as %s", async (_label, reason) => {
    if (reason === "unauthenticated") mocks.session = null;
    else seedContext({ removed: reason === "removed", participantRole: reason === "non-host" ? "participant" : "host" });

    const response = await request(app())
      .post(`/meetings/${occurrenceId}/end`)
      .set("x-vndrly-client", "ios")
      .send({});

    expect(response.status).toBe(reason === "unauthenticated" ? 401 : 403);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not duplicate the audit for an already-ended iOS request", async () => {
    seedContext({ ended: true });

    const response = await request(app())
      .post(`/meetings/${occurrenceId}/end`)
      .set("x-vndrly-client", "ios")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ended: true });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
