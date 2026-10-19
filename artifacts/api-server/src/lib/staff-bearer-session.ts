import type { Request, Response, NextFunction } from "express";
import { decodeRole } from "./session";

/** The explicitly supplied native credential selects the account. A retained
 * browser cookie must not replace it or rescue an invalid bearer credential.
 * Scoped assistant OAuth routes are mounted before this staff-only bridge. */
export function applyStaffBearerSession(req: Request, _res: Response, next: NextFunction): void {
  const match = /^Bearer(?:\s+(.*))?$/i.exec(req.headers.authorization ?? "");
  if (!match) { next(); return; }
  const token = (match[1] ?? "").trim();
  const cookies: Record<string,string> = req.cookies ?? (req.cookies = {});
  delete cookies.vndrly_session;
  delete cookies.vndrly_guest;
  const retained = (req.headers.cookie ?? "").split(";").filter(value =>
    value.trim() && !/^\s*vndrly_(?:session|guest)\s*=/.test(value));
  if (token) {
    const name = decodeRole(token) === "guest" ? "vndrly_guest" : "vndrly_session";
    cookies[name] = token;
    retained.push(`${name}=${encodeURIComponent(token)}`);
  }
  if (retained.length) req.headers.cookie = retained.join("; ");
  else delete req.headers.cookie;
  next();
}
