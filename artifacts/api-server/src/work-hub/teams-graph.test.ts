import { describe, expect, it, vi, afterEach } from "vitest";
import { TEAMS_SCOPES, graphRequest, normalizeTeamsText, createTeamsCalendarEvent, listTeamsMessages } from "./teams-graph";
afterEach(() => vi.unstubAllGlobals());
describe("Teams Graph boundary", () => {
  it("uses delegated scopes without organization-wide access", () => {
    expect(TEAMS_SCOPES).toContain("ChatMessage.Send");
    expect(TEAMS_SCOPES.some(s => s.endsWith(".All"))).toBe(false);
  });
  it("rejects external and ambiguous paths before sending credentials", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const path of ["https://evil.example/me", "//evil.example/me", "/../beta/me", "/me#secret", "/me\\evil"]) {
      await expect(graphRequest("secret", path)).rejects.toMatchObject({ code: "invalid_graph_path" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns safe errors and Retry-After without reflecting provider text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"message":"secret-token"}}', { status: 429, headers: { "Retry-After": "12" } })));
    await expect(graphRequest("secret-token", "/me")).rejects.toMatchObject({ code: "provider_rate_limited", status: 429, retryAfter: 12, message: "provider_rate_limited" });
  });
  it("allows encoded slashes in opaque event IDs without changing the Graph origin", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await graphRequest("secret", "/me/events/AAMk%2F123%3D");
    expect(fetcher.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/me/events/AAMk%2F123%3D");
  });
  it("converts external HTML to inert text without script or style content", () => {
    expect(normalizeTeamsText('<p>Hello &amp; Joe</p><script>steal()</script><style>bad</style><img src=x onerror=bad><div>&lt;b&gt;Hi&lt;/b&gt;</div>')).toBe("Hello & Joe\n<b>Hi</b>");
  });
  it("creates a Teams meeting with an upstream deduplication transaction ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"id":"event"}')); vi.stubGlobal("fetch", fetcher);
    await createTeamsCalendarEvent("token", { transactionId: "op-1", subject: "Morning", start: "2026-10-18T12:00:00Z", end: "2026-10-18T13:00:00Z" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events");
    expect(JSON.parse(init.body)).toMatchObject({ transactionId: "op-1", isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" });
  });
  it("normalizes chat results and exposes only bounded pagination state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: [{ id: "m", body: { contentType: "html", content: "<b>Hello</b>" }, from: { user: { id: "external", displayName: "Joe" } } }], "@odata.nextLink": "https://secret.example/next" }))));
    const result = await listTeamsMessages("token", "19:a@thread.v2");
    expect(result).toMatchObject({ hasMore: true, messages: [{ id: "m", text: "Hello", sender: { id: "external", displayName: "Joe" } }] });
    expect(JSON.stringify(result)).not.toContain("secret.example");
  });
});
