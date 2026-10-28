import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { connectStart, finishConnect, status, disconnect, withTeamsToken, assertTeamsGeneration, type TeamsSession } from "../work-hub/teams-connection-service";
import { listTeamsCalendar, listTeamsChats, listTeamsMessages, TeamsProviderError, APP_CONFIG_AADSTS } from "../work-hub/teams-graph";
import { logger } from "../lib/logger";
import { deliverTeamsChat } from "../work-hub/teams-chat-send";
import { listMeetings, publishMeeting, syncMeetings } from "../work-hub/teams-meeting-sync";
import { createRateLimiter } from "../lib/rate-limit-factory";

const router: IRouter = Router();
const limiter = createRateLimiter({ resourcePrefix: "TEAMS_CONNECTOR", errorCode: "teams.rate_limited", logKind: "teams.rate_limit.trip", defaultMax: 60, defaultWindowMs: 60000, message: "Please wait before trying Teams again." });
const empty = z.object({}).strict();
const generation = z.string().regex(/^[a-f0-9]{64}$/);
const send = z.object({ operationId: z.uuid(), text: z.string().trim().min(1).max(20000), confirmSend: z.literal(true), expectedGeneration: generation }).strict();
const resourceId = z.string().min(1).max(2048).refine(value => !/[\r\n]/.test(value));
async function actor(req: Request): Promise<TeamsSession> {
  const signed = getSessionFromRequest(req);
  if (!signed?.userId) throw new TeamsProviderError("authentication_required", 401);
  let session;
  try { session = await validateAssistantSession(signed); } catch { throw new TeamsProviderError("authentication_required", 401); }
  if (!await isWorkHubEnabled()) throw new TeamsProviderError("work_hub_disabled", 403);
  if (!session.vendorId && !session.partnerId) throw new TeamsProviderError("organization_required", 403);
  // Cookie-authenticated mutations must originate from this application. OAuth
  // callback is a GET and is separately protected by one-use state and PKCE.
  if (req.method !== "GET") {
    const origin = req.get("origin");
    const expected = process.env.PUBLIC_APP_URL || "https://vndrly.ai";
    if (origin && new URL(origin).origin !== new URL(expected).origin) throw new TeamsProviderError("invalid_origin", 403);
    if (req.get("sec-fetch-site") === "cross-site") throw new TeamsProviderError("invalid_origin", 403);
  }
  return { ...session, userId: signed.userId };
}
function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "invalid_request", message: "Check the request fields." });
  const known = error instanceof TeamsProviderError;
  const code = known ? error.code : "teams_request_failed";
  const http = known && error.status >= 400 && error.status <= 599 ? error.status : 500;
  return res.status(http).json({ code, message: code.replaceAll("_", " ") });
}
function route(path: string, method: "get" | "post", handler: (req: Request, session: TeamsSession) => Promise<unknown>) {
  router[method](`/work-hub/teams${path}`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const session = await actor(req);
      if (!await limiter.enforce(req, res, session)) return;
      res.json(await handler(req, session));
    } catch (error) { fail(res, error); }
  });
}
route("/status", "get", async (_req, session) => status(session));
route("/connect", "post", async (req, session) => { empty.parse(req.body); return connectStart(session); });
router.get("/work-hub/teams/callback", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const session = await actor(req);
    if (req.query.error) {
      // Authorization errors carry AADSTS codes in error_description; only the numeric code is logged.
      const aadsts = Number(/AADSTS(\d{5,7})/.exec(String(req.query.error_description ?? ""))?.[1]);
      const misconfigured = APP_CONFIG_AADSTS.has(aadsts) || req.query.error === "unauthorized_client" || req.query.error === "invalid_client";
      if (misconfigured) logger.error({ event: "teams.authorize_error", error: String(req.query.error).slice(0, 64), aadsts: Number.isFinite(aadsts) ? aadsts : undefined }, "Microsoft Teams app registration rejected at authorization");
      throw new TeamsProviderError(misconfigured ? "teams_app_misconfigured" : "microsoft_consent_not_completed", misconfigured ? 503 : 400);
    }
    const input = z.object({ state: z.string().min(20).max(512), code: z.string().min(1).max(8192) }).parse(req.query);
    await finishConnect(session, input.state, input.code);
    res.redirect(303, "/work-hub/settings?teams=connected");
  } catch (error) {
    const code = error instanceof TeamsProviderError ? error.code : "teams_connection_failed";
    res.redirect(303, `/work-hub/settings?teams_error=${encodeURIComponent(code)}`);
  }
});
route("/disconnect", "post", async (req, session) => { empty.parse(req.body); return disconnect(session); });
route("/calendar", "get", async (_req, session) => withTeamsToken(session, token => {
  const start = new Date(); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 30);
  return listTeamsCalendar(token, start.toISOString(), end.toISOString());
}, { retryReadOnUnauthorized: true }));
route("/chats", "get", async (_req, session) => withTeamsToken(session, async token => {
  const result = await listTeamsChats(token);
  return { ...result, chats: result.chats.map(chat => ({ id: chat.id, chatType: chat.chatType,
    topic: typeof chat.topic === "string" && chat.topic.trim() ? chat.topic :
      (Array.isArray(chat.members) ? chat.members.map(member => typeof member?.displayName === "string" ? member.displayName : "").filter(Boolean).join(", ") : ""),
    webUrl: chat.webUrl })) };
}, { retryReadOnUnauthorized: true }));
route("/chats/:chatId/messages", "get", async (req, session) => withTeamsToken(session, async token => {
  const result = await listTeamsMessages(token, resourceId.parse(req.params.chatId));
  return { ...result, messages: result.messages.map(message => ({ ...message, sender: message.sender.displayName })) };
}, { retryReadOnUnauthorized: true }));
route("/chats/:chatId/messages", "post", async (req, session) => {
  const input = send.parse(req.body); const chatId = resourceId.parse(req.params.chatId);
  return withTeamsToken(session, (token, connection) => {
    assertTeamsGeneration(session, connection, input.expectedGeneration);
    return deliverTeamsChat(session, connection.id, token, chatId, input.text, input.operationId);
  });
});
route("/meetings", "get", async (_req, session) => withTeamsToken(session, (_token, connection) => listMeetings(session, connection.id)));
route("/meetings/:occurrenceId/publish", "post", async (req, session) => {
  const { operationId, expectedGeneration } = z.object({ operationId: z.uuid(), expectedGeneration: generation }).strict().parse(req.body);
  const occurrenceId = z.uuid().parse(req.params.occurrenceId);
  return withTeamsToken(session, (token, connection) => {
    assertTeamsGeneration(session, connection, expectedGeneration);
    return publishMeeting(session, connection.id, token, occurrenceId, operationId);
  });
});
route("/sync", "post", async (req, session) => {
  const { expectedGeneration } = z.object({ expectedGeneration: generation }).strict().parse(req.body);
  return withTeamsToken(session, (token, connection) => {
    assertTeamsGeneration(session, connection, expectedGeneration);
    return syncMeetings(session, connection.id, token);
  });
});
export default router;
