// Accounting-software connection management.
//
// These routes back the "Connect to QuickBooks" / "Connect to OpenAccountant"
// buttons on the Reports page. The actual "Sync to ..." pushes live in
// routes/reports.ts so they can sit next to the existing download routes.

import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { z } from "zod/v4";
import { getSessionFromRequest as getSession, SESSION_SECRET } from "../lib/session";
import { logger } from "../lib/logger";
import {
  authorizationUrl,
  exchangeCodeForTokens,
  loadQboConfig,
  revokeToken,
} from "../lib/accounting/qbo";
import {
  upsertConnection,
  listConnectionsForVendor,
  getConnection,
  deleteConnection,
  toPublicView,
  markRevoked,
} from "../lib/accounting/connections";
import {
  loadOaOAuthConfig,
  oaAuthorizationUrl,
  oaExchangeCodeForTokens,
  oaRevokeToken,
  validateOaBaseUrl,
} from "../lib/accounting/oa";

const router: IRouter = Router();

function rbacVendor(req: Request, res: Response, vendorId: number): boolean {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return false;
  }
  if (s.role === "admin") return true;
  if (s.role === "vendor" && s.vendorId === vendorId) return true;
  res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
  return false;
}

// ── State helpers (CSRF protection for OAuth round-trip) ────────
//
// Intuit echoes our `state` parameter back to the callback. We pack
// `${vendorId}:${userId}:${nonce}` and an HMAC signed with SESSION_SECRET
// so a malicious party cannot trick a logged-in vendor into binding a
// foreign QBO realm.

import crypto from "crypto";

const STATE_SECRET = SESSION_SECRET;
const STATE_TTL_MS = 10 * 60 * 1000;

function makeState(vendorId: number, userId: number): string {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${vendorId}.${userId}.${issuedAt}.${nonce}`;
  const sig = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 16);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

function parseState(
  raw: string,
): { vendorId: number; userId: number } | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  const expected = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 16);
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const parts = payload.split(".");
  if (parts.length !== 4) return null;
  const vendorId = Number(parts[0]);
  const userId = Number(parts[1]);
  const issuedAt = Number(parts[2]);
  if (
    !Number.isInteger(vendorId) ||
    !Number.isInteger(userId) ||
    !Number.isFinite(issuedAt)
  ) {
    return null;
  }
  if (Date.now() - issuedAt > STATE_TTL_MS) return null;
  return { vendorId, userId };
}

// ── Routes ──────────────────────────────────────────────────────

// GET /api/accounting/connections?vendorId=...
router.get(
  "/api/accounting/connections",
  async (req: Request, res: Response): Promise<void> => {
    const vendorId = Number(req.query["vendorId"]);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const conns = await listConnectionsForVendor(vendorId);
    res.json({ connections: conns.map(toPublicView) });
  },
);

// GET /api/accounting/qbo/connect?vendorId=...
router.get(
  "/api/accounting/qbo/connect",
  async (req: Request, res: Response): Promise<void> => {
    const vendorId = Number(req.query["vendorId"]);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const session = getSession(req);
    if (!session?.userId) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    try {
      const state = makeState(vendorId, session.userId);
      const url = authorizationUrl(state);
      // Two response modes: redirect (default, used when a browser hits
      // this URL directly) or JSON (used when the SPA wants to open the
      // popup itself). Pick by Accept header / `mode=json` query param.
      if (req.query["mode"] === "json") {
        res.json({ authorizationUrl: url, state });
        return;
      }
      res.redirect(url);
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message,
        code: "qbo.not_configured",
      });
    }
  },
);

// GET /api/accounting/qbo/callback
//   ?code=...&state=...&realmId=...
router.get(
  "/api/accounting/qbo/callback",
  async (req: Request, res: Response): Promise<void> => {
    const code = String(req.query["code"] ?? "");
    const state = String(req.query["state"] ?? "");
    const realmId = String(req.query["realmId"] ?? "");
    const errorParam = req.query["error"];
    if (errorParam) {
      res.status(400).send(htmlMessage("Connection cancelled", String(errorParam)));
      return;
    }
    if (!code || !state || !realmId) {
      res.status(400).send(htmlMessage("Missing parameters", "Intuit callback was missing code, state, or realmId."));
      return;
    }
    const parsed = parseState(state);
    if (!parsed) {
      res.status(400).send(htmlMessage("Invalid or expired state", "Please retry the connect flow."));
      return;
    }
    // Cross-check that the current session matches the user who
    // initiated the connect flow. Without this an attacker could trick
    // a vendor into binding a malicious realm. Admins may complete a
    // connect they started themselves (matching userId in the signed
    // state) for any vendor, mirroring the RBAC on /qbo/connect.
    const session = getSession(req);
    const sessionMatches =
      !!session &&
      session.userId === parsed.userId &&
      ((session.role === "vendor" && session.vendorId === parsed.vendorId) ||
        session.role === "admin");
    if (!sessionMatches) {
      res.status(403).send(htmlMessage(
        "Session mismatch",
        "Sign in as the user that started the connection and try again.",
      ));
      return;
    }
    try {
      const tokens = await exchangeCodeForTokens(code);
      const cfg = loadQboConfig();
      await upsertConnection({
        vendorId: parsed.vendorId,
        provider: "qbo",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: new Date(
          Date.now() + tokens.expiresInSec * 1000,
        ),
        realmId,
        displayName: `QuickBooks Online (${cfg.environment})`,
        scopes: "com.intuit.quickbooks.accounting",
        createdByUserId: parsed.userId,
      });
      res.send(htmlMessage(
        "QuickBooks Online connected",
        "You can close this window and return to the Reports page.",
        "success",
      ));
    } catch (err) {
      logger.error({ err }, "QBO callback failed");
      res.status(500).send(htmlMessage(
        "Connection failed",
        (err as Error).message,
      ));
    }
  },
);

// GET /api/accounting/oa/connect?vendorId=...
//
// Default OA connect path: kick off the OAuth2 authorization-code flow
// in a popup, mirroring /api/accounting/qbo/connect. Customers without
// an OA OAuth client can still use the legacy long-lived API-key path
// at POST /api/accounting/oa/connect-api-key (see below).
router.get(
  "/api/accounting/oa/connect",
  async (req: Request, res: Response): Promise<void> => {
    const vendorId = Number(req.query["vendorId"]);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const session = getSession(req);
    if (!session?.userId) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    try {
      const state = makeState(vendorId, session.userId);
      const url = oaAuthorizationUrl(state);
      if (req.query["mode"] === "json") {
        res.json({ authorizationUrl: url, state });
        return;
      }
      res.redirect(url);
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message,
        code: "oa.not_configured",
      });
    }
  },
);

// GET /api/accounting/oa/callback?code=...&state=...
router.get(
  "/api/accounting/oa/callback",
  async (req: Request, res: Response): Promise<void> => {
    const code = String(req.query["code"] ?? "");
    const state = String(req.query["state"] ?? "");
    const errorParam = req.query["error"];
    if (errorParam) {
      res
        .status(400)
        .send(htmlMessage("Connection cancelled", String(errorParam)));
      return;
    }
    if (!code || !state) {
      res.status(400).send(
        htmlMessage(
          "Missing parameters",
          "OpenAccountant callback was missing code or state.",
        ),
      );
      return;
    }
    const parsed = parseState(state);
    if (!parsed) {
      res
        .status(400)
        .send(htmlMessage("Invalid or expired state", "Please retry the connect flow."));
      return;
    }
    // Same session-binding check as the QBO callback: the user
    // completing the popup must match the user who started it.
    const session = getSession(req);
    const sessionMatches =
      !!session &&
      session.userId === parsed.userId &&
      ((session.role === "vendor" && session.vendorId === parsed.vendorId) ||
        session.role === "admin");
    if (!sessionMatches) {
      res.status(403).send(
        htmlMessage(
          "Session mismatch",
          "Sign in as the user that started the connection and try again.",
        ),
      );
      return;
    }
    try {
      const tokens = await oaExchangeCodeForTokens(code);
      const cfg = loadOaOAuthConfig();
      await upsertConnection({
        vendorId: parsed.vendorId,
        provider: "oa",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: new Date(
          Date.now() + tokens.expiresInSec * 1000,
        ),
        // OA OAuth doesn't have a per-realm id like QBO; leave null.
        // Existing API-key rows that are reconnected via OAuth are
        // overwritten by the (vendor, provider) unique index.
        displayName: "OpenAccountant",
        scopes: tokens.scope ?? cfg.scope,
        // Wipe any prior per-connection base URL so the OAuth-issued
        // token is used against OA's default API host.
        apiBaseUrl: null,
        createdByUserId: parsed.userId,
      });
      res.send(
        htmlMessage(
          "OpenAccountant connected",
          "You can close this window and return to the Reports page.",
          "success",
        ),
      );
    } catch (err) {
      logger.error({ err }, "OA callback failed");
      res
        .status(500)
        .send(htmlMessage("Connection failed", (err as Error).message));
    }
  },
);

const oaConnectApiKeySchema = z.object({
  vendorId: z.number().int().positive(),
  apiKey: z.string().min(8),
  baseUrl: z.string().url().optional(),
  displayName: z.string().max(120).optional(),
});

// POST /api/accounting/oa/connect-api-key
//
// Legacy fallback for customers that don't have an OAuth client (or
// that connected before the OAuth flow shipped). Stores the supplied
// API key as the connection's access_token with no refresh_token, so
// existing pushes continue to work unchanged.
router.post(
  "/api/accounting/oa/connect-api-key",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = oaConnectApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", code: "validation.invalid_body", details: parsed.error.flatten() });
      return;
    }
    if (!rbacVendor(req, res, parsed.data.vendorId)) return;

    // SSRF guard: when the operator supplies a custom base URL, force it
    // through the OA host allowlist before persisting.
    let normalizedBaseUrl: string | null = null;
    if (parsed.data.baseUrl) {
      try {
        normalizedBaseUrl = validateOaBaseUrl(parsed.data.baseUrl);
      } catch (err) {
        res.status(400).json({
          error: (err as Error).message,
          code: "oa.invalid_base_url",
        });
        return;
      }
    }

    const session = getSession(req);
    await upsertConnection({
      vendorId: parsed.data.vendorId,
      provider: "oa",
      accessToken: parsed.data.apiKey,
      refreshToken: null,
      accessTokenExpiresAt: null,
      apiBaseUrl: normalizedBaseUrl,
      displayName: parsed.data.displayName ?? "OpenAccountant (API key)",
      createdByUserId: session?.userId ?? null,
    });
    const conn = await getConnection(parsed.data.vendorId, "oa");
    res.json({ connection: conn ? toPublicView(conn) : null });
  },
);

// DELETE /api/accounting/connections/:id?vendorId=...
router.delete(
  "/api/accounting/connections/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params["id"]);
    const vendorId = Number(req.query["vendorId"]);
    if (!Number.isInteger(id) || !Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad id or vendorId", code: "accounting.invalid_id_or_vendor_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    // Best-effort upstream revoke so the refresh_token is invalidated
    // server-side too. Failure to revoke is logged but doesn't block
    // delete. API-key OA rows have no refresh_token and there's nothing
    // to revoke at OA's end, so we skip them.
    const qboConn = await getConnection(vendorId, "qbo");
    if (qboConn && qboConn.id === id && qboConn.provider === "qbo") {
      try {
        const tok = qboConn.refreshToken ?? qboConn.accessToken;
        if (tok) await revokeToken(tok);
      } catch (err) {
        logger.warn({ err, id }, "QBO revoke failed during delete");
      }
      await markRevoked(id);
    }
    const oaConn = await getConnection(vendorId, "oa");
    if (oaConn && oaConn.id === id && oaConn.provider === "oa") {
      // Only OAuth-issued connections have a refresh_token; API-key
      // rows are local-only and don't need an OA-side revoke.
      if (oaConn.refreshToken || oaConn.accessTokenExpiresAt) {
        try {
          const tok = oaConn.refreshToken ?? oaConn.accessToken;
          if (tok) await oaRevokeToken(tok);
        } catch (err) {
          logger.warn({ err, id }, "OA revoke failed during delete");
        }
      }
      await markRevoked(id);
    }

    const ok = await deleteConnection(id, vendorId);
    if (!ok) {
      res.status(404).json({ error: "Not found", code: "common.not_found" });
      return;
    }
    res.status(204).end();
  },
);

function htmlMessage(
  title: string,
  body: string,
  kind: "success" | "error" = "error",
): string {
  const color = kind === "success" ? "#16a34a" : "#dc2626";
  const safeTitle = title.replace(/[<>&]/g, "");
  const safeBody = body.replace(/[<>&]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#111}
h1{color:${color};font-size:1.4rem}p{line-height:1.5;color:#374151}</style>
</head><body><h1>${safeTitle}</h1><p>${safeBody}</p>
<script>setTimeout(function(){try{window.opener&&window.opener.postMessage({type:'vndrly.accounting.connected'},'*');}catch(e){}},250);</script>
</body></html>`;
}

export default router;
