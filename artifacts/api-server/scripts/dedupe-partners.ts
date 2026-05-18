/**
 * Dedupe legacy duplicate partner rows.
 *
 * The vendors table grew the same problem first: repeated demo seeds and
 * hand-edited rows produced near-duplicate operator rows whose only
 * difference was casing or surrounding whitespace ("ExxonMobil" vs
 * "exxonmobil  "). Without a DB-level guard, the next re-seed of
 * `seed-permian-basin.ts` would silently insert another splinter row,
 * splitting site_locations, invoices, vendor_ratings, user_org_memberships,
 * etc. across two operator rows.
 *
 * This script:
 *   1. Auto-detects duplicate groups by canonical name
 *      (`lower(btrim(name))`). No hard-coded list — the partners seed has
 *      no historical brand renames to track, unlike vendors.
 *   2. Picks the lowest-id row in each group as the survivor (oldest row,
 *      most likely to own the existing FKs).
 *   3. Re-points every partner FK (invoices, partner_contacts,
 *      partner_notes, partner_vendor_relationships, partner_work_type_afes,
 *      site_locations, site_visits.host_partner_id, hotlist_jobs,
 *      vendor_ratings, vendor_partner_billing_settings, qb_account_mapping,
 *      qb_account_mapping_audit_log, tax_1099_filings.payer_partner_id,
 *      user_org_memberships) onto the survivor and deletes the loser rows.
 *
 * Tables with a FULL unique constraint that scopes by partner_id are
 * merged with conflict handling: if the survivor already has the
 * conflicting row we drop the loser's row instead of moving it. The only
 * partial unique index (`invoices_unique_draft_per_period`) is checked
 * up-front via `partialConflictPreflight` so the merge aborts cleanly
 * instead of throwing an opaque unique-violation deep in the move.
 *
 * Run modes:
 *   pnpm --filter @workspace/api-server exec tsx scripts/dedupe-partners.ts
 *     → DRY RUN. Prints the pre-flight report only, makes no DB changes.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/dedupe-partners.ts --apply
 *     → APPLY. Runs the merge inside a single transaction.
 *
 * Idempotent. Safe to re-run; once a duplicate group is collapsed the
 * canonical-name query stops returning it and the script exits clean.
 */
import { pool, db, partnersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";

/**
 * Every table that references partners.id, with the scoping columns of
 * any FULL (non-partial) unique index that includes the partner FK.
 * Partial unique indexes must use `partialConflictPreflight` instead so
 * the merge does not silently drop rows that do not actually conflict.
 */
type FkTable = {
  table: string;
  fkColumn: string;
  uniqueScope: string[] | null;
  partialConflictPreflight?: {
    description: string;
    sql: string;
  };
};

const FK_TABLES: FkTable[] = [
  {
    table: "invoices",
    fkColumn: "partner_id",
    // The two unique indexes on invoices are PARTIAL — they only enforce
    // uniqueness for status='draft' rows. We must not conflict-drop here
    // because we'd risk deleting a sent/paid invoice on the loser just
    // because the survivor has a draft for the same period. Move every
    // invoice and let the partial-index preflight catch real collisions.
    uniqueScope: null,
    partialConflictPreflight: {
      description:
        "draft invoices on both survivor and loser for the same (vendor, cadence, period) — would violate invoices_unique_draft_per_period after merge",
      sql: `
        SELECT s.id AS survivor_invoice_id, l.id AS loser_invoice_id,
               s.vendor_id, s.cadence, s.period_start,
               COALESCE(s.supplemental_of_invoice_id::text, '∅') AS supplemental_of
        FROM invoices s
        JOIN invoices l
          ON s.vendor_id IS NOT DISTINCT FROM l.vendor_id
         AND s.cadence    IS NOT DISTINCT FROM l.cadence
         AND s.period_start IS NOT DISTINCT FROM l.period_start
         AND s.supplemental_of_invoice_id IS NOT DISTINCT FROM l.supplemental_of_invoice_id
        WHERE s.partner_id = $1
          AND l.partner_id = $2
          AND s.status = 'draft'
          AND l.status = 'draft'
          -- Mirror the partial-index predicate exactly. Both
          -- invoices_unique_draft_per_period and
          -- invoices_unique_supplemental_draft_per_period exclude
          -- per_ticket cadence, so per-ticket drafts can coexist on
          -- the survivor and loser without violating the index. The
          -- supplemental_of_invoice_id IS NOT DISTINCT FROM join
          -- predicate above already covers both indexes (NULL=NULL
          -- for non-supplemental, same-id=same-id for supplemental).
          AND s.cadence <> 'per_ticket'
          AND l.cadence <> 'per_ticket'
      `,
    },
  },
  { table: "partner_contacts", fkColumn: "partner_id", uniqueScope: null },
  { table: "partner_notes", fkColumn: "partner_id", uniqueScope: null },
  {
    table: "partner_vendor_relationships",
    fkColumn: "partner_id",
    // partner_vendor_relationship_unique: (partner_id, vendor_id)
    uniqueScope: ["partner_id", "vendor_id"],
  },
  {
    table: "partner_work_type_afes",
    fkColumn: "partner_id",
    // partner_work_type_afe_unique: (partner_id, work_type_id)
    uniqueScope: ["partner_id", "work_type_id"],
  },
  // site_locations.site_code is globally unique (not partner-scoped), so
  // moving a site row onto the survivor cannot violate a unique scope.
  { table: "site_locations", fkColumn: "partner_id", uniqueScope: null },
  { table: "site_visits", fkColumn: "host_partner_id", uniqueScope: null },
  { table: "hotlist_jobs", fkColumn: "partner_id", uniqueScope: null },
  {
    table: "vendor_ratings",
    fkColumn: "partner_id",
    // vendor_ratings_vendor_partner_unique: (vendor_id, partner_id)
    uniqueScope: ["vendor_id", "partner_id"],
  },
  {
    table: "vendor_partner_billing_settings",
    fkColumn: "partner_id",
    // vp_billing_settings_unique: (vendor_id, partner_id)
    uniqueScope: ["vendor_id", "partner_id"],
  },
  {
    table: "qb_account_mapping",
    fkColumn: "partner_id",
    // qb_account_mapping_scope_line_type: (vendor_id, partner_id, line_type)
    uniqueScope: ["vendor_id", "partner_id", "line_type"],
  },
  {
    table: "qb_account_mapping_audit_log",
    fkColumn: "partner_id",
    uniqueScope: null,
  },
  {
    table: "tax_1099_filings",
    fkColumn: "payer_partner_id",
    // tax_1099_filings_unique: (tax_year, form_type, payer_partner_id, recipient_vendor_id)
    uniqueScope: [
      "tax_year",
      "form_type",
      "payer_partner_id",
      "recipient_vendor_id",
    ],
  },
  {
    table: "user_org_memberships",
    fkColumn: "partner_id",
    // user_org_memberships_user_partner_unique: (user_id, partner_id)
    uniqueScope: ["user_id", "partner_id"],
  },
];

type PartnerRow = { id: number; name: string };

type Counts = Record<string, { move: number; conflictDelete: number }>;

class PartialConflictError extends Error {
  constructor(
    readonly table: string,
    readonly description: string,
    readonly rows: Array<Record<string, unknown>>,
    survivorId: number,
    loserId: number,
  ) {
    super(
      `Partial-index conflict on ${table} merging partner #${loserId} → #${survivorId}: ` +
        `${description}. ${rows.length} colliding row(s); aborting merge.`,
    );
  }
}

async function runPartialPreflights(
  client: PoolClient,
  survivor: PartnerRow,
  loser: PartnerRow,
): Promise<void> {
  for (const fk of FK_TABLES) {
    if (!fk.partialConflictPreflight) continue;
    const r = await client.query(fk.partialConflictPreflight.sql, [
      survivor.id,
      loser.id,
    ]);
    if (r.rowCount && r.rowCount > 0) {
      throw new PartialConflictError(
        fk.table,
        fk.partialConflictPreflight.description,
        r.rows,
        survivor.id,
        loser.id,
      );
    }
  }
}

async function planForGroup(
  client: PoolClient,
  survivor: PartnerRow,
  loser: PartnerRow,
): Promise<Counts> {
  await runPartialPreflights(client, survivor, loser);
  const counts: Counts = {};
  for (const fk of FK_TABLES) {
    const totalQ = await client.query(
      `SELECT COUNT(*)::int AS c FROM ${fk.table} WHERE ${fk.fkColumn} = $1`,
      [loser.id],
    );
    const total = totalQ.rows[0].c as number;
    let conflictDelete = 0;
    if (total > 0 && fk.uniqueScope) {
      const otherCols = fk.uniqueScope.filter((c) => c !== fk.fkColumn);
      const joinPredicate = otherCols
        .map((c) => `s.${c} IS NOT DISTINCT FROM t.${c}`)
        .join(" AND ");
      const c = await client.query(
        `
          SELECT COUNT(*)::int AS c
          FROM ${fk.table} s
          WHERE s.${fk.fkColumn} = $2
            AND EXISTS (
              SELECT 1 FROM ${fk.table} t
              WHERE t.${fk.fkColumn} = $1
                ${joinPredicate ? "AND " + joinPredicate : ""}
            )
        `,
        [survivor.id, loser.id],
      );
      conflictDelete = c.rows[0].c as number;
    }
    counts[fk.table] = { move: total - conflictDelete, conflictDelete };
  }
  return counts;
}

async function applyMerge(
  client: PoolClient,
  survivor: PartnerRow,
  loser: PartnerRow,
): Promise<Counts> {
  await runPartialPreflights(client, survivor, loser);
  const counts: Counts = {};
  for (const fk of FK_TABLES) {
    let conflictDelete = 0;
    if (fk.uniqueScope) {
      const otherCols = fk.uniqueScope.filter((c) => c !== fk.fkColumn);
      const joinPredicate = otherCols
        .map((c) => `s.${c} IS NOT DISTINCT FROM t.${c}`)
        .join(" AND ");
      const delQ = await client.query(
        `
          DELETE FROM ${fk.table} t
          WHERE t.${fk.fkColumn} = $1
            AND EXISTS (
              SELECT 1 FROM ${fk.table} s
              WHERE s.${fk.fkColumn} = $2
                ${joinPredicate ? "AND " + joinPredicate : ""}
            )
        `,
        [loser.id, survivor.id],
      );
      conflictDelete = delQ.rowCount ?? 0;
    }
    const upQ = await client.query(
      `UPDATE ${fk.table} SET ${fk.fkColumn} = $1 WHERE ${fk.fkColumn} = $2`,
      [survivor.id, loser.id],
    );
    counts[fk.table] = { move: upQ.rowCount ?? 0, conflictDelete };
  }
  await client.query(`DELETE FROM partners WHERE id = $1`, [loser.id]);
  return counts;
}

function fmtCounts(counts: Counts): string {
  const parts: string[] = [];
  for (const [table, c] of Object.entries(counts)) {
    if (c.move === 0 && c.conflictDelete === 0) continue;
    const bits: string[] = [];
    if (c.move > 0) bits.push(`${c.move} moved`);
    if (c.conflictDelete > 0) bits.push(`${c.conflictDelete} dropped (conflict)`);
    parts.push(`    ${table.padEnd(36)} ${bits.join(", ")}`);
  }
  return parts.length ? parts.join("\n") : "    (no FK rows to move)";
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "DEDUPE PARTNERS — APPLY mode (changes WILL be committed)"
      : "DEDUPE PARTNERS — DRY RUN (no changes; pass --apply to commit)",
  );
  console.log("");

  // Auto-detect duplicate groups by canonical name. Pulled with a single
  // query so we don't rely on a known list of brand renames the way
  // dedupe-vendors.ts does.
  const allPartners = (await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .orderBy(sql`${partnersTable.id} ASC`)) as PartnerRow[];

  const groups = new Map<string, PartnerRow[]>();
  for (const p of allPartners) {
    const canonical = p.name.trim().toLowerCase();
    const arr = groups.get(canonical);
    if (arr) arr.push(p);
    else groups.set(canonical, [p]);
  }

  type PlannedMerge = {
    survivor: PartnerRow;
    losers: PartnerRow[];
  };
  const plans: PlannedMerge[] = [];
  for (const [canonical, rows] of groups) {
    if (rows.length <= 1) continue;
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    const [survivor, ...losers] = sorted;
    plans.push({ survivor, losers });
    console.log(
      `· duplicate group "${canonical}" → ${rows.length} rows: survivor #${survivor.id} "${survivor.name}", losers ${losers
        .map((l) => `#${l.id} "${l.name}"`)
        .join(", ")}`,
    );
  }

  if (plans.length === 0) {
    console.log("No duplicate partner groups found. Database is clean.");
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { survivor, losers } of plans) {
      console.log("");
      console.log(`Group: survivor #${survivor.id} "${survivor.name}"`);
      for (const loser of losers) {
        const counts = await planForGroup(client, survivor, loser);
        console.log(`  ← merging #${loser.id} "${loser.name}"`);
        console.log(fmtCounts(counts));
      }
    }
    await client.query("ROLLBACK");

    if (!apply) {
      console.log("");
      console.log("Dry run complete. Re-run with --apply to commit the merge.");
      process.exit(0);
    }

    console.log("");
    console.log("Applying merge…");
    await client.query("BEGIN");
    let totalMoved = 0;
    let totalDropped = 0;
    let totalLosersDeleted = 0;
    for (const { survivor, losers } of plans) {
      for (const loser of losers) {
        const counts = await applyMerge(client, survivor, loser);
        for (const c of Object.values(counts)) {
          totalMoved += c.move;
          totalDropped += c.conflictDelete;
        }
        totalLosersDeleted++;
        console.log(
          `  ✓ merged #${loser.id} "${loser.name}" → #${survivor.id} "${survivor.name}"`,
        );
      }
    }
    await client.query("COMMIT");
    console.log("");
    console.log(
      `Done. Deleted ${totalLosersDeleted} duplicate partner row(s); ` +
        `moved ${totalMoved} FK rows; dropped ${totalDropped} conflicting loser rows.`,
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Best-effort rollback; ignore secondary errors.
    }
    throw err;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("dedupe-partners failed:", err);
  process.exit(1);
});
