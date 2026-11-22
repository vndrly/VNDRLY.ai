import { Router, type IRouter, type Request } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { createRateLimiter } from "../lib/rate-limit-factory";
import {
  teamsConnectionIdentity,
  type TeamsSession,
} from "../work-hub/teams-connection-service";
import {
  ConnectorError,
  providerSchema,
} from "../work-hub/connectors/providers";
import * as accounts from "../work-hub/connectors/accounts";
import * as mail from "../work-hub/connectors/mail";
import * as chat from "../work-hub/connectors/chat";
const router: IRouter = Router();
const limiter = createRateLimiter({
  resourcePrefix: "COMMS_CONNECTOR",
  errorCode: "connectors.rate_limited",
  logKind: "connectors.rate_limit",
  defaultMax: 120,
  defaultWindowMs: 60000,
  message: "Please wait before trying again.",
});
const id = z.uuid(),
  resource = z
    .string()
    .min(1)
    .max(2048)
    .refine((s) => !/[\r\n]/.test(s)),
  cursor = z.string().max(8192).optional(),
  kind = z.enum(["chats", "channels"]);
async function actor(req: Request): Promise<TeamsSession> {
  const signed = getSessionFromRequest(req);
  if (!signed?.userId) throw new ConnectorError("authentication_required", 401);
  let s;
  try {
    s = await validateAssistantSession(signed);
  } catch {
    throw new ConnectorError("authentication_required", 401);
  }
  if (!(await isWorkHubEnabled()))
    throw new ConnectorError("work_hub_disabled", 403);
  const session = { ...s, userId: signed.userId };
  try {
    teamsConnectionIdentity(session);
  } catch {
    throw new ConnectorError("connection_forbidden", 403);
  }
  if (req.method !== "GET") {
    const origin = req.get("origin"),
      expected = new URL(process.env.PUBLIC_APP_URL || "https://vndrly.ai")
        .origin;
    if (
      req.get("sec-fetch-site") === "cross-site" ||
      (origin &&
        new URL(origin).origin !== expected &&
        !(
          process.env.NODE_ENV !== "production" &&
          [
            "http://localhost:5173",
            "http://localhost:8081",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:8081",
          ].includes(origin)
        ))
    )
      throw new ConnectorError("invalid_origin", 403);
  }
  return session;
}
function route(
  method: "get" | "post",
  path: string,
  run: (req: Request, s: TeamsSession) => Promise<unknown>,
) {
  router[method](`/work-hub/connectors${path}`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const s = await actor(req);
      if (!(await limiter.enforce(req, res, s))) return;
      res.json(await run(req, s));
    } catch (e) {
      const known = e instanceof ConnectorError;
      if (known && e.retryAfter)
        res.setHeader("Retry-After", String(e.retryAfter));
      res.status(e instanceof z.ZodError ? 400 : known ? e.status : 500).json({
        message:
          e instanceof z.ZodError
            ? "Check the request fields."
            : known
              ? e.message
              : "Connection request failed.",
        code: known ? e.code : "request_failed",
      });
    }
  });
}
route("get", "/accounts", async (_r, s) => ({
  accounts: await accounts.listAccounts(s),
  configured: accounts.configurations(),
}));
route("post", "/:provider/connect", async (r, s) =>
  accounts.start(s, providerSchema.parse(r.params.provider)),
);
route("get", "/attempts/:id", async (r, s) =>
  accounts.progress(s, id.parse(r.params.id)),
);
route("post", "/accounts/:id/disconnect", async (r, s) =>
  accounts.disconnect(s, id.parse(r.params.id)),
);
router.get("/work-hub/connectors/:provider/callback", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    await accounts.finish(
      providerSchema.parse(req.params.provider),
      z.string().max(200).parse(req.query.state),
      req.query.error
        ? undefined
        : z.string().min(1).max(10000).parse(req.query.code),
    );
  } catch {
    /* Details are available only to the authenticated initiating session through attempts. */
  }
  // Never leave authorization codes or account details on a callback page.
  // The authenticated Communications view loads only this user's accounts.
  res.redirect(303, "/work-hub/chat");
});
const account = (
  r: Request,
  s: TeamsSession,
  run: Parameters<typeof accounts.withAccount>[2],
) => accounts.withAccount(s, id.parse(r.params.id), run);
route("get", "/accounts/:id/inbox-summary", async (r, s) =>
  account(r, s, (p, t) => mail.inboxSummary(p, t)),
);
route("get", "/accounts/:id/folder-counts", async (r, s) =>
  account(r, s, (p, t) => mail.folderCounts(p, t, resource.optional().parse(r.query.parent), cursor.parse(r.query.cursor))),
);
route("get", "/accounts/:id/folders", async (r, s) =>
  account(r, s, (p, t) =>
    mail.folders(
      p,
      t,
      resource.optional().parse(r.query.parent),
      cursor.parse(r.query.cursor),
    ),
  ),
);
route("get", "/accounts/:id/messages", async (r, s) =>
  account(r, s, (p, t) =>
    mail.messages(
      p,
      t,
      resource.parse(r.query.folder),
      cursor.parse(r.query.cursor),
      z.string().max(500).optional().parse(r.query.q),
      z.coerce.number().int().min(1).max(50).optional().parse(r.query.limit),
    ),
  ),
);
route("get", "/accounts/:id/messages/:message", async (r, s) =>
  account(r, s, (p, t) => mail.message(p, t, resource.parse(r.params.message))),
);
route(
  "get",
  "/accounts/:id/messages/:message/attachments/:attachment",
  async (r, s) =>
    account(r, s, (p, t) =>
      mail.attachment(
        p,
        t,
        resource.parse(r.params.message),
        resource.parse(r.params.attachment),
      ),
    ),
);
route("post", "/accounts/:id/mail", async (r, s) => {
  const v = z
    .object({
      operationId: z.uuid(),
      draft: z.boolean(),
      mail: mail.mailSchema,
    })
    .strict()
    .parse(r.body);
  return accounts.once(s, id.parse(r.params.id), v.operationId, v, () =>
    account(r, s, (p, t, label) =>
      mail.writeMail(p, t, label, v.mail, v.draft),
    ),
  );
});
route("post", "/accounts/:id/messages/:message/action", async (r, s) => {
  const v = z
    .object({
      action: z.enum(["read", "unread", "trash", "archive", "move", "star", "unstar"]),
      destination: resource.optional(),
      source: resource.optional(),
    })
    .strict()
    .parse(r.body);
  if (v.action === "move" && !v.destination)
    throw new ConnectorError("destination_required", 400);
  return account(r, s, (p, t) =>
    mail.mutateMail(
      p,
      t,
      resource.parse(r.params.message),
      v.action,
      v.destination,
      v.source,
    ),
  );
});
route("get", "/accounts/:id/conversations", async (r, s) =>
  account(r, s, (p, t) =>
    chat.conversations(
      p,
      t,
      kind.parse(r.query.kind),
      cursor.parse(r.query.cursor),
      resource.optional().parse(r.query.team),
    ),
  ),
);
route(
  "get",
  "/accounts/:id/conversations/:conversation/messages",
  async (r, s) =>
    account(r, s, (p, t) =>
      chat.chatMessages(
        p,
        t,
        kind.parse(r.query.kind),
        resource.parse(r.params.conversation),
        cursor.parse(r.query.cursor),
        resource.optional().parse(r.query.thread),
      ),
    ),
);
route(
  "post",
  "/accounts/:id/conversations/:conversation/messages",
  async (r, s) => {
    const v = z
      .object({
        kind,
        operationId: z.uuid(),
        text: z.string().trim().min(1).max(20000),
        thread: resource.optional(),
      })
      .strict()
      .parse(r.body);
    return accounts.once(
      s,
      id.parse(r.params.id),
      v.operationId,
      { ...v, conversation: r.params.conversation },
      () =>
        account(r, s, (p, t) =>
          chat.sendChat(
            p,
            t,
            v.kind,
            resource.parse(r.params.conversation),
            v.text,
            v.operationId,
            v.thread,
          ),
        ),
    );
  },
);
export default router;
