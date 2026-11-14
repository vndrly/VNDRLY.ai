import { Router } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { createRateLimiter } from "../lib/rate-limit-factory";
const router = Router();
const limiter = createRateLimiter({
  resourcePrefix: "ACCOUNT_DELETION",
  errorCode: "account.rate_limited",
  logKind: "account.deletion.rate_limit",
  defaultMax: 5,
  defaultWindowMs: 15 * 60 * 1000,
  message: "Please wait before trying again.",
});
router.get("/account/deletion-request", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    res.sendStatus(401);
    return;
  }
  const row = (
    await pool.query(
      "SELECT account_deletion_request AS request FROM users WHERE id=$1",
      [session.userId],
    )
  ).rows[0];
  res.setHeader("Cache-Control", "no-store");
  res.json({ request: row?.request ?? null });
});
router.post("/account/deletion-request", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    res.sendStatus(401);
    return;
  }
  if (session.publicDemo || session.realm === "demo") {
    res.status(403).json({ error: "Demo accounts cannot request deletion." });
    return;
  }
  if (
    !(await limiter.enforce(req, res, { ...session, userId: session.userId }))
  )
    return;
  const body = z
    .object({
      password: z.string().min(1).max(1000),
      confirmation: z.literal("DELETE"),
    })
    .strict()
    .safeParse(req.body);
  if (!body.success) {
    res
      .status(400)
      .json({ error: "Enter your current password and confirm deletion." });
    return;
  }
  const row = (
    await pool.query(
      "SELECT password_hash,account_deletion_request FROM users WHERE id=$1",
      [session.userId],
    )
  ).rows[0];
  if (!row || !(await bcrypt.compare(body.data.password, row.password_hash))) {
    res.status(403).json({ error: "Current password is incorrect." });
    return;
  }
  const request = {
    id: randomUUID(),
    status: "requested",
    requestedAt: new Date().toISOString(),
    source: "ios_gate",
  };
  const saved = await pool.query(
    "UPDATE users SET account_deletion_request=COALESCE(account_deletion_request,$2::jsonb) WHERE id=$1 RETURNING account_deletion_request AS request",
    [session.userId, JSON.stringify(request)],
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({ request: saved.rows[0].request });
});
router.get("/admin/account-deletion-requests", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (session?.role !== "admin") {
    res.sendStatus(session ? 403 : 401);
    return;
  }
  const result = await pool.query(
    "SELECT id AS user_id,display_name,email,account_deletion_request AS request FROM users WHERE account_deletion_request IS NOT NULL ORDER BY account_deletion_request->>'requestedAt' ASC LIMIT 200",
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({ requests: result.rows });
});
export default router;
