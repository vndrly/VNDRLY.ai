import { sql } from "drizzle-orm";
import {
  db,
  ticketStatusHistoryTable,
  ticketsTable,
  siteLocationsTable,
  userOrgMembershipsTable,
  vendorsTable,
} from "@workspace/db";

/**
 * The drizzle transaction client we accept here is intentionally typed as
 * `unknown`-ish. drizzle's transaction callback receives a tx object that has
 * the same `.insert / .update / .select` surface as the global `db` but is
 * scoped to a single PG transaction. Exporting that exact tx type leaks
 * generic database internals across the workspace boundary; instead we duck-
 * type to the one method we actually call (`insert(...).values(...)`).
 */
type TxLike = {
  insert: typeof db.insert;
};

/**
 * Append-only audit row for a ticket status mutation.
 *
 * Every existing handler in `routes/tickets.ts` and the one creator path in
 * `routes/field.ts` that mutates `tickets.status` must call this helper
 * inside the same transaction as the status update itself, so we never end
 * up with a status row whose history is missing (or vice-versa) on a
 * partial failure. Callers therefore wrap their status mutation in
 * `db.transaction(async (tx) => { ...; await recordTicketTransition({ tx, ... }) })`
 * and the helper writes through the supplied tx.
 *
 * The unlock route also still writes to `ticket_unlocks` — that table is the
 * legacy single-purpose audit (Task #18) and will be deprecated after one
 * release of dual-writes.
 *
 * `fromStatus` is nullable so creates (`null → initiated`) can be captured
 * with the same shape as later transitions.
 */
export async function recordTicketTransition(args: {
  ticketId: number;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: number | null;
  actorRole: string | null;
  reason?: string | null;
  /**
   * Optional drizzle transaction client. When supplied, the history row is
   * written inside that transaction so it commits atomically with the
   * caller's status mutation. Omitted callers fall back to the default
   * connection — kept only for ad-hoc tooling, not for request handlers.
   */
  tx?: TxLike;
}): Promise<void> {
  const writer = args.tx ?? db;
  await writer.insert(ticketStatusHistoryTable).values({
    ticketId: args.ticketId,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    reason: args.reason ?? null,
  });
}

/**
 * Task #858 — vendor scorecard rollup.
 *
 * Groups deny-transition reasons attributed to this vendor's users (via
 * the `user_org_memberships` lookup so we don't have to assume the
 * ticket still points at this vendor — by the time a partner reinvites
 * a different vendor, `tickets.vendor_id` has already moved on, but the
 * audit row's `actor_user_id` is immutable).
 *
 * `acceptCount` mirrors the `awaiting_acceptance → initiated` rows
 * authored by a vendor user, and `denyCount` mirrors the `* → denied`
 * rows. The rate is computed against the union of those decisions so
 * unanswered invites (later cancelled or reassigned by the partner)
 * don't drag the vendor's number down.
 */
export async function aggregateVendorTransitions(vendorId: number): Promise<{
  topDenialReasons: { reason: string; count: number }[];
  acceptCount: number;
  denyCount: number;
  acceptRatePercent: number | null;
}> {
  const denialRows = await db.execute<{ reason: string; count: number }>(sql`
    SELECT lower(trim(h.reason)) AS reason,
           count(*)::int AS count
    FROM ${ticketStatusHistoryTable} h
    JOIN ${userOrgMembershipsTable} m
      ON m.user_id = h.actor_user_id
     AND m.org_type = 'vendor'
     AND m.vendor_id = ${vendorId}
    WHERE h.to_status = 'denied'
      AND h.reason IS NOT NULL
      AND length(trim(h.reason)) > 0
    GROUP BY lower(trim(h.reason))
    ORDER BY count(*) DESC, lower(trim(h.reason)) ASC
    LIMIT 5
  `);

  const [decisionTotals] = (
    await db.execute<{ accept_count: number; deny_count: number }>(sql`
      SELECT
        count(*) FILTER (
          WHERE h.from_status = 'awaiting_acceptance'
            AND h.to_status = 'initiated'
        )::int AS accept_count,
        count(*) FILTER (WHERE h.to_status = 'denied')::int AS deny_count
      FROM ${ticketStatusHistoryTable} h
      JOIN ${userOrgMembershipsTable} m
        ON m.user_id = h.actor_user_id
       AND m.org_type = 'vendor'
       AND m.vendor_id = ${vendorId}
    `)
  ).rows;

  const acceptCount = decisionTotals?.accept_count ?? 0;
  const denyCount = decisionTotals?.deny_count ?? 0;
  const total = acceptCount + denyCount;
  const acceptRatePercent =
    total > 0 ? Math.round((acceptCount / total) * 100) : null;

  return {
    topDenialReasons: denialRows.rows.map((r) => ({
      reason: String(r.reason),
      count: Number(r.count),
    })),
    acceptCount,
    denyCount,
    acceptRatePercent,
  };
}

/**
 * Task #858 — partner KPI rollup. Mean time-to-acceptance is the
 * average delta between an invite (`* → awaiting_acceptance`) and the
 * acceptance row that immediately follows it (`awaiting_acceptance →
 * initiated`) for the same ticket. We use a `LAG()` window per ticket
 * because a single ticket can be invited multiple times before
 * acceptance (the bounce case), and we want every invite-to-accept
 * pair counted, not just the first one.
 */
export async function aggregatePartnerTransitions(
  partnerId: number,
): Promise<{
  meanTimeToAcceptanceSeconds: number | null;
  acceptedInviteCount: number;
}> {
  const [row] = (
    await db.execute<{
      mean_seconds: string | null;
      accepted_count: number;
    }>(sql`
      WITH events AS (
        SELECT h.ticket_id,
               h.from_status,
               h.to_status,
               h.created_at,
               LAG(h.to_status) OVER (
                 PARTITION BY h.ticket_id
                 ORDER BY h.created_at, h.id
               ) AS prev_to_status,
               LAG(h.created_at) OVER (
                 PARTITION BY h.ticket_id
                 ORDER BY h.created_at, h.id
               ) AS prev_created_at
        FROM ${ticketStatusHistoryTable} h
        JOIN ${ticketsTable} t ON t.id = h.ticket_id
        JOIN ${siteLocationsTable} s ON s.id = t.site_location_id
        WHERE s.partner_id = ${partnerId}
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (created_at - prev_created_at)))::numeric AS mean_seconds,
        count(*)::int AS accepted_count
      FROM events
      WHERE from_status = 'awaiting_acceptance'
        AND to_status = 'initiated'
        AND prev_to_status = 'awaiting_acceptance'
        AND prev_created_at IS NOT NULL
    `)
  ).rows;

  const acceptedInviteCount = row?.accepted_count ?? 0;
  const meanTimeToAcceptanceSeconds =
    row?.mean_seconds != null
      ? Math.round(Number(row.mean_seconds))
      : null;

  return { meanTimeToAcceptanceSeconds, acceptedInviteCount };
}

/**
 * Task #858 — admin "Reassignments" rollup. A ticket counts as
 * "bounced" once it has accumulated 2+ `awaiting_acceptance` rows in
 * `ticket_status_history` (one per invite). The drilldown lists the
 * top 50 offenders so the admin can click straight through to the
 * per-ticket transitions view; we cap at 50 to keep the response
 * cheap on large tenants and let the admin filter by clicking through.
 */
export async function aggregateAdminReassignments(): Promise<{
  reassignedTicketCount: number;
  tickets: {
    ticketId: number;
    vendorInviteCount: number;
    status: string;
    currentVendorId: number | null;
    currentVendorName: string | null;
    lastInviteAt: Date;
  }[];
}> {
  const [totals] = (
    await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM (
        SELECT h.ticket_id
        FROM ${ticketStatusHistoryTable} h
        WHERE h.to_status = 'awaiting_acceptance'
        GROUP BY h.ticket_id
        HAVING count(*) >= 2
      ) bounced
    `)
  ).rows;

  const drilldown = await db.execute<{
    ticket_id: number;
    invite_count: number;
    status: string;
    vendor_id: number | null;
    vendor_name: string | null;
    last_invite_at: string;
  }>(sql`
    WITH bounced AS (
      SELECT h.ticket_id,
             count(*)::int AS invite_count,
             max(h.created_at) AS last_invite_at
      FROM ${ticketStatusHistoryTable} h
      WHERE h.to_status = 'awaiting_acceptance'
      GROUP BY h.ticket_id
      HAVING count(*) >= 2
    )
    SELECT b.ticket_id,
           b.invite_count,
           t.status,
           v.id AS vendor_id,
           v.name AS vendor_name,
           b.last_invite_at
    FROM bounced b
    JOIN ${ticketsTable} t ON t.id = b.ticket_id
    LEFT JOIN ${vendorsTable} v ON v.id = t.vendor_id
    ORDER BY b.invite_count DESC, b.last_invite_at DESC
    LIMIT 50
  `);

  return {
    reassignedTicketCount: totals?.count ?? 0,
    tickets: drilldown.rows.map((r) => ({
      ticketId: Number(r.ticket_id),
      vendorInviteCount: Number(r.invite_count),
      status: String(r.status),
      currentVendorId: r.vendor_id != null ? Number(r.vendor_id) : null,
      currentVendorName: r.vendor_name ?? null,
      // pg's timestamptz comes back as a Date in the node-postgres driver,
      // but raw SQL execute() can also surface ISO strings depending on the
      // type parser registry. Normalise to Date so the response Zod schema
      // (`zod.coerce.date()`) gets a value it can shape losslessly.
      lastInviteAt:
        typeof r.last_invite_at === "object" && r.last_invite_at !== null
          ? (r.last_invite_at as Date)
          : new Date(String(r.last_invite_at)),
    })),
  };
}
