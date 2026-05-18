import { and, eq, lt, gte, sql, isNull, inArray } from "drizzle-orm";
import {
  db,
  ticketsTable,
  siteLocationsTable,
  employeeCertificationsTable,
  fieldEmployeesTable,
  hotlistJobsTable,
  hotlistBidsTable,
  vendorWorkTypesTable,
  workTypesTable,
  ticketNoteLogsTable,
  vendorRatingsTable,
} from "@workspace/db";
import {
  notifyUsers,
  findVendorUserIdsBatch,
  findPartnerUserIdsBatch,
} from "../routes/notifications";
import { logger } from "./logger";

// A single rule fires zero or more notifications and returns the count inserted.
// The cache is shared across every rule in a tick so repeat orgs (e.g. a
// busy vendor that shows up in tickets, hotlist bids, AND ratings in the
// same window) only cost one round trip per tick.
type Rule = {
  name: string;
  run: (cache: OrgUserCache) => Promise<number>;
};

const PENDING_REVIEW_DAYS = 30;
const LONG_CHECKIN_HOURS = 8;

function ticketNumber(id: number): string {
  return `#${String(id).padStart(4, "0")}`;
}

// Per-tick cache of org→userIds. Each rule preloads the orgs it needs via
// `preload()` (one batched `IN` query per org type for the unseen ids) and
// then reads with `getVendor()` / `getPartner()`. Designed to live for the
// duration of a single rules-engine tick and then be discarded.
class OrgUserCache {
  private vendor = new Map<number, number[]>();
  private partner = new Map<number, number[]>();

  async preload(
    rows: ReadonlyArray<{ vendorId?: number | null; partnerId?: number | null }>,
  ): Promise<void> {
    const vendorIds: number[] = [];
    const partnerIds: number[] = [];
    for (const r of rows) {
      if (r.vendorId != null && !this.vendor.has(r.vendorId)) vendorIds.push(r.vendorId);
      if (r.partnerId != null && !this.partner.has(r.partnerId)) partnerIds.push(r.partnerId);
    }
    const [vendorMap, partnerMap] = await Promise.all([
      vendorIds.length ? findVendorUserIdsBatch(vendorIds) : Promise.resolve(new Map<number, number[]>()),
      partnerIds.length ? findPartnerUserIdsBatch(partnerIds) : Promise.resolve(new Map<number, number[]>()),
    ]);
    for (const [k, v] of vendorMap) this.vendor.set(k, v);
    for (const [k, v] of partnerMap) this.partner.set(k, v);
  }

  async preloadVendors(ids: ReadonlyArray<number>): Promise<void> {
    const missing = ids.filter((id) => id != null && !this.vendor.has(id));
    if (!missing.length) return;
    const fresh = await findVendorUserIdsBatch(missing);
    for (const [k, v] of fresh) this.vendor.set(k, v);
  }

  async preloadPartners(ids: ReadonlyArray<number>): Promise<void> {
    const missing = ids.filter((id) => id != null && !this.partner.has(id));
    if (!missing.length) return;
    const fresh = await findPartnerUserIdsBatch(missing);
    for (const [k, v] of fresh) this.partner.set(k, v);
  }

  getVendor(id: number): number[] {
    return this.vendor.get(id) ?? [];
  }

  getPartner(id: number): number[] {
    return this.partner.get(id) ?? [];
  }
}

// ---------- Tickets: pending review > 30 days ----------
async function rulePendingTicketsLong(cache: OrgUserCache): Promise<number> {
  const cutoff = new Date(Date.now() - PENDING_REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      partnerId: siteLocationsTable.partnerId,
      updatedAt: ticketsTable.updatedAt,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(lt(ticketsTable.updatedAt, cutoff), eq(ticketsTable.status, "pending_review")));

  if (!stale.length) return 0;
  await cache.preload(stale);

  let n = 0;
  for (const t of stale) {
    const recipients = new Set<number>();
    if (t.vendorId) for (const id of cache.getVendor(t.vendorId)) recipients.add(id);
    if (t.partnerId) for (const id of cache.getPartner(t.partnerId)) recipients.add(id);
    if (!recipients.size) continue;
    n += await notifyUsers([...recipients], {
      type: "ticket_pending_long",
      title: "Tracking pending review > 30 days",
      body: `Tracking ${ticketNumber(t.id)} has been awaiting review for over 30 days.`,
      link: `/tickets/${t.id}`,
      dedupeKey: `ticket_pending_long:${t.id}`,
    });
  }
  return n;
}

// ---------- Crew: checked in > 8 hours ----------
async function ruleLongCheckIn(cache: OrgUserCache): Promise<number> {
  const cutoff = new Date(Date.now() - LONG_CHECKIN_HOURS * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      partnerId: siteLocationsTable.partnerId,
      checkInTime: ticketsTable.checkInTime,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(
      and(
        lt(ticketsTable.checkInTime, cutoff),
        isNull(ticketsTable.checkOutTime),
        sql`${ticketsTable.status} IN ('in_progress', 'submitted')`,
      ),
    );

  if (!rows.length) return 0;
  await cache.preload(rows);

  let n = 0;
  for (const t of rows) {
    const recipients = new Set<number>();
    if (t.vendorId) for (const id of cache.getVendor(t.vendorId)) recipients.add(id);
    if (t.partnerId) for (const id of cache.getPartner(t.partnerId)) recipients.add(id);
    if (!recipients.size) continue;
    n += await notifyUsers([...recipients], {
      type: "long_checkin",
      title: "Field employee still checked in",
      body: `Tracking ${ticketNumber(t.id)} has been checked in for over ${LONG_CHECKIN_HOURS} hours.`,
      link: `/tickets/${t.id}`,
      dedupeKey: `long_checkin:${t.id}`,
    });
  }
  return n;
}

// ---------- Compliance: certs expiring at 90 / 60 / 30 / 0 days ----------
const CERT_WINDOWS = [90, 60, 30, 0];

async function ruleCertExpiring(cache: OrgUserCache): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let n = 0;
  for (const days of CERT_WINDOWS) {
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() + days);
    const targetIso = target.toISOString().slice(0, 10);

    const rows = await db
      .select({
        id: employeeCertificationsTable.id,
        name: employeeCertificationsTable.name,
        employeeId: employeeCertificationsTable.employeeId,
        expirationDate: employeeCertificationsTable.expirationDate,
        vendorId: fieldEmployeesTable.vendorId,
        employeeFirstName: fieldEmployeesTable.firstName,
        employeeLastName: fieldEmployeesTable.lastName,
        userId: fieldEmployeesTable.userId,
      })
      .from(employeeCertificationsTable)
      .innerJoin(fieldEmployeesTable, eq(employeeCertificationsTable.employeeId, fieldEmployeesTable.id))
      .where(
        and(
          eq(employeeCertificationsTable.expirationDate, targetIso),
          isNull(employeeCertificationsTable.deletedAt),
        ),
      );

    if (!rows.length) continue;
    await cache.preload(rows);

    for (const c of rows) {
      const recipients = new Set<number>();
      if (c.vendorId) for (const id of cache.getVendor(c.vendorId)) recipients.add(id);
      if (c.userId) recipients.add(c.userId);
      if (!recipients.size) continue;

      const type = days === 0 ? "cert_expired" : "cert_expiring";
      const title = days === 0
        ? `Certification expired`
        : `Certification expires in ${days} day${days === 1 ? "" : "s"}`;
      const empName = [c.employeeFirstName, c.employeeLastName].filter(Boolean).join(" ").trim() || "An employee";
      const body = `${empName}'s ${c.name} ${days === 0 ? "expired today" : `expires on ${c.expirationDate}`}.`;

      n += await notifyUsers([...recipients], {
        type,
        title,
        body,
        link: `/field-employees/${c.employeeId}`,
        dedupeKey: `cert_expiring:${c.id}:${days}`,
      });
    }
  }
  return n;
}

// ---------- Hotlist: new matches for vendor work types ----------
async function ruleHotlistMatches(cache: OrgUserCache): Promise<number> {
  // Open jobs created in the last 24h, paired with vendors whose work types match.
  // We don't have a job<->workType link in the schema; match heuristically by title containing work type name.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const jobs = await db
    .select({
      id: hotlistJobsTable.id,
      title: hotlistJobsTable.title,
      partnerId: hotlistJobsTable.partnerId,
    })
    .from(hotlistJobsTable)
    .where(and(eq(hotlistJobsTable.status, "open"), gte(hotlistJobsTable.createdAt, since)));

  if (!jobs.length) return 0;

  const vwt = await db
    .select({
      vendorId: vendorWorkTypesTable.vendorId,
      workTypeName: workTypesTable.name,
    })
    .from(vendorWorkTypesTable)
    .innerJoin(workTypesTable, eq(workTypesTable.id, vendorWorkTypesTable.workTypeId));

  // Preload userIds for every vendor that has at least one work type. This
  // is a superset of the vendors any job can possibly match, so a single
  // batched query covers all per-job loops below.
  await cache.preloadVendors(vwt.map((r) => r.vendorId));

  let n = 0;
  for (const job of jobs) {
    const matchingVendors = new Set<number>();
    const titleLower = job.title.toLowerCase();
    for (const r of vwt) {
      if (r.workTypeName && titleLower.includes(r.workTypeName.toLowerCase())) {
        matchingVendors.add(r.vendorId);
      }
    }
    for (const vid of matchingVendors) {
      const userIds = cache.getVendor(vid);
      if (!userIds.length) continue;
      n += await notifyUsers(userIds, {
        type: "hotlist_match",
        title: "New Hotlist job matches your work types",
        body: `"${job.title}" was just posted.`,
        link: `/?hotlistJob=${job.id}`,
        dedupeKey: `hotlist_match:${job.id}:${vid}`,
      });
    }
  }
  return n;
}

// ---------- Hotlist: vendor outbid (lower current bid posted by another vendor) ----------
async function ruleHotlistOutbid(cache: OrgUserCache): Promise<number> {
  // For each open job, find the lowest bid; notify any vendor whose latest bid is higher.
  const open = await db
    .select({ id: hotlistJobsTable.id, title: hotlistJobsTable.title })
    .from(hotlistJobsTable)
    .where(eq(hotlistJobsTable.status, "open"));

  if (!open.length) return 0;

  // Pull every pending bid for these jobs in one query and bucket by jobId,
  // so the per-job loop below does not issue O(jobs) bid queries.
  const allBids = await db
    .select({
      jobId: hotlistBidsTable.jobId,
      vendorId: hotlistBidsTable.vendorId,
      amount: hotlistBidsTable.amountUsd,
    })
    .from(hotlistBidsTable)
    .where(
      and(
        inArray(hotlistBidsTable.jobId, open.map((j) => j.id)),
        eq(hotlistBidsTable.status, "pending"),
      ),
    );

  const bidsByJob = new Map<number, { vendorId: number; amount: number }[]>();
  for (const b of allBids) {
    const arr = bidsByJob.get(b.jobId) ?? [];
    arr.push({ vendorId: b.vendorId, amount: Number(b.amount) });
    bidsByJob.set(b.jobId, arr);
  }

  // Preload vendor → userIds for every vendor that placed a bid.
  await cache.preloadVendors(allBids.map((b) => b.vendorId));

  let n = 0;
  for (const job of open) {
    const numeric = bidsByJob.get(job.id) ?? [];
    if (numeric.length < 2) continue;
    const lowest = Math.min(...numeric.map((b) => b.amount));
    const losers = numeric.filter((b) => b.amount > lowest);

    for (const l of losers) {
      const userIds = cache.getVendor(l.vendorId);
      if (!userIds.length) continue;
      n += await notifyUsers(userIds, {
        type: "bid_outbid",
        title: "You've been outbid on a Hotlist job",
        body: `Another vendor placed a lower bid on "${job.title}".`,
        link: `/?hotlistJob=${job.id}`,
        dedupeKey: `bid_outbid:${job.id}:${l.vendorId}:${lowest}`,
      });
    }
  }
  return n;
}

// ---------- Recent ratings ----------
async function ruleRatingReceived(cache: OrgUserCache): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: vendorRatingsTable.id,
      vendorId: vendorRatingsTable.vendorId,
      rating: vendorRatingsTable.rating,
      partnerId: vendorRatingsTable.partnerId,
    })
    .from(vendorRatingsTable)
    .where(gte(vendorRatingsTable.createdAt, since));

  if (!rows.length) return 0;
  await cache.preloadVendors(rows.map((r) => r.vendorId));

  let n = 0;
  for (const r of rows) {
    const userIds = cache.getVendor(r.vendorId);
    if (!userIds.length) continue;
    n += await notifyUsers(userIds, {
      type: "rating_received",
      title: "You received a new rating",
      body: `A partner rated your work ${r.rating}/5.`,
      link: `/vendors/${r.vendorId}`,
      dedupeKey: `rating_received:${r.id}`,
    });
  }
  return n;
}

// ---------- New ticket notes (last 24h) ----------
async function ruleTicketNoteAdded(cache: OrgUserCache): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notes = await db
    .select({
      id: ticketNoteLogsTable.id,
      ticketId: ticketNoteLogsTable.ticketId,
      createdById: ticketNoteLogsTable.createdById,
      vendorId: ticketsTable.vendorId,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(ticketNoteLogsTable)
    .innerJoin(ticketsTable, eq(ticketNoteLogsTable.ticketId, ticketsTable.id))
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(gte(ticketNoteLogsTable.createdAt, since));

  if (!notes.length) return 0;
  await cache.preload(notes);

  let n = 0;
  for (const note of notes) {
    const recipients = new Set<number>();
    if (note.vendorId) for (const id of cache.getVendor(note.vendorId)) recipients.add(id);
    if (note.partnerId) for (const id of cache.getPartner(note.partnerId)) recipients.add(id);
    if (note.createdById) recipients.delete(note.createdById);
    if (!recipients.size) continue;
    n += await notifyUsers([...recipients], {
      type: "ticket_note_added",
      title: "New note on a tracking number",
      body: `A new note was added on tracking ${ticketNumber(note.ticketId)}.`,
      link: `/tickets/${note.ticketId}`,
      dedupeKey: `ticket_note_added:${note.id}`,
    });
  }
  return n;
}

// ---------- Tickets: status transitions (assigned/kicked_back/rejected/approved) ----------
// Backfills notifications for tickets whose status changed within the last 24h
// in case the inline notification at the API call site failed or was skipped.
type StatusRuleSpec = {
  status: string;
  type: string;
  title: string;
  // Some rules want extra row context (e.g. funds_dispersed wants the
  // payment method in the message). Pass the whole row so future rules can
  // pull whatever they need without enlarging this type per-rule.
  body: (id: number, row: { paymentMethod: string | null }) => string;
  recipients: "vendor" | "vendor_and_partner";
};

function paymentMethodLabel(method: string | null): string {
  if (method === "etf") return "ETF / Wire";
  if (method === "check") return "Check";
  if (method === "other") return "Other";
  return "their selected method";
}

const TICKET_STATUS_RULES: StatusRuleSpec[] = [
  {
    status: "in_progress",
    type: "ticket_assigned",
    title: "Tracking number assigned",
    body: (id) => `Tracking ${ticketNumber(id)} is in progress and assigned to your crew.`,
    recipients: "vendor",
  },
  {
    status: "kicked_back",
    type: "ticket_kicked_back",
    title: "Tracking number kicked back",
    body: (id) => `Tracking ${ticketNumber(id)} was kicked back for corrections.`,
    recipients: "vendor",
  },
  {
    status: "rejected",
    type: "ticket_rejected",
    title: "Tracking number rejected",
    body: (id) => `Tracking ${ticketNumber(id)} was rejected.`,
    recipients: "vendor",
  },
  {
    status: "approved",
    type: "ticket_approved",
    title: "Tracking number approved",
    body: (id) => `Tracking ${ticketNumber(id)} has been approved.`,
    recipients: "vendor_and_partner",
  },
  {
    // Task #497: AP team marked the ticket paid. Vendor needs to see funds
    // are on the way; the inline notify in /tickets/:id/disperse-funds is
    // the primary path, this rule is the 24h backfill safety net for that.
    // Body mirrors the inline message ("paid via $method") so the vendor
    // sees the same payment context whether the inline or backfill path
    // delivered the notification.
    status: "funds_dispersed",
    type: "funds_dispersed",
    title: "Tracking number paid",
    body: (id, row) =>
      `Tracking ${ticketNumber(id)} has been paid by the partner via ${paymentMethodLabel(row.paymentMethod)}.`,
    recipients: "vendor",
  },
];

async function ruleTicketStatusChanges(cache: OrgUserCache): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let total = 0;

  for (const spec of TICKET_STATUS_RULES) {
    const rows = await db
      .select({
        id: ticketsTable.id,
        vendorId: ticketsTable.vendorId,
        partnerId: siteLocationsTable.partnerId,
        updatedAt: ticketsTable.updatedAt,
        paymentMethod: ticketsTable.paymentMethod,
      })
      .from(ticketsTable)
      .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .where(and(eq(ticketsTable.status, spec.status), gte(ticketsTable.updatedAt, since)));

    if (!rows.length) continue;
    await cache.preload(
      spec.recipients === "vendor_and_partner"
        ? rows
        : rows.map((r) => ({ vendorId: r.vendorId })),
    );

    for (const t of rows) {
      const recipients = new Set<number>();
      if (t.vendorId) for (const id of cache.getVendor(t.vendorId)) recipients.add(id);
      if (spec.recipients === "vendor_and_partner" && t.partnerId) {
        for (const id of cache.getPartner(t.partnerId)) recipients.add(id);
      }
      if (!recipients.size) continue;

      // Dedupe by ticket+status+updatedAt-day so a re-status fires anew but a
      // re-scan within the same day does not duplicate.
      const day = t.updatedAt.toISOString().slice(0, 10);
      total += await notifyUsers([...recipients], {
        type: spec.type,
        title: spec.title,
        body: spec.body(t.id, { paymentMethod: t.paymentMethod }),
        link: `/tickets/${t.id}`,
        dedupeKey: `${spec.type}:${t.id}:${day}`,
      });
    }
  }
  return total;
}

// ---------- Hotlist bid status changes (accepted = "awarded", declined) ----------
async function ruleHotlistBidStatusChanges(cache: OrgUserCache): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: hotlistBidsTable.id,
      jobId: hotlistBidsTable.jobId,
      vendorId: hotlistBidsTable.vendorId,
      status: hotlistBidsTable.status,
      jobTitle: hotlistJobsTable.title,
    })
    .from(hotlistBidsTable)
    .innerJoin(hotlistJobsTable, eq(hotlistJobsTable.id, hotlistBidsTable.jobId))
    .where(
      and(
        sql`${hotlistBidsTable.status} IN ('awarded', 'declined')`,
        gte(hotlistJobsTable.createdAt, since),
      ),
    );

  if (!rows.length) return 0;
  await cache.preloadVendors(rows.map((r) => r.vendorId));

  let total = 0;
  for (const b of rows) {
    const userIds = cache.getVendor(b.vendorId);
    if (!userIds.length) continue;
    if (b.status === "awarded") {
      total += await notifyUsers(userIds, {
        type: "job_awarded",
        title: "You won a Hotlist job!",
        body: `Your bid on "${b.jobTitle}" was awarded.`,
        link: `/?hotlistJob=${b.jobId}`,
        dedupeKey: `job_awarded:${b.id}`,
      });
    } else {
      total += await notifyUsers(userIds, {
        type: "bid_declined",
        title: "Hotlist bid not selected",
        body: `Your bid on "${b.jobTitle}" was not selected.`,
        link: `/?hotlistJob=${b.jobId}`,
        dedupeKey: `bid_declined:${b.id}`,
      });
    }
  }
  return total;
}

const RULES: Rule[] = [
  { name: "ticket_status_changes", run: ruleTicketStatusChanges },
  { name: "hotlist_bid_status_changes", run: ruleHotlistBidStatusChanges },
  { name: "pending_tickets_long", run: rulePendingTicketsLong },
  { name: "long_checkin", run: ruleLongCheckIn },
  { name: "cert_expiring", run: ruleCertExpiring },
  { name: "hotlist_matches", run: ruleHotlistMatches },
  { name: "hotlist_outbid", run: ruleHotlistOutbid },
  { name: "rating_received", run: ruleRatingReceived },
  { name: "ticket_note_added", run: ruleTicketNoteAdded },
];

export async function runRulesEngine(): Promise<{ rule: string; inserted: number; error?: string }[]> {
  const summary: { rule: string; inserted: number; error?: string }[] = [];
  // One cache per tick: a busy vendor that touches multiple rules pays for
  // its membership lookup once instead of N times.
  const cache = new OrgUserCache();
  for (const r of RULES) {
    try {
      const inserted = await r.run(cache);
      summary.push({ rule: r.name, inserted });
    } catch (err) {
      logger.warn({ err, rule: r.name }, "Rule failed");
      summary.push({ rule: r.name, inserted: 0, error: String((err as Error)?.message ?? err) });
    }
  }
  const total = summary.reduce((a, s) => a + s.inserted, 0);
  if (total > 0) logger.info({ summary, total }, "Rules engine fired notifications");
  return summary;
}

export function startRulesEngine(): void {
  const intervalMs = 15 * 60 * 1000;
  const tick = () => {
    runRulesEngine().catch((err) => logger.error({ err }, "Rules engine tick failed"));
  };
  setTimeout(tick, 90 * 1000);
  setInterval(tick, intervalMs);
}
