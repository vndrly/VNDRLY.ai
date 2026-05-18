import { pgTable, text, serial, timestamp, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    category: text("category").notNull().default("system"),
    dedupeKey: text("dedupe_key"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Task #47 — when the user has email delivery enabled for this
    // notification's category, the notify pipeline either sends a single
    // alert email immediately (for high-priority types or users without
    // the daily-digest preference) or leaves this column NULL so the
    // daily-digest worker can bundle the row into a single summary email.
    // Either way, once emailed (or rolled into a digest) this column is
    // stamped so the digest worker never re-sends.
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("notifications_user_idx").on(t.userId),
    dedupeUnique: uniqueIndex("notifications_user_dedupe_unique").on(t.userId, t.dedupeKey),
    // Daily-digest worker scans for unemailed rows per user, ordered by
    // creation. A partial index keeps the lookup tight — the vast
    // majority of rows are eventually stamped with `emailedAt` and drop
    // out of the index.
    unemailedIdx: index("notifications_unemailed_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.emailedAt} is null`),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;

export const notificationPreferencesTable = pgTable("notification_preferences", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  ticketsEnabled: boolean("tickets_enabled").notNull().default(true),
  hotlistEnabled: boolean("hotlist_enabled").notNull().default(true),
  complianceEnabled: boolean("compliance_enabled").notNull().default(true),
  crewEnabled: boolean("crew_enabled").notNull().default(true),
  systemEnabled: boolean("system_enabled").notNull().default(true),
  visitorEnabled: boolean("visitor_enabled").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  dndStartHour: integer("dnd_start_hour"),
  dndEndHour: integer("dnd_end_hour"),
  // Per-channel opt-in for "your QB account-mapping bulk action is about to
  // fall out of the undo window" warnings. Today's worker fires both the
  // in-app notification and (when SendGrid is configured + the actor has an
  // email on file) an email. Some admins want one channel and not the other,
  // so we expose two booleans that the worker honors independently:
  //   - both true  → both channels (default; matches pre-Task-#796 behavior)
  //   - in-app only → email off, in-app on
  //   - email only  → in-app off, email on
  //   - both false → off entirely
  // We default both to true so existing users (who have no row in this
  // table or were created before this column existed) keep getting the
  // same notifications they got before — nothing regresses silently.
  qbBulkExpiryInAppEnabled: boolean("qb_bulk_expiry_in_app_enabled").notNull().default(true),
  qbBulkExpiryEmailEnabled: boolean("qb_bulk_expiry_email_enabled").notNull().default(true),
  // Task #47 — per-category opt-in for email delivery of regular alerts
  // (kickbacks, expiring certifications, Hotlist awards, etc.). The high-
  // priority categories (tickets, hotlist, compliance) default to ON so
  // brand-new users with no preferences row still receive critical
  // emails the first time they fire. The lower-priority categories
  // default to OFF so we don't spam users with crew/system/visitor noise
  // by default — they can opt in if they want it. The notify pipeline
  // also gates on the per-category in-app `*Enabled` flags above, so
  // turning a category off there silences both channels at once.
  ticketsEmailEnabled: boolean("tickets_email_enabled").notNull().default(true),
  hotlistEmailEnabled: boolean("hotlist_email_enabled").notNull().default(true),
  complianceEmailEnabled: boolean("compliance_email_enabled").notNull().default(true),
  crewEmailEnabled: boolean("crew_email_enabled").notNull().default(false),
  systemEmailEnabled: boolean("system_email_enabled").notNull().default(false),
  visitorEmailEnabled: boolean("visitor_email_enabled").notNull().default(false),
  // Task #47 — opt-in daily digest. When true, *low-priority* alerts
  // (anything not in HIGH_PRIORITY_TYPES) are accumulated and delivered
  // as a single digest email by `notification-email-digest.ts` once per
  // day, instead of one email per event. High-priority alerts always
  // ship immediately regardless of this setting because the whole point
  // is "you need to know now".
  emailDigestEnabled: boolean("email_digest_enabled").notNull().default(false),
  // Task #50 — comments thread fan-out. The notify pipeline raises three
  // notification types from /tickets/:id/comments and
  // /hotlist/jobs/:id/comments:
  //   • comment_mention            — you were @mentioned
  //   • comment_added              — someone replied on a ticket you're on
  //   • hotlist_comment_added      — someone replied on a hotlist job you're on
  //
  // All three roll up under the synthetic "comments" category. We expose
  // three booleans so users can independently silence the in-app/push
  // channel, the instant mention email, and the every-few-minutes
  // reply-digest email. All default to true because the whole point of
  // the task is "field crews and partners often miss thread updates";
  // opting in by default delivers the alert, opting out is one click.
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
  commentMentionEmailEnabled: boolean("comment_mention_email_enabled")
    .notNull()
    .default(true),
  commentReplyEmailEnabled: boolean("comment_reply_email_enabled")
    .notNull()
    .default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
