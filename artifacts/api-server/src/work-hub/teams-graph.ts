import { logger } from "../lib/logger";

export const TEAMS_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite", "Chat.Read", "ChatMessage.Send"] as const;
export type TeamsConfig = { clientId: string; clientSecret: string; tenantId: string; redirectUri: string; allowedTenantIds?: string[] };
const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
/** Personal Microsoft accounts (MSA) cannot use delegated Teams chat APIs. */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
/** "organizations"/"common" authorities accept any work or school tenant; a GUID or domain pins one tenant. */
export const isMultiTenantAuthority = (tenantId: string) => ["organizations", "common"].includes(tenantId.toLowerCase());
export class TeamsProviderError extends Error {
  constructor(public readonly code: string, public readonly status = 502, public readonly retryAfter?: number) { super(code); this.name = "TeamsProviderError"; }
}
/** Missing registration returns null; malformed configured values fail closed. */
export function loadTeamsConfig(): TeamsConfig | null {
  const clientId = process.env.MICROSOFT_365_CLIENT_ID?.trim(), clientSecret = process.env.MICROSOFT_365_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const tenantId = process.env.MICROSOFT_365_TENANT_ID?.trim() || "organizations";
  const redirectUri = process.env.MICROSOFT_365_REDIRECT_URI?.trim() || "https://vndrly.ai/api/work-hub/teams/callback";
  if (!/^[a-zA-Z0-9.-]+$/.test(tenantId) || tenantId.toLowerCase() === "consumers" || tenantId.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID) throw new TeamsProviderError("invalid_tenant_config", 503);
  // Optional allow-list for a multi-tenant registration (comma-separated directory tenant IDs).
  const allowed = process.env.MICROSOFT_365_ALLOWED_TENANT_IDS?.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (allowed?.some(v => !GUID.test(v) || v === MICROSOFT_CONSUMER_TENANT_ID)) throw new TeamsProviderError("invalid_tenant_config", 503);
  let url: URL; try { url = new URL(redirectUri); } catch { throw new TeamsProviderError("invalid_redirect_config", 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new TeamsProviderError("invalid_redirect_config", 503);
  return { clientId, clientSecret, tenantId, redirectUri, ...(allowed?.length ? { allowedTenantIds: allowed } : {}) };
}
export function authorizationUrl(c: TeamsConfig, i: { state: string; codeChallenge: string; loginHint?: string }) {
  return `https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/authorize?${new URLSearchParams({ client_id: c.clientId, response_type: "code", redirect_uri: c.redirectUri, response_mode: "query", scope: TEAMS_SCOPES.join(" "), state: i.state, code_challenge: i.codeChallenge, code_challenge_method: "S256", ...(i.loginHint ? { login_hint: i.loginHint } : {}) })}`;
}
async function request(url: string, init: RequestInit): Promise<unknown> {
  let r: Response; try { r = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) }); } catch { throw new TeamsProviderError("provider_connection_uncertain"); }
  if (!r.ok) {
    const retry = Number(r.headers.get("retry-after"));
    throw new TeamsProviderError(r.status === 429 ? "provider_rate_limited" : r.status === 401 ? "provider_reauthentication_required" : r.status === 403 ? "provider_permission_denied" : r.status === 404 ? "provider_not_found" : r.status === 412 ? "provider_version_conflict" : "provider_request_failed", r.status, retry > 0 && Number.isFinite(retry) ? Math.min(retry, 86400) : undefined);
  }
  if (r.status === 204) return undefined;
  try { return await r.json(); } catch { throw new TeamsProviderError("provider_invalid_response"); }
}
export type TeamsTokens = { accessToken: string; refreshToken: string; expiresIn: number; scope: string; tenantId?: string };
// OAuth 2.0 / Microsoft identity platform token-endpoint error codes.
// The user's grant is gone: the refresh token was revoked, expired, or needs fresh interaction/consent.
const USER_GRANT_ERRORS = new Set(["invalid_grant", "interaction_required", "consent_required", "login_required"]);
// The VNDRLY app registration is wrong: bad/expired secret, unknown client, or not enabled for the tenant.
const APP_CONFIG_ERRORS = new Set(["invalid_client", "unauthorized_client", "unsupported_grant_type"]);
// AADSTS codes that indicate registration problems even when reported as invalid_request/invalid_grant:
// 50011 redirect mismatch, 50194 app not multi-tenant, 700016 app not found in tenant,
// 7000215 invalid secret, 7000222 expired secret, 700025 public client sent secret, 7000218 secret missing.
export const APP_CONFIG_AADSTS = new Set([50011, 50194, 700016, 7000215, 7000222, 700025, 7000218]);
/** Classify a Microsoft identity error without retaining the description, tokens or secret. */
export function classifyTeamsIdentityError(error: unknown, codes: unknown): "teams_reconnect_required" | "teams_app_misconfigured" | null {
  const aadsts = Array.isArray(codes) ? codes.filter((v): v is number => typeof v === "number") : [];
  if (aadsts.some(code => APP_CONFIG_AADSTS.has(code)) || (typeof error === "string" && APP_CONFIG_ERRORS.has(error))) return "teams_app_misconfigured";
  if (typeof error === "string" && USER_GRANT_ERRORS.has(error)) return "teams_reconnect_required";
  return null;
}
async function tokenRequest(url: string, body: string, grantType: string): Promise<Record<string, unknown>> {
  let r: Response;
  try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "error", signal: AbortSignal.timeout(20000) }); }
  catch { throw new TeamsProviderError("provider_connection_uncertain"); }
  if (r.ok) { try { return await r.json() as Record<string, unknown>; } catch { throw new TeamsProviderError("provider_invalid_response"); } }
  let detail: Record<string, unknown> = {};
  try { detail = await r.json() as Record<string, unknown>; } catch { /* Non-JSON identity errors are classified by status only. */ }
  const aadsts = Array.isArray(detail.error_codes) ? detail.error_codes.filter((v): v is number => typeof v === "number").slice(0, 5) : [];
  const kind = classifyTeamsIdentityError(detail.error, aadsts) ?? (r.status === 401 ? "teams_app_misconfigured" : null);
  // Log only classification metadata. Never the request body, description, tokens or client secret.
  const log = { event: "teams.token_error", grantType, status: r.status, error: typeof detail.error === "string" ? detail.error.slice(0, 64) : undefined, aadsts, traceId: typeof detail.trace_id === "string" ? detail.trace_id.slice(0, 64) : undefined, correlationId: typeof detail.correlation_id === "string" ? detail.correlation_id.slice(0, 64) : undefined };
  if (kind === "teams_app_misconfigured") { logger.error(log, "Microsoft Teams app registration rejected by Microsoft identity platform"); throw new TeamsProviderError("teams_app_misconfigured", 503); }
  logger.warn(log, "Microsoft Teams token request failed");
  if (kind === "teams_reconnect_required") throw new TeamsProviderError("teams_reconnect_required", 401);
  const retry = Number(r.headers.get("retry-after"));
  throw new TeamsProviderError(r.status === 429 ? "provider_rate_limited" : "provider_request_failed", r.status, retry > 0 && Number.isFinite(retry) ? Math.min(retry, 86400) : undefined);
}
async function tokens(c: TeamsConfig, fields: Record<string,string>, authority = c.tenantId): Promise<TeamsTokens> {
  const r = await tokenRequest(`https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`, new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, scope: TEAMS_SCOPES.join(" "), ...fields }).toString(), fields.grant_type || "unknown");
  if (!r || typeof r.access_token !== "string" || typeof r.expires_in !== "number" || r.expires_in <= 0) throw new TeamsProviderError("provider_invalid_token_response");
  // This ID token is obtained directly from Microsoft's TLS token endpoint, never a browser input.
  // Graph /me separately verifies the access token. Only tenant metadata is retained here.
  let tenantId: string | undefined;
  if (typeof r.id_token === "string") {
    try {
      const claims = JSON.parse(Buffer.from(r.id_token.split(".")[1], "base64url").toString("utf8"));
      // Per-tenant issuer validation: iss must be the v2.0 issuer of the token's own tid, for any tenant.
      if (typeof claims.tid === "string" && GUID.test(claims.tid) && claims.aud === c.clientId && claims.iss === `https://login.microsoftonline.com/${claims.tid}/v2.0` && claims.exp > Date.now() / 1000) tenantId = claims.tid.toLowerCase();
    } catch { /* Missing identity metadata requires a fresh connection, never inferred from email. */ }
  }
  if (tenantId && !teamsTenantAllowed(c, tenantId)) { logger.warn({ event: "teams.tenant_rejected", tenantId }, "Microsoft Teams tenant is not allowed by configuration"); throw new TeamsProviderError("teams_tenant_not_allowed", 403); }
  return { accessToken: r.access_token, refreshToken: typeof r.refresh_token === "string" ? r.refresh_token : fields.refresh_token || "", expiresIn: r.expires_in, scope: typeof r.scope === "string" ? r.scope : "", ...(tenantId ? { tenantId } : {}) };
}
/** Consumer accounts are never allowed; a pinned GUID authority or an allow-list restricts work/school tenants. */
export function teamsTenantAllowed(c: TeamsConfig, tenantId: string) {
  const tid = tenantId.toLowerCase();
  if (!GUID.test(tid) || tid === MICROSOFT_CONSUMER_TENANT_ID) return false;
  if (GUID.test(c.tenantId) && c.tenantId.toLowerCase() !== tid) return false;
  return !c.allowedTenantIds?.length || c.allowedTenantIds.includes(tid);
}
export const exchangeTeamsCode = (c: TeamsConfig, code: string, verifier: string) => tokens(c, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: c.redirectUri });
/** Multi-tenant registrations refresh against the user's own tenant authority, as Microsoft recommends. */
export const refreshTeamsToken = (c: TeamsConfig, token: string, tenantId?: string) => tokens(c, { grant_type: "refresh_token", refresh_token: token }, tenantId && isMultiTenantAuthority(c.tenantId) && GUID.test(tenantId) ? tenantId : c.tenantId);
export async function graphRequest<T>(token: string, path: string, o: { method?: string; body?: unknown; etag?: string } = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\#\r\n]/.test(path) || /(?:^|\/)(?:\.|\.\.)(?:\/|\?|$)/.test(path) || /%2e|%5c/i.test(path)) throw new TeamsProviderError("invalid_graph_path", 400);
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) throw new TeamsProviderError("invalid_graph_path",400);
  return await request(url.toString(), { method: o.method || "GET", headers: { ...graphHeaders(token), ...(o.etag ? { "If-Match": o.etag } : {}) }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }) as T;
}
function graphHeaders(token: string): Record<string, string> { return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId", outlook.timezone="UTC"' }; }
function id(s: string) { if (!s || s.length > 2048 || /[\r\n]/.test(s)) throw new TeamsProviderError("invalid_resource_id",400); return encodeURIComponent(s); }
function range(start: string,end: string,bounded=false) {
  const iso=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/;
  const a=Date.parse(start), b=Date.parse(end);
  if (!iso.test(start)||!iso.test(end)||!Number.isFinite(a)||!Number.isFinite(b)||b<=a||(bounded&&b-a>31*86400000)) throw new TeamsProviderError("invalid_time_range",400);
}
type Collection<T> = { value: T[]; "@odata.nextLink"?: string };
/** Page size per Graph request and caps per read. hasMore means Graph still has items beyond what is returned. */
export const TEAMS_PAGE_LIMITS = { pageSize: 50, calendar: { maxPages: 10, maxItems: 500 }, chats: { maxPages: 5, maxItems: 250 } } as const;
/** Follow only Graph v1.0 nextLinks; a link elsewhere is never sent the bearer token. */
function nextLinkUrl(link: unknown): string {
  let url: URL; try { url = new URL(String(link)); } catch { throw new TeamsProviderError("provider_invalid_response"); }
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/") || url.username || url.password || url.hash || /%2e|%5c/i.test(url.pathname)) throw new TeamsProviderError("provider_invalid_response");
  return url.toString();
}
async function collectPages<T>(token: string, firstPath: string, limits: { maxPages: number; maxItems: number }) {
  const items: T[] = [];
  let page = await graphRequest<Collection<T>>(token, firstPath);
  for (let pages = 1; ; pages++) {
    if (!Array.isArray(page?.value)) throw new TeamsProviderError("provider_invalid_response");
    items.push(...page.value);
    const next = page["@odata.nextLink"];
    if (!next || items.length >= limits.maxItems || pages >= limits.maxPages) return { items: items.slice(0, limits.maxItems), hasMore: Boolean(next) || items.length > limits.maxItems };
    page = await request(nextLinkUrl(next), { method: "GET", headers: graphHeaders(token) }) as Collection<T>;
  }
}
export async function listTeamsCalendar(t: string,start: string,end: string) {
  range(start,end,true); const q=new URLSearchParams({startDateTime:start,endDateTime:end,"$top":String(TEAMS_PAGE_LIMITS.pageSize),"$orderby":"start/dateTime"});
  const r=await collectPages<Record<string,unknown>>(t,`/me/calendarView?${q}`,TEAMS_PAGE_LIMITS.calendar); return {events:r.items,hasMore:r.hasMore};
}
export async function listTeamsChats(t: string) { const r=await collectPages<Record<string,unknown>>(t,`/me/chats?$top=${TEAMS_PAGE_LIMITS.pageSize}&$expand=members`,TEAMS_PAGE_LIMITS.chats); return {chats:r.items,hasMore:r.hasMore}; }
/** Output is text, never safe HTML. Entity decoding intentionally occurs after tag removal. */
export function normalizeTeamsText(value: string) {
  const text=value.replace(/<!--[^]*?(?:-->|$)/g,"").replace(/<(script|style|iframe|object)\b[^>]*>[^]*?<\/\1\s*>/gi,"").replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi,"\n").replace(/<[^>]*(?:>|$)/g,"");
  const entities:Record<string,string>={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(match,e:string)=>{if(e[0]!=="#")return entities[e.toLowerCase()]||match; const n=e[1]?.toLowerCase()==="x"?parseInt(e.slice(2),16):parseInt(e.slice(1),10); return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):"";}).replace(/[\t ]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim().slice(0,50000);
}
type Message={id:string;body?:{content?:string;contentType?:string};from?:{user?:{id?:string;displayName?:string}};createdDateTime?:string;webUrl?:string;deletedDateTime?:string};
export async function listTeamsMessages(t:string,chatId:string) {
  const r=await graphRequest<Collection<Message>>(t,`/chats/${id(chatId)}/messages?$top=50`);
  return { messages:r.value.map(m=>({id:m.id,text:m.deletedDateTime?"":m.body?.contentType==="html"?normalizeTeamsText(m.body.content||""):(m.body?.content||"").slice(0,50000),sender:{id:m.from?.user?.id||"",displayName:m.from?.user?.displayName||"Microsoft Teams"},createdAt:m.createdDateTime||null,webUrl:m.webUrl?.startsWith("https://teams.microsoft.com/")?m.webUrl:null})),hasMore:Boolean(r["@odata.nextLink"])};
}
export function sendTeamsMessage(t:string,chatId:string,text:string) {if(!text.trim()||text.length>20000)throw new TeamsProviderError("invalid_message",400);return graphRequest<Message>(t,`/chats/${id(chatId)}/messages`,{method:"POST",body:{body:{contentType:"text",content:text}}});}
export const getTeamsProfile=(t:string)=>graphRequest<{id:string;displayName:string;userPrincipalName:string;mail:string|null}>(t,"/me?$select=id,displayName,userPrincipalName,mail");
export type TeamsEventInput={transactionId:string;subject:string;body?:string;start:string;end:string};
export function createTeamsCalendarEvent(t:string,i:TeamsEventInput) {
  range(i.start,i.end);if(!i.transactionId||!i.subject.trim()||i.subject.length>1000||(i.body?.length||0)>20000)throw new TeamsProviderError("invalid_event",400);
  return graphRequest<Record<string,unknown>>(t,"/me/events",{method:"POST",body:{transactionId:i.transactionId,subject:i.subject,body:{contentType:"text",content:i.body||""},start:{dateTime:new Date(i.start).toISOString().replace(/Z$/,""),timeZone:"UTC"},end:{dateTime:new Date(i.end).toISOString().replace(/Z$/,""),timeZone:"UTC"},isOnlineMeeting:true,onlineMeetingProvider:"teamsForBusiness"}});
}
export const getTeamsCalendarEvent=(t:string,eventId:string)=>graphRequest<Record<string,unknown>>(t,`/me/events/${id(eventId)}`);
export const updateTeamsCalendarEvent=(t:string,eventId:string,body:Record<string,unknown>,etag?:string)=>graphRequest<Record<string,unknown>>(t,`/me/events/${id(eventId)}`,{method:"PATCH",body,etag});
