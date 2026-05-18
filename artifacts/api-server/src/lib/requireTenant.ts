import type { Request, Response, NextFunction } from "express";
import { getSessionFromRequest } from "./session";

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromRequest(req);

  if (!session) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (!session.partnerId && !session.vendorId) {
    return res.status(403).json({ message: "No tenant context" });
  }

  next();
}
