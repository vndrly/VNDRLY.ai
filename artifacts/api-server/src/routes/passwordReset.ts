import { Router } from "express";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, isNull, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../lib/sendgrid";
import { logger } from "../lib/logger";
import { apiError, sendApiError } from "../lib/apiError";

const router = Router();

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetUrl(token: string): string {
  const origin =
    process.env.PUBLIC_APP_URL ||
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost");
  return `${origin}/reset-password?token=${token}`;
}

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return sendApiError(res, 400, "password_reset.email_required", "Email is required");
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower(${email})`)
      .limit(1);

    // Always respond success to avoid account enumeration
    if (!user) {
      logger.info({ email }, "Password reset requested for unknown email");
      return res.json({ message: "If an account exists for that email, a reset link has been sent." });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    const resetUrl = buildResetUrl(rawToken);

    try {
      await sendPasswordResetEmail(user.username, resetUrl, user.displayName);
    } catch (err) {
      logger.error({ err, userId: user.id }, "Failed to send password reset email");
      return sendApiError(res, 500, "password_reset.send_failed", "Could not send reset email. Please try again or contact your admin.");
    }

    return res.json({ message: "If an account exists for that email, a reset link has been sent." });
  } catch (error) {
    logger.error({ err: error }, "Forgot password error");
    return sendApiError(res, 500, "server.internal_error", "Internal server error");
  }
});

router.get("/auth/reset-password/validate", async (req, res) => {
  const token = String(req.query.token || "");
  if (!token) {
    return res.status(400).json({
      valid: false,
      ...apiError("password_reset.token_required", "A reset token is required."),
    });
  }
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.tokenHash, tokenHash),
      isNull(passwordResetTokensTable.usedAt),
      gt(passwordResetTokensTable.expiresAt, new Date()),
    ))
    .limit(1);
  return res.json({ valid: !!row });
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return sendApiError(res, 400, "password_reset.token_required", "Token and password are required");
    }
    if (typeof password !== "string" || password.length < 8) {
      return sendApiError(res, 400, "auth.weak_password", "Password must be at least 8 characters");
    }

    const tokenHash = hashToken(token);
    const [row] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ))
      .limit(1);

    if (!row) {
      return sendApiError(res, 400, "password_reset.invalid_or_expired", "This reset link is invalid or has expired. Please request a new one.");
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({ passwordHash, sessionVersion: sql`${usersTable.sessionVersion} + 1` })
        .where(eq(usersTable.id, row.userId));
      await tx.update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokensTable.id, row.id));
    });

    return res.json({ message: "Password updated successfully. You can now sign in." });
  } catch (error) {
    logger.error({ err: error }, "Reset password error");
    return sendApiError(res, 500, "server.internal_error", "Internal server error");
  }
});

export default router;
