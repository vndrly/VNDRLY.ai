// Task #50 — pinning tests for the comment-thread routing helpers in
// routes/notifications.ts. These are tiny but high-stakes:
//   • Misclassifying a type would silently put comment alerts under the
//     wrong category preference (so toggling "Comments" off wouldn't
//     actually silence them).
//   • Removing `comment_mention` from HIGH_PRIORITY_NOTIFICATION_TYPES
//     would demote @mentions into the daily-digest path, breaking the
//     "you should hear about a mention immediately" promise.
//   • Adding a new "comment_*" type without re-checking the
//     reply-vs-mention split would silently change which user toggle
//     gates it.
//
// We deliberately stub out @workspace/db at the module-import level so
// importing the routes file (which pulls in db + auth middleware) doesn't
// require a live database — the helpers under test are pure.

import { describe, expect, it, vi } from "vitest";

// Stub db imports — these helpers are pure but the module imports
// drizzle-backed tables at top level.
vi.mock("@workspace/db", () => ({
  db: {},
  notificationsTable: {},
  notificationPreferencesTable: {},
  usersTable: {},
}));
vi.mock("../lib/expo-push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../lib/sendgrid", () => ({
  sendNotificationAlertEmail: vi.fn(),
  sendNotificationDigestEmail: vi.fn(),
  buildNotificationDeepLink: (link: string | null | undefined) => link ?? null,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/notifications-rate-limit", () => ({
  enforceNotificationsRateLimit: vi.fn(),
}));
vi.mock("../lib/session", () => ({ SESSION_SECRET: "test-secret" }));

const mod = await import("./notifications");

describe("comment-thread notification routing", () => {
  it("classifies comment_mention as a comments-category mention type", () => {
    expect(mod.categoryForType("comment_mention")).toBe("comments");
    expect(mod.isCommentMentionNotificationType("comment_mention")).toBe(true);
    expect(mod.isCommentReplyNotificationType("comment_mention")).toBe(false);
  });

  it("classifies comment_added (ticket reply) as a reply type in the comments category", () => {
    expect(mod.categoryForType("comment_added")).toBe("comments");
    expect(mod.isCommentReplyNotificationType("comment_added")).toBe(true);
    expect(mod.isCommentMentionNotificationType("comment_added")).toBe(false);
  });

  it("classifies hotlist_comment_added (hotlist reply) as a reply type in the comments category", () => {
    expect(mod.categoryForType("hotlist_comment_added")).toBe("comments");
    expect(mod.isCommentReplyNotificationType("hotlist_comment_added")).toBe(true);
    expect(mod.isCommentMentionNotificationType("hotlist_comment_added")).toBe(false);
  });

  it("treats comment_mention as high-priority so it bypasses the daily digest", () => {
    expect(mod.isHighPriorityNotificationType("comment_mention")).toBe(true);
  });

  it("does NOT treat reply types as high-priority — they batch through the reply digest worker", () => {
    expect(mod.isHighPriorityNotificationType("comment_added")).toBe(false);
    expect(mod.isHighPriorityNotificationType("hotlist_comment_added")).toBe(false);
  });

  it("COMMENT_REPLY_NOTIFICATION_TYPES contains exactly the two reply types the worker drains", () => {
    expect([...mod.COMMENT_REPLY_NOTIFICATION_TYPES].sort()).toEqual([
      "comment_added",
      "hotlist_comment_added",
    ]);
  });

  it("falls back to system category for unknown types", () => {
    expect(mod.categoryForType("totally_made_up_type")).toBe("system");
  });
});
