// Helpers for capturing snapshots of QuickBooks mapping rows before a
// bulk-apply or CSV-import touches them, persisting the snapshot as a
// single "bulk action" row, and reverting (undoing) one of those actions.
// The snapshot lives in `qb_account_mapping_bulk_actions.snapshots` as a
// JSONB array — each entry records the previous and applied values for a
// single (vendorId, partnerId, lineType) cell so undo can either re-insert
// the original override row or strip a row that the bulk write created.

import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  qbAccountMappingTable,
  qbAccountMappingBulkActionsTable,
  type QbAccountMappingBulkActionKind,
  type QbBulkActionSnapshotEntry,
} from "@workspace/db";
import { getSessionFromRequest as getSession } from "../session";
import { logger } from "../logger";

export interface BulkScopeKey {
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
}

/**
 * Look up the existing override row at each (vendorId, partnerId, lineType)
 * cell and return a Map keyed by `${vendorId}|${partnerId}|${lineType}` so
 * the caller can do O(1) lookups while it iterates writes. Cells with no
 * existing row don't appear in the map (look-ups should treat the absence
 * as `null previous`).
 *
 * Done as one round-trip per cell because PG doesn't have a clean way to
 * combine NULL-vs-eq predicates across many rows in a single batched IN
 * clause without `IS NOT DISTINCT FROM` (PG-specific) or a derived table —
 * and bulk operations are already capped at 5,000 cells.
 */
export async function loadCurrentMappingsForCells(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts both db and tx
  exec: any,
  cells: ReadonlyArray<BulkScopeKey>,
): Promise<
  Map<
    string,
    {
      id: number;
      accountName: string;
      accountNumber: string | null;
    }
  >
> {
  const out = new Map<
    string,
    { id: number; accountName: string; accountNumber: string | null }
  >();
  for (const c of cells) {
    const rows = await exec
      .select({
        id: qbAccountMappingTable.id,
        accountName: qbAccountMappingTable.accountName,
        accountNumber: qbAccountMappingTable.accountNumber,
      })
      .from(qbAccountMappingTable)
      .where(
        and(
          c.vendorId == null
            ? isNull(qbAccountMappingTable.vendorId)
            : eq(qbAccountMappingTable.vendorId, c.vendorId),
          c.partnerId == null
            ? isNull(qbAccountMappingTable.partnerId)
            : eq(qbAccountMappingTable.partnerId, c.partnerId),
          eq(qbAccountMappingTable.lineType, c.lineType),
        ),
      );
    if (rows.length > 0) {
      out.set(snapshotKey(c), {
        id: rows[0].id,
        accountName: rows[0].accountName,
        accountNumber: rows[0].accountNumber,
      });
    }
  }
  return out;
}

export function snapshotKey(c: BulkScopeKey): string {
  return `${c.vendorId ?? "_"}|${c.partnerId ?? "_"}|${c.lineType}`;
}

export interface RecordBulkActionInput {
  req: Request;
  kind: QbAccountMappingBulkActionKind;
  summary: string;
  snapshots: QbBulkActionSnapshotEntry[];
}

/**
 * Persist a single bulk-action row capturing every cell touched by a
 * bulk-apply or CSV-import. Returns the new row id so the caller can echo
 * it back to the UI. A persistence failure is logged and re-thrown so the
 * outer transaction rolls the bulk write back — without an undo snapshot
 * we don't want a "ghost" bulk write the admin can't unwind.
 */
export async function recordBulkAction(
  input: RecordBulkActionInput,
): Promise<number> {
  const session = getSession(input.req);
  const actorUserId = session?.userId ?? null;
  const actorRole = session?.role ?? "anonymous";
  try {
    const [row] = await db
      .insert(qbAccountMappingBulkActionsTable)
      .values({
        kind: input.kind,
        actorUserId,
        actorRole,
        summary: input.summary,
        snapshots: input.snapshots,
      })
      .returning({ id: qbAccountMappingBulkActionsTable.id });
    return row.id;
  } catch (err) {
    logger.error(
      { err, kind: input.kind, snapshotCount: input.snapshots.length },
      "Failed to record qb-account-mapping bulk action",
    );
    throw err;
  }
}

/**
 * Apply the inverse of a bulk action's snapshot inside the given
 * transaction. For each snapshot entry: if `previous` is null the cell
 * was newly created — delete whatever row currently lives at that scope.
 * If `previous` is set, upsert the row back to those exact values.
 *
 * Returns counts so the UI can show "restored 12 rows, removed 3 inserts".
 */
export async function undoBulkActionSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  snapshots: ReadonlyArray<QbBulkActionSnapshotEntry>,
): Promise<{ restored: number; removed: number }> {
  let restored = 0;
  let removed = 0;
  for (const snap of snapshots) {
    const where = and(
      snap.vendorId == null
        ? isNull(qbAccountMappingTable.vendorId)
        : eq(qbAccountMappingTable.vendorId, snap.vendorId),
      snap.partnerId == null
        ? isNull(qbAccountMappingTable.partnerId)
        : eq(qbAccountMappingTable.partnerId, snap.partnerId),
      eq(qbAccountMappingTable.lineType, snap.lineType),
    );
    const existing = await tx
      .select({ id: qbAccountMappingTable.id })
      .from(qbAccountMappingTable)
      .where(where);
    if (snap.previous == null) {
      // Bulk write inserted this row — strip it. If it was already
      // deleted manually, that's fine; just count it as removed.
      if (existing.length > 0) {
        await tx
          .delete(qbAccountMappingTable)
          .where(eq(qbAccountMappingTable.id, existing[0].id));
        removed++;
      }
    } else {
      const prev = snap.previous;
      if (existing.length > 0) {
        await tx
          .update(qbAccountMappingTable)
          .set({
            accountName: prev.accountName,
            accountNumber: prev.accountNumber,
          })
          .where(eq(qbAccountMappingTable.id, existing[0].id));
      } else {
        // Someone else removed the row in the interim; recreate it from
        // the snapshot so undo always lands on the recorded state.
        await tx.insert(qbAccountMappingTable).values({
          vendorId: snap.vendorId,
          partnerId: snap.partnerId,
          lineType: snap.lineType,
          accountName: prev.accountName,
          accountNumber: prev.accountNumber,
        });
      }
      restored++;
    }
  }
  return { restored, removed };
}
