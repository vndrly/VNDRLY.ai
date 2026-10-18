export const TEAMS_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite", "Chat.Read", "ChatMessage.Send"] as const;
export type TeamsConfig = { clientId: string; clientSecret: string; tenantId: string; redirectUri: string };
export class TeamsProviderError extends Error {
  constructor(public readonly code: string, public readonly status = 502, public readonly retryAfter?: number) { super(code); this.name = "TeamsProviderError"; }
}
/** Missing registration returns null; malformed configured values fail closed. */
export function loadTeamsConfig(): TeamsConfig | null {
  const clientId = process.env.MICROSOFT_365_CLIENT_ID?.trim(), clientSecret = process.env.MICROSOFT_365_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const tenantId = process.env.MICROSOFT_365_TENANT_ID?.trim() || "organizations";
  const redirectUri = process.env.MICROSOFT_365_REDIRECT_URI?.trim() || "https://vndrly.ai/api/work-hub/teams/callback";
  if (!/^[a-zA-Z0-9.-]+$/.test(tenantId)) throw new TeamsProviderError("invalid_tenant_config", 503);
  let url: URL; try { url = new URL(redirectUri); } catch { throw new TeamsProviderError("invalid_redirect_config", 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new TeamsProviderError("invalid_redirect_config", 503);
  return { clientId, clientSecret, tenantId, redirectUri };
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
async function tokens(c: TeamsConfig, fields: Record<string,string>): Promise<TeamsTokens> {
  const r = await request(`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, scope: TEAMS_SCOPES.join(" "), ...fields }).toString() }) as Record<string,unknown>;
  if (!r || typeof r.access_token !== "string" || typeof r.expires_in !== "number" || r.expires_in <= 0) throw new TeamsProviderError("provider_invalid_token_response");
  // This ID token is obtained directly from Microsoft's TLS token endpoint, never a browser input.
  // Graph /me separately verifies the access token. Only tenant metadata is retained here.
  let tenantId: string | undefined;
  if (typeof r.id_token === "string") {
    try {
      const claims = JSON.parse(Buffer.from(r.id_token.split(".")[1], "base64url").toString("utf8"));
      if (typeof claims.tid === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(claims.tid) && claims.aud === c.clientId && claims.iss === `https://login.microsoftonline.com/${claims.tid}/v2.0` && claims.exp > Date.now() / 1000) tenantId = claims.tid;
    } catch { /* Missing identity metadata requires a fresh connection, never inferred from email. */ }
  }
  return { accessToken: r.access_token, refreshToken: typeof r.refresh_token === "string" ? r.refresh_token : fields.refresh_token || "", expiresIn: r.expires_in, scope: typeof r.scope === "string" ? r.scope : "", ...(tenantId ? { tenantId } : {}) };
}
export const exchangeTeamsCode = (c: TeamsConfig, code: string, verifier: string) => tokens(c, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: c.redirectUri });
export const refreshTeamsToken = (c: TeamsConfig, token: string) => tokens(c, { grant_type: "refresh_token", refresh_token: token });
export async function graphRequest<T>(token: string, path: string, o: { method?: string; body?: unknown; etag?: string } = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\#\r\n]/.test(path) || /(?:^|\/)(?:\.|\.\.)(?:\/|\?|$)/.test(path) || /%2e|%5c/i.test(path)) throw new TeamsProviderError("invalid_graph_path", 400);
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) throw new TeamsProviderError("invalid_graph_path",400);
  return await request(url.toString(), { method: o.method || "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId", outlook.timezone="UTC"', ...(o.etag ? { "If-Match": o.etag } : {}) }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }) as T;
}
function id(s: string) { if (!s || s.length > 2048 || /[\r\n]/.test(s)) throw new TeamsProviderError("invalid_resource_id",400); return encodeURIComponent(s); }
function range(start: string,end: string,bounded=false) {
  const iso=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/;
  const a=Date.parse(start), b=Date.parse(end);
  if (!iso.test(start)||!iso.test(end)||!Number.isFinite(a)||!Number.isFinite(b)||b<=a||(bounded&&b-a>31*86400000)) throw new TeamsProviderError("invalid_time_range",400);
}
type Collection<T> = { value: T[]; "@odata.nextLink"?: string };
export async function listTeamsCalendar(t: string,start: string,end: string) {
  range(start,end,true); const q=new URLSearchParams({startDateTime:start,endDateTime:end,"$top":"50","$orderby":"start/dateTime"});
  const r=await graphRequest<Collection<Record<string,unknown>>>(t,`/me/calendarView?${q}`); return {events:r.value,hasMore:Boolean(r["@odata.nextLink"])};
}
export async function listTeamsChats(t: string) { const r=await graphRequest<Collection<Record<string,unknown>>>(t,"/me/chats?$top=50&$expand=members"); return {chats:r.value,hasMore:Boolean(r["@odata.nextLink"])}; }
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
