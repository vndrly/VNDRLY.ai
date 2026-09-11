import { beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create: provider.create } } }));
const input = { question: "What is the plan?", audience: "shared" as const, roster: [{ userId: 1, displayName: "Alex" }], chat: [{ speaker: "Alex", text: "Inspect the pump" }], transcript: [] };
beforeEach(() => provider.create.mockReset());
describe("meeting text answers", () => {
  it("uses supplied meeting text without assistant tools, credentials or account lookup", async () => {
    provider.create.mockResolvedValue({ content: [{ type: "text", text: "Inspect the pump." }] });
    const { answerMeetingQuestion } = await import("./meeting-answer");
    expect(await answerMeetingQuestion(input)).toBe("Inspect the pump.");
    const [request, options] = provider.create.mock.calls[0];
    expect(request.tools).toBeUndefined(); expect(JSON.parse(request.messages[0].content)).toEqual(input); expect(request.system).toMatch(/untrusted/i); expect(request.system).toMatch(/follow.up/i); expect(options.timeout).toBeLessThanOrEqual(30_000); expect(options.maxRetries).toBe(0);
  });
  it("bounds question, context, and returned answer text", async () => {
    const { answerMeetingQuestion } = await import("./meeting-answer");
    provider.create.mockResolvedValue({ content: [{ type: "text", text: "x".repeat(5_000) }] });
    await expect(answerMeetingQuestion({ ...input, question: "x".repeat(2_001) })).rejects.toThrow(/question/i);
    await expect(answerMeetingQuestion({ ...input, chat: Array.from({ length: 101 }, () => ({ speaker: "A", text: "x" })) })).rejects.toThrow(/context/i);
    await expect(answerMeetingQuestion(input)).rejects.toThrow(/answer/i);
  });
  it("passes the caller abort signal and never enables retries or tools", async () => {
    const { answerMeetingQuestion } = await import("./meeting-answer");
    provider.create.mockResolvedValue({ content: [{ type: "text", text: "Answer" }] });
    const controller = new AbortController();
    await answerMeetingQuestion(input, controller.signal);
    const [request, options] = provider.create.mock.calls[0];
    expect(request.tools).toBeUndefined();
    expect(options).toMatchObject({ maxRetries: 0, signal: controller.signal });
  });
  it.each([{ content: [] }, { content: [{ type: "tool_use", name: "lookup_user" }] }, { content: [{ type: "text", text: " " }] }])("rejects unusable output rather than pretending it answered", async ({ content }) => {
    const { answerMeetingQuestion } = await import("./meeting-answer");
    provider.create.mockResolvedValue({ content }); await expect(answerMeetingQuestion(input)).rejects.toThrow();
  });
  it("does not call the provider for a cancelled question", async () => {
    const { answerMeetingQuestion } = await import("./meeting-answer");
    const controller = new AbortController(); controller.abort(); await expect(answerMeetingQuestion(input, controller.signal)).rejects.toThrow(); expect(provider.create).not.toHaveBeenCalled();
  });
  it("bounds concurrent generations and frees capacity after completion", async () => {
    const { answerMeetingQuestion } = await import("./meeting-answer");
    const releases: Array<(value: unknown) => void> = []; provider.create.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
    const pending = Array.from({ length: 4 }, () => answerMeetingQuestion(input));
    await expect(answerMeetingQuestion(input)).rejects.toThrow(/busy/i);
    await vi.waitFor(() => expect(releases).toHaveLength(4)); releases.forEach((resolve) => resolve({ content: [{ type: "text", text: "Done" }] })); await Promise.all(pending);
    provider.create.mockResolvedValue({ content: [{ type: "text", text: "Again" }] }); expect(await answerMeetingQuestion(input)).toBe("Again");
  });
});
