import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { decodeRole, decodeSession } from "./lib/session";
import { requireSession } from "./lib/session";
import { requireTenant } from "./lib/requireTenant";
import helmet from "helmet";


const app: Express = express();

const GUEST_ALLOWLIST: { method: string; pattern: RegExp }[] = [
  { method: "POST", pattern: /^\/api\/auth\/guest\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/guest\/me\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/guest\/logout\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/logout\/?$/ },
  // Allow staff auth endpoints so a stale visitor guest cookie doesn't
  // block a user from signing in to the vendor / staff portal.
  { method: "POST", pattern: /^\/api\/auth\/login\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/me\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/forgot-password\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/reset-password\/validate\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/reset-password\/?$/ },
  { method: "GET", pattern: /^\/api\/visits\/site-context\/[^/]+\/?$/ },
  { method: "GET", pattern: /^\/api\/visits\/public-sites\/?$/ },
  { method: "POST", pattern: /^\/api\/visits\/check-in\/?$/ },
  { method: "POST", pattern: /^\/api\/visits\/\d+\/check-out\/?$/ },
  { method: "GET", pattern: /^\/api\/visits\/me\/active\/?$/ },
];

// Paths that must bypass the session-version guard. Only include routes
// that run before a valid session exists (login, anonymous health check).
// /auth/logout is intentionally NOT listed: if the token's sv already
// mismatches (e.g., another device already logged out), the middleware
// still clears the cookie and returns 401, which is functionally
// equivalent to a successful logout from the client's perspective, and
// also prevents stolen tokens from being used to repeatedly increment
// sessionVersion (DoS via forced global logout).
const SESSION_VERSION_SKIP: { method: string; pattern: RegExp }[] = [
  { method: "POST", pattern: /^\/api\/auth\/login\/?$/ },
  { method: "GET", pattern: /^\/api\/health\/?$/ },
];

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://vndry.ai" // change later
];

app.use(cors({
  credentials: true,
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  }
}));
``
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
``


// Bearer-token shim: mobile clients send the signed session as
// `Authorization: Bearer <token>`. Route the token to the appropriate
// cookie based on the embedded role so cookie-based session helpers
// continue to work unchanged for both staff and guests.
app.use((req, _res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    const cookies: Record<string, string> = req.cookies ?? (req.cookies = {});
    if (token) {
      const role = decodeRole(token);
      if (role === "guest") {
        if (!cookies["vndrly_guest"]) cookies["vndrly_guest"] = token;
      } else {
        if (!cookies["vndrly_session"]) cookies["vndrly_session"] = token;
      }
    }
  }
  next();
});

// Deny-by-default for guest-role sessions: a request that carries a
// guest token (and no valid staff session) may only hit the explicit
// visitor allowlist. This prevents guests from reaching any other API.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api/")) return next();

  const cookies = (req as any).cookies ?? {};
  const staffRole = decodeRole(cookies["vndrly_session"]);
  if (staffRole && staffRole !== "guest") return next(); // valid staff session — allow

  const guestRole = decodeRole(cookies["vndrly_guest"]);
  if (guestRole !== "guest") return next(); // not a guest request — let normal auth handle

  const allowed = GUEST_ALLOWLIST.some(
    (rule) => rule.method === req.method && rule.pattern.test(req.path),
  );
  if (allowed) return next();
  return res.status(403).json({ message: "Forbidden for guest session" });
});

// Staff session version guard: on every authenticated staff request,
// validate that the token's embedded session version (sv) matches the
// current value stored in the database. This makes explicit logout and
// any access-revocation (membership removal, user disable) immediately
// effective even for long-lived Bearer tokens that have not yet expired.
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api/")) return next();

  const cookies = (req as any).cookies ?? {};
  const token = cookies["vndrly_session"];
  if (!token) return next();

  const session = decodeSession(token);
  // If token is invalid/expired decodeSession returns null; route-level
  // auth will issue a 401 in the normal flow.
  if (!session?.userId || typeof session.sv !== "number") return next();

  // Skip the DB round-trip for auth bootstrap paths.
  const skip = SESSION_VERSION_SKIP.some(
    (rule) => rule.method === req.method && rule.pattern.test(req.path),
  );
  if (skip) return next();

  try {
    const [row] = await db
      .select({ sv: usersTable.sessionVersion })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId))
      .limit(1);

    if (!row) {
      // User no longer exists — reject the token immediately rather than
      // letting claim-trusting route handlers accept it.
      res.clearCookie("vndrly_session", { path: "/" });
      return res.status(401).json({
        message: "Session has been invalidated",
        code: "auth.session_invalidated",
      });
    }

    if (row.sv !== session.sv) {
      res.clearCookie("vndrly_session", { path: "/" });
      return res.status(401).json({
        message: "Session has been invalidated",
        code: "auth.session_invalidated",
      });
    }

    // Reject legacy tokens that predate the membershipRole field. Partner
    // and vendor sessions must carry membershipRole so that the per-org
    // admin/member distinction is enforced on write routes. Without it the
    // server cannot distinguish org admins from ordinary members, so the
    // only safe action is to force re-authentication.
    const orgPortalRoles = ["partner", "vendor", "field_employee"];
    if (
      orgPortalRoles.includes(session.role ?? "") &&
      !("membershipRole" in session)
    ) {
      res.clearCookie("vndrly_session", { path: "/" });
      return res.status(401).json({
        message: "Session has been invalidated",
        code: "auth.session_invalidated",
      });
    }
  } catch (err) {
    // On a transient DB error let the request through; route-level
    // auth still validates the token signature and expiry.
    logger.warn({ err }, "Session version check failed — allowing request");
  }

  next();
});

const { enforceTenant } = require("./lib/tenantGuard");

const { getSessionFromRequest } = require("./lib/session");

app.use("/api", requireSession, (req, res, next) => {
  const session = getSessionFromRequest(req);

  const originalJson = res.json;

  res.json = function (data) {
    try {
      // If no session, don't touch response
      if (!session) return originalJson.call(this, data);

      // Handle arrays
      if (Array.isArray(data)) {
        data = data.filter((item) => {
          if (!item || typeof item !== "object") return true;

          if (session.partnerId && item.partnerId) {
            return item.partnerId === session.partnerId;
          }

          if (session.vendorId && item.vendorId) {
            return item.vendorId === session.vendorId;
          }

          return true; // allow non-tenant objects through (metadata, etc)
        });
      }

      // Handle single object
      else if (data && typeof data === "object") {
        if (
          (session.partnerId && data.partnerId && data.partnerId !== session.partnerId) ||
          (session.vendorId && data.vendorId && data.vendorId !== session.vendorId)
        ) {
          return originalJson.call(this, null); // block it
        }
      }

      return originalJson.call(this, data);
    } catch (err) {
      console.error("Tenant guard error:", err);
      return originalJson.call(this, data);
    }
  };

  next();
}, router);

export default app;

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    message: "Internal server error"
  });
});