import { Router, type IRouter } from "express";
import { sql, eq, desc, and } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  partnersTable,
  vendorsTable,
  siteLocationsTable,
  ticketsTable,
  ticketLineItemsTable,
  hotlistJobsTable,
  hotlistBidsTable,
} from "@workspace/db";
import {
  GetAwaitingPaymentSummaryResponse,
  GetDashboardSummaryResponse,
  GetRecentActivityResponse,
  GetTicketStatsResponse,
} from "@workspace/api-zod";

import { SESSION_SECRET, requireAdmin, requireSession } from "../lib/session";
import {
  getTicketsTripsBufferInfo,
  summarizeRecentTicketsTrips,
} from "../lib/tickets-rate-limit";
import { enforceDashboardRateLimit } from "../lib/dashboard-rate-limit";
import {
  RATE_LIMITED_ENDPOINTS,
  resolveEndpointBudgets,
} from "../lib/rate-limit-registry";
import { getResolvedDefaultStoreInfo } from "../lib/bucket-store";
import { sendResponse } from "../lib/typed-response";

const COOKIE_NAME = "vndrly_session";
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null };
function getSession(req: any): Session | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
}

const router: IRouter = Router();

router.get("/dashboard/summary", requireSession, async (req, res): Promise<void> => {
  const session = getSession(req);
  // Task #698: per-session, role-aware rate limit on the heavy
  // joined dashboard summary. Applied BEFORE building the partner /
  // ticket / hotlist count queries so a stuck refresh loop is
  // caught at the door rather than fanning out into multiple
  // aggregate reads per request.
  if (!await enforceDashboardRateLimit(req, res, session)) return;
  const isPartner = session?.role === "partner" && !!session.partnerId;
  const partnerId = isPartner ? session!.partnerId! : null;
  const isVendor = session?.role === "vendor" && !!session.vendorId;
  const vendorId = isVendor ? session!.vendorId! : null;

  const [partnerCount] = await db.select({ count: sql<number>`count(*)::int` }).from(partnersTable);
  const [vendorCount] = await db.select({ count: sql<number>`count(*)::int` }).from(vendorsTable);
  // Site locations card scoping:
  //   - partner → sites they own
  //   - vendor  → distinct sites this vendor has tickets on (i.e.
  //               anywhere they've done or are doing work). Not all
  //               sites in the system, since a vendor shouldn't see
  //               other partners' inventories.
  //   - admin / other → global count (legacy behaviour).
  const [siteCount] = isPartner
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(siteLocationsTable)
        .where(eq(siteLocationsTable.partnerId, partnerId!))
    : isVendor
    ? await db
        .select({ count: sql<number>`count(distinct ${ticketsTable.siteLocationId})::int` })
        .from(ticketsTable)
        .where(eq(ticketsTable.vendorId, vendorId!))
    : await db.select({ count: sql<number>`count(*)::int` }).from(siteLocationsTable);

  const ticketBase = isPartner
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    : db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable);

  const partnerCond = isPartner ? sql`${siteLocationsTable.partnerId} = ${partnerId}` : sql`true`;

  const [ticketCount] = await (isPartner
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
        .where(partnerCond)
    : db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable));
  const [activeCount] = await (isPartner
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
        .where(sql`${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review') AND ${partnerCond}`)
    : db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .where(sql`${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review')`));
  const [pendingCount] = await (isPartner
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
        .where(sql`${ticketsTable.status} = 'submitted' AND ${partnerCond}`)
    : db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .where(eq(ticketsTable.status, "submitted")));
  const [approvedMonth] = await (isPartner
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
        .where(sql`${ticketsTable.status} = 'approved' AND ${ticketsTable.updatedAt} >= date_trunc('month', CURRENT_DATE) AND ${partnerCond}`)
    : db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .where(sql`${ticketsTable.status} = 'approved' AND ${ticketsTable.updatedAt} >= date_trunc('month', CURRENT_DATE)`));
  void ticketBase;

  let hotlistBids = 0;
  if (isPartner) {
    const [bidCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(hotlistBidsTable)
      .leftJoin(hotlistJobsTable, eq(hotlistBidsTable.jobId, hotlistJobsTable.id))
      .where(eq(hotlistJobsTable.partnerId, partnerId!));
    hotlistBids = bidCount?.count ?? 0;
  }

  sendResponse(res, GetDashboardSummaryResponse, {
    hotlistBids,
    totalPartners: partnerCount.count,
    totalVendors: vendorCount.count,
    totalSiteLocations: siteCount.count,
    totalTickets: ticketCount.count,
    activeTickets: activeCount.count,
    pendingApproval: pendingCount.count,
    approvedThisMonth: approvedMonth.count,
  });
});

// Task #505 — partner-side AP queue tile.
//
// Roll-up powering the dashboard "Awaiting payment" card. The same
// rule the /tickets?awaitingPayment=true filter uses (status='approved'
// AND payment_dispersed_at IS NULL) is what we count and sum here so
// the tile and the filtered list can never drift. Sum is computed
// directly from ticket_line_items (quantity * unit_price) since the
// tickets table itself doesn't carry a stored total.
//
// Non-partner sessions intentionally get a zero/null roll-up rather
// than a 403: this endpoint is hit unconditionally on the dashboard
// mount, and the partner-only rendering decision lives in the client.
router.get("/dashboard/awaiting-payment", requireSession, async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!await enforceDashboardRateLimit(req, res, session)) return;

  const isPartner = session?.role === "partner" && !!session.partnerId;
  if (!isPartner) {
    sendResponse(res, GetAwaitingPaymentSummaryResponse, {
      count: 0,
      totalApprovedAmount: "0.00",
      oldestApprovedAt: null,
    });
    return;
  }

  const partnerId = session!.partnerId!;
  // Single aggregate query: COUNT(DISTINCT ticket), SUM of line item
  // extended price, and MIN(approvedAt). LEFT JOIN to line items so a
  // ticket with no line items still counts (its contribution to the
  // sum is 0, which COALESCE keeps as 0.00).
  const rows = await db.execute<{
    count: number;
    total: string;
    oldest: string | null;
  }>(sql`
    select
      count(distinct t.id)::int as count,
      coalesce(sum(li.quantity * li.unit_price), 0)::numeric(14,2)::text as total,
      to_char(min(t.approved_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as oldest
    from ${ticketsTable} t
    left join ${siteLocationsTable} sl on sl.id = t.site_location_id
    left join ${ticketLineItemsTable} li on li.ticket_id = t.id
    where sl.partner_id = ${partnerId}
      and t.status = 'approved'
      and t.payment_dispersed_at is null
  `);
  const row = rows.rows?.[0];
  // Task #583: the SQL emits `oldest` as a pre-formatted ISO string
  // (via `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`) but the
  // schema's `oldestApprovedAt` is `z.coerce.date().nullable()`, which
  // declares an output type of `Date | null`. The previous code path
  // (`Schema.parse(...)`) was coercing the string at runtime and
  // hiding the contract mismatch from TypeScript. Construct the Date
  // explicitly here so the typed bridge can verify the shape at
  // compile time.
  sendResponse(res, GetAwaitingPaymentSummaryResponse, {
    count: row?.count ?? 0,
    totalApprovedAmount: row?.total ?? "0.00",
    oldestApprovedAt: row?.oldest ? new Date(row.oldest) : null,
  });
});

router.get("/dashboard/recent-activity", requireSession, async (req, res): Promise<void> => {
  const session = getSession(req);
  // Task #698: per-session, role-aware rate limit on the dashboard
  // recent-activity feed. Shares the dashboard-resource budget with
  // summary / ticket-stats so a tight page-mount loop burns one
  // budget rather than three.
  if (!await enforceDashboardRateLimit(req, res, session)) return;
  const baseQuery = db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
      updatedAt: ticketsTable.updatedAt,
      siteName: siteLocationsTable.name,
      vendorName: vendorsTable.name,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id));
  const tickets = await (
    session?.role === "partner" && session.partnerId
      ? baseQuery.where(eq(siteLocationsTable.partnerId, session.partnerId))
      : session?.role === "vendor" && session.vendorId
      ? baseQuery.where(eq(ticketsTable.vendorId, session.vendorId))
      : baseQuery
  )
    .orderBy(desc(ticketsTable.updatedAt))
    .limit(50);

  const INACTIVITY_DAYS = 30;
  const ACTIVE_STATUSES = new Set([
    "initiated",
    "draft",
    "in_progress",
    "pending_review",
    "kicked_back",
    "submitted",
  ]);
  const cutoffMs = Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000;

  const activities = tickets.map((t, i) => {
    const tsMs = t.updatedAt ? new Date(t.updatedAt).getTime() : Date.now();
    return {
      id: i + 1,
      ticketId: t.id,
      action: t.status,
      description: `VNDRLY Tracking #${t.id} at ${t.siteName || "Unknown"} by ${t.vendorName || "Unknown"}`,
      timestamp: t.updatedAt,
      needsAttention: ACTIVE_STATUSES.has(t.status) && tsMs < cutoffMs,
      lifecycleState: t.lifecycleState ?? null,
    };
  });

  sendResponse(res, GetRecentActivityResponse, activities);
});

router.get("/dashboard/ticket-stats", requireSession, async (req, res): Promise<void> => {
  const session = getSession(req);
  // Task #698: per-session, role-aware rate limit on the dashboard
  // ticket-stats roll-up. Shares the dashboard-resource budget with
  // summary / recent-activity (see comment above).
  if (!await enforceDashboardRateLimit(req, res, session)) return;
  let stats;
  if (session?.role === "vendor" && session.vendorId) {
    stats = await db
      .select({
        status: ticketsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.vendorId, session.vendorId))
      .groupBy(ticketsTable.status);
  } else if (session?.role === "partner" && session.partnerId) {
    stats = await db
      .select({
        status: ticketsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .where(eq(siteLocationsTable.partnerId, session.partnerId))
      .groupBy(ticketsTable.status);
  } else {
    stats = await db
      .select({
        status: ticketsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.status);
  }

  sendResponse(res, GetTicketStatsResponse, stats);
});

// Admin-only readout of the resolved rate-limit budget per known
// role for every per-role rate-limited endpoint family (Task #697
// extends Task #688's tickets-only readout to a multi-endpoint
// listing). Lets an operator confirm that a per-role override
// applied via `<PREFIX>_RATE_LIMIT_MAX_<ROLE>` /
// `<PREFIX>_RATE_LIMIT_WINDOW_MS_<ROLE>` actually took effect after
// a restart, across every protected endpoint, without grepping logs
// or having to trip a 429 in the wild.
//
// Values are read live from each limiter's resolver (which itself
// reads env on every call), so an env-driven hot-reload would be
// reflected here too. We also surface the unauthenticated/default
// budget alongside the per-role rows since unknown callers (and
// roles whose strings don't match the sanitized pattern) get that
// budget.
router.get("/admin/rate-limit-budgets", requireAdmin, (_req, res): void => {
  // Pin a single `now` for the whole response so every endpoint
  // slices the same trailing window — otherwise a slow handler
  // could let the last endpoint count trips a few ms further into
  // the future than the first, biasing rollups across endpoints.
  const now = Date.now();
  const endpoints = RATE_LIMITED_ENDPOINTS.map((ep) =>
    resolveEndpointBudgets(ep, { now }),
  );
  // Surface which BucketStore backend the limiters actually
  // resolved to (Task #700 follow-up #776). With `kind: "memory"`
  // the budgets shown above are enforced PER REPLICA — useful
  // diagnostic when an operator notices the cap "feels higher than
  // configured" because they're scaled out and don't yet have
  // RATE_LIMIT_REDIS_URL pointed at a shared instance. With
  // `kind: "redis"` the prefix tells operators which key namespace
  // to inspect with `redis-cli SCAN`.
  const store = getResolvedDefaultStoreInfo();
  res.json({ endpoints, store });
});

// Task #696 — admin-only readout of recent 429 trips on the
// `/api/tickets` and `/api/tickets/:id` reads. Companion to the
// budgets card: budgets confirm an override took effect; this
// confirms whether the cap is actually being hit in the wild.
//
// Backed by the in-process ring buffer maintained by the tickets
// limiter (see `summarizeRecentTicketsTrips`), so the displayed
// counts come from the same limiter that `getTicketsBudgetForRole`
// reports. The buffer is per-replica and clears on restart — the
// durable record stays in the structured `tickets.rate_limit.trip`
// log line. Trips are deduped by session userId / IP key when
// reporting `uniqueKeys`, so an operator can tell "one runaway
// client" from "many clients collectively bumping the cap".
//
// Returns two windows (60 min and 24 h) so the panel can show
// both a recent and a daily view without the client having to
// pick. Buffer info (`bufferSize`, `bufferCapacity`,
// `oldestTrackedAt`) is included so the panel can warn that older
// trips were evicted when the buffer is full.
const TICKETS_TRIPS_WINDOWS_MS = [
  { key: "lastHour", windowMs: 60 * 60 * 1000 },
  { key: "last24Hours", windowMs: 24 * 60 * 60 * 1000 },
] as const;

router.get(
  "/admin/tickets-rate-limit-trips",
  requireAdmin,
  (_req, res): void => {
    const now = Date.now();
    const windows = TICKETS_TRIPS_WINDOWS_MS.map(({ key, windowMs }) => {
      const summary = summarizeRecentTicketsTrips({ windowMs, now });
      return {
        key,
        windowMs: summary.windowMs,
        totalTrips: summary.totalTrips,
        uniqueKeys: summary.uniqueKeys,
        byRole: summary.byRole,
      };
    });
    const buffer = getTicketsTripsBufferInfo();
    res.json({
      generatedAt: new Date(now).toISOString(),
      windows,
      buffer: {
        size: buffer.currentSize,
        capacity: buffer.maxEntries,
        retentionMs: buffer.retentionMs,
        oldestTrackedAt: buffer.oldestTrackedAt
          ? new Date(buffer.oldestTrackedAt).toISOString()
          : null,
      },
      // Hint for the operator reading the JSON directly via curl
      // — the panel uses its own caption.
      note: "Trips are recorded in an in-process ring buffer per replica, deduped by session userId or client IP when reporting uniqueKeys, and evicted by age and cap. Persistent record is the 'tickets.rate_limit.trip' log line.",
    });
  },
);

export default router;
