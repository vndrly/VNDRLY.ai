import { describe, expect, it, vi } from "vitest";
import { CooperativeVTurn, VProviderError, selectVProvider, shouldVConsult, savedVTaskMutationBlock } from "./cooperative-v";

describe("one cooperative V", () => {
  it("selects a suitable approved engine and never treats a client preference as approval", () => {
    expect(selectVProvider("Analyze this report", ["anthropic", "openai"], true)).toBe("openai");
    expect(selectVProvider("Check in this visitor", ["anthropic", "openai"], true)).toBe("anthropic");
    expect(selectVProvider("Analyze this report", ["anthropic"], true)).toBe("anthropic");
    expect(() => selectVProvider("hello", [], true)).toThrow("approved");
  });
  it("passes the identical authorized transcript to one bounded fallback", async () => {
    const context = { messages: [{ role: "user", content: "save" }] };
    const primary = vi.fn().mockRejectedValue(new VProviderError("unavailable", true));
    const secondary = vi.fn().mockResolvedValue("answer");
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic", "openai"], openaiAvailable: true });
    expect(await turn.round(context, { anthropic: primary, openai: secondary })).toBe("answer");
    expect(primary).toHaveBeenCalledWith(context);
    expect(secondary).toHaveBeenCalledWith(context);
    secondary.mockRejectedValueOnce(new VProviderError("unavailable", true));
    await expect(turn.round(context, { anthropic: primary, openai: secondary })).rejects.toThrow("unavailable");
    expect(primary).toHaveBeenCalledTimes(1);
  });
  it("does not change engines after authentication or domain permission denial", async () => {
    const secondary = vi.fn();
    const providers = { anthropic: vi.fn().mockRejectedValue(new VProviderError("authorization", false)), openai: secondary };
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic", "openai"], openaiAvailable: true });
    await expect(turn.round({}, providers)).rejects.toThrow("authorization");
    expect(secondary).not.toHaveBeenCalled();
    const denied = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic", "openai"], openaiAvailable: true });
    denied.observeToolResult('{"error":"Forbidden","code":"auth.forbidden"}');
    providers.anthropic.mockRejectedValue(new VProviderError("transport", true));
    await expect(denied.round({}, providers)).rejects.toThrow("transport");
    expect(secondary).not.toHaveBeenCalled();
  });
  it("joins repeated mutation calls across engines while keeping reads fresh", async () => {
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic", "openai"], openaiAvailable: true });
    const execute = vi.fn().mockResolvedValue('{"id":42}');
    expect(await turn.execute("save", { a: 1, b: 2 }, true, execute)).toBe('{"id":42}');
    expect(await turn.execute("save", { b: 2, a: 1 }, true, execute)).toBe('{"id":42}');
    expect(execute).toHaveBeenCalledTimes(1);
    await turn.execute("read", {}, false, execute);
    await turn.execute("read", {}, false, execute);
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it("keeps ambiguous mutations fenced and reports remaining work", async () => {
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic"], openaiAvailable: false });
    const execute = vi.fn().mockRejectedValue(new Error("connection closed"));
    await expect(turn.execute("save", {}, true, execute)).rejects.toThrow("connection closed");
    await expect(turn.execute("save", {}, true, execute)).rejects.toThrow("connection closed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(turn.recovery()).toMatchObject({ completed: [], remaining: ["save"], needed: expect.stringContaining("saved") });
  });
  it("alerts on usage without stopping the task", () => {
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic"], openaiAvailable: false, alertTokens: 100 });
    expect(turn.recordUsage({ inputTokens: 80, outputTokens: 30 })).toMatchObject({ alert: true, totalTokens: 110 });
    expect(turn.recordUsage({ inputTokens: 1, outputTokens: 1 })).toMatchObject({ alert: false, totalTokens: 112 });
  });
  it("preserves a failed action when another action uses the same tool successfully", async () => {
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic"], openaiAvailable: false });
    await expect(turn.execute("save", { id: 1 }, true, async () => { throw new Error("ambiguous"); })).rejects.toThrow();
    await turn.execute("save", { id: 2 }, true, async () => '{"id":2}');
    expect(turn.recovery()).toMatchObject({ completed: ["save"], remaining: ["save"] });
  });
  it("does not use provider fallback to retry a domain execution failure", async () => {
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic", "openai"], openaiAvailable: true });
    turn.observeToolResult('{"ok":false,"error":"Tool execution failed."}');
    const alternate = vi.fn();
    await expect(turn.round({}, { anthropic: async () => { throw new VProviderError("outage", true); }, openai: alternate })).rejects.toThrow("outage");
    expect(alternate).not.toHaveBeenCalled();
  });
  it("consults a second approved engine once only for a selective review", async () => {
    expect(shouldVConsult("Please double-check the report")).toBe(true);
    expect(shouldVConsult("Show my tickets")).toBe(false);
    const turn = new CooperativeVTurn({ first: "anthropic", approved: ["anthropic", "openai"], openaiAvailable: true });
    const secondary = vi.fn().mockResolvedValue("reviewed answer");
    expect(await turn.consult({ draft: "report" }, { anthropic: vi.fn(), openai: secondary })).toBe("reviewed answer");
    expect(await turn.consult({ draft: "report" }, { anthropic: vi.fn(), openai: secondary })).toBeNull();
    expect(secondary).toHaveBeenCalledTimes(1);
  });
  it("blocks terminal and previously completed saved-plan operations before execution", () => {
    expect(savedVTaskMutationBlock({ taskStatus: "completed", completed: [] }, "manage_ticket_record")).toContain("terminal");
    expect(savedVTaskMutationBlock({ taskStatus: "open", completed: [{ toolNames: ["manage_ticket_record_approve"] }] }, "manage_ticket_record")).toContain("completed");
    expect(savedVTaskMutationBlock({ taskStatus: "open", completed: [{ toolNames: ["manage_ticket_record_approve"] }] }, "manage_work_hub_task")).toBeNull();
  });
});
