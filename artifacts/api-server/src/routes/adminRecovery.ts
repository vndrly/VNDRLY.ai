import { Router } from "express";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, pool, usersTable, vendorsTable, partnersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

function checkSecret(req: import("express").Request, res: import("express").Response): boolean {
  const expected = process.env["ADMIN_RECOVERY_SECRET"];
  if (!expected || !expected.trim()) {
    res.status(404).json({ message: "Not found", code: "not_found" });
    return false;
  }
  const provided = String(req.header("x-recovery-secret") ?? "");
  if (provided.length !== expected.length || provided !== expected) {
    res.status(404).json({ message: "Not found", code: "not_found" });
    return false;
  }
  return true;
}

router.post("/admin/recovery/reset-password", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const username = String(req.body?.username ?? "").trim();
  const newPassword = String(req.body?.newPassword ?? "");
  if (!username || newPassword.length < 8) {
    return res.status(400).json({
      message: "username and newPassword (min 8 chars) required",
      code: "recovery.bad_request",
    });
  }

  const matches = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = lower(${username})`);

  if (matches.length === 0) {
    return res.status(404).json({ message: "user not found", code: "recovery.not_found" });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  for (const u of matches) {
    await db
      .update(usersTable)
      .set({
        passwordHash,
        sessionVersion: sql`${usersTable.sessionVersion} + 1`,
      })
      .where(sql`${usersTable.id} = ${u.id}`);
    logger.warn(
      { userId: u.id, username: u.username },
      "admin/recovery/reset-password applied (sessions invalidated)",
    );
  }

  return res.json({
    ok: true,
    updated: matches.map((m) => ({ id: m.id, username: m.username })),
  });
});

// One-shot dev→prod branding fill. Only writes a column when the
// current prod value IS NULL — never clobbers a value the user
// already set on prod. Body shape:
//   { rows: [{ table: "vendors"|"partners", id: number,
//       brand_primary_color?, brand_accent_color?, logo_url?,
//       logo_square_url?, blurb? }] }
router.post("/admin/recovery/sync-branding", async (req, res) => {
  if (!checkSecret(req, res)) return;

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) {
    return res
      .status(400)
      .json({ message: "rows[] required", code: "recovery.bad_request" });
  }

  type FieldKey =
    | "brand_primary_color"
    | "brand_accent_color"
    | "logo_url"
    | "logo_square_url"
    | "blurb";

  const FIELDS: FieldKey[] = [
    "brand_primary_color",
    "brand_accent_color",
    "logo_url",
    "logo_square_url",
    "blurb",
  ];

  const results: Array<{
    table: string;
    id: number;
    applied: Record<string, string>;
    skipped: Record<string, string>;
  }> = [];

  for (const r of rows) {
    const table = String(r?.table ?? "");
    const id = Number(r?.id);
    if (!Number.isFinite(id)) continue;
    const targetTable =
      table === "vendors"
        ? vendorsTable
        : table === "partners"
          ? partnersTable
          : null;
    if (!targetTable) continue;

    const tableSql = sql.raw(table);
    const applied: Record<string, string> = {};
    const skipped: Record<string, string> = {};
    for (const f of FIELDS) {
      // `blurb` only exists on vendors.
      if (f === "blurb" && table !== "vendors") continue;
      const incoming = r?.[f];
      if (incoming == null || incoming === "") continue;
      const colSql = sql.raw(f);
      // COALESCE-only update: leave any non-null prod value intact.
      const out = await db.execute(
        sql`UPDATE ${tableSql} SET ${colSql} = ${incoming}
            WHERE id = ${id} AND ${colSql} IS NULL
            RETURNING id`,
      );
      const rowCount = Array.isArray(out) ? out.length : (out as { rowCount?: number })?.rowCount ?? 0;
      if (rowCount > 0) {
        applied[f] = String(incoming);
      } else {
        skipped[f] = String(incoming);
      }
    }
    results.push({ table, id, applied, skipped });
    if (Object.keys(applied).length > 0) {
      logger.warn(
        { table, id, applied: Object.keys(applied) },
        "admin/recovery/sync-branding applied",
      );
    }
  }

  return res.json({ ok: true, results });
});

// Generic SQL exec, secret-guarded. Used to push a one-shot dev→prod
// data sync. Body shape:
//   { sql: string }    — single statement (extended protocol).
//   { script: string } — multi-statement script run via simple
//                        protocol on a single checked-out client,
//                        wrapped in BEGIN/COMMIT.
router.post("/admin/recovery/exec-sql", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const sqlText = req.body?.sql != null ? String(req.body.sql) : "";
  const scriptText = req.body?.script != null ? String(req.body.script) : "";
  if (!sqlText.trim() && !scriptText.trim()) {
    return res
      .status(400)
      .json({ message: "sql or script required", code: "recovery.bad_request" });
  }
  if (scriptText) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(scriptText);
      await client.query("COMMIT");
      const rowCount = Array.isArray(result)
        ? result.reduce((n, r) => n + ((r as { rowCount?: number })?.rowCount ?? 0), 0)
        : ((result as { rowCount?: number })?.rowCount ?? 0);
      logger.warn(
        { bytes: scriptText.length, rowCount },
        "admin/recovery/exec-sql script applied",
      );
      return res.json({ ok: true, rowCount });
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "admin/recovery/exec-sql script failed");
      return res.status(500).json({ ok: false, message });
    } finally {
      client.release();
    }
  }
  try {
    const result = await db.execute(sql.raw(sqlText));
    const rowCount = Array.isArray(result)
      ? result.length
      : (result as { rowCount?: number })?.rowCount ?? 0;
    logger.warn(
      { bytes: sqlText.length, rowCount },
      "admin/recovery/exec-sql applied",
    );
    return res.json({ ok: true, rowCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "admin/recovery/exec-sql failed");
    return res.status(500).json({ ok: false, message });
  }
});

export default router;
