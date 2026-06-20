import type { Request, Response, NextFunction } from "express";
import { getSessionFromRequest } from "./session";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const buckets = new Map<number, { count: number; resetAt: number }>();

export function enforceSafetyRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = getSessionFromRequest(req)?.userId;
  if (!userId) {
    next();
    return;
  }
  const now = Date.now();
  const bucket = buckets.get(userId) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  buckets.set(userId, bucket);
  if (bucket.count > MAX_PER_WINDOW) {
    res.status(429).json({
      error: "Too many safety reports. Please wait a minute and try again.",
      message: "Too many safety reports. Please wait a minute and try again.",
      code: "safety.rate_limited",
    });
    return;
  }
  next();
}
