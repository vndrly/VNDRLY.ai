import { savedGateVisitResourceId } from "../assistant/plan-gate-visit-proof";
import { selectConsentedScopes } from "../assistant/chatgpt-consent-selection";
import { fleetConsentUpgradeTools, partnerFleetConsentUpgradeTools, supportFleetConsentUpgradeTools, fleetConsentChallenge, fleetToolSecuritySchemes } from "../assistant/chatgpt-fleet-consent";
import { createFleetService } from "../services/fleet-ops";
import { databaseFleetRepository } from "../services/fleet-repository";
import type { SessionPayload } from "../lib/session";
import { financeConsentUpgradeTools, requiresFinanceConsent, financeConsentChallenge, FINANCE_SECURITY_SCHEMES } from "../assistant/chatgpt-consent-upgrade";
import { Router, type Request, type Response } from "express";
import { exposedOperationTools, resolveOperationTool, planOperationTools } from "../assistant/chatgpt-operation-tools";
import { createHmac, createHash, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_SECRET, getSessionFromRequest } from "../lib/session";
import { createRateLimiter } from "../lib/rate-limit-factory";
import { validateAssistantSession, withAssistantGrants } from "../assistant/chatgpt-grant-store";
import { ASSISTANT_ISSUER, ASSISTANT_RESOURCE, ASSISTANT_SCOPES, CHATGPT_CLIENT_ID, AssistantOAuthError, validateAssistantAuthorization, issueAssistantCode, exchangeAssistantCode, refreshAssistantTokens, assistantAccessMatches, assistantAccessHashMatches, assistantTokenHash, assistantTokenUserId } from "../assistant/chatgpt-oauth";
import { chatGptActionTools, chatGptReadableTools, requireChatGptReadableTool, chatGptReadToolDescription, chatGptReadToolOutput, chatGptReadToolAnnotations } from "../assistant/chatgpt-tool-access";
import { WORKSPACE_HTML, WORKSPACE_URI, WORKSPACE_TOOL, workspaceRequest, workspaceOutput } from "../assistant/chatgpt-workspace";
import { askvPendingConfirmations, organizationKeyFromSession, runBoundTypedAskVTool } from "../assistant/askv-pending-confirmation";
import { mutationIdempotencyKey, readPersistentAskVMutationResult } from "../assistant/askv-idempotency";
import type { AssistantPreparedAction } from "../assistant/chatgpt-oauth";
import { runTool } from "./assistant";
import { isTypedWorkHubTool } from "../assistant/work-hub-tool-runtime";
import { ACTION_PANEL_URI, ATTENDANCE_ACTION_PANEL_URI, RECOVERY_ACTION_PANEL_URI, RECENT_ACTION_PANEL_URI, PREVIOUS_ACTION_PANEL_URI, LEGACY_ACTION_PANEL_URI, ACTION_STATUS_OUTPUT_SCHEMA, ACTION_PANEL_HTML, ACTION_PANEL_META, SUBMIT_PANEL_ACTION_TOOL } from "../assistant/chatgpt-action-panel";
import { writeAskVActionAudit } from "../assistant/action-audit";
import { CHATGPT_READ_CAPABILITIES } from "../assistant/chatgpt-read-capabilities";
import { publicMapConfig } from "../lib/public-map-config";
import { SPECIALISTS_TOOL, specialistDirectory } from "../assistant/chatgpt-specialists";
import { fileDeviceHandoff, requireMatchingFileDevice, type FileDeviceHandoff, meetingDeviceHandoff, requireMatchingMeetingDevice, type MeetingDeviceHandoff } from "../assistant/chatgpt-device-handoff";
import { ticketDeviceHandoff, requireMatchingTicketDevice, type TicketDeviceHandoff, TICKET_DEVICE_TOOL } from "../assistant/chatgpt-device-handoff";
import { gateDeviceHandoff, requireMatchingGateDevice, type GateDeviceHandoff, GATE_DEVICE_TOOL } from "../assistant/chatgpt-device-handoff";
import { fleetDeviceHandoff, requireMatchingFleetDevice, type FleetDeviceHandoff, FLEET_DEVICE_TOOL } from "../assistant/chatgpt-device-handoff";
import { CHATGPT_WRITE_CAPABILITIES, validateChatGptActionInput, sanitizeChatGptActionInput, chatGptActionAuditInput, chatGptActionResult } from "../assistant/chatgpt-write-capabilities";

import { RESUME_PLAN_TOOL, resumedWorkPlan, PREPARE_PLAN_TOOL, prepareWorkPlan, RUN_PLAN_READ_TOOL, plannedReadRequests, CONTROL_PLAN_TOOL, prepareWorkPlanControl } from "../assistant/chatgpt-coordinated-plan";
import { PLAN_READ_CHECKPOINT_TOOL, preparePlanReadCheckpoint, planReadReceiptSchema } from "../assistant/chatgpt-plan-read-checkpoint";
import { PLAN_COMPLETION_TOOL, planCompletionRequestSchema, preparePlanCompletion } from "../assistant/chatgpt-plan-completion";
import { verifiedPlanCompletionIds } from "../assistant/plan-completion-proof";
import { readExactPlanTask } from "../assistant/coordinated-plan-exact-task";
import { callNaturalVoiceDomainApi } from "../assistant/natural-voice-write-tools";
import { savedWorkHubTaskResourceId } from "../assistant/plan-work-hub-task-proof";
import { savedWorkHubMeetingResourceId } from "../assistant/plan-work-hub-meeting-proof";
import { savedWorkHubMessageTarget } from "../assistant/plan-work-hub-message-proof";
import assistantPlanExecutionRouter from "./assistantPlanExecution";
import { PLAN_EXECUTION_PREPARE_TOOL, PLAN_EXECUTION_STATUS_TOOL, PLAN_EXECUTION_CANCEL_TOOL, handlePlanExecutionTool } from "../assistant/plan-execution-chatgpt";
import { PLAN_EXECUTION_CALENDAR_TOOL, handlePlanExecutionCalendarTool } from "../assistant/plan-execution-calendar-chatgpt";
import { recoverOperationsDisplayAction } from "../assistant/operations-display-action-recovery";
import { recoverCalendarReschedule } from "../assistant/calendar-reschedule-recovery";
import { recoverCalendarResponse } from "../assistant/calendar-response-recovery";
import { CALENDAR_RESCHEDULE_TOOLS } from "../assistant/calendar-reschedule-tools";
import { CALENDAR_RESPONSE_TOOLS } from "../assistant/calendar-response-tools";
import { INVOICE_ACTIVITY_TOOL, handleInvoiceActivityTool, invoiceActivityAvailable } from "../assistant/invoice-activity-chatgpt";
import { TICKET_INVOICE_CANDIDATES_TOOL, handleTicketInvoiceCandidatesTool, ticketInvoiceCandidatesAvailable } from "../assistant/ticket-invoice-candidates-tools";
import { TICKET_INVOICE_PREPARATION_TOOL } from "../assistant/ticket-invoice-preparation-tools";
import { WORKDAY_OPPORTUNITY_TOOLS, availableWorkdayOpportunityTools, handleWorkdayOpportunityTool } from "../assistant/workday-opportunity-chatgpt";

const router = Router();
const origin = new URL(ASSISTANT_ISSUER).origin;
const limiter = createRateLimiter({ resourcePrefix: "assistant_connection", errorCode: "assistant_connection.rate_limited", logKind: "assistant_connection.rate_limit", defaultMax: 60, defaultWindowMs: 60_000, message: "Please wait before trying V again." });
const SERVER_ACTION_FIELDS = new Set(["confirmed", "operationId", "idempotencyKey", "voiceSessionId", "latitude", "longitude", "accuracyMeters", "startLatitude", "startLongitude", "locationSharingActive", "currentLocation"]);
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const sign = (body: string) => createHmac("sha256", SESSION_SECRET).update(`assistant-consent:${body}`).digest("base64url");
const verifyPlanCompletions = (taskId: string, plan: import('../assistant/coordinated-plan').CoordinatedPlan) => verifiedPlanCompletionIds(SESSION_SECRET, taskId, plan);
function envelope(value: unknown) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${sign(body)}`;
}
function readEnvelope(value: unknown): { request: Record<string, unknown>; scopeSelection?: boolean; userId: number; sv: number; activeMembershipId: number | null; nonce: string; expires: number } {
  if (typeof value !== "string" || value.length > 12_000) throw new AssistantOAuthError("invalid_request");
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) throw new AssistantOAuthError("invalid_request");
  const expected = Buffer.from(sign(body)), actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new AssistantOAuthError("invalid_request");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload || typeof payload.expires !== "number" || !Number.isFinite(payload.expires) || payload.expires <= Date.now()) throw new AssistantOAuthError("invalid_request");
  return payload;
}
function page(res: Response, body: string) {
  return res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect V to VNDRLY</title></head><body><main><h1>VNDRLY.ai</h1>${body}</main></body></html>`);
}
// Only the known public OpenAI document is fetched; arbitrary client URLs cannot cause SSRF.
let clientCache: { expires: number; redirects: string[] } | undefined;
async function clientRedirects(): Promise<string[]> {
  if (clientCache && clientCache.expires > Date.now()) return clientCache.redirects;
  const response = await fetch(CHATGPT_CLIENT_ID, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new AssistantOAuthError("invalid_client");
  const metadata = await response.json() as Record<string, unknown>;
  const redirects = metadata.redirect_uris;
  const callbacks = ["https://chatgpt.com/connector_platform_oauth_redirect"];
  if (metadata.client_id !== CHATGPT_CLIENT_ID || !Array.isArray(redirects) ||
      !callbacks.every((uri) => redirects.includes(uri)) ||
      !Array.isArray(metadata.token_endpoint_auth_methods_supported) || !metadata.token_endpoint_auth_methods_supported.includes("none")) throw new AssistantOAuthError("invalid_client");
  clientCache = { expires: Date.now() + 3600_000, redirects: callbacks };
  return callbacks;
}
router.use(async (req, res, next) => {
  res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
  if (process.env.ASSISTANT_CONNECTION_ENABLED !== "1") return res.status(503).json({ error: "temporarily_unavailable" });
  if (!(await limiter.enforce(req, res, null))) return undefined;
  return next();
});
router.use("/executions", assistantPlanExecutionRouter);
router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
  issuer: ASSISTANT_ISSUER, authorization_endpoint: `${ASSISTANT_ISSUER}/authorize`, token_endpoint: `${ASSISTANT_ISSUER}/token`, revocation_endpoint: `${ASSISTANT_ISSUER}/revoke`,
  response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: ASSISTANT_SCOPES,
  client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true,
}));
router.get("/.well-known/oauth-protected-resource", (_req, res) => res.json({ resource: ASSISTANT_RESOURCE, authorization_servers: [ASSISTANT_ISSUER], scopes_supported: ASSISTANT_SCOPES, bearer_methods_supported: ["header"] }));
router.get("/device/files/:handoff", async (req, res) => {
  try {
    const handoff = readEnvelope(req.params.handoff) as unknown as FileDeviceHandoff;
    const session = getSessionFromRequest(req);
    if (!session) return page(res, '<p>Sign into the same VNDRLY account used by ChatGPT in another tab, then refresh this page.</p><p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a></p>');
    const current = await validateAssistantSession(session);
    requireMatchingFileDevice(handoff, current);
    await withAssistantGrants(current.userId!, async (grants, database) => {
      const grant = grants.find(item => !item.revoked && item.consentHash && item.consentHash === handoff.grantConsentHash);
      if (!grant) throw new AssistantOAuthError("access_denied");
      const connected = await validateAssistantSession(grant.session, database);
      requireMatchingFileDevice(handoff, connected);
      requireChatGptReadableTool(connected, grant.scopes, "deep_link_to");
    });
    const destination = JSON.parse(await runTool("deep_link_to", { screen: "work-hub-files" }, current, ""));
    if (destination.url !== "/work-hub/files") throw new AssistantOAuthError("access_denied");
    return res.redirect(302, "/work-hub/files");
  } catch {
    return page(res.status(403), '<p>This file handoff is expired, disconnected, or belongs to a different VNDRLY account or organization. Use the same account and organization as ChatGPT, then request a fresh file link from V. No upload was started.</p>');
  }
});
router.get("/device/meetings/:handoff", async (req, res) => {
  try {
    const handoff = readEnvelope(req.params.handoff) as unknown as MeetingDeviceHandoff;
    const session = getSessionFromRequest(req);
    if (!session) return page(res, '<p>Sign into the same VNDRLY account used by ChatGPT in another tab, then refresh this page.</p><p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a></p>');
    const current = await validateAssistantSession(session);
    const destination = requireMatchingMeetingDevice(handoff, current);
    await withAssistantGrants(current.userId!, async (grants, database) => {
      const grant = grants.find(item => !item.revoked && item.consentHash === handoff.grantConsentHash);
      if (!grant) throw new AssistantOAuthError("access_denied");
      requireMatchingMeetingDevice(handoff, await validateAssistantSession(grant.session, database));
      requireChatGptReadableTool(current, grant.scopes, "get_work_hub_meeting_catchup");
    });
    const result = JSON.parse(await runTool("get_work_hub_meeting_catchup", { occurrenceId: handoff.occurrenceId }, current, ""));
    if (result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
    return res.redirect(302, destination);
  } catch {
    return page(res.status(403), '<p>This meeting link is expired, disconnected, or unavailable to this account and organization. Refresh sign-in with the same VNDRLY account and organization used by ChatGPT, then return here and refresh. If the connection was revoked or the link expired, request a fresh link from V. No microphone, camera, or recording was started.</p><p><a href="/switch-account" target="_blank" rel="noopener">Refresh VNDRLY sign-in</a></p>');
  }
});
router.get("/device/tickets/:handoff", async (req, res) => {
  try {
    const handoff = readEnvelope(req.params.handoff) as unknown as TicketDeviceHandoff;
    const session = getSessionFromRequest(req);
    if (!session) return page(res, '<p>Sign into the same VNDRLY account used by ChatGPT in another tab, then refresh this page.</p><p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a></p>');
    const current = await validateAssistantSession(session);
    const destination = requireMatchingTicketDevice(handoff, current);
    await withAssistantGrants(current.userId!, async (grants, database) => {
      const grant = grants.find(item => !item.revoked && item.consentHash === handoff.grantConsentHash);
      if (!grant) throw new AssistantOAuthError("access_denied");
      requireMatchingTicketDevice(handoff, await validateAssistantSession(grant.session, database));
      requireChatGptReadableTool(current, grant.scopes, "query_ticket_detail");
    });
    const result = JSON.parse(await runTool("query_ticket_detail", { ticketId: handoff.ticketId }, current, ""));
    if (!result || result.ticketId !== handoff.ticketId || result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
    return res.redirect(302, destination);
  } catch {
    return page(res.status(403), '<p>This ticket link is expired, disconnected, or unavailable to this account and organization. Request a fresh link from V. No entry, upload, or tracking was started.</p>');
  }
});
router.get("/device/gate/:handoff", async (req, res) => {
  try {
    const handoff = readEnvelope(req.params.handoff) as unknown as GateDeviceHandoff;
    const session = getSessionFromRequest(req);
    if (!session) return page(res, '<p>Sign into the same VNDRLY account used by ChatGPT, then refresh this page.</p><p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a></p>');
    const current = await validateAssistantSession(session);
    const destination = requireMatchingGateDevice(handoff, current);
    await withAssistantGrants(current.userId!, async (grants, database) => {
      const grant = grants.find(item => !item.revoked && item.consentHash === handoff.grantConsentHash);
      if (!grant) throw new AssistantOAuthError("access_denied");
      requireMatchingGateDevice(handoff, await validateAssistantSession(grant.session, database));
      requireChatGptReadableTool(current, grant.scopes, "query_gate_change_over");
    });
    const result = JSON.parse(await runTool("query_gate_change_over", { stationId: handoff.stationId }, current, ""));
    if (!result || result.station?.id !== handoff.stationId || result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
    const siteId = result.station.site_id;
    if (!Number.isSafeInteger(siteId) || siteId <= 0) throw new AssistantOAuthError("access_denied");
    return res.redirect(302, destination + "&siteId=" + siteId);
  } catch {
    return page(res.status(403), '<p>This Gate link is expired, disconnected, or unavailable to this account. Request a fresh link from V. No shift was transferred.</p>');
  }
});
router.get("/device/fleet/:handoff", async (req, res) => {
  try {
    const handoff = readEnvelope(req.params.handoff) as unknown as FleetDeviceHandoff;
    const session = getSessionFromRequest(req);
    if (!session) return page(res, '<p>Sign into the same VNDRLY account used by ChatGPT, then refresh this page.</p><p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a></p>');
    const current = await validateAssistantSession(session);
    const destination = requireMatchingFleetDevice(handoff, current);
    await withAssistantGrants(current.userId!, async (grants, database) => {
      const grant = grants.find(item => !item.revoked && item.consentHash === handoff.grantConsentHash);
      if (!grant) throw new AssistantOAuthError("access_denied");
      requireMatchingFleetDevice(handoff, await validateAssistantSession(grant.session, database));
      requireChatGptReadableTool(current, grant.scopes, "query_fleet_run_detail");
    });
    const result = JSON.parse(await runTool("query_fleet_run_detail", { runId: handoff.runId }, current, ""));
    if (!result || result.id !== handoff.runId || result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
    return res.redirect(302, destination);
  } catch {
    return page(res.status(403), '<p>This Fleet link is expired, disconnected, or unavailable to this account and organization. Request a fresh link from V. No entry, tracking or upload was started.</p>');
  }
});
router.get("/authorize", async (req, res) => {
  // The consent POST redirects to the fixed ChatGPT callback. Helmet's default
  // form-action self would otherwise block that browser redirect after success.
  res.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect");
  try {
    const authorizationRequest = await validateAssistantAuthorization(req.query, await clientRedirects());
    if (typeof req.query.state !== "string" || req.query.state.length > 4096) throw new AssistantOAuthError("invalid_request");
    const session = getSessionFromRequest(req);
    if (!session) return page(res, '<p>Sign into VNDRLY in another tab, then return here and refresh this page.</p><p><a href="/switch-account" target="_blank" rel="noopener">Sign into VNDRLY</a></p>');
    const current = await validateAssistantSession(session);
    const nonce = randomBytes(32).toString("base64url");
    res.cookie("vndrly_assistant_consent", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/assistant-connection", maxAge: 300_000 });
    const consent = envelope({ request: req.query, scopeSelection: true, userId: current.userId, sv: current.sv, activeMembershipId: current.activeMembershipId ?? null, nonce, expires: Date.now() + 300_000 });
    const writeAccess = String(req.query.scope).split(" ").some((scope) => scope.endsWith(":write"));
    const requestedScopes = authorizationRequest.scopes;
    const labels: Record<string, string> = { "gate:read": "Gate records and draft preparation", "gate:write": "Prepare Gate changes for authenticated approval", "work_hub:read": "Work Hub records", "work_hub:write": "Prepare Work Hub changes for authenticated approval", ...Object.fromEntries(Object.entries({...CHATGPT_READ_CAPABILITIES, ...CHATGPT_WRITE_CAPABILITIES}).map(([scope, capability]) => [scope, capability.label])) };
    return page(res, `<p>Connect ChatGPT to the VNDRLY records available to ${escape(current.displayName ?? "your VNDRLY account")}.</p><p>Choose the access to grant. Uncheck permissions you do not want; reconnecting does not require selecting every permission.</p><p>${writeAccess ? "V can read the listed records and prepare changes. Changes requiring approval are completed through your signed-in VNDRLY account." : "This connection can read the listed records. It cannot change them."}</p><form method="post" action="/api/assistant-connection/authorize"><input type="hidden" name="consent" value="${escape(consent)}"><fieldset><legend>Selected permissions</legend>${requestedScopes.map(scope => `<label style="display:block"><input type="checkbox" name="selected_scope" value="${escape(scope)}" checked> ${escape(labels[scope] ?? scope)} (${escape(scope)})</label>`).join("")}</fieldset><button type="submit">Connect my VNDRLY account</button></form><p><a href="/switch-account" target="_blank" rel="noopener">Switch VNDRLY account</a>. After signing in, return here and refresh before connecting.</p>`);
  } catch (error) { return oauthError(res, error); }
});
router.post("/authorize", async (req, res) => {
  try {
    if (req.headers.origin !== origin) throw new AssistantOAuthError("access_denied");
    const consent = readEnvelope(req.body.consent);
    const session = getSessionFromRequest(req);
    if (!session || session.userId !== consent.userId || req.cookies?.vndrly_assistant_consent !== consent.nonce) throw new AssistantOAuthError("access_denied");
    const current = await validateAssistantSession(session);
    if (current.sv !== consent.sv || (current.activeMembershipId ?? null) !== consent.activeMembershipId) throw new AssistantOAuthError("access_denied");
    const authorization = validateAssistantAuthorization(consent.request, await clientRedirects());
    if (consent.scopeSelection !== true) throw new AssistantOAuthError("invalid_request");
    authorization.scopes = selectConsentedScopes(authorization.scopes, req.body.selected_scope);
    const issued = issueAssistantCode(authorization, current);
    issued.grant.consentHash = assistantTokenHash(consent.nonce);
    await withAssistantGrants(current.userId!, async (grants) => {
      if (grants.some((grant) => grant.consentHash === issued.grant.consentHash)) throw new AssistantOAuthError("invalid_request");
      const active = grants.filter((grant) => (!grant.revoked && (grant.refreshExpiresAt ?? grant.codeExpiresAt) > Date.now()) || grant.actions?.some(unresolved));
      if (active.length >= 20) throw new AssistantOAuthError("access_denied");
      grants.splice(0, grants.length, ...active, issued.grant);
    });
    res.clearCookie("vndrly_assistant_consent", { path: "/api/assistant-connection", secure: true, sameSite: "lax" });
    const callback = new URL(authorization.redirectUri);
    callback.searchParams.set("code", issued.code); callback.searchParams.set("state", String(consent.request.state)); callback.searchParams.set("iss", ASSISTANT_ISSUER);
    return res.redirect(303, callback.href);
  } catch (error) { return oauthError(res, error); }
});
router.post("/token", async (req, res) => {
  try {
    const refresh = req.body.grant_type === "refresh_token";
    if (!refresh && req.body.grant_type !== "authorization_code") throw new AssistantOAuthError("unsupported_grant_type");
    const raw = refresh ? req.body.refresh_token : req.body.code;
    const userId = assistantTokenUserId(raw);
    if (!userId) throw new AssistantOAuthError("invalid_grant");
    const result = await withAssistantGrants(userId, async (grants, database) => {
      const hash = assistantTokenHash(raw);
      const grant = grants.find((item) => refresh ? item.refreshHash === hash || item.previousRefreshHashes.includes(hash) : item.codeHash === hash);
      if (!grant) throw new AssistantOAuthError("invalid_grant");
      try { await validateAssistantSession(grant.session, database); } catch (error) { grant.revoked = true; throw error; }
      return refresh ? refreshAssistantTokens(grant, req.body) : exchangeAssistantCode(grant, req.body);
    });
    return res.json(result);
  } catch (error) { return oauthError(res, error); }
});
router.post("/revoke", async (req, res) => {
  try {
    if (req.body.client_id !== CHATGPT_CLIENT_ID) throw new AssistantOAuthError("invalid_client");
    const userId = assistantTokenUserId(req.body.token);
    if (userId) await withAssistantGrants(userId, async (grants) => {
      const hash = assistantTokenHash(req.body.token);
      const grant = grants.find((item) => item.accessHash === hash || item.previousAccessTokens?.some(token => token.hash === hash) || item.refreshHash === hash || item.previousRefreshHashes.includes(hash));
      if (grant) grant.revoked = true;
    });
    return res.status(200).end();
  } catch (error) { return oauthError(res, error); }
});
async function authenticate(req: Request) {
  const raw = /^Bearer ([^ ]+)$/i.exec(req.headers.authorization ?? "")?.[1];
  const userId = assistantTokenUserId(raw);
  if (!userId || !raw) throw new AssistantOAuthError("invalid_token");
  return withAssistantGrants(userId, async (grants, database) => {
    const grant = grants.find((item) => assistantAccessMatches(item, raw));
    if (!grant) throw new AssistantOAuthError("invalid_token");
    const session = await validateAssistantSession(grant.session, database);
    return { session, scopes: grant.scopes, grantAccessHash: assistantTokenHash(raw), grantConsentHash: grant.consentHash };
  });
}
async function fleetUpgradeDiscovery(session: SessionPayload, scopes: readonly string[]) {
  if(session.role==="admin" && session.userId) {
    try { const choices=JSON.parse(await runTool("query_fleet_support",{},session,"")); return Array.isArray(choices.companies) ? supportFleetConsentUpgradeTools(session,scopes,choices) : []; } catch { return []; }
  }
  if(session.role==="partner" && session.partnerId && session.userId) {
    try { const choices=JSON.parse(await runTool("query_fleet_site_activity",{},session,"")); return Array.isArray(choices.sites) ? partnerFleetConsentUpgradeTools(session,scopes,choices) : []; } catch { return []; }
  }
  if (!session.vendorId || !session.userId || !["vendor", "field_employee"].includes(session.role ?? "")) return [];
  try {
    const overview = await createFleetService(databaseFleetRepository).overview({ ...session, userId: session.userId, companyId: session.vendorId });
    return fleetConsentUpgradeTools(session, scopes, overview);
  } catch { return []; } // Unavailable or revoked authority never exposes hypothetical access.
}
router.post("/mcp", async (req, res) => {
  let authorized;
  try { authorized = await authenticate(req); } catch {
    return res.status(401).set("WWW-Authenticate", `Bearer resource_metadata="${ASSISTANT_ISSUER}/.well-known/oauth-protected-resource"`).json({ error: "invalid_token" });
  }
  if (req.headers.origin && ![origin, "https://chatgpt.com"].includes(req.headers.origin)) return res.status(403).end();
  const message = req.body;
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return res.status(400).json({ error: "invalid_request" });
  const reply = (result: unknown) => res.json({ jsonrpc: "2.0", id: message.id, result });
  if (message.id === undefined) return res.status(202).end();
  if (message.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, extensions: { "io.modelcontextprotocol/ui": {} } }, serverInfo: { name: "VNDRLY.ai", version: "1.2.0" }, instructions: "These tools access live VNDRLY records within the connected account permissions." });
  if (message.method === "ping") return reply({});
  if (message.method === "resources/list") return reply({ resources: [{ uri: WORKSPACE_URI, name: "VNDRLY work desk", mimeType: "text/html;profile=mcp-app" }, { uri: ACTION_PANEL_URI, name: "VNDRLY action authorization", mimeType: "text/html;profile=mcp-app" }] });
  if (message.method === "resources/read") {
    if ([ACTION_PANEL_URI, ATTENDANCE_ACTION_PANEL_URI, RECOVERY_ACTION_PANEL_URI, RECENT_ACTION_PANEL_URI, PREVIOUS_ACTION_PANEL_URI, LEGACY_ACTION_PANEL_URI].includes(message.params?.uri)) return reply({ contents: [{ uri: message.params.uri, mimeType: "text/html;profile=mcp-app", text: ACTION_PANEL_HTML, _meta: { "openai/widgetDescription": "VNDRLY action authorization panel. Shows the exact prepared change, current saved status, and actual result after submission. Location-dependent changes use the secure device authorization link.", ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } } }] });
    if (message.params?.uri !== WORKSPACE_URI) return res.json({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown resource" } });
    return reply({ contents: [{ uri: WORKSPACE_URI, mimeType: "text/html;profile=mcp-app", text: WORKSPACE_HTML, _meta: { ui: { csp: { connectDomains: [], resourceDomains: (authorized.scopes.includes("crew:read") || authorized.scopes.includes("fleet:read")) ? ["https://api.mapbox.com"] : [] }, prefersBorder: true } } }] });
  }
  if (message.method === "tools/list") {
    const fleetUpgrades = await fleetUpgradeDiscovery(authorized.session, authorized.scopes);
    const fleetUpgradeDescriptors = fleetUpgrades.map(({tool, scope}) => {
      const securitySchemes = [{ type: "oauth2" as const, scopes: [scope] }];
      return { name: tool.name, description: `${tool.description} Additional Fleet consent is required before this tool can access records or prepare a change.`, inputSchema: { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).filter(([key]) => !SERVER_ACTION_FIELDS.has(key))), required: (tool.inputSchema.required ?? []).filter(key => !SERVER_ACTION_FIELDS.has(key)) }, securitySchemes, _meta: { securitySchemes }, annotations: { readOnlyHint: !tool.mutating, destructiveHint: tool.mutating, openWorldHint: false } };
    });
    const reads: Array<{ name: string; description: string; inputSchema: ReturnType<typeof chatGptReadableTools>[number]["inputSchema"]; annotations: ReturnType<typeof chatGptReadToolAnnotations>; securitySchemes?: ReturnType<typeof fleetToolSecuritySchemes>; _meta?: Record<string, unknown>; outputSchema?: unknown }> = chatGptReadableTools(authorized.session, authorized.scopes).filter(tool => tool.name !== TICKET_INVOICE_CANDIDATES_TOOL.name).map((tool) => ({ ...(fleetToolSecuritySchemes(tool.name, authorized.scopes) ? { securitySchemes: fleetToolSecuritySchemes(tool.name, authorized.scopes), _meta: { securitySchemes: fleetToolSecuritySchemes(tool.name, authorized.scopes) } } : {}), ...([CALENDAR_RESCHEDULE_TOOLS[0].name, CALENDAR_RESPONSE_TOOLS[0].name].includes(tool.name as never) ? { outputSchema: (tool.name === CALENDAR_RESPONSE_TOOLS[0].name ? CALENDAR_RESPONSE_TOOLS[0] : CALENDAR_RESCHEDULE_TOOLS[0]).outputSchema, securitySchemes: [{ type: "oauth2" as const, scopes: ["work_hub:read"] }] } : {}), name: tool.name, description: chatGptReadToolDescription(tool), inputSchema: tool.inputSchema, annotations: chatGptReadToolAnnotations(tool.name) }));
    reads.push(...fleetUpgradeDescriptors.filter(tool => tool.annotations.readOnlyHint));
    reads.push(SPECIALISTS_TOOL);
    if (invoiceActivityAvailable(authorized.session, authorized.scopes)) reads.push(INVOICE_ACTIVITY_TOOL);
    if (ticketInvoiceCandidatesAvailable(authorized.session, authorized.scopes)) reads.push(TICKET_INVOICE_CANDIDATES_TOOL);
    reads.push(...availableWorkdayOpportunityTools(authorized.session, authorized.scopes));
    reads.push({ name: "v_connection_context", description: "Read this connection's authenticated account and granted scope names. These are connection facts, not proof of operational site access or permission to perform an action. Use before selecting role-dependent workflows; do not infer roles from display names.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } });
    if (reads.some(tool => tool.name === "query_gate_change_over")) reads.push(GATE_DEVICE_TOOL);
    if (reads.some(tool => tool.name === "query_ticket_detail")) reads.push(TICKET_DEVICE_TOOL);
    if (chatGptReadableTools(authorized.session, authorized.scopes).some(tool => tool.name === "query_fleet_run_detail")) reads.push(FLEET_DEVICE_TOOL);
    if (reads.some(tool => tool.name === "list_work_hub_tasks")) reads.push(RESUME_PLAN_TOOL, RUN_PLAN_READ_TOOL);
    if (process.env.ASSISTANT_PLAN_EXECUTION_ENABLED === "1" && reads.some(tool => tool.name === "list_work_hub_tasks")) {
      reads.push(PLAN_EXECUTION_STATUS_TOOL, PLAN_EXECUTION_CANCEL_TOOL);
      if (authorized.session.role !== "admin" && ["get_work_hub_calendar", "get_work_hub_calendar_item", "get_work_hub_meeting_catchup", "find_work_hub_meeting_times"].every(name => reads.some(tool => tool.name === name)) && chatGptActionTools(authorized.session, authorized.scopes).some(tool => tool.name === "manage_work_hub_meeting")) reads.push(PLAN_EXECUTION_CALENDAR_TOOL);
      if (chatGptActionTools(authorized.session, authorized.scopes).some(tool => tool.name === "manage_work_hub_task")) reads.push(PLAN_EXECUTION_PREPARE_TOOL);
    }
    if (reads.some(tool => ["get_work_hub_briefing", "get_work_hub_calendar", "query_gate_stations", "lookup_user_progress", "query_tickets", "query_notifications", "query_field_trips", "query_fleet_briefing", "query_fleet_site_activity", "query_asset_custody"].includes(tool.name))) reads.push(WORKSPACE_TOOL);
    const actions = chatGptActionTools(authorized.session, authorized.scopes);
    const upgradeTools = financeConsentUpgradeTools(authorized.session, authorized.scopes).map(tool => ({ name: tool.name, description: `${tool.description} Additional finance consent is required before preparation; this does not transfer money.`, inputSchema: { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).filter(([key]) => !SERVER_ACTION_FIELDS.has(key))), required: (tool.inputSchema.required ?? []).filter(key => !SERVER_ACTION_FIELDS.has(key)) }, securitySchemes: FINANCE_SECURITY_SCHEMES, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, _meta: { securitySchemes: FINANCE_SECURITY_SCHEMES } }));
    upgradeTools.push(...fleetUpgradeDescriptors.filter(tool => !tool.annotations.readOnlyHint));
    const planTools = actions.some(tool => tool.name === "manage_work_hub_task") ? [{ ...PREPARE_PLAN_TOOL, _meta: ACTION_PANEL_META }, ...(reads.some(tool => tool.name === 'list_work_hub_tasks') ? [{ ...CONTROL_PLAN_TOOL, _meta: ACTION_PANEL_META }, { ...PLAN_READ_CHECKPOINT_TOOL, _meta: ACTION_PANEL_META }, { ...PLAN_COMPLETION_TOOL, _meta: ACTION_PANEL_META }] : [])] : [];
    const preparedTools = exposedOperationTools(actions).map((tool) => ({ ...(CHATGPT_WRITE_CAPABILITIES["finance:write"].tools.includes(tool.name as never) ? { securitySchemes: tool.name === TICKET_INVOICE_PREPARATION_TOOL.name ? TICKET_INVOICE_PREPARATION_TOOL.securitySchemes : FINANCE_SECURITY_SCHEMES } : {}), ...(fleetToolSecuritySchemes(tool.name, authorized.scopes) ? { securitySchemes: fleetToolSecuritySchemes(tool.name, authorized.scopes) } : {}), name: tool.name, description: `${tool.description}${tool.name.startsWith("manage_ticket_record") ? " Authorized operations can overwrite ticket fields, cancel tickets, or remove line items. This call only prepares the change; submission requires the existing authorization panel." : ""} This connection prepares the exact change for authorization in the VNDRLY action panel. Location-dependent actions use the secure device authorization link. Never claim prepared means completed.`, inputSchema: { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).filter(([key]) => !SERVER_ACTION_FIELDS.has(key))), required: (tool.inputSchema.required ?? []).filter((key) => !SERVER_ACTION_FIELDS.has(key)) }, annotations: { readOnlyHint: false, destructiveHint: tool.name.startsWith("manage_ticket_record") || tool.name === "manage_gate_shift_cancel_handoff" || tool.name === "cancel_fleet_cargo_transfer" || tool.name === "cancel_fleet_equipment_replacement", openWorldHint: false }, ...([CALENDAR_RESCHEDULE_TOOLS[1].name, CALENDAR_RESPONSE_TOOLS[1].name].includes(tool.name as never) ? { securitySchemes: [{ type: "oauth2" as const, scopes: ["work_hub:write"] }] } : {}), _meta: { ...ACTION_PANEL_META, ...([CALENDAR_RESCHEDULE_TOOLS[1].name, CALENDAR_RESPONSE_TOOLS[1].name].includes(tool.name as never) ? { securitySchemes: [{ type: "oauth2" as const, scopes: ["work_hub:write"] }] } : {}), ...(tool.name === TICKET_INVOICE_PREPARATION_TOOL.name ? { securitySchemes: TICKET_INVOICE_PREPARATION_TOOL.securitySchemes } : {}), ...(fleetToolSecuritySchemes(tool.name, authorized.scopes) ? { securitySchemes: fleetToolSecuritySchemes(tool.name, authorized.scopes) } : {}) } }));

    return reply({ tools: [...reads, ...preparedTools, ...upgradeTools, ...planTools, ...(actions.length ? [SUBMIT_PANEL_ACTION_TOOL] : []), ...((actions.length || upgradeTools.length) ? [{ name: "v_prepare_action", securitySchemes: [{ type: "oauth2", scopes: [...authorized.scopes] }], _meta: { ...ACTION_PANEL_META, securitySchemes: [{ type: "oauth2", scopes: [...authorized.scopes] }] }, description: "Prepare an authorized VNDRLY change and return its secure VNDRLY approval link. This tool never claims the change is completed. Model-supplied approval and GPS are ignored. Finance operations may require finance:write consent when invoked; unrelated operations retain existing scopes.", inputSchema: { type: "object", properties: { toolName: { type: "string", enum: [...actions, ...upgradeTools].map((tool) => tool.name) }, arguments: { type: "object" } }, required: ["toolName", "arguments"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: actions.some(tool => tool.name === "manage_ticket_record"), openWorldHint: false } }, { name: "v_action_status", outputSchema: ACTION_STATUS_OUTPUT_SCHEMA, _meta: { "openai/widgetAccessible": true }, description: "Read the status and actual result of an action prepared by this connected account. Pending or running does not mean completed.", inputSchema: { type: "object", properties: { reference: { type: "string" } }, required: ["reference"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] : [])] });
  }
  if (message.method !== "tools/call") return res.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  try {
    let name = message.params?.name;
    let args = message.params?.arguments ?? {};
    if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool request");
    const opportunityTool = WORKDAY_OPPORTUNITY_TOOLS.find(tool => tool.name === name);
    if (name === TICKET_INVOICE_CANDIDATES_TOOL.name) {
      const output = await handleTicketInvoiceCandidatesTool(args, authorized.session, authorized.scopes);
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: name, targetType: "invoice", toolInput: args, resultStatus: "success" });
      return reply({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: false });
    }
    if (opportunityTool) {
      const output = await handleWorkdayOpportunityTool(opportunityTool.name, args, authorized.session, authorized.scopes);
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: name, targetType: "work_hub", toolInput: args, resultStatus: "success" });
      return reply({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: false });
    }
    if (name === INVOICE_ACTIVITY_TOOL.name) {
      const output = await handleInvoiceActivityTool(args, authorized.session, authorized.scopes);
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: name, targetType: "invoice", toolInput: { basis: output.basis }, resultStatus: "success" });
      return reply({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: false });
    }
    if ([PLAN_EXECUTION_PREPARE_TOOL.name, PLAN_EXECUTION_STATUS_TOOL.name, PLAN_EXECUTION_CANCEL_TOOL.name, PLAN_EXECUTION_CALENDAR_TOOL.name].includes(name)) {
      if (!authorized.grantConsentHash) throw new AssistantOAuthError("access_denied");
      const handler = name === PLAN_EXECUTION_CALENDAR_TOOL.name ? handlePlanExecutionCalendarTool : (input: unknown, session: typeof authorized.session, scopes: string[], grant: string) => handlePlanExecutionTool(name, input, session, scopes, grant);
      const output = await handler(args, authorized.session, authorized.scopes, authorized.grantConsentHash);
      return reply({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output });
    }
    if (requiresFinanceConsent(authorized.session, authorized.scopes, name, args)) return reply(financeConsentChallenge(ASSISTANT_ISSUER, authorized.scopes));
    const fleetTarget = name === "v_prepare_action" ? args.toolName : name;
    if (typeof fleetTarget === "string" && /fleet/.test(fleetTarget)) {
      const missing = (await fleetUpgradeDiscovery(authorized.session, authorized.scopes)).find(item => item.tool.name === fleetTarget);
      if (missing) return reply(fleetConsentChallenge(ASSISTANT_ISSUER, authorized.scopes, missing.scope));
    }
    if (name === "v_connection_context") {
      if (Object.keys(args).length) throw new AssistantOAuthError("invalid_request");
      const session = authorized.session;
      const context = { userId: session.userId, role: session.role, membershipRole: session.membershipRole ?? null, vendorRole: session.vendorRole ?? null, vendorId: session.vendorId ?? null, partnerId: session.partnerId ?? null, activeMembershipId: session.activeMembershipId ?? null, grantedScopes: authorized.scopes, operationalAccessVerified: false };
      await writeAskVActionAudit({ session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: name, targetType: "profile", toolInput: {}, resultStatus: "success" });
      return reply({ content: [{ type: "text", text: JSON.stringify(context) }], isError: false });
    }
    if (name === FLEET_DEVICE_TOOL.name) {
      requireChatGptReadableTool(authorized.session, authorized.scopes, "query_fleet_run_detail");
      if (!authorized.grantConsentHash || Object.keys(args).some(key => key !== "runId")) throw new AssistantOAuthError("invalid_request");
      const handoff = fleetDeviceHandoff(authorized.session, authorized.grantConsentHash, args.runId);
      const result = JSON.parse(await runTool("query_fleet_run_detail", { runId: handoff.runId }, authorized.session, ""));
      if (!result || result.id !== handoff.runId || result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
      return reply({ content: [{ type: "text", text: JSON.stringify({ deviceUrl: ASSISTANT_ISSUER + "/device/fleet/" + envelope(handoff), runId: handoff.runId, entrySaved: false, deviceCaptureStarted: false, nativeAppOpened: false }) }], isError: false });
    }
    if (name === GATE_DEVICE_TOOL.name) {
      requireChatGptReadableTool(authorized.session, authorized.scopes, "query_gate_change_over");
      if (!authorized.grantConsentHash || Object.keys(args).some(key => key !== "stationId")) throw new AssistantOAuthError("invalid_request");
      const handoff = gateDeviceHandoff(authorized.session, authorized.grantConsentHash, args.stationId);
      const result = JSON.parse(await runTool("query_gate_change_over", { stationId: handoff.stationId }, authorized.session, ""));
      if (!result || result.station?.id !== handoff.stationId || result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
      return reply({ content: [{ type: "text", text: JSON.stringify({ deviceUrl: ASSISTANT_ISSUER + "/device/gate/" + envelope(handoff), stationId: handoff.stationId, handoffTransferred: false }) }], isError: false });
    }
    if (name === TICKET_DEVICE_TOOL.name) {
      const tool = requireChatGptReadableTool(authorized.session, authorized.scopes, "query_ticket_detail");
      if (!authorized.grantConsentHash || Object.keys(args).some(key => !["ticketId", "entry"].includes(key))) throw new AssistantOAuthError("invalid_request");
      const handoff = ticketDeviceHandoff(authorized.session, authorized.grantConsentHash, args.ticketId, args.entry);
      const result = JSON.parse(await runTool(tool.name, { ticketId: handoff.ticketId }, authorized.session, ""));
      if (!result || result.ticketId !== handoff.ticketId || result.error || result.ok === false) throw new AssistantOAuthError("access_denied");
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: tool.name, targetType: "ticket", toolInput: { ticketId: handoff.ticketId }, resultStatus: "success" });
      return reply({ content: [{ type: "text", text: JSON.stringify({ deviceUrl: ASSISTANT_ISSUER + "/device/tickets/" + envelope(handoff), ticketId: handoff.ticketId, entry: handoff.entry, entrySaved: false, deviceCaptureStarted: false, message: "Complete the requested entry on this device screen. Its editing permissions remain authoritative. Read back the saved ticket before claiming completion." }) }], isError: false });
    }
    if (name === "v_resume_work_plan" || name === "v_run_work_plan_read") {
      if (Object.keys(args).some(key => !(name === "v_run_work_plan_read" ? ["taskId", "stepId", "toolArguments"] : ["taskId"]).includes(key)) || typeof args.taskId !== "string") throw new Error("Invalid plan request");
      requireChatGptReadableTool(authorized.session, authorized.scopes, "list_work_hub_tasks");
      const session = authorized.session;
      const owner = session.vendorId ? { type: "vendor", id: session.vendorId } : session.partnerId ? { type: "partner", id: session.partnerId } : null;
      if (!owner || !session.userId) throw new Error("Plan company unavailable");
      const raw = await authorizedExactPlanTask(session, authorized.scopes, args.taskId);
      const tools = [...chatGptReadableTools(session, authorized.scopes), ...planOperationTools(chatGptActionTools(session, authorized.scopes))];
      const output = resumedWorkPlan(raw, args.taskId, { userId: session.userId, organizationKey: owner.type + ":" + owner.id }, new Set([...tools.map(tool => tool.name), ...availablePlanReadNames(session, authorized.scopes)]), Date.now(), verifyPlanCompletions);
      await writeAskVActionAudit({ session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: "list_work_hub_tasks", targetType: "task", toolInput: { taskId: args.taskId }, toolOutput: { taskId: output.taskId, taskVersion: output.taskVersion }, resultStatus: "success" });
      if (name === "v_run_work_plan_read") {
        if (typeof args.stepId !== "string") throw new Error("Missing plan step");
        const requests = plannedReadRequests(output, args.stepId, args.toolArguments, availablePlanReadNames(session, authorized.scopes));
        const results = [];
        for (const request of requests) {
          const opportunity = availableWorkdayOpportunityTools(session, authorized.scopes).find(tool => tool.name === request.name);
          const invoiceCandidates = request.name === TICKET_INVOICE_CANDIDATES_TOOL.name && ticketInvoiceCandidatesAvailable(session, authorized.scopes);
          const tool = request.name === INVOICE_ACTIVITY_TOOL.name && invoiceActivityAvailable(session, authorized.scopes)
            ? { name: INVOICE_ACTIVITY_TOOL.name, auditTarget: "invoice" as const }
            : invoiceCandidates ? { name: TICKET_INVOICE_CANDIDATES_TOOL.name, auditTarget: "invoice" as const }
            : opportunity ? { name: opportunity.name, auditTarget: "work_hub" as const }
            : requireChatGptReadableTool(session, authorized.scopes, request.name);
          let result: unknown;
          try {
            result = tool.name === INVOICE_ACTIVITY_TOOL.name
              ? await handleInvoiceActivityTool(request.arguments, session, authorized.scopes)
              : invoiceCandidates ? await handleTicketInvoiceCandidatesTool(request.arguments, session, authorized.scopes)
              : opportunity ? await handleWorkdayOpportunityTool(opportunity.name, request.arguments, session, authorized.scopes)
              : chatGptReadToolOutput(tool.name, JSON.parse(await runTool(tool.name, request.arguments, session, "")));
          } catch {
            // Preserve earlier reads without exposing internal/provider exception details.
            result = { ok: false, error: "This planned lookup failed. Its result is unavailable; retry this lookup before treating the step as complete." };
          }
          const failed = !!(result as { error?: unknown })?.error || (result as { ok?: boolean })?.ok === false;
          await writeAskVActionAudit({ session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: tool.name, targetType: tool.auditTarget, toolInput: request.arguments, toolOutput: result, resultStatus: failed ? "failure" : "success" });
          results.push({ toolName: tool.name, result });
        }
        const checkpointReceipt = envelope({ kind: "plan-read-checkpoint", id: randomUUID(), userId: session.userId, organizationKey: owner.type + ":" + owner.id,
          taskId: output.taskId, taskVersion: output.taskVersion, planVersion: output.plan.version, stepId: args.stepId,
          observedAt: new Date().toISOString(), expires: Date.now() + 300_000,
          observations: results.map(row => ({ toolName: row.toolName, failed: !!(row.result as { error?: unknown })?.error || (row.result as { ok?: boolean })?.ok === false, resultHash: createHash("sha256").update(JSON.stringify(row.result)).digest("hex") })) });
        const executed = { taskId: output.taskId, stepId: args.stepId, results, executionStarted: true, checkpointSaved: false, checkpointReceipt };
        return reply({ content: [{ type: "text", text: JSON.stringify(executed) }], structuredContent: executed });
      }
      return reply({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output });
    }
    if (name === "v_list_specialists") {
      if (Object.keys(args).length) throw new Error("Specialist directory takes no arguments");
      const reads = chatGptReadableTools(authorized.session, authorized.scopes);
      let hasGateSites = false;
      if (reads.some(tool => tool.name === "query_gate_stations")) {
        const gates = JSON.parse(await runTool("query_gate_stations", {}, authorized.session, ""));
        hasGateSites = !gates.error && Array.isArray(gates.sites) && gates.sites.length > 0;
        await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: "query_gate_stations", targetType: "site", toolInput: {}, toolOutput: gates, resultStatus: gates.error ? "failure" : "success" });
      }
      const result = specialistDirectory(reads, exposedOperationTools(chatGptActionTools(authorized.session, authorized.scopes)), { hasGateSites });
      return reply({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    }
    if (name === "v_submit_panel_action") {
      if (typeof args.reference !== "string" || assistantTokenUserId(args.reference) !== authorized.session.userId) throw new AssistantOAuthError("access_denied");
      const proof = readEnvelope(args.proof) as unknown as { kind: string; tokenHash: string; fingerprint: string; nonce: string; expires: number };
      if (proof.kind !== "component-action" || proof.tokenHash !== assistantTokenHash(args.reference) || typeof proof.fingerprint !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof.nonce ?? "")) throw new AssistantOAuthError("access_denied");
      const action = await withAssistantGrants(authorized.session.userId!, async (grants, database) => {
        const grant = grants.find(item => assistantAccessHashMatches(item, authorized.grantAccessHash));
        const candidate = grant?.actions?.find(item => item.tokenHash === proof.tokenHash);
        if (!grant || !candidate || candidate.fingerprint !== proof.fingerprint || (!unresolved(candidate) && candidate.expiresAt <= Date.now()) || needsLocation(candidate.toolName, candidate.arguments)) throw new AssistantOAuthError("access_denied");
        const current = await validateAssistantSession(grant.session, database);
        if (!chatGptActionTools(current, grant.scopes).some(tool => tool.name === candidate.toolName)) throw new AssistantOAuthError("access_denied");
        await reconcileAction(candidate, current, database, grant.scopes);
        return structuredClone(candidate);
      });
      const reserved = { token: args.reference, session: authorized.session, action };
      if (action.state === "pending") {
        const operationHex = action.tokenHash.slice(0, 32);
        const input = { ...action.arguments, operationId: `${operationHex.slice(0, 8)}-${operationHex.slice(8, 12)}-4${operationHex.slice(13, 16)}-8${operationHex.slice(17, 20)}-${operationHex.slice(20, 32)}` };
        await executePreparedAction(reserved, input, { grantAccessHash: authorized.grantAccessHash, fingerprint: proof.fingerprint, expires: proof.expires });
      }
      const saved = await withAssistantGrants(authorized.session.userId!, async (grants, database) => {
        const grant = grants.find(item => assistantAccessHashMatches(item, authorized.grantAccessHash));
        const candidate = grant?.actions?.find(item => item.tokenHash === proof.tokenHash);
        if (!grant || !candidate) throw new AssistantOAuthError("access_denied");
        await validateAssistantSession(grant.session, database);
        return structuredClone(candidate);
      });
      const result = saved.result ? JSON.parse(saved.result) : null;
      const outcome = { reference: args.reference, status: saved.state, ok: saved.state === "completed" && !result?.error && result?.ok !== false, result };
      return reply({ structuredContent: outcome, content: [{ type: "text", text: JSON.stringify(outcome) }], isError: saved.state === "completed" && !outcome.ok });
    }
    if (name === "v_show_workspace") {
      const allowedNames = new Set(chatGptReadableTools(authorized.session, authorized.scopes).map(tool => tool.name));
      const upgrades = typeof args.view === "string" && args.view.startsWith("fleet")
        ? await fleetUpgradeDiscovery(authorized.session, authorized.scopes) : [];
      const request = workspaceRequest(args, new Set([...allowedNames, ...upgrades.filter(item => !item.tool.mutating).map(item => item.tool.name)]));
      const missing = upgrades.find(item => item.tool.name === request.sourceTool);
      if (missing) return reply(fleetConsentChallenge(ASSISTANT_ISSUER, authorized.scopes, missing.scope));
      const source = requireChatGptReadableTool(authorized.session, authorized.scopes, request.sourceTool);
      const raw = chatGptReadToolOutput(source.name, JSON.parse(await runTool(source.name, request.sourceArguments, authorized.session, "")));
      const output = workspaceOutput(request.view, source.name, request.sourceArguments, raw);
      if (output.fleetMap) output.fleetMap.publicToken = publicMapConfig(process.env).mapboxAccessToken;
      output.availableViews = [];
      if (allowedNames.has("get_work_hub_briefing")) output.availableViews.push("my_workday");
      if (allowedNames.has("get_work_hub_calendar")) output.availableViews.push("work_calendar");
      if (allowedNames.has("lookup_user_progress")) output.availableViews.push("onboarding");
      if (allowedNames.has("query_tickets")) output.availableViews.push("tickets");
      if (allowedNames.has("query_notifications")) output.availableViews.push("notifications");
      if (allowedNames.has("query_fleet_briefing")) {
        const fleet = request.sourceTool === "query_fleet_briefing" ? raw : JSON.parse(await runTool("query_fleet_capabilities", {}, authorized.session, ""));
        if (request.sourceTool !== "query_fleet_briefing") await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: "query_fleet_capabilities", targetType: "work_hub", toolInput: {}, toolOutput: fleet, resultStatus: fleet.error ? "failure" : "success" });
        if (!fleet.error && (fleet.roles?.length || fleet.capabilities?.canSetup)) {
          output.availableViews.push("fleet", "fleet_map");
          if (allowedNames.has("query_fleet_run_eta")) output.availableViews.push("fleet_eta");
          if (allowedNames.has("query_fleet_evidence")) output.availableViews.push("fleet_evidence");
          if (allowedNames.has("query_fleet_review_packet")) output.availableViews.push("fleet_review");
          if (allowedNames.has("query_fleet_report")) output.availableViews.push("fleet_reports");
          if ((fleet.capabilities?.canMaintain || fleet.capabilities?.canReportDefect) && allowedNames.has("query_fleet_maintenance")) output.availableViews.push("fleet_maintenance");
          if (fleet.capabilities?.canDispatch && allowedNames.has("query_fleet_resources")) output.availableViews.push("fleet_dispatch");
        }
      } else if (allowedNames.has("query_field_trips")) output.availableViews.push("fleet");
      if (allowedNames.has("query_asset_custody")) output.availableViews.push("inventory");
      if (allowedNames.has("query_fleet_site_activity")) output.availableViews.push("fleet_site");
      if (allowedNames.has("query_gate_stations")) {
        const gates = request.view === "gate_board" ? raw : JSON.parse(await runTool("query_gate_stations", {}, authorized.session, ""));
        if (request.view === "gate_board" || (Array.isArray(gates.sites) && gates.sites.length > 0)) output.availableViews.push("gate_board");
        if (request.view !== "gate_board") await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: "query_gate_stations", targetType: "site", toolInput: {}, toolOutput: gates, resultStatus: gates.error ? "failure" : "success" });
      }
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: source.name, targetType: source.auditTarget, toolInput: request.sourceArguments, toolOutput: raw, resultStatus: "success" });
      return reply({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: false });
    }
    if (name === "v_action_status") {
      if (assistantTokenUserId(args.reference) !== authorized.session.userId) throw new Error("Action unavailable");
      const status = await withAssistantGrants(authorized.session.userId!, async (grants, database) => {
        const grant = grants.find((item) => assistantAccessHashMatches(item, authorized.grantAccessHash));
        if (!grant) throw new Error("Action unavailable");
        const owner = grants.find((item) => organizationKeyFromSession(item.session) === organizationKeyFromSession(grant.session) && item.actions?.some((action) => action.tokenHash === assistantTokenHash(args.reference)));
        const action = owner?.actions?.find((item) => item.tokenHash === assistantTokenHash(args.reference));
        if (!action || (!unresolved(action) && action.expiresAt <= Date.now())) throw new Error("Action unavailable");
        await reconcileAction(action, authorized.session, database, grant.scopes);
        return { state: action.state, toolName: action.toolName, result: action.result ? JSON.parse(action.result) : null };
      });
      return reply({ content: [{ type: "text", text: JSON.stringify(status) }], structuredContent: status, isError: false });
    }
    const permittedActions = chatGptActionTools(authorized.session, authorized.scopes);
    const operation = resolveOperationTool(name, args, permittedActions);
    name = operation.name;
    args = operation.input;
    let planCompletion: AssistantPreparedAction['planCompletion'];
    if (name === 'v_prepare_work_plan_completion') {
      const request = planCompletionRequestSchema.parse(args);
      const observedAt = Date.now();
      args = await currentPlanCompletion(authorized.session, authorized.scopes, request, observedAt);
      planCompletion = { request, observedAt };
      name = 'manage_work_hub_task';
    }
    if (name === 'v_prepare_work_plan_read_checkpoint') {
      if (!permittedActions.some(tool => tool.name === 'manage_work_hub_task')) throw new Error('Action unavailable');
      if (Object.keys(args).some(key => key !== 'receipt')) throw new Error('Invalid checkpoint request');
      requireChatGptReadableTool(authorized.session, authorized.scopes, 'list_work_hub_tasks');
      const session = authorized.session;
      const owner = session.vendorId ? { type: 'vendor' as const, id: session.vendorId } : session.partnerId ? { type: 'partner' as const, id: session.partnerId } : null;
      if (!owner || !session.userId) throw new Error('Plan company unavailable');
      const receipt = planReadReceiptSchema.parse(readEnvelope(args.receipt));
      const raw = await authorizedExactPlanTask(session, authorized.scopes, receipt.taskId);
      args = preparePlanReadCheckpoint(raw, receipt, { userId: session.userId, organizationKey: owner.type + ':' + owner.id }, owner, availablePlanReadNames(session, authorized.scopes), Date.now(), verifyPlanCompletions);
      name = 'manage_work_hub_task';
    }
    if (name === 'v_prepare_work_plan_control') {
      if (!permittedActions.some(tool => tool.name === 'manage_work_hub_task')) throw new Error('Action unavailable');
      requireChatGptReadableTool(authorized.session, authorized.scopes, 'list_work_hub_tasks');
      const session = authorized.session;
      const owner = session.vendorId ? { type: 'vendor' as const, id: session.vendorId } : session.partnerId ? { type: 'partner' as const, id: session.partnerId } : null;
      if (!owner || !session.userId) throw new Error('Plan company unavailable');
      const raw = await authorizedExactPlanTask(session, authorized.scopes, args.taskId);
      args = prepareWorkPlanControl(raw, args, { userId: session.userId, organizationKey: owner.type + ':' + owner.id }, owner, new Set([...availablePlanReadNames(session, authorized.scopes), ...planOperationTools(permittedActions).map(tool => tool.name)]), verifyPlanCompletions);
      await writeAskVActionAudit({ session, clientSurface: 'api', inputMode: 'web_text', provider: 'chatgpt_mcp', toolName: 'list_work_hub_tasks', targetType: 'task', toolInput: { taskId: args.taskId }, toolOutput: { taskId: args.taskId, taskVersion: args.expectedVersion }, resultStatus: 'success' });
      name = 'manage_work_hub_task';
    }
    if (name === "v_prepare_work_plan") {
      if (!permittedActions.some(tool => tool.name === "manage_work_hub_task")) throw new Error("Action unavailable");
      const session = authorized.session;
      const owner = session.vendorId ? { type: "vendor" as const, id: session.vendorId } : session.partnerId ? { type: "partner" as const, id: session.partnerId } : null;
      if (!owner || !session.userId) throw new Error("Plan company unavailable");
      args = prepareWorkPlan(args, { userId: session.userId, organizationKey: owner.type + ":" + owner.id }, owner, new Set([...availablePlanReadNames(session, authorized.scopes), ...planOperationTools(permittedActions).map(tool => tool.name)]));
      name = "manage_work_hub_task";
    }
    if (name === "v_prepare_action" || permittedActions.some((tool) => tool.name === name)) {
      const tool = permittedActions.find((candidate) => candidate.name === (name === "v_prepare_action" ? args.toolName : name));
      const suppliedInput = name === "v_prepare_action" ? args.arguments : args;
      if (!tool || !suppliedInput || typeof suppliedInput !== "object" || Array.isArray(suppliedInput)) throw new Error("Action unavailable");
      const input = sanitizeChatGptActionInput(tool.name, Object.fromEntries(Object.entries(suppliedInput).filter(([key]) => !SERVER_ACTION_FIELDS.has(key))));
      if (JSON.stringify(input).length > 20_000) throw new Error("Action too large");
      validateChatGptActionInput(tool.name, input);
      const actionToken = `${authorized.session.userId}.${randomBytes(32).toString("base64url")}`;
      const fingerprint = mutationIdempotencyKey(authorized.session.userId!, tool.name, input);
      const prepared = await withAssistantGrants(authorized.session.userId!, async (grants) => {
        const grant = grants.find((item) => assistantAccessHashMatches(item, authorized.grantAccessHash));
        if (!grant) throw new AssistantOAuthError("access_denied");
        grant.actions = (grant.actions ?? []).filter((action) => unresolved(action) || action.expiresAt > Date.now());
        const prior = grants.filter((item) => organizationKeyFromSession(item.session) === organizationKeyFromSession(grant.session)).flatMap((item) => (item.actions ?? []).filter((action) => !item.revoked || unresolved(action))).find((action) => action.fingerprint === fingerprint && (unresolved(action) || action.createdAt > Date.now() - 300_000) && action.reference);
        if (prior) return { reference: prior.reference!, state: prior.state, result: prior.result, panelProof: grant.actions?.includes(prior) && prior.state === "pending" ? envelope({ kind: "component-action", tokenHash: prior.tokenHash, fingerprint: prior.fingerprint, nonce: randomBytes(32).toString("base64url"), expires: prior.expiresAt }) : undefined };
        if (grant.actions.length >= 20) throw new Error("Too many pending actions");
        grant.actions.push({ reference: actionToken, tokenHash: assistantTokenHash(actionToken), toolName: tool.name, arguments: input, fingerprint, createdAt: Date.now(), expiresAt: Date.now() + 300_000, turnId: randomBytes(6).readUIntBE(0, 6), state: "pending", ...(planCompletion ? { planCompletion } : {}) });
        return { reference: actionToken, state: "pending", result: undefined, panelProof: envelope({ kind: "component-action", tokenHash: assistantTokenHash(actionToken), fingerprint, nonce: randomBytes(32).toString("base64url"), expires: Date.now() + 300_000 }) };
      });
      const previousResult = prepared.result ? JSON.parse(prepared.result) : null;
      const text = JSON.stringify({ ok: prepared.state === "completed" && !previousResult?.error && previousResult?.ok !== false, requiresConfirmation: prepared.state === "pending", status: prepared.state, toolName: tool.name, reference: prepared.reference, approvalUrl: `${ASSISTANT_ISSUER}/actions/${prepared.reference}`, result: previousResult, message: prepared.state === "pending" ? "The change is prepared. Complete its required authorization in your VNDRLY account; it has not been submitted." : "This matching action was already submitted. Inspect its status and actual result." });
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: tool.name, targetType: tool.auditTarget, toolInput: chatGptActionAuditInput(tool.name, input), resultStatus: "requires_confirmation" });
      return reply({ content: [{ type: "text", text }], structuredContent: JSON.parse(text), isError: false, ...(prepared.state === "pending" && prepared.panelProof ? { _meta: { componentApproval: { toolName: tool.name, reference: prepared.reference, proof: needsLocation(tool.name, input) ? undefined : prepared.panelProof, arguments: input, requiresLocation: needsLocation(tool.name, input), approvalUrl: `${ASSISTANT_ISSUER}/actions/${prepared.reference}` } } } : {}) });
    }
    const tool = requireChatGptReadableTool(authorized.session, authorized.scopes, name);
    let readOutput = chatGptReadToolOutput(name, JSON.parse(await runTool(name, args, authorized.session, "")));
    if (name === "deep_link_to" && args.screen === "work-hub-files" && (readOutput as { url?: string })?.url === "/work-hub/files") {
      if (!authorized.grantConsentHash) throw new AssistantOAuthError("access_denied");
      readOutput = { ...(readOutput as object), url: `${ASSISTANT_ISSUER}/device/files/${envelope(fileDeviceHandoff(authorized.session, authorized.grantConsentHash))}`,
        completed: false, message: "Use this account-bound device link to select and upload the actual file. This link does not upload bytes. After the device reports success, read the file and versions through this same ChatGPT account before claiming completion." };
    }
    if (name === "get_work_hub_meeting_catchup" && !(readOutput as { error?: unknown; ok?: boolean })?.error && (readOutput as { ok?: boolean })?.ok !== false) {
      if (!authorized.grantConsentHash || typeof args.occurrenceId !== "string") throw new AssistantOAuthError("access_denied");
      readOutput = { ...(readOutput as object), deviceUrl: ASSISTANT_ISSUER + "/device/meetings/" + envelope(meetingDeviceHandoff(authorized.session, authorized.grantConsentHash, args.occurrenceId)), deviceCaptureStarted: false,
        deviceMessage: "Open this account-bound link for the saved meeting. Joining, microphone/camera permission, and permitted recording must be completed on that device. This link does not start capture or transcription." };
    }
    const text = JSON.stringify(readOutput);
    const output = JSON.parse(text);
    const failed = Boolean(output?.error || output?.ok === false);
    await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: name, targetType: tool.auditTarget, toolInput: args, toolOutput: output, resultStatus: failed ? "failure" : "success" });
    return reply({ content: [{ type: "text", text }], isError: failed });
  } catch {
    try {
      await writeAskVActionAudit({ session: authorized.session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: typeof message.params?.name === "string" ? message.params.name.slice(0, 120) : "invalid_tool", toolInput: { rejected: true }, resultStatus: "failure", errorCode: "assistant_connection.tool_rejected" });
    } catch { /* Do not expose data if its audit could not be persisted. */ }
    return reply({ content: [{ type: "text", text: "V could not complete this live tool request. Check the account permissions and required fields." }], isError: true });
  }
});
router.all("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
const needsLocation = (toolName: string, input: Record<string, unknown> = {}) => ["confirm_visitor_check_in", "confirm_visitor_check_out", "start_paid_travel", "set_ticket_lifecycle", "close_ticket_for_review"].includes(toolName) || (toolName === "confirm_field_trips_action" && input.action === "location");
async function authorizedExactPlanTask(session: SessionPayload, scopes: string[], taskId: unknown) {
  requireChatGptReadableTool(session, scopes, 'list_work_hub_tasks');
  const owner = session.vendorId ? `vendor:${session.vendorId}` : session.partnerId ? `partner:${session.partnerId}` : null;
  if (!owner || !session.userId || typeof taskId !== 'string') throw Error('Plan company unavailable');
  return [await readExactPlanTask(path => callNaturalVoiceDomainApi(path, 'GET', {}, session), taskId, { userId: session.userId, organizationKey: owner })];
}
function availablePlanReadNames(session: SessionPayload, scopes: string[]) {
  return new Set([...chatGptReadableTools(session, scopes).map(tool => tool.name), ...availableWorkdayOpportunityTools(session, scopes).map(tool => tool.name), ...(invoiceActivityAvailable(session, scopes) ? [INVOICE_ACTIVITY_TOOL.name] : []), ...(ticketInvoiceCandidatesAvailable(session, scopes) ? [TICKET_INVOICE_CANDIDATES_TOOL.name] : [])]);
}
async function currentPlanCompletion(session: SessionPayload, scopes: string[], input: unknown, observedAt: number) {
  const request = planCompletionRequestSchema.parse(input);
  const reads = chatGptReadableTools(session, scopes);
  const actions = chatGptActionTools(session, scopes);
  if (!session.userId || !actions.some(tool => tool.name === 'manage_work_hub_task')) throw Error('Action unavailable');
  requireChatGptReadableTool(session, scopes, 'list_work_hub_tasks');
  const owner = session.vendorId ? { type: 'vendor' as const, id: session.vendorId } : session.partnerId ? { type: 'partner' as const, id: session.partnerId } : null;
  if (!owner) throw Error('Plan company unavailable');
  const tasks = await authorizedExactPlanTask(session, scopes, request.taskId);
  const available = new Set([...availablePlanReadNames(session, scopes), ...planOperationTools(actions).map(tool => tool.name)]);
  const resumed = resumedWorkPlan(tasks, request.taskId, { userId: session.userId, organizationKey: owner.type + ':' + owner.id }, available, Date.now(), verifyPlanCompletions);
  const step = resumed.plan.steps.find(row => row.id === request.stepId);
  const evidence: { receipt?: unknown; action?: unknown; ticket?: unknown; resource?: unknown } = {};
  if (request.receipt) evidence.receipt = readEnvelope(request.receipt);
  if (request.actionReference) {
    if (assistantTokenUserId(request.actionReference) !== session.userId) throw Error('Action unavailable');
    evidence.action = await withAssistantGrants(session.userId, async grants => {
      const action = grants.filter(grant => organizationKeyFromSession(grant.session) === organizationKeyFromSession(session)).flatMap(grant => grant.actions ?? []).find(action => action.tokenHash === assistantTokenHash(request.actionReference!));
      if (!action) throw Error('Saved action unavailable');
      return structuredClone(action);
    });
    if (step?.completion?.kind === 'canonical_ticket_action_saved') {
      requireChatGptReadableTool(session, scopes, 'query_ticket_detail');
      evidence.ticket = JSON.parse(await runTool('query_ticket_detail', { ticketId: step.completion.ticketId }, session, ''));
    } else if (step?.completion?.kind === 'canonical_work_hub_task_action_saved') {
      requireChatGptReadableTool(session, scopes, 'list_work_hub_tasks');
      const resourceId = savedWorkHubTaskResourceId(evidence.action);
      evidence.resource = await callNaturalVoiceDomainApi(`/work-hub/search/items/task/${resourceId}`, 'GET', {}, session);
    } else if (step?.completion?.kind === 'canonical_work_hub_meeting_action_saved') {
      requireChatGptReadableTool(session, scopes, 'get_work_hub_calendar_item');
      const resourceId = savedWorkHubMeetingResourceId(evidence.action);
      evidence.resource = await callNaturalVoiceDomainApi(`/work-hub/calendar/items/meeting/${resourceId}`, 'GET', {}, session);
    } else if (step?.completion?.kind === 'canonical_gate_visit_action_saved') {
      requireChatGptReadableTool(session, scopes, 'search_gate_history');
      const resourceId = savedGateVisitResourceId(evidence.action);
      evidence.resource = await callNaturalVoiceDomainApi(`/visits/${resourceId}`, 'GET', {}, session);
    } else if (step?.completion?.kind === 'canonical_work_hub_message_saved') {
      requireChatGptReadableTool(session,scopes,'list_work_hub_messages');
      const target=savedWorkHubMessageTarget(evidence.action);
      evidence.resource=await callNaturalVoiceDomainApi(`/work-hub/channels/${target.channelId}/messages/${target.messageId}`,'GET',{},session);
    } else throw Error('Unsupported plan completion');
  }
  return preparePlanCompletion(tasks, request, { userId: session.userId, organizationKey: owner.type + ':' + owner.id }, owner, available, availablePlanReadNames(session, scopes), evidence, SESSION_SECRET, Date.now(), observedAt);
}
const unresolved = (action: AssistantPreparedAction) => action.state === "running" || action.state === "outcome_unknown";
async function reconcileAction(action: AssistantPreparedAction, session: import("../lib/session").SessionPayload, database: Omit<typeof import("@workspace/db").db, "$client">, scopes: string[]) {
  if (!unresolved(action) || !action.executionFingerprint) return;
  let result = await readPersistentAskVMutationResult({ userId: session.userId!, organizationKey: organizationKeyFromSession(session), sessionId: `conversation:${action.turnId}`, key: `chatgpt:${action.tokenHash}`, fingerprint: action.executionFingerprint }, database);
  if (result === null && action.toolName === "confirm_operations_displays_action") {
    const receipt = await recoverOperationsDisplayAction(action, session, scopes);
    if (receipt !== null) result = JSON.stringify(receipt);
  }
  if (result === null && action.toolName === "reschedule_work_hub_meeting") {
    const receipt = await recoverCalendarReschedule(action, session, scopes);
    if (receipt !== null) result = JSON.stringify(receipt);
  }
  if (result === null && action.toolName === "respond_work_hub_meeting_invitation") {
    const receipt = await recoverCalendarResponse(action, session, scopes);
    if (receipt !== null) result = JSON.stringify(receipt);
  }
  if (result !== null) { action.state = "completed"; action.result = JSON.stringify(chatGptActionResult(action.toolName, JSON.parse(result))); action.arguments = chatGptActionAuditInput(action.toolName, action.arguments); action.expiresAt = Date.now() + 3600_000; }
  else if (action.createdAt < Date.now() - 300_000) action.state = "outcome_unknown";
}
async function authorizedAction(req: Request) {
  const token = String(req.params.actionToken ?? "");
  const userId = assistantTokenUserId(token);
  const session = getSessionFromRequest(req);
  if (!userId || !session || session.userId !== userId) throw new AssistantOAuthError("access_denied");
  const current = await validateAssistantSession(session);
  const found = await withAssistantGrants(userId, async (grants, database) => {
    for (const grant of grants) {
      const action = grant.actions?.find((candidate) => candidate.tokenHash === assistantTokenHash(token));
      if (!action) continue;
      if (grant.revoked || (!unresolved(action) && action.expiresAt <= Date.now()) || organizationKeyFromSession(current) !== organizationKeyFromSession(grant.session)) throw new AssistantOAuthError("access_denied");
      await validateAssistantSession(grant.session, database);
      if (!chatGptActionTools(current, grant.scopes).some((tool) => tool.name === action.toolName)) throw new AssistantOAuthError("access_denied");
      await reconcileAction(action, current, database, grant.scopes);
      return structuredClone(action);
    }
    throw new AssistantOAuthError("access_denied");
  });
  return { token, session: current, action: found };
}
async function executePreparedAction(reserved: Awaited<ReturnType<typeof authorizedAction>>, input: Record<string, unknown>, component?: { grantAccessHash: string; fingerprint: string; expires: number }) {
  let claimed = false;
  try {
    validateChatGptActionInput(reserved.action.toolName, input);
    const claim = await withAssistantGrants(reserved.session.userId!, async (grants, database) => {
      const grant = grants.find(item => item.actions?.some(action => action.tokenHash === reserved.action.tokenHash));
      if (!grant || grant.revoked || organizationKeyFromSession(grant.session) !== organizationKeyFromSession(reserved.session)) throw new AssistantOAuthError("access_denied");
      const current = await validateAssistantSession(grant.session, database);
      const action = grant.actions!.find(item => item.tokenHash === reserved.action.tokenHash)!;
      const tool = chatGptActionTools(current, grant.scopes).find(item => item.name === action.toolName);
      if (!tool) throw new AssistantOAuthError("access_denied");
      if (component && (!assistantAccessHashMatches(grant, component.grantAccessHash) || component.fingerprint !== action.fingerprint || component.expires <= Date.now() || needsLocation(action.toolName, action.arguments))) throw new AssistantOAuthError("access_denied");
      if (action.state !== "pending") return null;
      if (action.expiresAt <= Date.now()) throw new AssistantOAuthError("access_denied");
      action.state = "running";
      action.executionFingerprint = mutationIdempotencyKey(current.userId!, action.toolName, input);
      action.expiresAt = Date.now() + 3600_000;
      return { session: current, tool, scopes: grant.scopes, planCompletion: action.planCompletion };
    });
    if (!claim) return null;
    claimed = true;
    const { session, tool } = claim;
    if (claim.planCompletion) {
      const checked = await currentPlanCompletion(session, claim.scopes, claim.planCompletion.request, claim.planCompletion.observedAt);
      const preparedInput = Object.fromEntries(Object.entries(input).filter(([key]) => !SERVER_ACTION_FIELDS.has(key)));
      if (JSON.stringify(checked) !== JSON.stringify(preparedInput)) throw Error('Plan completion changed before approval');
    }
    askvPendingConfirmations.set({ userId: session.userId!, organizationKey: organizationKeyFromSession(session), sessionId: `conversation:${reserved.action.turnId}`, contextKey: reserved.action.tokenHash, toolName: tool.name, arguments: input, idempotencyKey: `chatgpt:${reserved.action.tokenHash}` });
    const result = await runBoundTypedAskVTool({ name: tool.name, input, session, conversationId: reserved.action.turnId, turnId: reserved.action.turnId, contextKey: reserved.action.tokenHash, phrase: "confirm", execute: async authorizedInput => JSON.stringify(chatGptActionResult(tool.name, JSON.parse(await runTool(tool.name, authorizedInput, session, "", false, isTypedWorkHubTool(tool.name))))) });
    const output = chatGptActionResult(tool.name, JSON.parse(result)) as Record<string, unknown>;
    const savedResult = JSON.stringify(output);
    await withAssistantGrants(session.userId!, async grants => {
      const action = grants.flatMap(grant => grant.actions ?? []).find(item => item.tokenHash === reserved.action.tokenHash);
      if (action) { action.state = "completed"; action.result = savedResult; action.arguments = chatGptActionAuditInput(tool.name, action.arguments); action.expiresAt = Date.now() + 3600_000; }
    });
    await writeAskVActionAudit({ session, clientSurface: "api", inputMode: "web_text", provider: "chatgpt_mcp", toolName: tool.name, targetType: tool.auditTarget, toolInput: chatGptActionAuditInput(tool.name, input), toolOutput: output, resultStatus: output?.error || output?.ok === false ? "failure" : "success", confirmationPhrase: component ? "VNDRLY component-mediated action authorization" : "Authenticated VNDRLY action approval" });
    return savedResult;
  } catch (error) {
    if (claimed) {
      try { await withAssistantGrants(reserved.session.userId!, async grants => { const action = grants.flatMap(grant => grant.actions ?? []).find(item => item.tokenHash === reserved.action.tokenHash); if (action?.state === "running") action.state = "outcome_unknown"; }); } catch { /* The durable running claim still prevents a duplicate. */ }
    }
    throw error;
  }
}
router.get("/actions-client.js", (_req, res) => res.type("application/javascript").send(`document.querySelector('form[data-location="required"]')?.addEventListener('submit', function(event) { if (this.dataset.located === 'yes') return; event.preventDefault(); const form = this; const status = document.getElementById('location-status'); status.textContent = 'Getting your current location…'; navigator.geolocation.getCurrentPosition(function(position) { form.elements.latitude.value = position.coords.latitude; form.elements.longitude.value = position.coords.longitude; form.elements.accuracyMeters.value = position.coords.accuracy; form.dataset.located = 'yes'; form.requestSubmit(); }, function() { status.textContent = 'Location permission is required for this VNDRLY action. Enable location and try again.'; }, {enableHighAccuracy:true,timeout:15000,maximumAge:0}); });`));
router.get("/actions/:actionToken", async (req, res) => {
  try {
    const { token, action } = await authorizedAction(req);
    if (action.state === "completed") return page(res, `<h2>Action result</h2><pre>${escape(action.result ?? "Result unavailable")}</pre>`);
    if (action.state === "running") return page(res, "<p>This action is already being processed. Refresh to check its result.</p>");
    if (action.state === "outcome_unknown") return page(res, "<p>This action may already have completed. Check the current VNDRLY record before taking another action. V will not submit it again automatically.</p>");
    const nonce = randomBytes(32).toString("base64url");
    res.cookie("vndrly_assistant_action", envelope({ tokenHash: assistantTokenHash(token), nonce, expires: Date.now() + 300_000 }), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/assistant-connection/actions", maxAge: 300_000 });
    return page(res, `<h2>Approve VNDRLY action</h2><p>${escape(action.toolName.replaceAll("_", " "))}</p><pre>${escape(JSON.stringify(action.arguments, null, 2))}</pre>${action.toolName === "start_paid_travel" ? "<p>This starts paid time with your current location. Continuous trip tracking must be enabled in the VNDRLY mobile app; this browser does not start it.</p>" : ""}<form method="post" data-location="${needsLocation(action.toolName, action.arguments) ? "required" : "optional"}"><input type="hidden" name="nonce" value="${escape(nonce)}"><input type="hidden" name="latitude"><input type="hidden" name="longitude"><input type="hidden" name="accuracyMeters"><button type="submit">Approve and submit</button></form><p id="location-status"></p><script src="/api/assistant-connection/actions-client.js" defer></script>`);
  } catch (error) { return oauthError(res, error); }
});
router.post("/actions/:actionToken", async (req, res) => {
  let reserved: Awaited<ReturnType<typeof authorizedAction>> | undefined;
  try {
    if (req.headers.origin !== origin) throw new AssistantOAuthError("access_denied");
    reserved = await authorizedAction(req);
    const signed = req.cookies?.vndrly_assistant_action;
    // The signed envelope is separate from both staff sessions and OAuth grants.
    const proof = readActionEnvelope(signed);
    if (proof.tokenHash !== assistantTokenHash(reserved.token) || proof.nonce !== req.body.nonce) throw new AssistantOAuthError("access_denied");
    const input = { ...reserved.action.arguments };
    // Stable server-owned domain operation ID; model keys cannot select replays.
    const operationHex = reserved.action.tokenHash.slice(0, 32);
    input.operationId = `${operationHex.slice(0, 8)}-${operationHex.slice(8, 12)}-4${operationHex.slice(13, 16)}-8${operationHex.slice(17, 20)}-${operationHex.slice(20, 32)}`;
    validateChatGptActionInput(reserved.action.toolName, input);
    if (needsLocation(reserved.action.toolName, input)) {
      const latitude = Number(req.body.latitude), longitude = Number(req.body.longitude), accuracyMeters = Number(req.body.accuracyMeters);
      if (!req.body.latitude || !req.body.longitude || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) throw new AssistantOAuthError("invalid_request");
      if (reserved.action.toolName === "confirm_field_trips_action") {
        input.payload = { ...(input.payload as Record<string, unknown>), latitude, longitude, accuracyMeters, speedMps: null, recordedAt: new Date().toISOString() };
      } else Object.assign(input, { latitude, longitude, accuracyMeters });
      if (reserved.action.toolName === "start_paid_travel") {
        delete input.latitude; delete input.longitude; delete input.accuracyMeters;
        Object.assign(input, { startLatitude: latitude, startLongitude: longitude, locationSharingActive: false });
      }
    }
    const savedResult = await executePreparedAction(reserved, input);
    if (savedResult === null) return page(res, "<p>This action was already submitted. Refresh its approval page for the result.</p>");
    res.clearCookie("vndrly_assistant_action", { path: "/api/assistant-connection/actions", secure: true, sameSite: "lax" });
    return page(res, `<h2>Action result</h2><pre>${escape(savedResult)}</pre>`);
  } catch (error) {
    return oauthError(res, error);
  }
});
function readActionEnvelope(value: unknown): { tokenHash: string; nonce: string; expires: number } {
  // Reuse the signature/expiry verifier without widening staff-session decoding.
  return readEnvelope(value) as unknown as { tokenHash: string; nonce: string; expires: number };
}
function oauthError(res: Response, error: unknown) {
  return res.status(error instanceof AssistantOAuthError ? 400 : 503).json({ error: error instanceof AssistantOAuthError ? error.code : "temporarily_unavailable" });
}
export default router;
