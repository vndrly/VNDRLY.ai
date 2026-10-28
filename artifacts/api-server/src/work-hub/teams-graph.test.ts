import { describe, expect, it, vi, afterEach } from "vitest";
import { classifyTeamsIdentityError, loadTeamsConfig, teamsTenantAllowed, isMultiTenantAuthority, TEAMS_SCOPES, graphRequest, normalizeTeamsText, createTeamsCalendarEvent, listTeamsMessages } from "./teams-graph";
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
describe("Teams identity errors and tenants", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("separates user-grant failures from app-registration failures", () => {
    expect(classifyTeamsIdentityError("invalid_grant", [70008])).toBe("teams_reconnect_required");
    expect(classifyTeamsIdentityError("interaction_required", [50076])).toBe("teams_reconnect_required");
    expect(classifyTeamsIdentityError("invalid_client", [7000215])).toBe("teams_app_misconfigured");
    expect(classifyTeamsIdentityError("invalid_client", [7000222])).toBe("teams_app_misconfigured");
    expect(classifyTeamsIdentityError("invalid_request", [50194])).toBe("teams_app_misconfigured");
    expect(classifyTeamsIdentityError("unauthorized_client", [])).toBe("teams_app_misconfigured");
    expect(classifyTeamsIdentityError("temporarily_unavailable", [])).toBeNull();
  });
  it("defaults to the organizations authority, rejects consumer authorities and parses the allow-list", () => {
    vi.stubEnv("MICROSOFT_365_CLIENT_ID", "client"); vi.stubEnv("MICROSOFT_365_CLIENT_SECRET", "s"); vi.stubEnv("MICROSOFT_365_TENANT_ID", "");
    expect(loadTeamsConfig()).toMatchObject({ tenantId: "organizations" });
    expect(isMultiTenantAuthority("organizations")).toBe(true); expect(isMultiTenantAuthority("common")).toBe(true);
    for (const bad of ["consumers", "9188040d-6c67-4c5b-b112-36a304b66dad", "evil/tenant"]) { vi.stubEnv("MICROSOFT_365_TENANT_ID", bad); expect(() => loadTeamsConfig()).toThrow("invalid_tenant_config"); }
    vi.stubEnv("MICROSOFT_365_TENANT_ID", "organizations");
    vi.stubEnv("MICROSOFT_365_ALLOWED_TENANT_IDS", " D59A479F-2195-4137-9CC7-F1B9F81D21F6 ,0b9e5d1a-3c4f-4e2a-9d8b-7a6c5b4e3f21");
    expect(loadTeamsConfig()?.allowedTenantIds).toEqual(["d59a479f-2195-4137-9cc7-f1b9f81d21f6", "0b9e5d1a-3c4f-4e2a-9d8b-7a6c5b4e3f21"]);
    vi.stubEnv("MICROSOFT_365_ALLOWED_TENANT_IDS", "contoso.com"); expect(() => loadTeamsConfig()).toThrow("invalid_tenant_config");
  });
  it("pins a GUID authority, applies the allow-list and never allows the consumer tenant", () => {
    const base = { clientId: "c", clientSecret: "s", redirectUri: "https://vndrly.ai/cb" };
    const a = "d59a479f-2195-4137-9cc7-f1b9f81d21f6", b = "0b9e5d1a-3c4f-4e2a-9d8b-7a6c5b4e3f21";
    expect(teamsTenantAllowed({ ...base, tenantId: "organizations" }, b)).toBe(true);
    expect(teamsTenantAllowed({ ...base, tenantId: a }, b)).toBe(false);
    expect(teamsTenantAllowed({ ...base, tenantId: a.toUpperCase() }, a)).toBe(true);
    expect(teamsTenantAllowed({ ...base, tenantId: "organizations", allowedTenantIds: [a] }, b)).toBe(false);
    expect(teamsTenantAllowed({ ...base, tenantId: "common" }, "9188040d-6c67-4c5b-b112-36a304b66dad")).toBe(false);
  });
});
