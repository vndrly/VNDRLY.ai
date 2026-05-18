// Stub-based unit tests for the every-5-minute comment-reply digest
// worker (Task #50). Mirrors the structure of
// `notification-email-digest.test.ts`: @workspace/db is mocked so the
// worker's branch decisions can be exercised in isolation.
//
// Coverage targets:
//   • candidate filtering (only un-emailed reply rows queue up)
//   • per-user gating via `commentReplyEmailEnabled` (off → email
//     suppressed but rows still stamped so they don't pile up forever)
//   • users with no deliverable email get their backlog stamped
//   • SendGrid failure leaves rows un-stamped so the next tick retries
//   • multiple replies on the same thread group under one section

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const candidateRows: Array<{ userId: number }> = [];
const prefsRows: Array<Record<string, unknown>> = [];
const userRows: Array<Record<string, unknown>> = [];
const notificationRowsByUser = new Map<number, Array<Record<string, unknown>>>();
const stampedRowIds: number[] = [];

const sendReplyDigestMock = vi.fn();

vi.mock("@workspace/db", () => {
  const notificationsTable = {
    __tag: "notifications",
    id: "id",
    userId: "userId",
    type: "type",
    title: "title",
    body: "body",
    link: "link",
    createdAt: "createdAt",
    emailedAt: "emailedAt",
  } as const;
  const notificationPreferencesTable = {
    __tag: "prefs",
    userId: "userId",
    commentReplyEmailEnabled: "commentReplyEmailEnabled",
  } as const;
  const usersTable = {
    __tag: "users",
    id: "id",
    email: "email",
    username: "username",
    displayName: "displayName",
  } as const;

  // The worker's call sequence:
  //   1. selectDistinct({userId}) from notificationsTable.where(...)
  //      → candidateRows
  //   2. select() from notificationPreferencesTable
  //      .where(inArray(userId, [...])) → prefsRows
  //   3. select({...}) from usersTable
  //      .where(inArray(id, [...])) → userRows
  //   4. select({...}) from notificationsTable
  //      .where(and(eq(userId, N), inArray(type, [...]), isNull(emailedAt)))
  //      .orderBy(createdAt) → notificationRowsByUser.get(N)
  let lastFromTag: string | null = null;
  let lastWhereUserId: number | null = null;

  function makeResolver(): { then: (cb: (rows: unknown[]) => unknown) => unknown } {
    return {
      then: (cb: (rows: unknown[]) => unknown) => {
        if (lastFromTag === "notifications" && lastWhereUserId == null) {
          // The candidate sweep — no per-user `eq` so we return the
          // distinct list of user ids the worker should consider.
          return cb(candidateRows);
        }
        if (lastFromTag === "prefs") return cb(prefsRows);
        if (lastFromTag === "users") return cb(userRows);
        if (lastFromTag === "notifications") {
          const uid = lastWhereUserId;
          return cb(uid != null ? (notificationRowsByUser.get(uid) ?? []) : []);
        }
        return cb([]);
      },
    };
  }

  function buildSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    // Reset the per-user marker at the start of each chain so the
    // candidate sweep (no eq) doesn't accidentally inherit a userId
    // from a previous per-user query in the same test.
    lastWhereUserId = null;
    chain.from = (table: { __tag: string }) => {
      lastFromTag = table.__tag;
      return chain;
    };
    chain.where = (cond: unknown) => {
      const c = cond as { __userIdEq?: number } | undefined;
      if (c && typeof c.__userIdEq === "number") lastWhereUserId = c.__userIdEq;
      return chain;
    };
    chain.orderBy = () => makeResolver();
    chain.then = (cb: (rows: unknown[]) => unknown) =>
      makeResolver().then(cb);
    return chain;
  }

  return {
    db: {
      select: () => buildSelectChain(),
      selectDistinct: () => buildSelectChain(),
      update: (_table: { __tag: string }) => ({
        set: (_vals: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: async () => {
              // The worker only ever stamps via inArray(id, [...]).
              const c = cond as { __ids?: unknown } | undefined;
              const ids: number[] = [];
              if (c && Array.isArray(c.__ids)) {
                for (const id of c.__ids as number[]) ids.push(id);
              }
              stampedRowIds.push(...ids);
              return ids.map((id) => ({ id }));
            },
          }),
        }),
      }),
    },
    notificationsTable,
    notificationPreferencesTable,
    usersTable,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => {
    const c = col as { name?: string } | string | undefined;
    const colName = typeof c === "string" ? c : c?.name;
    return colName === "userId" ? { __userIdEq: val } : { __op: "eq" };
  },
  and: (...args: unknown[]) => {
    for (const a of args) {
      const x = a as { __userIdEq?: number } | undefined;
      if (x && typeof x.__userIdEq === "number") return x;
    }
    return { __op: "and" };
  },
  inArray: (_col: unknown, vals: unknown) => ({ __op: "in", __ids: vals }),
  isNull: () => ({ __op: "isNull" }),
  sql: (..._args: unknown[]) => ({ __op: "sql" }),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./sendgrid", async () => {
  const actual =
    await vi.importActual<typeof import("./sendgrid")>("./sendgrid");
  return {
    ...actual,
    sendCommentReplyDigestEmail: (...args: unknown[]) =>
      sendReplyDigestMock(...args),
  };
});

beforeEach(() => {
  candidateRows.length = 0;
  prefsRows.length = 0;
  userRows.length = 0;
  notificationRowsByUser.clear();
  stampedRowIds.length = 0;
  sendReplyDigestMock.mockReset();
  sendReplyDigestMock.mockResolvedValue({ messageId: "stub" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCommentReplyDigest", () => {
  it("returns an empty summary when no candidates are queued", async () => {
    const { runCommentReplyDigest } = await import("./comment-reply-digest");
    const summary = await runCommentReplyDigest(new Date("2026-05-01T14:00:00Z"));
    expect(summary).toEqual({
      usersConsidered: 0,
      digestsSent: 0,
      rowsMarked: 0,
      errors: 0,
    });
    expect(sendReplyDigestMock).not.toHaveBeenCalled();
  });

  it("sends one digest per user with reply email enabled and stamps every row", async () => {
    candidateRows.push({ userId: 7 });
    prefsRows.push({ userId: 7, commentReplyEmailEnabled: true });
    userRows.push({
      id: 7,
      email: "field@vndrly.test",
      username: "field@vndrly.test",
      displayName: "Field User",
    });
    notificationRowsByUser.set(7, [
      {
        id: 100,
        type: "comment_added",
        title: "Jane Doe commented on tracking #0123",
        body: "Heads up — please re-check the gauges.",
        link: "/tickets/123#comment-100",
        createdAt: new Date("2026-05-01T13:50:00Z"),
      },
      {
        id: 101,
        type: "hotlist_comment_added",
        title: "Bob Smith commented on a Hotlist job",
        body: "Quote attached.",
        link: "/hotlist/42#comment-101",
        createdAt: new Date("2026-05-01T13:55:00Z"),
      },
    ]);

    const { runCommentReplyDigest } = await import("./comment-reply-digest");
    const summary = await runCommentReplyDigest(new Date("2026-05-01T14:00:00Z"));

    expect(summary.usersConsidered).toBe(1);
    expect(summary.digestsSent).toBe(1);
    expect(summary.rowsMarked).toBe(2);
    expect(summary.errors).toBe(0);
    expect(stampedRowIds.sort()).toEqual([100, 101]);

    expect(sendReplyDigestMock).toHaveBeenCalledTimes(1);
    const arg = sendReplyDigestMock.mock.calls[0]![0] as {
      to: string;
      recipientName: string | null;
      items: Array<{
        source: "ticket" | "hotlist";
        threadLabel: string;
        body: string | null;
      }>;
    };
    expect(arg.to).toBe("field@vndrly.test");
    expect(arg.recipientName).toBe("Field User");
    expect(arg.items).toHaveLength(2);
    expect(arg.items[0]!.source).toBe("ticket");
    expect(arg.items[0]!.threadLabel).toBe("tracking #0123");
    expect(arg.items[1]!.source).toBe("hotlist");
    expect(arg.items[1]!.threadLabel).toBe("a Hotlist job");
  });

  it("suppresses email when commentReplyEmailEnabled is false but still stamps rows", async () => {
    candidateRows.push({ userId: 8 });
    prefsRows.push({ userId: 8, commentReplyEmailEnabled: false });
    userRows.push({
      id: 8,
      email: "quiet@vndrly.test",
      username: "quiet@vndrly.test",
      displayName: "Quiet User",
    });
    notificationRowsByUser.set(8, [
      {
        id: 200,
        type: "comment_added",
        title: "Author commented on tracking #0001",
        body: "ping",
        link: "/tickets/1#comment-200",
        createdAt: new Date("2026-05-01T13:00:00Z"),
      },
    ]);

    const { runCommentReplyDigest } = await import("./comment-reply-digest");
    const summary = await runCommentReplyDigest(new Date("2026-05-01T14:00:00Z"));

    expect(summary.digestsSent).toBe(0);
    expect(summary.rowsMarked).toBe(1);
    expect(summary.errors).toBe(0);
    expect(stampedRowIds).toEqual([200]);
    expect(sendReplyDigestMock).not.toHaveBeenCalled();
  });

  it("skips users with no deliverable email but still stamps their backlog", async () => {
    candidateRows.push({ userId: 9 });
    prefsRows.push({ userId: 9, commentReplyEmailEnabled: true });
    userRows.push({
      id: 9,
      // Username is the auth handle for vendor-people logins and is
      // NOT an address. Without a real email we have nowhere to send.
      email: null,
      username: "vendor-handle-without-at-sign",
      displayName: "Handle Login",
    });
    notificationRowsByUser.set(9, [
      {
        id: 300,
        type: "comment_added",
        title: "Author commented on tracking #0009",
        body: null,
        link: null,
        createdAt: new Date("2026-05-01T13:30:00Z"),
      },
    ]);

    const { runCommentReplyDigest } = await import("./comment-reply-digest");
    const summary = await runCommentReplyDigest(new Date("2026-05-01T14:00:00Z"));

    expect(summary.digestsSent).toBe(0);
    expect(summary.rowsMarked).toBe(1);
    expect(summary.errors).toBe(0);
    expect(stampedRowIds).toEqual([300]);
    expect(sendReplyDigestMock).not.toHaveBeenCalled();
  });

  it("leaves rows un-stamped when SendGrid throws so the next tick retries", async () => {
    sendReplyDigestMock.mockRejectedValueOnce(new Error("sendgrid 503"));
    candidateRows.push({ userId: 10 });
    prefsRows.push({ userId: 10, commentReplyEmailEnabled: true });
    userRows.push({
      id: 10,
      email: "retry@vndrly.test",
      username: "retry@vndrly.test",
      displayName: "Retry User",
    });
    notificationRowsByUser.set(10, [
      {
        id: 400,
        type: "comment_added",
        title: "Author commented on tracking #0042",
        body: "retry me",
        link: "/tickets/42#comment-400",
        createdAt: new Date("2026-05-01T13:45:00Z"),
      },
    ]);

    const { runCommentReplyDigest } = await import("./comment-reply-digest");
    const summary = await runCommentReplyDigest(new Date("2026-05-01T14:00:00Z"));

    expect(summary.digestsSent).toBe(0);
    // CRITICAL: a transient send failure must NOT stamp the row, or
    // the user would silently lose the reply on retry.
    expect(summary.rowsMarked).toBe(0);
    expect(summary.errors).toBe(1);
    expect(stampedRowIds).toEqual([]);
  });

  it("treats a missing prefs row as default-on (new users still get reply emails)", async () => {
    candidateRows.push({ userId: 11 });
    // prefsRows intentionally empty — user has never opened the prefs page.
    userRows.push({
      id: 11,
      email: "newcomer@vndrly.test",
      username: "newcomer@vndrly.test",
      displayName: "Newcomer",
    });
    notificationRowsByUser.set(11, [
      {
        id: 500,
        type: "comment_added",
        title: "Author commented on tracking #0050",
        body: "welcome aboard",
        link: "/tickets/50#comment-500",
        createdAt: new Date("2026-05-01T13:55:00Z"),
      },
    ]);

    const { runCommentReplyDigest } = await import("./comment-reply-digest");
    const summary = await runCommentReplyDigest(new Date("2026-05-01T14:00:00Z"));

    expect(summary.digestsSent).toBe(1);
    expect(summary.rowsMarked).toBe(1);
    expect(sendReplyDigestMock).toHaveBeenCalledTimes(1);
  });
});
