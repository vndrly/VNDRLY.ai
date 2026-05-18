// Admin CRUD for the IRS FIRE transmitter info written into every
// 1099 e-file submission. Backed by the `fire_transmitter_settings`
// singleton row. See lib/reports/transmitter-settings.ts for the
// shared resolver the FIRE generator uses.
//
// Endpoints:
//   GET /admin/1099-transmitter-settings — admin-only, returns the
//     singleton row's values plus a `missing` array of fields that
//     would block a real (non-test) submission.
//   PUT /admin/1099-transmitter-settings — admin-only, validates with
//     the same rules the e-file route enforces, replaces every column
//     in one write, and appends an audit row capturing the diff.

import { Router, type IRouter, type Request } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  fireTransmitterSettingsTable,
  fireTransmitterSettingsAuditLogTable,
  usersTable,
  type FireTransmitterSettings,
} from "@workspace/db";
import { UpdateFireTransmitterSettingsBody } from "@workspace/api-zod";
import { requireAdmin, getSessionFromRequest } from "../lib/session";
import { logger } from "../lib/logger";
import { sendValidationFailed } from "../lib/validation-error";
import {
  FIRE_TRANSMITTER_SETTINGS_ID,
  TRANSMITTER_FIELDS,
  effectiveFromRow,
  readFireTransmitterRow,
  validateEffective,
  type EffectiveTransmitter,
} from "../lib/reports/transmitter-settings";

const router: IRouter = Router();

interface FireTransmitterSettingsResponse {
  tcc: string | null;
  ein: string | null;
  name: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  updatedAt: string | null;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedByEmail: string | null;
  missing: string[];
}

// What the GET returns: the *raw* DB row values (so the form can show
// blanks for never-saved fields), plus a `missing` list computed
// against the same values so the UI can highlight which fields still
// need to be filled in before a real (non-test) FIRE submission will
// be accepted.
function toGetResponse(
  row: FireTransmitterSettings | null,
  updatedBy: { displayName: string | null; email: string | null } | null = null,
): FireTransmitterSettingsResponse {
  const effective = effectiveFromRow(row);
  const validation = validateEffective(effective);
  return {
    tcc: row?.tcc ?? null,
    ein: row?.ein ?? null,
    name: row?.name ?? null,
    address: row?.address ?? null,
    contactName: row?.contactName ?? null,
    contactEmail: row?.contactEmail ?? null,
    contactPhone: row?.contactPhone ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    updatedByUserId: row?.updatedByUserId ?? null,
    updatedByName: updatedBy?.displayName ?? null,
    updatedByEmail: updatedBy?.email ?? null,
    missing: validation.ok ? [] : validation.missing,
  };
}

async function lookupActor(
  userId: number | null,
): Promise<{ displayName: string | null; email: string | null } | null> {
  if (!userId) return null;
  const [u] = await db
    .select({ displayName: usersTable.displayName, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return u
    ? { displayName: u.displayName ?? null, email: u.email ?? null }
    : null;
}

router.get(
  "/admin/1099-transmitter-settings",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const row = await readFireTransmitterRow();
    const actor = await lookupActor(row?.updatedByUserId ?? null);
    res.json(toGetResponse(row, actor));
  },
);

function actorIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  return (
    (Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    null
  );
}

function diffColumns(
  before: FireTransmitterSettings | null,
  after: EffectiveTransmitter,
): Record<string, { before: string | null; after: string }> {
  const changes: Record<string, { before: string | null; after: string }> = {};
  for (const field of TRANSMITTER_FIELDS) {
    const prev = (before?.[field] ?? null) as string | null;
    const next = after[field];
    if ((prev ?? "") !== next) {
      changes[field] = { before: prev, after: next };
    }
  }
  return changes;
}

// History view used by the admin "1099 transmitter" page so support
// can answer "who saved this last week?" without dropping into psql.
// Joins to `users` for the actor's display name + email at read time
// (the FK is `ON DELETE SET NULL`, so both fall back to NULL when the
// admin who saved has since been deleted). Newest first; paged with
// `limit` / `offset` mirroring the vendor-merge audit endpoint so
// future "Load more" UX stays consistent.
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;

router.get(
  "/admin/1099-transmitter-settings/history",
  requireAdmin,
  async (req, res): Promise<void> => {
    let limit = Number(req.query.limit ?? HISTORY_DEFAULT_LIMIT);
    if (!Number.isFinite(limit) || limit < 1) limit = HISTORY_DEFAULT_LIMIT;
    if (limit > HISTORY_MAX_LIMIT) limit = HISTORY_MAX_LIMIT;
    limit = Math.floor(limit);

    let offset = Number(req.query.offset ?? 0);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    offset = Math.floor(offset);

    const rows = await db
      .select({
        id: fireTransmitterSettingsAuditLogTable.id,
        createdAt: fireTransmitterSettingsAuditLogTable.createdAt,
        changes: fireTransmitterSettingsAuditLogTable.changes,
        actorUserId: fireTransmitterSettingsAuditLogTable.actorUserId,
        actorDisplayName: usersTable.displayName,
        actorEmail: usersTable.email,
        actorRole: fireTransmitterSettingsAuditLogTable.actorRole,
        actorIp: fireTransmitterSettingsAuditLogTable.actorIp,
        actorUserAgent: fireTransmitterSettingsAuditLogTable.actorUserAgent,
      })
      .from(fireTransmitterSettingsAuditLogTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, fireTransmitterSettingsAuditLogTable.actorUserId),
      )
      .orderBy(
        desc(fireTransmitterSettingsAuditLogTable.createdAt),
        desc(fireTransmitterSettingsAuditLogTable.id),
      )
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`cast(count(*) as integer)` })
      .from(fireTransmitterSettingsAuditLogTable);

    res.json({
      items: rows.map((r) => ({
        ...r,
        createdAt:
          r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      })),
      total,
      limit,
      offset,
    });
  },
);

router.put(
  "/admin/1099-transmitter-settings",
  requireAdmin,
  async (req, res): Promise<void> => {
    const session = getSessionFromRequest(req);
    // requireAdmin guarantees a session; this narrows for TS and is
    // defensive in case middleware ordering ever changes.
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    const parsed = UpdateFireTransmitterSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
      return;
    }

    // Trim every value before validating + persisting. The IRS T
    // record has no use for leading/trailing whitespace and a
    // typo'd " 9XYZ1" would otherwise sail through min(1).
    const next: EffectiveTransmitter = {
      tcc: parsed.data.tcc.trim(),
      ein: parsed.data.ein.trim(),
      name: parsed.data.name.trim(),
      address: parsed.data.address.trim(),
      contactName: parsed.data.contactName.trim(),
      contactEmail: parsed.data.contactEmail.trim(),
      contactPhone: parsed.data.contactPhone.trim(),
    };

    // Re-run the same validator the FIRE e-file route uses against the
    // newly-supplied values so a save can never sneak an incomplete
    // row past the gate.
    const validation = validateEffective(next);
    if (!validation.ok) {
      res.status(400).json({
        error:
          "Transmitter info is incomplete. Address must be parseable as 'Street, City, ST 12345' and every field is required.",
        code: "fire_transmitter.invalid",
        missing: validation.missing,
      });
      return;
    }

    const ip = actorIp(req);
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;

    let updated: FireTransmitterSettings;
    try {
      updated = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(fireTransmitterSettingsTable)
          .where(
            eq(fireTransmitterSettingsTable.id, FIRE_TRANSMITTER_SETTINGS_ID),
          );
        const changes = diffColumns(before ?? null, next);
        const values = {
          id: FIRE_TRANSMITTER_SETTINGS_ID,
          ...next,
          updatedAt: new Date(),
          updatedByUserId: session.userId ?? null,
        };
        const [row] = await tx
          .insert(fireTransmitterSettingsTable)
          .values(values)
          .onConflictDoUpdate({
            target: fireTransmitterSettingsTable.id,
            set: {
              tcc: values.tcc,
              ein: values.ein,
              name: values.name,
              address: values.address,
              contactName: values.contactName,
              contactEmail: values.contactEmail,
              contactPhone: values.contactPhone,
              updatedAt: values.updatedAt,
              updatedByUserId: values.updatedByUserId,
            },
          })
          .returning();
        // Only audit when something actually changed — clicking Save
        // on an unchanged form shouldn't pollute the timeline.
        if (Object.keys(changes).length > 0) {
          await tx.insert(fireTransmitterSettingsAuditLogTable).values({
            changes,
            actorUserId: session.userId ?? null,
            actorRole: session.role ?? "admin",
            actorIp: ip,
            actorUserAgent: ua,
          });
        }
        return row;
      });
    } catch (err) {
      logger.error({ err }, "Failed to save FIRE transmitter settings");
      res.status(500).json({
        error: "Failed to save transmitter settings",
        code: "fire_transmitter.save_failed",
      });
      return;
    }
    const actor = await lookupActor(updated.updatedByUserId ?? null);
    res.json(toGetResponse(updated, actor));
  },
);

export default router;
