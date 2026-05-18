// Task #50 — regression matrix for the comments-category fan-out in
// `notifyUsers`. The fix here decouples the email sub-channels
// (commentMentionEmailEnabled, commentReplyEmailEnabled) from the
// in-app/push category toggle (commentsEnabled), so this test pins:
//
//   • commentsEnabled=false + commentMentionEmailEnabled=true
//        → row inserted, instant mention email sent, push NOT sent
//   • commentsEnabled=false + commentReplyEmailEnabled=true
//        → row inserted with emailedAt=null (so the reply-digest
//          worker can drain it), no instant email, no push
//   • commentsEnabled=false + BOTH email toggles off
//        → no row inserted, no email, no push
//   • commentsEnabled=true + commentMentionEmailEnabled=true
//        → row inserted, push sent, instant mention email sent
//
// The DB is stubbed so we can test the routing decisions in isolation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertedRowsCapture: Array<{ userId: number; type: string; category: string }> = [];
let prefsByUser = new Map<number, Record<string, unknown>>();

const sendPushMock = vi.fn();
const sendAlertEmailMock = vi.fn();
let nextInsertId = 1;

vi.mock("@workspace/db", () => {
  const notificationsTable = {
    __tag: "notifications",
    id: "id",
    userId: "userId",
    dedupeKey: "dedupeKey",
    category: "category",
  } as const;
  const notificationPreferencesTable = {
    __tag: "prefs",
    userId: "userId",
    commentsEnabled: "commentsEnabled",
  } as const;
  const userOrgMembershipsTable = { __tag: "memberships" } as const;
  const usersTable = {
    __tag: "users",
    id: "id",
    email: "email",
    username: "username",
    displayName: "displayName",
  } as const;

  let lastFromTag: string | null = null;
  let lastWhereUserIds: number[] = [];

  function buildSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.from = (table: { __tag: string }) => {
      lastFromTag = table.__tag;
      return chain;
    };
    chain.where = (cond: unknown) => {
      const c = cond as { __userIds?: number[] } | undefined;
      if (c && Array.isArray(c.__userIds)) lastWhereUserIds = c.__userIds;
      return chain;
    };
    chain.orderBy = () => chain;
    chain.then = (cb: (rows: unknown[]) => unknown) => {
      if (lastFromTag === "prefs") {
        // Build the prefs rows the helper expects, with sane defaults
        // for non-comments fields the route reads.
        const rows = lastWhereUserIds.map((uid) => {
          const overrides = prefsByUser.get(uid) ?? {};
          return {
            userId: uid,
            ticketsEnabled: true,
            hotlistEnabled: true,
            complianceEnabled: true,
            crewEnabled: true,
            systemEnabled: true,
            visitorEnabled: true,
            commentsEnabled: true,
            pushEnabled: true,
            dndStartHour: null,
            dndEndHour: null,
            qbBulkExpiryInAppEnabled: true,
            qbBulkExpiryEmailEnabled: true,
            ticketsEmailEnabled: true,
            hotlistEmailEnabled: true,
            complianceEmailEnabled: true,
            crewEmailEnabled: true,
            systemEmailEnabled: true,
            visitorEmailEnabled: true,
            emailDigestEnabled: false,
            commentMentionEmailEnabled: true,
            commentReplyEmailEnabled: true,
            ...overrides,
          };
        });
        return cb(rows);
      }
      // getEmailContactsForUsers reads usersTable; return a deliverable
      // email per requested user.
      if (lastFromTag === "users") {
        const rows = lastWhereUserIds.map((uid) => ({
          id: uid,
          email: `user${uid}@vndrly.test`,
          username: `user${uid}@vndrly.test`,
          displayName: `User ${uid}`,
        }));
        return cb(rows);
      }
      return cb([]);
    };
    return chain;
  }

  return {
    db: {
      select: () => buildSelectChain(),
      insert: (_table: { __tag: string }) => ({
        values: (rows: Array<Record<string, unknown>>) => ({
          onConflictDoNothing: (_opts?: unknown) => ({
            returning: async () => {
              const out = rows.map((r) => {
                insertedRowsCapture.push({
                  userId: r.userId as number,
                  type: r.type as string,
                  category: r.category as string,
                });
                return { id: nextInsertId++, userId: r.userId as number };
              });
              return out;
            },
          }),
        }),
      }),
      update: (_table: { __tag: string }) => ({
        set: (_vals: Record<string, unknown>) => ({
          where: () => Promise.resolve(),
        }),
      }),
    },
    notificationsTable,
    notificationPreferencesTable,
    userOrgMembershipsTable,
    usersTable,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({ __op: "eq" }),
  and: (..._args: unknown[]) => ({ __op: "and" }),
  desc: () => ({ __op: "desc" }),
  inArray: (_col: unknown, vals: unknown) => ({ __op: "in", __userIds: vals }),
  lt: () => ({ __op: "lt" }),
  isNull: () => ({ __op: "isNull" }),
  sql: () => ({ __op: "sql" }),
}));

vi.mock("../lib/expo-push", () => ({ sendPushToUser: (...args: unknown[]) => sendPushMock(...args) }));
vi.mock("../lib/sendgrid", () => ({
  sendNotificationAlertEmail: (...args: unknown[]) => sendAlertEmailMock(...args),
  sendNotificationDigestEmail: vi.fn(),
  buildNotificationDeepLink: (link: string | null | undefined) => link ?? null,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/notifications-rate-limit", () => ({
  enforceNotificationsRateLimit: vi.fn(async () => true),
}));
vi.mock("../lib/session", () => ({ SESSION_SECRET: "test-secret" }));

const { notifyUsers } = await import("./notifications");

beforeEach(() => {
  insertedRowsCapture.length = 0;
  prefsByUser = new Map();
  sendPushMock.mockReset();
  // notifyUsers calls `void sendPushToUser(...).catch(...)` so the mock
  // must return a Promise for `.catch` to be defined.
  sendPushMock.mockResolvedValue(undefined);
  sendAlertEmailMock.mockReset();
  sendAlertEmailMock.mockResolvedValue({ messageId: "stub" });
  nextInsertId = 1000;
});

afterEach(() => {
  vi.useRealTimers();
});

// Wait one microtask cycle so the fire-and-forget email dispatch
// (`void dispatchNotificationEmails(...)`) has a chance to invoke the
// SendGrid mock before we assert.
const flush = () => new Promise((r) => setImmediate(r));

describe("notifyUsers comments preference matrix (Task #50)", () => {
  it("commentsEnabled=false + commentMentionEmailEnabled=true → row + email, no push", async () => {
    prefsByUser.set(7, {
      commentsEnabled: false,
      commentMentionEmailEnabled: true,
      commentReplyEmailEnabled: false,
    });
    const inserted = await notifyUsers([7], {
      type: "comment_mention",
      title: "Jane Doe mentioned you on tracking #0123",
      body: "Hey @user7 please check this",
      link: "/tickets/123#comment-1",
      dedupeKey: "comment_mention:1",
    });
    await flush();

    expect(inserted).toBe(1);
    expect(insertedRowsCapture).toHaveLength(1);
    expect(insertedRowsCapture[0]!.category).toBe("comments");
    // Push must NOT fire — the user opted out of in-app/push for comments.
    expect(sendPushMock).not.toHaveBeenCalled();
    // But the instant mention email MUST fire — that channel is on.
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  it("commentsEnabled=false + commentReplyEmailEnabled=true → row queued for digest, no push, no instant email", async () => {
    prefsByUser.set(8, {
      commentsEnabled: false,
      commentMentionEmailEnabled: false,
      commentReplyEmailEnabled: true,
    });
    const inserted = await notifyUsers([8], {
      type: "comment_added",
      title: "Author commented on tracking #0007",
      body: "ping",
      link: "/tickets/7#comment-2",
      dedupeKey: "comment_added:2",
    });
    await flush();

    expect(inserted).toBe(1);
    expect(insertedRowsCapture).toHaveLength(1);
    expect(insertedRowsCapture[0]!.category).toBe("comments");
    expect(sendPushMock).not.toHaveBeenCalled();
    // Reply types are NEVER sent instantly — they always go through
    // the comment-reply-digest worker which scans for emailedAt=null.
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  it("commentsEnabled=false + ALL email toggles off → no row inserted, no fan-out", async () => {
    prefsByUser.set(9, {
      commentsEnabled: false,
      commentMentionEmailEnabled: false,
      commentReplyEmailEnabled: false,
    });
    const inserted = await notifyUsers([9], {
      type: "comment_mention",
      title: "Author mentioned you",
      body: null,
      link: "/tickets/1",
      dedupeKey: "comment_mention:99",
    });
    await flush();

    expect(inserted).toBe(0);
    expect(insertedRowsCapture).toHaveLength(0);
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  it("commentsEnabled=true + mention email on → row, push, AND instant mention email", async () => {
    prefsByUser.set(10, {
      commentsEnabled: true,
      commentMentionEmailEnabled: true,
      commentReplyEmailEnabled: true,
    });
    const inserted = await notifyUsers([10], {
      type: "comment_mention",
      title: "Author mentioned you on tracking #0042",
      body: "review please",
      link: "/tickets/42#comment-99",
      dedupeKey: "comment_mention:happy",
    });
    await flush();

    expect(inserted).toBe(1);
    expect(insertedRowsCapture).toHaveLength(1);
    // Both push AND instant mention email fire when in-app + email
    // are both on.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  it("commentsEnabled=true + reply digest on → row inserted but NO instant email (digest worker handles it)", async () => {
    prefsByUser.set(11, {
      commentsEnabled: true,
      commentMentionEmailEnabled: true,
      commentReplyEmailEnabled: true,
    });
    const inserted = await notifyUsers([11], {
      type: "comment_added",
      title: "Author commented on tracking #0011",
      body: "another reply",
      link: "/tickets/11#comment-12",
      dedupeKey: "comment_added:12",
    });
    await flush();

    expect(inserted).toBe(1);
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    // Reply notification types are batched by the worker, NEVER
    // emailed instantly — even when every channel is on.
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });
});
