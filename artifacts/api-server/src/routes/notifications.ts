import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, lt } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
  userOrgMembershipsTable,
  usersTable,
  vendorPeopleTable,
} from "@workspace/db";
import crypto from "crypto";
import { sendPushToUser } from "../lib/expo-push";
import { logger } from "../lib/logger";
import { enforceNotificationsRateLimit } from "../lib/notifications-rate-limit";
import {
  sendNotificationAlertEmail,
  renderBulkActionExpiringEmail,
} from "../lib/sendgrid";
import {
  getCurrentNotificationEventSeq,
  publishNotificationCreated,
  subscribeNotificationEvents,
} from "../lib/notification-events";

import { SESSION_SECRET } from "../lib/session";
import { sendApiError } from "../lib/apiError";

const COOKIE_NAME = "vndrly_session";

type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null; displayName?: string };

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

export type NotificationCategory =
  | "tickets"
  | "hotlist"
  | "compliance"
  | "crew"
  | "system"
  | "visitor"
  | "comments";

const TYPE_TO_CATEGORY: Record<string, NotificationCategory> = {
  ticket_assigned: "tickets",
  ticket_unlocked: "tickets",
  ticket_warning: "tickets",
  ticket_scheduled: "crew",
  late_check_in_nudge: "crew",
  ticket_kicked_back: "tickets",
  ticket_rejected: "tickets",
  ticket_approved: "tickets",
  funds_dispersed: "tickets",
  ticket_pending_long: "tickets",
  ticket_inactive: "tickets",
  ticket_note_added: "tickets",
  ticket_unblocked: "tickets",
  // Direct (Partner→Vendor) work assignment lifecycle. Routed through the
  // `tickets` category so they share the same per-user opt-in toggle as
  // every other work-flow alert (in-app + email default ON for new users).
  // The `_offered`, `_committed`, and `_passed` types are joined to the
  // high-priority list below so vendors and partners get the email
  // immediately rather than waiting for the daily digest.
  direct_assignment_offered: "tickets",
  direct_assignment_committed: "tickets",
  direct_assignment_passed: "tickets",
  direct_assignment_cancelled: "tickets",
  crew_added: "crew",
  long_checkin: "crew",
  crew_removed: "crew",
  crew_punch_in: "crew",
  crew_punch_out: "crew",
  schedule_changed: "crew",
  ptt_message: "crew",
  workflow_nudge: "tickets",
  ticket_flagged: "tickets",
  // Task #57 — dispatcher alert when a crew member's phone battery hits
  // a configurable critical threshold. Lives in the `crew` category so
  // it inherits the same per-user opt-in toggle as the other crew/roster
  // notifications.
  low_battery: "crew",
  cert_expiring: "compliance",
  cert_expired: "compliance",
  hotlist_match: "hotlist",
  bid_placed: "hotlist",
  bid_updated: "hotlist",
  bid_declined: "hotlist",
  job_awarded: "hotlist",
  bid_outbid: "hotlist",
  rating_received: "system",
  // Task #248 — OpenAccountant connection lifecycle reminders. Routed
  // through the `system` category so users with system_enabled=false
  // can mute them, with email gated by system_email_enabled.
  oa_connection_revoked: "system",
  oa_connection_expiring: "system",
  visitor_checked_in: "visitor",
  visitor_checked_out: "visitor",
  // Task #50 — comments thread fan-out. `comment_mention` covers BOTH
  // ticket and hotlist mentions (the route just varies the dedupeKey
  // and link); `comment_added` and `hotlist_comment_added` are
  // non-mention replies.
  comment_mention: "comments",
  comment_added: "comments",
  hotlist_comment_added: "comments",
};

// Task #50 — these are the comment-thread reply types. They are gated
// by `commentReplyEmailEnabled` (not the per-category mention flag) and
// — unlike everything else — are NOT emailed instantly. The
// `comment-reply-digest` worker batches them every few minutes so a
// busy thread doesn't dump one email per reply on every participant.
export const COMMENT_REPLY_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "comment_added",
  "hotlist_comment_added",
]);

export function isCommentReplyNotificationType(type: string): boolean {
  return COMMENT_REPLY_NOTIFICATION_TYPES.has(type);
}

export function isCommentMentionNotificationType(type: string): boolean {
  return type === "comment_mention";
}

export function categoryForType(type: string): NotificationCategory {
  return TYPE_TO_CATEGORY[type] ?? "system";
}

const DEFAULT_PREFS = {
  ticketsEnabled: true,
  hotlistEnabled: true,
  complianceEnabled: true,
  crewEnabled: true,
  systemEnabled: true,
  visitorEnabled: true,
  pushEnabled: true,
  dndStartHour: null as number | null,
  dndEndHour: null as number | null,
  // Task #796: per-channel opt-in for QB account-mapping bulk-action
  // expiry warnings. Both default to true so users with no row in
  // notification_preferences keep getting the same in-app + email
  // warnings they got before.
  qbBulkExpiryInAppEnabled: true,
  qbBulkExpiryEmailEnabled: true,
  // Task #47: per-category email delivery for the standard rules-engine
  // / inline alerts. High-priority categories default to ON so users
  // with no preferences row still receive critical emails.
  ticketsEmailEnabled: true,
  hotlistEmailEnabled: true,
  complianceEmailEnabled: true,
  crewEmailEnabled: false,
  systemEmailEnabled: false,
  visitorEmailEnabled: false,
  emailDigestEnabled: false,
  // Task #50 — comments thread fan-out. All three default to true so a
  // brand-new user with no preferences row still gets the alert when
  // they're @mentioned or replied-to. The reply digest is per-channel
  // gated separately from the mention email so users can keep mentions
  // instant but silence the chatty reply digest (or vice versa).
  commentsEnabled: true,
  commentMentionEmailEnabled: true,
  commentReplyEmailEnabled: true,
};

async function getPrefsForUsers(userIds: number[]): Promise<Map<number, typeof DEFAULT_PREFS>> {
  const rows = userIds.length
    ? await db
        .select()
        .from(notificationPreferencesTable)
        .where(inArray(notificationPreferencesTable.userId, userIds))
    : [];
  const map = new Map<number, typeof DEFAULT_PREFS>();
  for (const uid of userIds) map.set(uid, { ...DEFAULT_PREFS });
  for (const r of rows) {
    map.set(r.userId, {
      ticketsEnabled: r.ticketsEnabled,
      hotlistEnabled: r.hotlistEnabled,
      complianceEnabled: r.complianceEnabled,
      crewEnabled: r.crewEnabled,
      systemEnabled: r.systemEnabled,
      visitorEnabled: r.visitorEnabled,
      pushEnabled: r.pushEnabled,
      dndStartHour: r.dndStartHour,
      dndEndHour: r.dndEndHour,
      qbBulkExpiryInAppEnabled: r.qbBulkExpiryInAppEnabled,
      qbBulkExpiryEmailEnabled: r.qbBulkExpiryEmailEnabled,
      ticketsEmailEnabled: r.ticketsEmailEnabled,
      hotlistEmailEnabled: r.hotlistEmailEnabled,
      complianceEmailEnabled: r.complianceEmailEnabled,
      crewEmailEnabled: r.crewEmailEnabled,
      systemEmailEnabled: r.systemEmailEnabled,
      visitorEmailEnabled: r.visitorEmailEnabled,
      emailDigestEnabled: r.emailDigestEnabled,
      commentsEnabled: r.commentsEnabled,
      commentMentionEmailEnabled: r.commentMentionEmailEnabled,
      commentReplyEmailEnabled: r.commentReplyEmailEnabled,
    });
  }
  return map;
}

function categoryEnabled(prefs: typeof DEFAULT_PREFS, cat: NotificationCategory): boolean {
  switch (cat) {
    case "tickets": return prefs.ticketsEnabled;
    case "hotlist": return prefs.hotlistEnabled;
    case "compliance": return prefs.complianceEnabled;
    case "crew": return prefs.crewEnabled;
    case "system": return prefs.systemEnabled;
    case "visitor": return prefs.visitorEnabled;
    case "comments": return prefs.commentsEnabled;
  }
}

// Task #50 — email gating for the comments category is type-aware
// (mention vs reply use independent toggles), so callers must pass the
// notification `type` along with the category. Other categories ignore
// `type` and fall back to the per-category email switch.
function categoryEmailEnabled(
  prefs: typeof DEFAULT_PREFS,
  cat: NotificationCategory,
  type: string,
): boolean {
  switch (cat) {
    case "tickets": return prefs.ticketsEmailEnabled;
    case "hotlist": return prefs.hotlistEmailEnabled;
    case "compliance": return prefs.complianceEmailEnabled;
    case "crew": return prefs.crewEmailEnabled;
    case "system": return prefs.systemEmailEnabled;
    case "visitor": return prefs.visitorEmailEnabled;
    case "comments":
      if (isCommentMentionNotificationType(type)) return prefs.commentMentionEmailEnabled;
      if (isCommentReplyNotificationType(type)) return prefs.commentReplyEmailEnabled;
      // Unknown comment-thread type — gate behind both flags so we
      // don't accidentally start emailing about something we forgot
      // to map (e.g. a future "comment_reaction").
      return prefs.commentMentionEmailEnabled || prefs.commentReplyEmailEnabled;
  }
}

// Task #47 — these notification types are urgent enough that we always
// send an immediate email when the user has email enabled for the
// category, regardless of whether they opted into the daily digest.
// Everything else queues for the digest worker when digest mode is on.
//
// Task #50 — `comment_mention` joins the high-priority set: when
// someone @mentions you in a ticket/hotlist thread you should hear
// about it the same way you'd hear about a kickback.
export const HIGH_PRIORITY_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "ticket_kicked_back",
  "cert_expired",
  "job_awarded",
  "comment_mention",
  "crew_added",
  "schedule_changed",
  "ticket_assigned",
  "ticket_scheduled",
  "late_check_in_nudge",
  "ticket_warning",
  // Direct assignment offers + responses ride the high-priority lane:
  // the partner is waiting on a yes/no before they can re-assign, and a
  // vendor sitting on a pending offer is blocking schedule planning.
  // `cancelled` is informational and stays on the normal/digest path.
  "direct_assignment_offered",
  "direct_assignment_committed",
  "direct_assignment_passed",
  "ptt_message",
  "workflow_nudge",
  "ticket_flagged",
]);

export function isHighPriorityNotificationType(type: string): boolean {
  return HIGH_PRIORITY_NOTIFICATION_TYPES.has(type);
}

function inDndWindow(prefs: typeof DEFAULT_PREFS, now: Date = new Date()): boolean {
  const s = prefs.dndStartHour;
  const e = prefs.dndEndHour;
  if (s == null || e == null) return false;
  const h = now.getHours();
  if (s === e) return false;
  if (s < e) return h >= s && h < e;
  // window wraps midnight
  return h >= s || h < e;
}

export type NotifyInput = {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  category?: NotificationCategory;
  dedupeKey?: string | null;
  // Optional extra fields merged into the push payload's `data` object so
  // mobile deep-link routing can find e.g. `ticketId` (the mobile listener
  // routes by `data.ticketId`, not by `link`). See `vndrly-mobile/app/_layout.tsx`.
  pushData?: Record<string, unknown>;
};

/** Unread inbox count for push badge (matches GET /notifications/unread-count). */
export async function countUnreadForUser(
  userId: number,
  commentsEnabled = true,
): Promise<number> {
  const conds = [
    eq(notificationsTable.userId, userId),
    eq(notificationsTable.isRead, false),
  ];
  if (!commentsEnabled) {
    conds.push(sql`${notificationsTable.category} <> 'comments'`);
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(...conds));
  return row?.n ?? 0;
}

export async function countUnreadForUsers(
  userIds: number[],
  prefs: Map<number, typeof DEFAULT_PREFS>,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!userIds.length) return map;
  await Promise.all(
    userIds.map(async (uid) => {
      const p = prefs.get(uid) ?? DEFAULT_PREFS;
      map.set(uid, await countUnreadForUser(uid, p.commentsEnabled));
    }),
  );
  return map;
}

/** Notify a field employee by vendor_people id (prefs + inbox + push). */
export async function notifyFieldEmployee(
  fieldEmployeeId: number,
  notif: NotifyInput,
): Promise<number> {
  const [fe] = await db
    .select({ userId: vendorPeopleTable.userId })
    .from(vendorPeopleTable)
    .where(eq(vendorPeopleTable.id, fieldEmployeeId));
  if (!fe?.userId) return 0;
  return notifyUsers([fe.userId], notif);
}

/**
 * Push for a notification row that was inserted outside `notifyUsers()`
 * (scheduled workers). Honors the same push / DND / category prefs.
 */
export async function fanOutPushToUser(
  userId: number,
  notif: {
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    category?: NotificationCategory;
    pushData?: Record<string, unknown>;
    notificationId?: number;
  },
): Promise<void> {
  const category = notif.category ?? categoryForType(notif.type);
  const prefs = await getPrefsForUsers([userId]);
  const p = prefs.get(userId)!;
  const now = new Date();
  if (!p.pushEnabled || inDndWindow(p, now) || !categoryEnabled(p, category)) return;

  const badge = await countUnreadForUser(userId, p.commentsEnabled);
  const { sendPushToUser } = await import("../lib/expo-push");
  await sendPushToUser(userId, {
    title: notif.title,
    body: notif.body ?? "",
    badge,
    data: {
      type: notif.type,
      link: notif.link ?? null,
      category,
      ...(notif.notificationId != null ? { notificationId: notif.notificationId } : {}),
      badge,
      ...(notif.pushData ?? {}),
    },
  });
}

// Insert notifications honoring preferences and fan out push.
export async function notifyUsers(userIds: number[], notif: NotifyInput): Promise<number> {
  if (!userIds.length) return 0;
  const category = notif.category ?? categoryForType(notif.type);
  const prefs = await getPrefsForUsers(userIds);
  // Task #50 — for the comments category the email sub-channels
  // (mention email, reply digest email) are independently controllable
  // from the in-app/push category toggle. We must insert the row when
  // ANY enabled channel for this user+type wants delivery, otherwise
  // the email fan-out below — and the reply-digest worker which scans
  // un-emailed `comment_added` rows — would never see the row and the
  // independent email toggles would be silently subordinated to
  // `commentsEnabled`.
  //
  // For every other category the legacy semantics hold: the per-
  // category `*Enabled` flag gates everything, so a single false
  // skips the user entirely.
  const eligible = userIds.filter((uid) => {
    const p = prefs.get(uid)!;
    if (categoryEnabled(p, category)) return true;
    if (category === "comments") {
      if (isCommentMentionNotificationType(notif.type) && p.commentMentionEmailEnabled) return true;
      if (isCommentReplyNotificationType(notif.type) && p.commentReplyEmailEnabled) return true;
    }
    return false;
  });
  if (!eligible.length) return 0;

  const rows = eligible.map((uid) => ({
    userId: uid,
    type: notif.type,
    category,
    dedupeKey: notif.dedupeKey ?? null,
    title: notif.title,
    body: notif.body ?? null,
    link: notif.link ?? null,
  }));

  let inserted: { id: number; userId: number; createdAt: Date }[] = [];
  try {
    inserted = await db
      .insert(notificationsTable)
      .values(rows)
      .onConflictDoNothing({
        target: [notificationsTable.userId, notificationsTable.dedupeKey],
      })
      .returning({
        id: notificationsTable.id,
        userId: notificationsTable.userId,
        // Task #48 — surfaced on the SSE notification.created event so the
        // web bell can show a browser pop-up timestamped to the actual
        // insert (not the moment the SSE arrives).
        createdAt: notificationsTable.createdAt,
      });
  } catch (err) {
    logger.warn({ err }, "notifyUsers insert failed");
    return 0;
  }

  // Task #48 — fan out a real-time `notification.created` event for every
  // newly inserted row. The web bell subscribes via SSE on
  // /api/notifications/events to update its unread count immediately and
  // (when the user has opted in) raise a browser pop-up. Best-effort: if
  // the bus is offline the bell still falls back to its 30s poll.
  for (const r of inserted) {
    try {
      publishNotificationCreated({
        userId: r.userId,
        notificationId: r.id,
        notifType: notif.type,
        category,
        title: notif.title,
        body: notif.body ?? null,
        link: notif.link ?? null,
        createdAt:
          r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      });
    } catch (err) {
      logger.warn(
        { err, userId: r.userId, notificationId: r.id },
        "publishNotificationCreated failed",
      );
    }
  }

  // Fan out push notifications (best-effort) for newly inserted rows only,
  // respecting per-user push + DND prefs.
  const now = new Date();
  const unreadByUser = await countUnreadForUsers(
    inserted.map((r) => r.userId),
    prefs,
  );
  for (const r of inserted) {
    const p = prefs.get(r.userId)!;
    if (!p.pushEnabled || inDndWindow(p, now)) continue;
    // Task #50 — push lives on the same channel as the in-app
    // notification (commentsEnabled). When the row was inserted only
    // because the user wanted EMAIL but kept in-app/push off, we must
    // not fan out push or it would back-door the toggle they just set.
    if (!categoryEnabled(p, category)) continue;
    void sendPushToUser(r.userId, {
      title: notif.title,
      body: notif.body ?? "",
      badge: unreadByUser.get(r.userId) ?? 0,
      data: {
        type: notif.type,
        link: notif.link ?? null,
        category,
        notificationId: r.id,
        badge: unreadByUser.get(r.userId) ?? 0,
        ...(notif.pushData ?? {}),
      },
    }).catch(() => undefined);
  }

  // Task #47 — fan out email delivery (best-effort, fully async). For
  // each newly inserted notification:
  //   • Skip when the recipient has email off for this category.
  //   • For HIGH-priority types OR when the user is NOT on the daily
  //     digest, send an alert email immediately and stamp `emailedAt`.
  //   • Otherwise leave `emailedAt` NULL — the digest worker (see
  //     `notification-email-digest.ts`) will roll the row up later.
  // We deliberately don't await the SendGrid send so a slow email API
  // doesn't slow down the calling endpoint; the worker is the safety
  // net for any send that fails.
  // Task #50 — comment-thread *replies* are deliberately NOT emailed
  // instantly. They get batched by the `comment-reply-digest` worker
  // every few minutes so a busy thread doesn't dump one email per
  // reply. The notifications row stays `emailedAt = NULL` so the
  // worker can pick it up; the daily digest worker leaves the comments
  // category alone.
  const skipInstantEmail = isCommentReplyNotificationType(notif.type);
  const emailEligibleIds = skipInstantEmail
    ? []
    : inserted
        .filter((r) => categoryEmailEnabled(prefs.get(r.userId)!, category, notif.type))
        .map((r) => r.userId);
  if (emailEligibleIds.length) {
    void dispatchNotificationEmails(inserted, prefs, category, notif).catch((err) =>
      logger.warn({ err, type: notif.type }, "notifyUsers email dispatch failed"),
    );
  }

  return inserted.length;
}

// Look up email + display name for the given user ids in a single
// round-trip. Returns a map keyed by userId. Missing rows / users
// without an email simply omit the entry.
async function getEmailContactsForUsers(
  userIds: number[],
): Promise<Map<number, { email: string; name: string | null }>> {
  const map = new Map<number, { email: string; name: string | null }>();
  if (!userIds.length) return map;
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  for (const r of rows) {
    // Prefer the explicit `email` column; fall back to `username` (which
    // is the login email for nearly every account in this app — see
    // schema/users.ts comments). If neither looks like an email, skip.
    const candidate = r.email?.trim() || r.username?.trim() || "";
    if (!candidate.includes("@")) continue;
    map.set(r.id, { email: candidate, name: r.displayName ?? null });
  }
  return map;
}

async function dispatchNotificationEmails(
  inserted: { id: number; userId: number }[],
  prefs: Map<number, typeof DEFAULT_PREFS>,
  category: NotificationCategory,
  notif: NotifyInput,
): Promise<void> {
  const eligibleRows = inserted.filter((r) =>
    categoryEmailEnabled(prefs.get(r.userId)!, category, notif.type),
  );
  if (!eligibleRows.length) return;

  const contacts = await getEmailContactsForUsers(eligibleRows.map((r) => r.userId));
  const high = isHighPriorityNotificationType(notif.type);

  // Collect the row ids we successfully shipped via instant email so we
  // can mark them `emailedAt` in one UPDATE — the digest worker uses
  // that column to skip rows that already went out.
  const sentRowIds: number[] = [];

  for (const r of eligibleRows) {
    const p = prefs.get(r.userId)!;
    const contact = contacts.get(r.userId);
    if (!contact) continue;
    // Digest mode: only send instant emails for high-priority types.
    if (p.emailDigestEnabled && !high) continue;

    try {
      await sendNotificationAlertEmail({
        to: contact.email,
        recipientName: contact.name,
        category,
        type: notif.type,
        title: notif.title,
        body: notif.body ?? null,
        link: notif.link ?? null,
        highPriority: high,
      });
      sentRowIds.push(r.id);
    } catch (err) {
      // Best-effort: log and move on. The notification row stays
      // `emailedAt = NULL` so the digest worker may still pick it up
      // (or surface it on a future retry pass if we add one).
      logger.warn(
        { err, type: notif.type, userId: r.userId },
        "notification alert email failed",
      );
    }
  }

  if (sentRowIds.length) {
    try {
      await db
        .update(notificationsTable)
        .set({ emailedAt: new Date() })
        .where(inArray(notificationsTable.id, sentRowIds));
    } catch (err) {
      logger.warn(
        { err, count: sentRowIds.length },
        "failed to stamp emailedAt on notifications",
      );
    }
  }
}

// Convenience helpers to find users for a partner/vendor org.
// `user_org_memberships` is the source of truth for org assignment.
export async function findPartnerUserIds(partnerId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ id: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "partner"),
        eq(userOrgMembershipsTable.partnerId, partnerId),
      ),
    );
  return rows.map((r) => r.id);
}

export async function findVendorUserIds(vendorId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ id: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, vendorId),
      ),
    );
  return rows.map((r) => r.id);
}

// Batched variants of the single-org lookups above. Used by the 15-minute
// rules engine so a single tick that touches thousands of orgs does not
// issue thousands of point queries that compete with live API traffic.
// Returns a Map keyed by every requested id (with `[]` for orgs that have
// no users) so callers can do straight `map.get(id) ?? []` lookups.
export async function findPartnerUserIdsBatch(
  partnerIds: readonly number[],
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  const unique = [...new Set(partnerIds.filter((id): id is number => Number.isFinite(id)))];
  if (!unique.length) return result;
  for (const id of unique) result.set(id, []);
  const rows = await db
    .selectDistinct({
      partnerId: userOrgMembershipsTable.partnerId,
      userId: userOrgMembershipsTable.userId,
    })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "partner"),
        inArray(userOrgMembershipsTable.partnerId, unique),
      ),
    );
  for (const r of rows) {
    if (r.partnerId == null) continue;
    const arr = result.get(r.partnerId);
    if (arr) arr.push(r.userId);
  }
  return result;
}

export async function findVendorUserIdsBatch(
  vendorIds: readonly number[],
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  const unique = [...new Set(vendorIds.filter((id): id is number => Number.isFinite(id)))];
  if (!unique.length) return result;
  for (const id of unique) result.set(id, []);
  const rows = await db
    .selectDistinct({
      vendorId: userOrgMembershipsTable.vendorId,
      userId: userOrgMembershipsTable.userId,
    })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        inArray(userOrgMembershipsTable.vendorId, unique),
      ),
    );
  for (const r of rows) {
    if (r.vendorId == null) continue;
    const arr = result.get(r.vendorId);
    if (arr) arr.push(r.userId);
  }
  return result;
}

export const VISIT_NOTIFICATIONS_ROLE = "Visitor Notifications";

// Find users in a partner org tagged to receive visitor check-in notifications.
// Resolves users via `user_org_memberships` (the source of truth for newly
// created users) joined to `partner_contacts` by email so the role tags on
// the contact row gate the notification. Falls back to all partner users if
// no one is tagged.
export async function findPartnerVisitNotifierUserIds(partnerId: number): Promise<number[]> {
  // `users` now has a first-class `email` column (Task #202), but the login
  // identifier still lives in `username` and historically *is* the user's
  // email for partner-contact logins. We keep joining on `u.username` here so
  // older accounts created before the email column was populated still match
  // partner_contacts.email — switching to `u.email` would silently drop those
  // users from the notifier set.
  const rows = await db.execute<{ id: number }>(sql`
    select distinct m.user_id as id
    from user_org_memberships m
    join users u on u.id = m.user_id
    join partner_contacts pc
      on pc.partner_id = m.partner_id
      and lower(pc.email) = lower(u.username)
      and pc.deleted_at is null
    where m.org_type = 'partner'
      and m.partner_id = ${partnerId}
      and ${VISIT_NOTIFICATIONS_ROLE} = ANY(pc.roles)
  `);
  const ids = (rows as unknown as { rows?: { id: number }[] }).rows ?? (rows as unknown as { id: number }[]);
  const list = Array.isArray(ids) ? ids.map((r) => r.id) : [];
  if (list.length > 0) return list;
  return findPartnerUserIds(partnerId);
}

// Find users in a vendor org tagged to receive visitor check-in notifications.
// Resolves users via `user_org_memberships` joined to `vendor_people` (either
// by the explicit vendor_people_id link on the membership, or via the legacy
// vendor_people.user_id link) so the role tags on the vendor person gate the
// notification. Falls back to all vendor users if no one is tagged.
export async function findVendorVisitNotifierUserIds(vendorId: number): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    select distinct m.user_id as id
    from user_org_memberships m
    join vendor_people vp
      on vp.vendor_id = m.vendor_id
      and (vp.id = m.vendor_people_id or vp.user_id = m.user_id)
      and vp.deleted_at is null
    where m.org_type = 'vendor'
      and m.vendor_id = ${vendorId}
      and ${VISIT_NOTIFICATIONS_ROLE} = ANY(vp.roles)
  `);
  const ids = (rows as unknown as { rows?: { id: number }[] }).rows ?? (rows as unknown as { id: number }[]);
  const list = Array.isArray(ids) ? ids.map((r) => r.id) : [];
  if (list.length > 0) return list;
  return findVendorUserIds(vendorId);
}

router.get("/notifications", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  // Task #689: per-session, role-aware rate limit on the notification
  // bell endpoints. The bell polls `unread-count` every 30s on every
  // signed-in tab and re-fetches the list whenever the popover opens
  // — a stuck client could otherwise turn that into a tight loop.
  if (!await enforceNotificationsRateLimit(req, res, session)) return;

  // Task #639: optional `?type=...` filter (comma-separated) lets focused
  // surfaces like the mobile "Crew changes" screen pull just the rows
  // they care about (`crew_added,crew_removed`) without scanning the
  // full 100-row inbox payload. Unknown / blank values are dropped so a
  // bad query string never silently widens the result set.
  const typeParam = typeof req.query.type === "string" ? req.query.type : "";
  const types = typeParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Cursor-based pagination using `createdAt`. `before` is an ISO
  // timestamp; rows strictly older than it are returned. Combined with
  // `desc(createdAt)` this gives stable infinite-scroll without an
  // OFFSET that would skew when new rows arrive.
  const beforeParam = typeof req.query.before === "string" ? req.query.before : "";
  const beforeDate = beforeParam ? new Date(beforeParam) : null;
  const validBefore =
    beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;

  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(100, Math.floor(limitParam)))
    : 100;

  const conditions = [eq(notificationsTable.userId, session.userId)];
  if (types.length > 0) {
    conditions.push(inArray(notificationsTable.type, types));
  }
  if (validBefore) {
    conditions.push(lt(notificationsTable.createdAt, validBefore));
  }

  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  // Task #50 — when a user has the "Comments & mentions" in-app
  // category turned OFF but kept either email sub-channel ON, the row
  // is still inserted so the email pipeline / reply-digest worker can
  // see it. Hide those rows from the bell here so the user's in-app
  // toggle remains a real toggle. Push fan-out is gated independently
  // in `notifyUsers`. We only pay for the prefs lookup when the page
  // actually contains a comments row — keeps the hot path unchanged
  // and avoids touching list-filter test fixtures that don't return
  // comments rows.
  const hasCommentsRow = rows.some((r) => r.category === "comments");
  if (!hasCommentsRow) return res.json(rows);
  const [callerPrefs] = await db
    .select({ commentsEnabled: notificationPreferencesTable.commentsEnabled })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, session.userId));
  const callerCommentsEnabled = callerPrefs?.commentsEnabled ?? true;
  const visible = callerCommentsEnabled
    ? rows
    : rows.filter((r) => r.category !== "comments");
  return res.json(visible);
});

router.get("/notifications/unread-count", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  // Same per-session budget as the list endpoint above; both share
  // one bucket per user so a misbehaving client can't dodge the cap
  // by alternating between the two routes.
  if (!await enforceNotificationsRateLimit(req, res, session)) return;
  // Task #50 — match the visibility rule used by GET /notifications:
  // when the caller has the comments in-app channel off, exclude any
  // email-only rows from the unread count so the bell badge agrees
  // with the bell list.
  const [callerPrefs] = await db
    .select({ commentsEnabled: notificationPreferencesTable.commentsEnabled })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, session.userId));
  const callerCommentsEnabled = callerPrefs?.commentsEnabled ?? true;
  const conds = [
    eq(notificationsTable.userId, session.userId),
    eq(notificationsTable.isRead, false),
  ];
  if (!callerCommentsEnabled) {
    conds.push(sql`${notificationsTable.category} <> 'comments'`);
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(...conds));
  return res.json({ count: row?.n ?? 0 });
});

router.post("/notifications/:id/read", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, session.userId)));
  return res.status(204).send();
});

router.post("/notifications/:id/unread", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  await db
    .update(notificationsTable)
    .set({ isRead: false })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, session.userId)));
  return res.status(204).send();
});

router.delete("/notifications/:id", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  await db
    .delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, session.userId)));
  return res.status(204).send();
});

router.post("/notifications/read-all", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, session.userId), eq(notificationsTable.isRead, false)));
  return res.status(204).send();
});

// ── Notifications events stream (SSE) — Task #48 ──
//
// Real-time fan-out for newly inserted notifications so the web bell can
// update its unread count and (when the user has opted in) raise a browser
// pop-up the same instant `notifyUsers()` writes the row, instead of
// waiting for the bell's 30-second poll. Modeled directly on the
// `/api/tickets/events` SSE handler (Task #622): heartbeat ping every
// 25s, a one-shot `notification.hello` carrying the current global seq
// so the client can detect dropped events on reconnect, and per-event
// `id:` lines so EventSource auto-includes Last-Event-ID on reconnect.
//
// Scoping: every event carries a recipient `userId`; we only forward to
// the connected session's user. No other roles need to see another
// user's notifications, so this is the entire access check.
router.get("/notifications/events", (req, res): void => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: connected\n\n`);

  const lastEventIdHeader = req.header("Last-Event-ID");
  const lastSeenSeqRaw =
    lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
  const lastSeenSeq = Number.isFinite(lastSeenSeqRaw) ? lastSeenSeqRaw : null;
  void getCurrentNotificationEventSeq()
    .then((currentSeq) => {
      const gap = lastSeenSeq != null && currentSeq > lastSeenSeq;
      const hello = {
        type: "notification.hello" as const,
        currentSeq,
        lastSeenSeq,
        gap,
      };
      try {
        res.write(`event: notification.hello\n`);
        res.write(`data: ${JSON.stringify(hello)}\n\n`);
      } catch {
        /* client gone */
      }
    })
    .catch(() => {
      /* swallow — clients still get live events */
    });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 25000);

  const unsubscribe = subscribeNotificationEvents((ev) => {
    if (ev.userId !== session.userId) return;
    try {
      if (typeof ev.seq === "number") {
        res.write(`id: ${ev.seq}\n`);
      }
      res.write(`event: ${ev.type}\n`);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {
      /* client gone — cleanup happens on close */
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* already ended */
    }
  });
});

// ---------- Preferences endpoints ----------

router.get("/notifications/preferences", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const [row] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, session.userId));
  return res.json(row ?? { userId: session.userId, ...DEFAULT_PREFS });
});

router.patch("/notifications/preferences", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of [
    "ticketsEnabled",
    "hotlistEnabled",
    "complianceEnabled",
    "crewEnabled",
    "systemEnabled",
    "visitorEnabled",
    "pushEnabled",
    // Task #796 — per-channel opt-in for QB bulk-action expiry warnings.
    "qbBulkExpiryInAppEnabled",
    "qbBulkExpiryEmailEnabled",
    // Task #47 — per-category email delivery + daily digest opt-in.
    "ticketsEmailEnabled",
    "hotlistEmailEnabled",
    "complianceEmailEnabled",
    "crewEmailEnabled",
    "systemEmailEnabled",
    "visitorEmailEnabled",
    "emailDigestEnabled",
    // Task #50 — comments thread fan-out per-channel toggles.
    "commentsEnabled",
    "commentMentionEmailEnabled",
    "commentReplyEmailEnabled",
  ] as const) {
    if (typeof b[k] === "boolean") patch[k] = b[k];
  }
  for (const k of ["dndStartHour", "dndEndHour"] as const) {
    if (b[k] === null) patch[k] = null;
    else if (typeof b[k] === "number" && b[k] >= 0 && b[k] <= 23) patch[k] = b[k];
  }

  const [row] = await db
    .insert(notificationPreferencesTable)
    .values({ userId: session.userId, ...patch })
    .onConflictDoUpdate({
      target: notificationPreferencesTable.userId,
      set: patch,
    })
    .returning();
  return res.json(row);
});

// ---------- QB bulk-action expiry email preview (Task #963) ----------
//
// Renders the same template the expiry-warning worker uses
// (`renderBulkActionExpiringEmail`) with sample data so admins can see
// what the email looks like before opting into the "Email" or "Both"
// channel on /notification-preferences. No SendGrid call is made.
router.get("/notifications/qb-bulk-expiry/preview", async (req, res) => {
  const session = getSession(req);
  if (!session) {
    return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  }
  // QB account-mapping bulk actions (and therefore the expiry-warning
  // emails about them) are admin-only operations. Restrict the preview
  // route to the same audience so we don't leak the admin-oriented
  // template to vendors / field employees / partners.
  if (session.role !== "admin") {
    return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  }
  const [user] = await db
    .select({
      displayName: usersTable.displayName,
      username: usersTable.username,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  const actorName =
    user?.displayName?.trim() ||
    user?.username?.trim() ||
    user?.email?.trim() ||
    "Admin";
  const sample = renderBulkActionExpiringEmail({
    actorName,
    summary: "Apply mapping: 12 rows → 7000 Bank Charges",
    kind: "bulk_apply" as const,
    daysRemaining: 2,
    expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    retentionDays: 14,
  });
  return res.json({
    subject: sample.subject,
    html: sample.html,
    text: sample.text,
    sample: true,
  });
});

// ---------- Manual rules-engine trigger ----------

router.post("/internal/notifications/run", async (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  }
  const { runRulesEngine } = await import("../lib/rules-engine");
  const summary = await runRulesEngine();
  return res.json(summary);
});

export default router;
