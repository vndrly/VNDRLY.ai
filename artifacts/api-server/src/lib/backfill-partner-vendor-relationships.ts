import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * One-shot, idempotent backfill that rebuilds
 * `partner_vendor_relationships` from real ticket history when the
 * table is empty.
 *
 * Background: a deployment incident wiped every row from
 * `partner_vendor_relationships`, which is the table that powers the
 * partner portal's "Vendors" page. Because the dev and production
 * databases are separate, the same wipe affected both, leaving
 * partner admins (e.g. exxon@vndrly.com) staring at an empty list
 * even though they have months of completed tickets with those
 * vendors. This helper rebuilds an "approved" relationship for every
 * (partner, vendor) pair that has at least one ticket together,
 * picking the partner via the ticket's site_location.
 *
 * Safety properties:
 *  - Runs only when `partner_vendor_relationships` is completely
 *    empty. Once any row exists (whether from this backfill or a
 *    real approval), subsequent boots skip the work entirely.
 *  - The INSERT uses `ON CONFLICT (partner_id, vendor_id) DO NOTHING`
 *    so concurrent boots cannot create duplicates.
 *  - Wrapped in try/catch so a failure here never blocks startup.
 *  - All inserted rows carry a `notes` value that records the
 *    auto-restore origin and the date of the first ticket between
 *    the pair, so the rows are easy to audit or revert later.
 *  - `approved_by_user_id` is set to whichever user holds an
 *    `admin` membership in the partner org (deterministic: lowest
 *    user_id wins). If no admin exists yet, the column is left null.
 */
export async function backfillPartnerVendorRelationshipsFromTickets(): Promise<number> {
  try {
    const existing = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from partner_vendor_relationships
    `);
    const existingRows =
      (existing as unknown as { rows?: { count: number }[] }).rows ??
      (existing as unknown as { count: number }[]);
    const total = Array.isArray(existingRows) && existingRows[0]
      ? Number(existingRows[0].count)
      : 0;
    if (total > 0) {
      // Table already has data — nothing to recover.
      return 0;
    }

    const result = await db.execute<{ partner_id: number; vendor_id: number }>(sql`
      with derived as (
        select sl.partner_id,
               t.vendor_id,
               min(t.created_at) as first_seen
          from tickets t
          join site_locations sl on sl.id = t.site_location_id
         where t.vendor_id is not null
         group by sl.partner_id, t.vendor_id
      ),
      admins as (
        select distinct on (partner_id) partner_id, user_id
          from user_org_memberships
         where org_type = 'partner'
           and role = 'admin'
           and partner_id is not null
         order by partner_id, user_id
      )
      insert into partner_vendor_relationships
        (partner_id, vendor_id, status, notes, approved_at, approved_by_user_id, created_at, updated_at)
      select d.partner_id,
             d.vendor_id,
             'approved',
             'Auto-restored from ticket history (first ticket: ' || to_char(d.first_seen, 'YYYY-MM-DD') || ')',
             now(),
             a.user_id,
             d.first_seen,
             now()
        from derived d
        left join admins a on a.partner_id = d.partner_id
      on conflict (partner_id, vendor_id) do nothing
      returning partner_id, vendor_id
    `);
    const rows =
      (result as unknown as { rows?: { partner_id: number; vendor_id: number }[] }).rows ??
      (result as unknown as { partner_id: number; vendor_id: number }[]);
    const inserted = Array.isArray(rows) ? rows.length : 0;
    if (inserted > 0) {
      logger.info(
        { inserted },
        "Backfilled partner_vendor_relationships from ticket history",
      );
    }
    return inserted;
  } catch (err) {
    logger.warn(
      { err },
      "partner_vendor_relationships backfill skipped (non-fatal)",
    );
    return 0;
  }
}
