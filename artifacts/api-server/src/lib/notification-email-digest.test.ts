// Stub-based unit tests for the daily notification email digest worker
// (Task #47). We mock @workspace/db so the SQL pipeline is exercised
// purely from the worker's perspective; the goal is to lock in the
// branch decisions the worker is supposed to make:
//
//   • candidate filtering (digest-on users with un-emailed rows)
//   • per-row category-email gating (a row in a category the user
//     turned email off for must NOT appear in the email body, but the
//     row should still be marked emailed so it doesn't pile up forever)
//   • users without a deliverable email get their backlog stamped so
//     the worker doesn't reconsider them every day
//   • a SendGrid failure leaves rows un-stamped so tomorrow retries
//
// We also smoke-test the `buildNotificationDeepLink` helper from
// sendgrid.ts to lock in its handling of absolute / app-relative /
// missing-base-url cases — the digest body relies on it for click
// targets.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-table fixtures. Refilled in beforeEach.
const candidateRows: Array<{ userId: number }> = [];
const prefsRows: Array<Record<string, unknown>> = [];
const userRows: Array<Record<string, unknown>> = [];
const notificationRowsByUser = new Map<number, Array<Record<string, unknown>>>();
const stampedRowIds: number[] = [];

const sendDigestMock = vi.fn();

vi.mock("@workspace/db", () => {
  const notificationsTable = {
    __tag: "notifications",
    id: "id",
    userId: "userId",
    emailedAt: "emailedAt",
  } as const;
  const notificationPreferencesTable = {
    __tag: "prefs",
    userId: "userId",
    emailDigestEnabled: "emailDigestEnabled",
  } as const;
  const usersTable = {
    __tag: "users",
    id: "id",
    email: "email",
    username: "username",
    displayName: "displayName",
  } as const;

  // Track which `from()` was called so subsequent `where()` calls can
  // route results to the right fixture. The worker performs:
  //   1. selectDistinct from prefsTable.innerJoin(notificationsTable)
  //      → returns candidates
  //   2. select from prefsTable                → prefsRows
  //   3. select from usersTable                → userRows
  //   4. select from notificationsTable (per user) → notificationRowsByUser.get(userId)
  let lastFromTag: string | null = null;
  let lastWhereUserId: number | null = null;

  // Awaitable thenable that resolves to the right fixture for the
  // current chain. Captures the most recently scoped userId for
  // per-user notification queries.
  function makeResolver(): { then: (cb: (rows: unknown[]) => unknown) => unknown } {
    return {
      then: (cb: (rows: unknown[]) => unknown) => {
        if (lastFromTag === "prefs+join") return cb(candidateRows);
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
    chain.from = (table: { __tag: string }) => {
      lastFromTag = table.__tag;
      return chain;
    };
    chain.innerJoin = () => {
      // Only the candidate query joins; tag the source so the resolver
      // can return candidateRows.
      lastFromTag = "prefs+join";
      return chain;
    };
    chain.where = (cond: unknown) => {
      // Capture an explicit `eq(userId, N)` so the per-user
      // notifications fetch returns the right slice.
      const c = cond as { __userIdEq?: number } | undefined;
      if (c && typeof c.__userIdEq === "number") lastWhereUserId = c.__userIdEq;
      return chain;
    };
    chain.orderBy = () => makeResolver();
    chain.then = (cb: (rows: unknown[]) => unknown) => makeResolver().then(cb);
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
              // Two shapes show up:
              //   • `inArray(notifications.id, [...ids])` — explicit
              //     ids passed when the worker sends a digest.
              //   • `and(eq(userId, N), isNull(emailedAt))` — the
              //     no-email-on-file path that nukes the user's whole
              //     backlog.
              const c = cond as
                | { __ids?: unknown; __userIdEq?: number }
                | undefined;
              const ids: number[] = [];
              if (c && Array.isArray(c.__ids)) {
                for (const id of c.__ids as number[]) ids.push(id);
              } else if (c && typeof c.__userIdEq === "number") {
                const rows = notificationRowsByUser.get(c.__userIdEq) ?? [];
                for (const r of rows) ids.push(r.id as number);
                notificationRowsByUser.set(c.__userIdEq, []);
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
  // eq(userId, N) returns a tagged object so the mock chain can pluck
  // the user id back out when it sees the where() call.
  eq: (col: unknown, val: unknown) => {
    const c = col as { name?: string } | string | undefined;
    const colName = typeof c === "string" ? c : c?.name;
    return colName === "userId" ? { __userIdEq: val } : { __op: "eq" };
  },
  and: (...args: unknown[]) => {
    // Hoist any nested __userIdEq markers so the chain can still see them.
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
    sendNotificationDigestEmail: (...args: unknown[]) => sendDigestMock(...args),
  };
});

// Helper: build a `prefs` fixture row with all category-email flags
// defaulting to true so individual tests can opt one off.
function prefsRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: 0,
    emailDigestEnabled: true,
    ticketsEmailEnabled: true,
    hotlistEmailEnabled: true,
    complianceEmailEnabled: true,
    crewEmailEnabled: true,
    systemEmailEnabled: true,
    visitorEmailEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  candidateRows.length = 0;
  prefsRows.length = 0;
  userRows.length = 0;
  notificationRowsByUser.clear();
  stampedRowIds.length = 0;
  sendDigestMock.mockReset();
  sendDigestMock.mockResolvedValue({ messageId: "stub" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runNotificationEmailDigest", () => {
  it("returns an empty summary when no candidates are queued", async () => {
    const { runNotificationEmailDigest } = await import(
      "./notification-email-digest"
    );

    const summary = await runNotificationEmailDigest(new Date("2026-05-01T14:00:00Z"));

    expect(summary).toEqual({
      usersConsidered: 0,
      digestsSent: 0,
      rowsMarked: 0,
      errors: 0,
    });
    expect(sendDigestMock).not.toHaveBeenCalled();
  });

  it("sends one digest per candidate user with category gating applied", async () => {
    candidateRows.push({ userId: 7 });
    prefsRows.push(prefsRow({ userId: 7, systemEmailEnabled: false }));
    userRows.push({
      id: 7,
      email: "field@vndrly.test",
      username: "field@vndrly.test",
      displayName: "Field User",
    });
    // Three queued rows: tickets (eligible), system (suppressed by
    // pref), hotlist (eligible).
    notificationRowsByUser.set(7, [
      {
        id: 100,
        category: "tickets",
        type: "ticket_assigned",
        title: "Ticket #1 assigned",
        body: "Heads up",
        link: "/tickets/1",
        createdAt: new Date("2026-04-30T10:00:00Z"),
      },
      {
        id: 101,
        category: "system",
        type: "system_notice",
        title: "Account update",
        body: null,
        link: null,
        createdAt: new Date("2026-04-30T11:00:00Z"),
      },
      {
        id: 102,
        category: "hotlist",
        type: "hotlist_match",
        title: "Bid match",
        body: "New bid available",
        link: "/hotlist/42",
        createdAt: new Date("2026-04-30T12:00:00Z"),
      },
    ]);

    const { runNotificationEmailDigest } = await import(
      "./notification-email-digest"
    );
    const summary = await runNotificationEmailDigest(
      new Date("2026-05-01T14:00:00Z"),
    );

    expect(summary.usersConsidered).toBe(1);
    expect(summary.digestsSent).toBe(1);
    // All three queued rows are stamped — even the suppressed one — so
    // the worker doesn't keep reconsidering ineligible categories.
    expect(summary.rowsMarked).toBe(3);
    expect(stampedRowIds.sort()).toEqual([100, 101, 102]);

    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    const arg = sendDigestMock.mock.calls[0]![0] as {
      to: string;
      recipientName: string | null;
      dayLabel: string;
      items: Array<{ category: string; title: string }>;
    };
    expect(arg.to).toBe("field@vndrly.test");
    expect(arg.recipientName).toBe("Field User");
    expect(arg.dayLabel).toBe("May 1, 2026");
    // Only the two eligible rows are in the email body; the system row
    // was suppressed because the user disabled system email.
    expect(arg.items.map((i) => i.title).sort()).toEqual([
      "Bid match",
      "Ticket #1 assigned",
    ]);
  });

  it("stamps backlog without sending when the user has no deliverable email", async () => {
    candidateRows.push({ userId: 9 });
    prefsRows.push(prefsRow({ userId: 9 }));
    userRows.push({
      id: 9,
      email: null,
      username: "no-at-symbol",
      displayName: "Mystery User",
    });
    notificationRowsByUser.set(9, [
      {
        id: 200,
        category: "tickets",
        type: "ticket_assigned",
        title: "Stranded",
        body: null,
        link: null,
        createdAt: new Date(),
      },
    ]);

    const { runNotificationEmailDigest } = await import(
      "./notification-email-digest"
    );
    const summary = await runNotificationEmailDigest(
      new Date("2026-05-01T14:00:00Z"),
    );

    expect(summary.digestsSent).toBe(0);
    expect(summary.rowsMarked).toBe(1);
    expect(sendDigestMock).not.toHaveBeenCalled();
    expect(stampedRowIds).toContain(200);
  });

  it("leaves rows un-stamped when SendGrid throws so tomorrow retries", async () => {
    candidateRows.push({ userId: 11 });
    prefsRows.push(prefsRow({ userId: 11 }));
    userRows.push({
      id: 11,
      email: "boom@vndrly.test",
      username: "boom@vndrly.test",
      displayName: "Boom",
    });
    notificationRowsByUser.set(11, [
      {
        id: 300,
        category: "tickets",
        type: "ticket_assigned",
        title: "Will fail",
        body: null,
        link: "/tickets/9",
        createdAt: new Date(),
      },
    ]);
    sendDigestMock.mockRejectedValueOnce(new Error("SendGrid 503"));

    const { runNotificationEmailDigest } = await import(
      "./notification-email-digest"
    );
    const summary = await runNotificationEmailDigest(
      new Date("2026-05-01T14:00:00Z"),
    );

    expect(summary.digestsSent).toBe(0);
    expect(summary.errors).toBe(1);
    expect(summary.rowsMarked).toBe(0);
    expect(stampedRowIds).not.toContain(300);
  });
});

describe("buildNotificationDeepLink", () => {
  it("returns null when the link is missing", async () => {
    const { buildNotificationDeepLink } = await import("./sendgrid");
    expect(buildNotificationDeepLink(null)).toBeNull();
    expect(buildNotificationDeepLink(undefined)).toBeNull();
    expect(buildNotificationDeepLink("")).toBeNull();
  });

  it("passes through absolute URLs unchanged", async () => {
    vi.stubEnv("APP_BASE_URL", "https://app.example.com");
    const { buildNotificationDeepLink } = await import("./sendgrid");
    expect(buildNotificationDeepLink("https://other.example/foo")).toBe(
      "https://other.example/foo",
    );
    expect(buildNotificationDeepLink("http://other.example/foo")).toBe(
      "http://other.example/foo",
    );
  });

  it("prepends APP_BASE_URL for app-relative paths and trims trailing slashes", async () => {
    vi.stubEnv("APP_BASE_URL", "https://app.example.com/");
    const { buildNotificationDeepLink } = await import("./sendgrid");
    expect(buildNotificationDeepLink("/tickets/123")).toBe(
      "https://app.example.com/tickets/123",
    );
    expect(buildNotificationDeepLink("tickets/123")).toBe(
      "https://app.example.com/tickets/123",
    );
  });

  it("returns null when APP_BASE_URL is not configured", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    const { buildNotificationDeepLink } = await import("./sendgrid");
    expect(buildNotificationDeepLink("/tickets/1")).toBeNull();
  });
});
