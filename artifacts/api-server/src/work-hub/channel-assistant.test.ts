import { beforeEach, expect, it, vi } from "vitest";
import { answerChannelQuestion } from "./channel-assistant";

const mocks = vi.hoisted(() => ({
  reads: [] as unknown[][],
  answer: vi.fn(async (_input: unknown) => "Joe had it last."),
  access: vi.fn(async () => ({ channel: { id: "channel-a", ownerOrgType: "vendor", ownerOrgId: 22 } })),
  insert: vi.fn((_value: unknown) => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "answer-id" }] }) })),
  audit: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const select = () => {
    const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, for: () => chain, orderBy: () => chain, limit: async () => mocks.reads.shift() ?? [] };
    return chain;
  };
  const database = { select, insert: () => ({ values: mocks.insert }) };
  return { ...original, db: { ...database, transaction: async (run: (tx: typeof database) => unknown) => run(database) } };
});
vi.mock("./queries", () => ({ resolveChannelAccess: mocks.access }));
vi.mock("./audit", () => ({ appendWorkHubAudit: mocks.audit }));
vi.mock("./meeting-answer", () => ({ answerMeetingQuestion: mocks.answer }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: async (actor: unknown) => actor }));

const actor = { userId: 7, role: "vendor" as const, vendorId: 22 };
const source: Parameters<typeof answerChannelQuestion>[1] = {
  id: "73399677-f4be-4c73-b2d8-ed7095e40710", channelId: "channel-a", authorUserId: actor.userId,
  body: "Hey V, who had the tablet last?", kind: "text", rootMessageId: "thread-id", parentMessageId: "thread-id",
  version: 1, clientOperationId: "client-op", createdAt: new Date(), editedAt: null, deletedAt: null, deletedById: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reads = [[], [{ id: source.id }], [{ id: "context", userId: 8, speaker: "Joe", text: "I took the tablet.", createdAt: new Date() }], [{ id: source.id }]];
});

it("adds a labelled answer in the original thread after rechecking the source and access", async () => {
  await answerChannelQuestion(actor, source);
  expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({
    question: "who had the tablet last?",
    chat: [{ speaker: "Joe", text: "I took the tablet." }],
  }), expect.any(AbortSignal), "chat");
  expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
    channelId: source.channelId, kind: "askv_answer", rootMessageId: source.rootMessageId,
    parentMessageId: source.parentMessageId, body: "Joe had it last.",
  }));
});

it("ignores an ordinary message and a retry of an answered invocation", async () => {
  await answerChannelQuestion(actor, { ...source, body: "Joe said to ask V later." });
  expect(mocks.access).not.toHaveBeenCalled();
  mocks.reads = [[{ id: "answer-id" }]];
  await answerChannelQuestion(actor, source);
  expect(mocks.answer).not.toHaveBeenCalled();
});

it("does not post when the source disappears while V is answering", async () => {
  mocks.reads[3] = [];
  await answerChannelQuestion(actor, source);
  expect(mocks.answer).toHaveBeenCalledOnce();
  expect(mocks.insert).not.toHaveBeenCalled();
});
