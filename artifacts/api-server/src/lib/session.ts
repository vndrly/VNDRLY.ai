import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error(
    "SESSION_SECRET environment variable is not set. " +
      "Set it to a long random string before starting the server.",
  );
}

export const SESSION_SECRET: string = secret;

function verifyPayload(signed: string): string | null {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return payload;
}

export interface SessionPayload {
  userId?: number;
  role?: string;
  /**
   * The user's role within their active org membership ("admin" | "member" |
   * "field_employee"). Undefined for system admins (role === "admin") who have
   * no org membership. Used by legacy CRUD routes to distinguish org admins
   * from ordinary members even though both collapse to the same portal role.
   */
  membershipRole?: string | null;
  partnerId?: number | null;
  vendorId?: number | null;
  vendorRole?: string | null;
  vendorPeopleId?: number | null;
  activeMembershipId?: number | null;
  displayName?: string | null;
  iat?: number;
  exp?: number;
  /** Session version — must match users.session_version in the DB. */
  sv?: number;
}

export function decodeSession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const p = verifyPayload(token);
  if (!p) return null;
  try {
    const obj = JSON.parse(Buffer.from(p, "base64").toString("utf-8"));
    if (!obj || typeof obj !== "object") return null;
    const now = Math.floor(Date.now() / 1000);
    // Require exp — reject legacy tokens that lack an expiry claim.
    if (typeof obj.exp !== "number") return null;
    if (obj.exp < now) return null;
    return obj as SessionPayload;
  } catch {
    return null;
  }
}

export function decodeRole(token: string | undefined | null): string | null {
  const s = decodeSession(token);
  return typeof s?.role === "string" ? s.role : null;
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
  return decodeSession(cookies["vndrly_session"]);
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Authentication required", code: "auth.unauthenticated" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);
  if (!session || session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  next();
}
