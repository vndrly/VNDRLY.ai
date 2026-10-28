// Meeting verification (tests only): exercises teams-graph.ts over real HTTP against a local
// fake of the Microsoft identity platform v2 token endpoint and Microsoft Graph v1.0.
// Global fetch is wrapped only to rewrite the two Microsoft origins to 127.0.0.1; the real
// fetch/Response stack, headers, status mapping and JSON parsing all run. No real tenant.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizationUrl, createTeamsCalendarEvent, exchangeTeamsCode, getTeamsCalendarEvent, getTeamsProfile,
  listTeamsCalendar, listTeamsChats, listTeamsMessages, refreshTeamsToken, sendTeamsMessage, TEAMS_SCOPES,
  updateTeamsCalendarEvent, TEAMS_PAGE_LIMITS, type TeamsConfig,
} from "./teams-graph";
import { logger } from "../lib/logger";

const TENANT = "d59a479f-2195-4137-9cc7-f1b9f81d21f6";
const config: TeamsConfig = { clientId: "00000000-0000-4000-8000-00000000c11e", clientSecret: "fake-client-secret", tenantId: TENANT, redirectUri: "https://vndrly.ai/api/work-hub/teams/callback" };
const ACCESS = "fake-graph-access-token";
type Seen = { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: string };
let server: Server; let base = ""; const seen: Seen[] = [];
let override: ((s: Seen) => { status: number; body?: unknown; headers?: Record<string, string> } | undefined) | undefined;
const realFetch = globalThis.fetch;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(claims)}.sig`;
const validClaims = () => ({ tid: TENANT, aud: config.clientId, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, exp: Math.floor(Date.now() / 1000) + 3600 });

function respond(s: Seen): { status: number; body?: unknown; headers?: Record<string, string> } {
  const o = override?.(s); if (o) return o;
  if (s.path === `/login/${TENANT}/oauth2/v2.0/token` || s.path === "/login/organizations/oauth2/v2.0/token") {
    const form = new URLSearchParams(s.body);
    if (s.headers["content-type"] !== "application/x-www-form-urlencoded" || form.get("client_id") !== config.clientId || form.get("client_secret") !== config.clientSecret) return { status: 401, body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided.", error_codes: [7000215], trace_id: "trace-1", correlation_id: "corr-1" } };
    if (form.get("grant_type") === "authorization_code" && (form.get("code") !== "auth-code" || !form.get("code_verifier") || form.get("redirect_uri") !== config.redirectUri)) return { status: 400, body: { error: "invalid_grant" } };
    if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") !== "refresh-1") return { status: 400, body: { error: "invalid_grant", error_description: "AADSTS70008: expired", error_codes: [70008] } };
    // Shape per Microsoft identity platform auth-code flow docs.
    return { status: 200, body: { token_type: "Bearer", scope: "openid profile email User.Read Calendars.ReadWrite Chat.Read ChatMessage.Send", expires_in: 3599, ext_expires_in: 3599, access_token: ACCESS, refresh_token: "refresh-2", id_token: idToken(validClaims()) } };
  }
  if (!s.path.startsWith("/graph/v1.0/")) return { status: 404 };
  if (s.headers.authorization !== `Bearer ${ACCESS}`) return { status: 401, body: { error: { code: "InvalidAuthenticationToken" } } };
  const p = s.path.slice("/graph/v1.0".length);
  if (p === "/me" && s.method === "GET") return { status: 200, body: { "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity", id: "87d349ed-44d7-43e1-9a83-5f2406dee5bd", displayName: "Field Lead", userPrincipalName: "lead@contoso.example", mail: "lead@contoso.example" } };
  if (p === "/me/calendarView" && s.query.get("$skiptoken") === "p2") return { status: 200, body: { value: [{ id: "AAMkEv2", subject: "Crew sync", start: { dateTime: "2026-10-30T15:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-30T15:30:00.0000000", timeZone: "UTC" } }] } };
  if (p === "/me/calendarView" && s.query.get("$skiptoken") === "loop") return { status: 200, body: { value: Array.from({ length: 50 }, (_, i) => ({ id: `L${i}` })), "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=loop" } };
  if (p === "/me/chats" && s.query.get("$skiptoken") === "c2") return { status: 200, body: { value: [{ id: "19:def@thread.v2", chatType: "oneOnOne", topic: "Ops", webUrl: null, members: [] }] } };
  if (p === "/me/calendarView") return { status: 200, body: { value: [{ id: "AAMkEv1", subject: "Site walk", start: { dateTime: "2026-10-29T15:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-29T15:30:00.0000000", timeZone: "UTC" }, isOnlineMeeting: true, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" } }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=p2" } };
  if (p === "/me/chats") return { status: 200, body: { value: [{ id: "19:abc@thread.v2", chatType: "group", topic: null, webUrl: "https://teams.microsoft.com/l/chat/19%3Aabc", members: [{ displayName: "A" }, { displayName: "B" }] }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$top=50&$expand=members&$skiptoken=c2" } };
  if (p === "/chats/19%3Aabc%40thread.v2/messages" && s.method === "GET") return { status: 200, body: { value: [
    { id: "1", createdDateTime: "2026-10-28T14:00:00Z", body: { contentType: "html", content: "<p>Gate&nbsp;code <b>changed</b></p><script>x()</script>" }, from: { user: { id: "u1", displayName: "A" } }, webUrl: "https://teams.microsoft.com/l/message/1" },
    { id: "2", createdDateTime: "2026-10-28T14:01:00Z", deletedDateTime: "2026-10-28T14:02:00Z", body: { contentType: "text", content: "gone" }, from: null, webUrl: "https://evil.example/x" },
  ] } };
  if (p === "/chats/19%3Aabc%40thread.v2/messages" && s.method === "POST") return { status: 201, body: { id: "3", body: JSON.parse(s.body).body } };
  if (p === "/me/events" && s.method === "POST") return { status: 201, body: { id: "AAMkNew", "@odata.etag": 'W/"etag-1"', changeKey: "ck1", ...JSON.parse(s.body), onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/new" } } };
  if (p === "/me/events/AAMkNew" && s.method === "GET") return { status: 200, body: { id: "AAMkNew", "@odata.etag": 'W/"etag-1"' } };
  if (p === "/me/events/AAMkNew" && s.method === "PATCH") return s.headers["if-match"] === 'W/"etag-1"' ? { status: 200, body: { id: "AAMkNew", "@odata.etag": 'W/"etag-2"' } } : { status: 412, body: { error: { code: "ErrorIrresolvableConflict" } } };
  return { status: 404, body: { error: { code: "ResourceNotFound" } } };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const s: Seen = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, headers: req.headers, body };
      seen.push(s);
      const r = respond(s);
      res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
      res.end(r.status === 204 || r.body === undefined ? undefined : JSON.stringify(r.body));
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { vi.unstubAllGlobals(); await new Promise(r => server.close(r)); });
beforeEach(() => {
  seen.length = 0; override = undefined;
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const url = String(input);
    const local = url.replace(/^https:\/\/graph\.microsoft\.com\//, `${base}/graph/`).replace(/^https:\/\/login\.microsoftonline\.com\//, `${base}/login/`);
    if (local === url) throw new Error(`unexpected origin ${url}`);
    return realFetch(local, init);
  });
});

describe("Teams Graph client against a fake Microsoft identity + Graph server", () => {
  it("builds a PKCE authorize URL for the v2 endpoint with delegated scopes only", () => {
    const url = new URL(authorizationUrl(config, { state: "s".repeat(43), codeChallenge: "c".repeat(43) }));
    expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: config.clientId, response_type: "code", response_mode: "query", code_challenge_method: "S256", redirect_uri: config.redirectUri });
    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual([...TEAMS_SCOPES].sort());
    expect(url.searchParams.get("scope")).not.toMatch(/\.All\b|\/\.default/);
  });

  it("exchanges an auth code (form-encoded, with verifier) and keeps only a verified tenant id", async () => {
    const t = await exchangeTeamsCode(config, "auth-code", "verifier-123");
    expect(t).toMatchObject({ accessToken: ACCESS, refreshToken: "refresh-2", expiresIn: 3599, tenantId: TENANT });
    const form = new URLSearchParams(seen[0].body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("verifier-123");
    expect(seen[0].method).toBe("POST");
  });

  it("drops tenant metadata from an id_token with a foreign audience or issuer", async () => {
    override = s => s.path.endsWith("/token") ? { status: 200, body: { access_token: ACCESS, refresh_token: "r", expires_in: 3599, scope: "User.Read", id_token: idToken({ ...validClaims(), aud: "someone-else" }) } } : undefined;
    expect((await exchangeTeamsCode(config, "auth-code", "v")).tenantId).toBeUndefined();
  });

  it("refreshes with rotation and maps a revoked/expired refresh token (invalid_grant) to teams_reconnect_required", async () => {
    await expect(refreshTeamsToken(config, "refresh-1")).resolves.toMatchObject({ refreshToken: "refresh-2" });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const error = await refreshTeamsToken(config, "revoked").catch(e => e);
    expect(error).toMatchObject({ code: "teams_reconnect_required", status: 401 });
    expect(String(error.message)).not.toMatch(/AADSTS|expired/);
    expect(warn.mock.calls[0][0]).toMatchObject({ event: "teams.token_error", grantType: "refresh_token", error: "invalid_grant", aadsts: [70008] });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/revoked|fake-client-secret|expired/);
    warn.mockRestore();
  });

  it("maps a wrong/expired client secret (invalid_client) to teams_app_misconfigured and logs without secrets", async () => {
    const err = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const bad = { ...config, clientSecret: "wrong-secret-value" };
    for (const call of [() => refreshTeamsToken(bad, "refresh-1"), () => exchangeTeamsCode(bad, "auth-code", "v")]) {
      await expect(call()).rejects.toMatchObject({ code: "teams_app_misconfigured", status: 503 });
    }
    expect(err.mock.calls[0][0]).toMatchObject({ event: "teams.token_error", error: "invalid_client", aadsts: [7000215], traceId: "trace-1", correlationId: "corr-1" });
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/wrong-secret-value|refresh-1|auth-code|Invalid client secret/);
    // AADSTS700016 (app not found in tenant) / 50194 (single-tenant app) are app-registration problems too.
    for (const code of [700016, 50194]) {
      override = s => s.path.endsWith("/token") ? { status: 400, body: { error: "invalid_request", error_codes: [code] } } : undefined;
      await expect(refreshTeamsToken(config, "refresh-1")).rejects.toMatchObject({ code: "teams_app_misconfigured" });
    }
    override = s => s.path.endsWith("/token") ? { status: 503, body: { error: "temporarily_unavailable" } } : undefined;
    await expect(refreshTeamsToken(config, "refresh-1")).rejects.toMatchObject({ code: "provider_request_failed" });
    err.mockRestore();
  });

  it("multi-tenant: accepts any work/school tenant with its own issuer, honours the allow-list, rejects consumer", async () => {
    const OTHER = "0b9e5d1a-3c4f-4e2a-9d8b-7a6c5b4e3f21";
    const multi: TeamsConfig = { ...config, tenantId: "organizations" };
    const asTenant = (tid: string, iss = `https://login.microsoftonline.com/${tid}/v2.0`) => { override = s => s.path === "/login/organizations/oauth2/v2.0/token" ? { status: 200, body: { access_token: ACCESS, refresh_token: "r", expires_in: 3599, scope: "User.Read", id_token: idToken({ ...validClaims(), tid, iss }) } } : undefined; };
    asTenant(OTHER);
    await expect(exchangeTeamsCode(multi, "auth-code", "v")).resolves.toMatchObject({ tenantId: OTHER });
    expect(seen.at(-1)!.path).toBe("/login/organizations/oauth2/v2.0/token");
    // Issuer must belong to the token's own tid; a MidCon issuer on another tid is dropped.
    asTenant(OTHER, `https://login.microsoftonline.com/${TENANT}/v2.0`);
    expect((await exchangeTeamsCode(multi, "auth-code", "v")).tenantId).toBeUndefined();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    asTenant(OTHER);
    await expect(exchangeTeamsCode({ ...multi, allowedTenantIds: [TENANT] }, "auth-code", "v")).rejects.toMatchObject({ code: "teams_tenant_not_allowed", status: 403 });
    await expect(exchangeTeamsCode(config, "auth-code", "v").then(() => { override = undefined; })).resolves.toBeUndefined();
    asTenant("9188040d-6c67-4c5b-b112-36a304b66dad");
    await expect(exchangeTeamsCode(multi, "auth-code", "v")).rejects.toMatchObject({ code: "teams_tenant_not_allowed" });
    warn.mockRestore();
    // Refresh for a multi-tenant registration uses the user's own tenant authority.
    override = undefined;
    await refreshTeamsToken({ ...multi, tenantId: "organizations" }, "refresh-1", TENANT);
    expect(seen.at(-1)!.path).toBe(`/login/${TENANT}/oauth2/v2.0/token`);
  });

  it("reads /me, calendarView (bounded, UTC, immutable ids), chats and normalized messages", async () => {
    await expect(getTeamsProfile(ACCESS)).resolves.toMatchObject({ userPrincipalName: "lead@contoso.example" });
    expect(seen[0].query.get("$select")).toBe("id,displayName,userPrincipalName,mail");
    const cal = await listTeamsCalendar(ACCESS, "2026-10-28T00:00:00.000Z", "2026-11-27T00:00:00.000Z");
    // Follows @odata.nextLink (same auth + Prefer headers) until exhausted; hasMore false once complete.
    expect(cal).toMatchObject({ hasMore: false, events: [{ id: "AAMkEv1" }, { id: "AAMkEv2" }] });
    expect(seen[2]).toMatchObject({ path: "/graph/v1.0/me/calendarView" });
    expect(seen[2].query.get("$skiptoken")).toBe("p2");
    expect(seen[2].headers.prefer).toBe('IdType="ImmutableId", outlook.timezone="UTC"');
    expect(seen[2].headers.authorization).toBe(`Bearer ${ACCESS}`);
    const calReq = seen[1];
    expect(Object.fromEntries(calReq.query)).toEqual({ startDateTime: "2026-10-28T00:00:00.000Z", endDateTime: "2026-11-27T00:00:00.000Z", $top: "50", $orderby: "start/dateTime" });
    expect(calReq.headers.prefer).toBe('IdType="ImmutableId", outlook.timezone="UTC"');
    await expect(listTeamsCalendar(ACCESS, "2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z")).rejects.toMatchObject({ code: "invalid_time_range" });
    const chats = await listTeamsChats(ACCESS);
    expect(seen.at(-1)!.query.get("$expand")).toBe("members");
    expect(chats).toMatchObject({ hasMore: false, chats: [{ id: "19:abc@thread.v2" }, { id: "19:def@thread.v2" }] });
    const msgs = await listTeamsMessages(ACCESS, "19:abc@thread.v2");
    expect(msgs.messages[0]).toMatchObject({ text: "Gate code changed", sender: { displayName: "A" }, webUrl: "https://teams.microsoft.com/l/message/1" });
    expect(msgs.messages[1]).toMatchObject({ text: "", webUrl: null, sender: { displayName: "Microsoft Teams" } });
  });

  it("caps runaway paging and preserves hasMore; refuses a nextLink off graph.microsoft.com/v1.0", async () => {
    override = s => s.path === "/graph/v1.0/me/calendarView" && !s.query.get("$skiptoken") ? { status: 200, body: { value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=loop" } } : undefined;
    const capped = await listTeamsCalendar(ACCESS, "2026-10-28T00:00:00.000Z", "2026-11-27T00:00:00.000Z");
    expect(capped.hasMore).toBe(true);
    expect(capped.events.length).toBeLessThanOrEqual(TEAMS_PAGE_LIMITS.calendar.maxItems);
    expect(seen.length).toBeLessThanOrEqual(TEAMS_PAGE_LIMITS.calendar.maxPages);
    for (const link of ["https://evil.example/v1.0/me/chats", "https://graph.microsoft.com/beta/me/chats", "https://user:pw@graph.microsoft.com/v1.0/me/chats", "http://graph.microsoft.com/v1.0/me/chats"]) {
      seen.length = 0;
      override = s => s.path === "/graph/v1.0/me/chats" ? { status: 200, body: { value: [], "@odata.nextLink": link } } : undefined;
      await expect(listTeamsChats(ACCESS)).rejects.toMatchObject({ code: "provider_invalid_response" });
      expect(seen).toHaveLength(1);
    }
  });

  it("sends a plain-text chat message with the documented chatMessage body", async () => {
    await sendTeamsMessage(ACCESS, "19:abc@thread.v2", "On my way");
    const post = seen.at(-1)!;
    expect(post.method).toBe("POST");
    expect(JSON.parse(post.body)).toEqual({ body: { contentType: "text", content: "On my way" } });
  });

  it("creates an online Teams meeting event, reads it back and PATCHes with If-Match / 412 on conflict", async () => {
    const created = await createTeamsCalendarEvent(ACCESS, { transactionId: "7f2c2f4e-0000-4000-8000-000000000001", subject: "Pre-job safety", start: "2026-10-29T15:00:00Z", end: "2026-10-29T15:30:00Z" });
    const body = JSON.parse(seen.at(-1)!.body);
    expect(body).toMatchObject({ isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness", transactionId: "7f2c2f4e-0000-4000-8000-000000000001", start: { dateTime: "2026-10-29T15:00:00.000", timeZone: "UTC" }, end: { dateTime: "2026-10-29T15:30:00.000", timeZone: "UTC" } });
    expect((created.onlineMeeting as { joinUrl: string }).joinUrl).toMatch(/^https:\/\/teams\.microsoft\.com\//);
    await expect(getTeamsCalendarEvent(ACCESS, "AAMkNew")).resolves.toMatchObject({ "@odata.etag": 'W/"etag-1"' });
    await expect(updateTeamsCalendarEvent(ACCESS, "AAMkNew", { subject: "x" }, 'W/"etag-1"')).resolves.toMatchObject({ "@odata.etag": 'W/"etag-2"' });
    await expect(updateTeamsCalendarEvent(ACCESS, "AAMkNew", { subject: "x" }, 'W/"stale"')).rejects.toMatchObject({ code: "provider_version_conflict", status: 412 });
  });

  it("maps 401/403/429/204/non-JSON Graph responses without reflecting provider text", async () => {
    await expect(getTeamsProfile("wrong-token")).rejects.toMatchObject({ code: "provider_reauthentication_required", status: 401 });
    override = () => ({ status: 403, body: { error: { code: "Forbidden", message: "secret detail" } } });
    await expect(listTeamsChats(ACCESS)).rejects.toMatchObject({ code: "provider_permission_denied" });
    override = () => ({ status: 429, headers: { "retry-after": "7" }, body: {} });
    await expect(listTeamsChats(ACCESS)).rejects.toMatchObject({ code: "provider_rate_limited", retryAfter: 7 });
    override = () => ({ status: 204 });
    await expect(updateTeamsCalendarEvent(ACCESS, "AAMkNew", {}, 'W/"etag-1"')).resolves.toBeUndefined();
    override = () => ({ status: 200, body: undefined });
    await expect(getTeamsProfile(ACCESS)).rejects.toMatchObject({ code: "provider_invalid_response" });
  });
});
