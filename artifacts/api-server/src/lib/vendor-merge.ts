/**
 * Shared vendor-merge primitives used by both the legacy
 * `scripts/dedupe-vendors.ts` batch job and the admin-facing
 * `POST /vendors/:id/merge-into` HTTP endpoint.
 *
 * The merge re-points every vendor-scoped FK row from a "loser" vendor
 * onto a chosen "survivor" vendor, dropping rows whose unique-scope
 * already exists on the survivor (so an UPDATE never violates a unique
 * index). Tables guarded only by a partial unique index are checked via
 * an explicit preflight query — the heuristic conflict-drop must NOT be
 * applied to partial indexes (it would over-delete unrelated rows).
 *
 * All functions take a `PoolClient` so the caller controls the
 * surrounding transaction boundary. The contract is:
 *   - planMerge(client, survivor, loser) — read-only; safe to call inside
 *     a BEGIN/ROLLBACK pair to produce a preview without mutating data.
 *   - applyMerge(client, survivor, loser) — mutating; caller must wrap in
 *     a transaction so a failure rolls every FK rewrite back together.
 *
 * Both functions throw `PartialConflictError` when a partial-index
 * preflight finds a real collision (e.g. two draft invoices for the
 * same period); the caller should surface this as a 409.
 */
import type { PoolClient } from "pg";

/** Per-table FK-rewrite descriptor. See the comments below for what
 *  `uniqueScope` and `partialConflictPreflight` mean. */
export type FkTable = {
  table: string;
  fkColumn: string;
  /**
   * If non-null, the column list of a FULL (non-partial) unique index that
   * scopes by `fkColumn`. When set, the merge skip-and-deletes loser rows
   * whose scope already exists on the survivor (so the UPDATE doesn't
   * violate the unique index).
   *
   * IMPORTANT: only use this for indexes that are unconditional. Partial
   * unique indexes (e.g. WHERE status='draft') must NOT be modeled here —
   * the heuristic would over-delete rows that don't actually conflict.
   * Such tables must rely on `partialConflictPreflight` instead.
   */
  uniqueScope: string[] | null;
  /**
   * Optional preflight SQL run once per (survivor, loser) pair. If it
   * returns any rows the merge is aborted with a hard error. Use this for
   * tables whose only conflict surface is a partial unique index — we
   * detect collisions explicitly so the transaction never silently
   * deletes data (and never throws an opaque unique-violation deep in
   * the merge).
   *
   * The query receives the survivor id as $1 and the loser id as $2 and
   * should return zero rows when it is safe to proceed.
   */
  partialConflictPreflight?: {
    description: string;
    sql: string;
  };
};

/**
 * Every table that references vendors.id, with the scoping columns of
 * any unique constraint that includes vendor_id. Kept in sync with
 * lib/db/src/schema — adding a new vendor-scoped FK requires adding a
 * row here so manual + scripted merges both move it.
 */
export const FK_TABLES: FkTable[] = [
  { table: "tickets", fkColumn: "vendor_id", uniqueScope: null },
  {
    table: "invoices",
    fkColumn: "vendor_id",
    // The two unique indexes on invoices are PARTIAL — they only enforce
    // uniqueness for status='draft' rows (see invoices_unique_draft_per_period
    // and invoices_unique_supplemental_draft_per_period). We must not
    // conflict-drop here, otherwise we'd risk deleting a sent/paid
    // invoice on the loser just because the survivor has a draft for
    // the same (partner, cadence, period). Move every invoice and let
    // the partial-index preflight catch the only real collision case.
    uniqueScope: null,
    partialConflictPreflight: {
      description:
        "draft invoices on both survivor and loser for the same (partner, cadence, period) — would violate invoices_unique_draft_per_period after merge",
      sql: `
        SELECT s.id AS survivor_invoice_id, l.id AS loser_invoice_id,
               s.partner_id, s.cadence, s.period_start,
               COALESCE(s.supplemental_of_invoice_id::text, '∅') AS supplemental_of
        FROM invoices s
        JOIN invoices l
          ON s.partner_id IS NOT DISTINCT FROM l.partner_id
         AND s.cadence    IS NOT DISTINCT FROM l.cadence
         AND s.period_start IS NOT DISTINCT FROM l.period_start
         AND s.supplemental_of_invoice_id IS NOT DISTINCT FROM l.supplemental_of_invoice_id
        WHERE s.vendor_id = $1
          AND l.vendor_id = $2
          AND s.status = 'draft'
          AND l.status = 'draft'
      `,
    },
  },
  {
    table: "tax_1099_filings",
    fkColumn: "recipient_vendor_id",
    // tax_1099_filings_unique: (tax_year, form_type, payer_partner_id, recipient_vendor_id)
    uniqueScope: [
      "tax_year",
      "form_type",
      "payer_partner_id",
      "recipient_vendor_id",
    ],
  },
  {
    table: "vendor_ratings",
    fkColumn: "vendor_id",
    // vendor_ratings_vendor_partner_unique: (vendor_id, partner_id)
    uniqueScope: ["vendor_id", "partner_id"],
  },
  {
    table: "vendor_partner_billing_settings",
    fkColumn: "vendor_id",
    // vp_billing_settings_unique: (vendor_id, partner_id)
    uniqueScope: ["vendor_id", "partner_id"],
  },
  {
    table: "partner_vendor_relationships",
    fkColumn: "vendor_id",
    // partner_vendor_relationship_unique: (partner_id, vendor_id)
    uniqueScope: ["partner_id", "vendor_id"],
  },
  {
    table: "vendor_site_location_afes",
    fkColumn: "vendor_id",
    // vendor_site_location_afe_unique: (vendor_id, site_location_id)
    uniqueScope: ["vendor_id", "site_location_id"],
  },
  {
    table: "vendor_work_types",
    fkColumn: "vendor_id",
    // No DB-level unique index, but the row is logically (vendor_id, work_type_id).
    // We dedupe so the survivor never ends up with two rows for the same work type.
    uniqueScope: ["vendor_id", "work_type_id"],
  },
  { table: "vendor_people", fkColumn: "vendor_id", uniqueScope: null },
  { table: "vendor_notes", fkColumn: "vendor_id", uniqueScope: null },
  { table: "site_visits", fkColumn: "host_vendor_id", uniqueScope: null },
  { table: "site_work_assignments", fkColumn: "vendor_id", uniqueScope: null },
  { table: "hotlist_bids", fkColumn: "vendor_id", uniqueScope: null },
  { table: "hotlist_jobs", fkColumn: "awarded_vendor_id", uniqueScope: null },
  {
    table: "accounting_connections",
    fkColumn: "vendor_id",
    // accounting_conn_vendor_provider_uniq: (vendor_id, provider)
    uniqueScope: ["vendor_id", "provider"],
  },
  {
    table: "accounting_pushed_invoices",
    fkColumn: "vendor_id",
    // accounting_pushed_invoices_uniq: (vendor_id, provider, invoice_number)
    uniqueScope: ["vendor_id", "provider", "invoice_number"],
  },
  {
    table: "qb_account_mapping",
    fkColumn: "vendor_id",
    // qb_account_mapping_scope_line_type: (vendor_id, partner_id, line_type)
    uniqueScope: ["vendor_id", "partner_id", "line_type"],
  },
  {
    table: "qb_account_mapping_audit_log",
    fkColumn: "vendor_id",
    uniqueScope: null,
  },
  {
    table: "user_org_memberships",
    fkColumn: "vendor_id",
    // user_org_memberships_user_vendor_unique: (user_id, vendor_id)
    uniqueScope: ["user_id", "vendor_id"],
  },
];

/** Per-table counts produced by `planMerge` / `applyMerge`. */
export type MergeCounts = Record<
  string,
  { move: number; conflictDelete: number }
>;

/**
 * Per-table primary-key ids of rows the merge actually rewrote
 * (`moved`) or dropped because they would have collided on a
 * full-unique-index (`conflictDeleted`). Captured by `applyMerge`
 * via `RETURNING id` so a subsequent revert knows exactly which
 * rows on the survivor came from the loser, and which rows are
 * unrecoverable because they were physically deleted.
 *
 * The shape mirrors `MergeCounts` 1:1 so the audit-log row can
 * carry both side-by-side without divergence.
 */
export type MergedRowIds = Record<
  string,
  { moved: number[]; conflictDeleted: number[] }
>;

/** Result of `applyMerge` — counts (preserved for the existing audit
 *  log column and HTTP response) plus the new per-row id tracking
 *  used by the revert endpoint. */
export type ApplyMergeResult = {
  counts: MergeCounts;
  rowIds: MergedRowIds;
};

export class PartialConflictError extends Error {
  readonly code = "PARTIAL_CONFLICT";
  constructor(
    readonly table: string,
    readonly description: string,
    readonly rows: Array<Record<string, unknown>>,
    survivorId: number,
    loserId: number,
  ) {
    super(
      `Partial-index conflict on ${table} merging vendor #${loserId} → #${survivorId}: ` +
        `${description}. ${rows.length} colliding row(s); aborting merge.`,
    );
    this.name = "PartialConflictError";
  }
}

/**
 * Run every table's partial-index preflight. Throws `PartialConflictError`
 * on the first collision; otherwise returns silently. Safe to call inside
 * the read-only planning transaction OR inside the apply transaction —
 * both code paths must guard the merge.
 */
export async function runPartialPreflights(
  client: PoolClient,
  survivorId: number,
  loserId: number,
): Promise<void> {
  for (const fk of FK_TABLES) {
    if (!fk.partialConflictPreflight) continue;
    const r = await client.query(fk.partialConflictPreflight.sql, [
      survivorId,
      loserId,
    ]);
    if (r.rowCount && r.rowCount > 0) {
      throw new PartialConflictError(
        fk.table,
        fk.partialConflictPreflight.description,
        r.rows,
        survivorId,
        loserId,
      );
    }
  }
}

/**
 * Read-only plan: count rows that would move from `loser` to `survivor`,
 * and rows that would be conflict-dropped because the survivor already
 * holds the same unique-scope key. Caller is expected to wrap this in a
 * BEGIN/ROLLBACK so any incidental locks are released.
 */
export async function planMerge(
  client: PoolClient,
  survivorId: number,
  loserId: number,
): Promise<MergeCounts> {
  await runPartialPreflights(client, survivorId, loserId);
  const counts: MergeCounts = {};
  for (const fk of FK_TABLES) {
    const totalQ = await client.query(
      `SELECT COUNT(*)::int AS c FROM ${fk.table} WHERE ${fk.fkColumn} = $1`,
      [loserId],
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
        [survivorId, loserId],
      );
      conflictDelete = c.rows[0].c as number;
    }
    counts[fk.table] = { move: total - conflictDelete, conflictDelete };
  }
  return counts;
}

/**
 * Apply the merge: rewrite every FK row from `loser` onto `survivor`,
 * dropping conflict rows first so the UPDATE never violates a unique
 * index. Finally deletes the `loser` vendor row. Caller MUST wrap in a
 * single transaction.
 */
export async function applyMerge(
  client: PoolClient,
  survivorId: number,
  loserId: number,
): Promise<ApplyMergeResult> {
  await runPartialPreflights(client, survivorId, loserId);
  const counts: MergeCounts = {};
  const rowIds: MergedRowIds = {};
  for (const fk of FK_TABLES) {
    let conflictDelete = 0;
    const conflictDeletedIds: number[] = [];
    if (fk.uniqueScope) {
      const otherCols = fk.uniqueScope.filter((c) => c !== fk.fkColumn);
      const joinPredicate = otherCols
        .map((c) => `s.${c} IS NOT DISTINCT FROM t.${c}`)
        .join(" AND ");
      // RETURNING id captures the actual loser-side rows that get
      // dropped so the audit log can surface them as "unrecoverable"
      // when an admin later tries to undo the merge — they were
      // physically removed and a revert cannot reinstate them.
      const delQ = await client.query<{ id: number }>(
        `
          DELETE FROM ${fk.table} t
          WHERE t.${fk.fkColumn} = $1
            AND EXISTS (
              SELECT 1 FROM ${fk.table} s
              WHERE s.${fk.fkColumn} = $2
                ${joinPredicate ? "AND " + joinPredicate : ""}
            )
          RETURNING id
        `,
        [loserId, survivorId],
      );
      conflictDelete = delQ.rowCount ?? 0;
      for (const r of delQ.rows) conflictDeletedIds.push(Number(r.id));
    }
    // RETURNING id captures the primary keys we just re-pointed onto
    // the survivor so a later revert can find the same rows and put
    // them back on the restored loser, no matter what the survivor
    // has accumulated since.
    const upQ = await client.query<{ id: number }>(
      `UPDATE ${fk.table} SET ${fk.fkColumn} = $1 WHERE ${fk.fkColumn} = $2 RETURNING id`,
      [survivorId, loserId],
    );
    const movedIds = upQ.rows.map((r) => Number(r.id));
    counts[fk.table] = { move: upQ.rowCount ?? 0, conflictDelete };
    rowIds[fk.table] = { moved: movedIds, conflictDeleted: conflictDeletedIds };
  }
  await client.query(`DELETE FROM vendors WHERE id = $1`, [loserId]);
  return { counts, rowIds };
}

/** Result of `repointMerge`. `repointed` mirrors `MergeCounts.move`
 *  (per-table count of rows successfully moved back to the loser),
 *  `repointedRowIds` is the list of primary keys actually moved (the
 *  intersection of the audit-log's tracked ids and what still lives
 *  on the survivor today), `missing` is the tracked ids that no
 *  longer point at the survivor (deleted, re-merged elsewhere, etc.),
 *  and `unrecoverable` lists the conflict-deleted rows from the
 *  original merge — they were physically removed and the revert
 *  cannot bring them back. */
export type RepointMergeResult = {
  repointed: Record<string, number>;
  repointedRowIds: Record<string, number[]>;
  missing: Record<string, number[]>;
  unrecoverable: Record<string, number[]>;
};

/**
 * Inverse of `applyMerge`'s FK-rewrite step: re-point the rows the
 * audit log says we moved off the loser back onto the loser. Caller
 * MUST wrap in a single transaction so any unique-violation midway
 * through aborts the whole revert. The loser vendor row is expected
 * to already exist (the revert endpoint restores it from the
 * snapshot before calling this).
 *
 * Each table's UPDATE is scoped by `id IN (trackedIds) AND fkColumn
 * = survivorId` so we never accidentally re-point a row the
 * survivor created independently after the merge.
 */
export async function repointMerge(
  client: PoolClient,
  survivorId: number,
  loserId: number,
  trackedRowIds: MergedRowIds,
): Promise<RepointMergeResult> {
  const repointed: Record<string, number> = {};
  const repointedRowIds: Record<string, number[]> = {};
  const missing: Record<string, number[]> = {};
  const unrecoverable: Record<string, number[]> = {};

  for (const fk of FK_TABLES) {
    const tracked = trackedRowIds[fk.table];
    if (!tracked) {
      // No tracking for this table (audit log predates this column or
      // a new FK_TABLES entry was added after the merge ran). Treat
      // as nothing-to-do — admin can hand-fix anything that drifted.
      repointed[fk.table] = 0;
      repointedRowIds[fk.table] = [];
      missing[fk.table] = [];
      unrecoverable[fk.table] = [];
      continue;
    }
    const movedIds = tracked.moved ?? [];
    const dropped = tracked.conflictDeleted ?? [];
    if (movedIds.length === 0) {
      repointed[fk.table] = 0;
      repointedRowIds[fk.table] = [];
      missing[fk.table] = [];
      if (dropped.length > 0) unrecoverable[fk.table] = dropped;
      else unrecoverable[fk.table] = [];
      continue;
    }
    const upQ = await client.query<{ id: number }>(
      `UPDATE ${fk.table} SET ${fk.fkColumn} = $1
         WHERE ${fk.fkColumn} = $2 AND id = ANY($3::int[])
         RETURNING id`,
      [loserId, survivorId, movedIds],
    );
    const movedBack = upQ.rows.map((r) => Number(r.id));
    const movedBackSet = new Set(movedBack);
    repointed[fk.table] = upQ.rowCount ?? 0;
    repointedRowIds[fk.table] = movedBack;
    missing[fk.table] = movedIds.filter((id) => !movedBackSet.has(id));
    unrecoverable[fk.table] = dropped;
  }
  return { repointed, repointedRowIds, missing, unrecoverable };
}

/** Sum of moved rows across every FK table. Used by the audit log and
 *  the API response so the caller can show "moved 41 rows" without
 *  re-summing client-side. */
export function totalMoved(counts: MergeCounts): number {
  let n = 0;
  for (const c of Object.values(counts)) n += c.move;
  return n;
}

/** Sum of conflict-dropped rows across every FK table. */
export function totalConflictDeleted(counts: MergeCounts): number {
  let n = 0;
  for (const c of Object.values(counts)) n += c.conflictDelete;
  return n;
}
