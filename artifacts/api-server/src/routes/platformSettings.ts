// Platform-level settings + system-admin user management.
//
// Two thin areas behind one router:
//   GET  /platform-settings         — singleton platform_settings row (any auth)
//   PATCH /platform-settings        — admin-only, partial update
//   GET  /admin/admins              — admin-only, list of role=admin users
//   POST /admin/admins              — admin-only, creates a new role=admin user
//
// The platform_settings row is keyed at id=1. We upsert on first read to
// guarantee callers always see *something* even if the migration that
// pre-seeds the row hasn't run yet — defense in depth, since the same
// CREATE TABLE that introduced the row also INSERTed it.

import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  db,
  platformSettingsTable,
  platformSettingsAuditLogTable,
  usersTable,
  type PlatformSettings,
} from "@workspace/db";
import {
  UpdatePlatformSettingsBody,
  CreateAdminUserBody,
  UpsertDemoUserLabelBody,
} from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { logger } from "../lib/logger";
import { DEMO_LOCALES } from "../lib/demo-users";
import { sendValidationFailed } from "../lib/validation-error";
import {
  clearDemoLabelOverride,
  isValidDemoLocale,
  isValidDemoUsername,
  listDemoLabelEntries,
  upsertDemoLabelOverride,
} from "../lib/demo-user-labels";

const router: IRouter = Router();

const SINGLETON_ID = 1;

// Camel-case audit-log `field` values. The audit table is keyed by
// field name so we can audit additional platform-settings columns
// without a migration; keep the strings centralized so the writer and
// reader can never drift.
const AUDIT_FIELD_QB_RETENTION = "qbBulkActionRetentionDays";

interface PlatformSettingsFieldChange {
  changedAt: string;
  actorUserId: number | null;
  actorDisplayName: string | null;
  actorRole: string;
  prevValue: string | null;
  newValue: string | null;
}

async function readSingleton(): Promise<PlatformSettings> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, SINGLETON_ID));
  if (row) return row;
  // First-ever read — create the row so subsequent updates always have a
  // target. Concurrent inserts race-safely via ON CONFLICT DO NOTHING.
  await db
    .insert(platformSettingsTable)
    .values({ id: SINGLETON_ID, name: "VNDRLY" })
    .onConflictDoNothing();
  const [row2] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, SINGLETON_ID));
  return row2!;
}

async function readLastFieldChange(
  field: string,
): Promise<PlatformSettingsFieldChange | null> {
  // Single indexed lookup against (field, created_at desc). We left-join
  // users so a since-deleted actor still reports their displayName at
  // audit-write time being null (the FK is set null on user delete) —
  // the audit row itself is preserved.
  const [row] = await db
    .select({
      createdAt: platformSettingsAuditLogTable.createdAt,
      actorUserId: platformSettingsAuditLogTable.actorUserId,
      actorRole: platformSettingsAuditLogTable.actorRole,
      prevValue: platformSettingsAuditLogTable.prevValue,
      newValue: platformSettingsAuditLogTable.newValue,
      actorDisplayName: usersTable.displayName,
    })
    .from(platformSettingsAuditLogTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, platformSettingsAuditLogTable.actorUserId),
    )
    .where(eq(platformSettingsAuditLogTable.field, field))
    .orderBy(desc(platformSettingsAuditLogTable.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    changedAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    actorDisplayName: row.actorDisplayName ?? null,
    actorRole: row.actorRole,
    prevValue: row.prevValue,
    newValue: row.newValue,
  };
}

interface PlatformSettingsResponse extends PlatformSettings {
  qbBulkActionRetentionLastChange: PlatformSettingsFieldChange | null;
}

async function buildResponse(
  row: PlatformSettings,
): Promise<PlatformSettingsResponse> {
  const qbBulkActionRetentionLastChange = await readLastFieldChange(
    AUDIT_FIELD_QB_RETENTION,
  );
  return { ...row, qbBulkActionRetentionLastChange };
}

router.get("/platform-settings", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const row = await readSingleton();
  res.json(await buildResponse(row));
});

// Public, unauthenticated brand-only view of the platform_settings
// singleton. The mobile login screen needs to flex its pills / links
// to whatever VNDRLY brand color the admin set in the web app, but
// the user isn't signed in yet — so the standard `/platform-settings`
// route can't serve them. This route returns ONLY the brand fields
// (name + colors + logos) so we don't leak admin-only settings like
// QB retention or contact info.
router.get("/public/platform-brand", async (_req, res): Promise<void> => {
  const row = await readSingleton();
  res.json({
    name: row.name,
    brandPrimaryColor: row.brandPrimaryColor ?? null,
    brandAccentColor: row.brandAccentColor ?? null,
    logoUrl: row.logoUrl ?? null,
    logoSquareUrl: row.logoSquareUrl ?? null,
  });
});

router.patch("/platform-settings", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin role required", code: "auth.admin_required" });
    return;
  }
  const parsed = UpdatePlatformSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  // Make sure the row exists before we update; readSingleton handles that.
  const before = await readSingleton();

  // Audit qbBulkActionRetentionDays whenever the request explicitly
  // touches it AND the value actually changes. We use `in` rather than
  // truthy checks so an explicit `null` (clear-the-override) is
  // distinguished from "the field wasn't sent at all".
  const auditQbRetention =
    "qbBulkActionRetentionDays" in parsed.data &&
    (parsed.data.qbBulkActionRetentionDays ?? null) !==
      (before.qbBulkActionRetentionDays ?? null);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(platformSettingsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(platformSettingsTable.id, SINGLETON_ID))
      .returning();
    if (auditQbRetention) {
      const prev = before.qbBulkActionRetentionDays;
      const next = parsed.data.qbBulkActionRetentionDays ?? null;
      await tx.insert(platformSettingsAuditLogTable).values({
        field: AUDIT_FIELD_QB_RETENTION,
        prevValue: prev == null ? null : String(prev),
        newValue: next == null ? null : String(next),
        actorUserId: session.userId ?? null,
        actorRole: session.role ?? "admin",
      });
    }
    return row!;
  });

  res.json(await buildResponse(updated));
});

// ─── System admins (role=admin) ──────────────────────────────────

router.get("/admin/admins", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin role required", code: "auth.admin_required" });
    return;
  }
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      email: usersTable.email,
      username: usersTable.username,
      suspendedAt: usersTable.suspendedAt,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  res.json(rows);
});

// Generate a 16-char URL-safe temp password. base64url over 12 random
// bytes gives ~16 chars without padding and no easily-confused glyphs.
function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

router.post("/admin/admins", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin role required", code: "auth.admin_required" });
    return;
  }
  const parsed = CreateAdminUserBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  // username == email by convention for admin accounts (mirrors the
  // partner/vendor onboarding flow). Lowercase the email so case-only
  // duplicates ("Alice@x" vs "alice@x") collide as intended.
  const email = parsed.data.email.trim().toLowerCase();
  const displayName = parsed.data.displayName.trim();

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, email));
  if (existing) {
    res.status(409).json({ error: "Email already registered", code: "accounts.email_exists" });
    return;
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  let created;
  try {
    [created] = await db
      .insert(usersTable)
      .values({
        username: email,
        email,
        passwordHash,
        role: "admin",
        displayName,
        mustChangePassword: true,
      })
      .returning({
        id: usersTable.id,
        displayName: usersTable.displayName,
        email: usersTable.email,
        username: usersTable.username,
        suspendedAt: usersTable.suspendedAt,
        createdAt: usersTable.createdAt,
      });
  } catch (err: any) {
    // Race with another admin inserting the same email — translate the
    // unique-violation into the same 409 the precheck would have given.
    if (err?.code === "23505") {
      res.status(409).json({ error: "Email already registered", code: "accounts.email_exists" });
      return;
    }
    logger.error({ err }, "Failed to create admin user");
    res.status(500).json({ error: "Failed to create admin user", code: "accounts.create_failed" });
    return;
  }

  res.status(201).json({ user: created, temporaryPassword: tempPassword });
});

// ─── Demo-account picker labels (admin-editable, per locale) ─────
//
// The canonical list of demo accounts still lives in source so seeding
// stays self-contained, but each (username, locale) display label can
// be overridden from `demo_user_label_overrides` so non-engineers can
// retranslate the picker without a code deploy. The GET endpoint
// returns the merged view (defaults + any overrides) so the UI can
// show "no override / falling back to <default>" hints; PUT upserts a
// single override (or clears it back to the source default when label
// is null).

router.get("/admin/demo-user-labels", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin role required", code: "auth.admin_required" });
    return;
  }
  const entries = await listDemoLabelEntries();
  res.json({ locales: [...DEMO_LOCALES], entries });
});

router.put("/admin/demo-user-labels", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin role required", code: "auth.admin_required" });
    return;
  }
  const parsed = UpsertDemoUserLabelBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const { username, locale, label } = parsed.data;
  if (!isValidDemoUsername(username)) {
    res.status(404).json({ error: "Unknown demo username", code: "demo_users.unknown_username" });
    return;
  }
  if (!isValidDemoLocale(locale)) {
    res.status(400).json({ error: "Unsupported locale", code: "demo_users.unsupported_locale" });
    return;
  }
  // null/empty label = clear the override and fall back to the source
  // default. Any other value upserts the override row.
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (label === null || trimmed.length === 0) {
    await clearDemoLabelOverride({ username, locale });
  } else {
    await upsertDemoLabelOverride({ username, locale, label: trimmed });
  }
  const entries = await listDemoLabelEntries();
  res.json({ locales: [...DEMO_LOCALES], entries });
});

export default router;
