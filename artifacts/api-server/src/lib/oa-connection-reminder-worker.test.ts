// Stub-based unit tests for the OA connection reminder worker
// (Task #248). We mock @workspace/db, sendgrid, and the notifyUsers
// route helper so the scan -> claim -> notify pipeline can be driven
// without touching Postgres or SendGrid. The cross-instance dedupe
// race is exercised by the unique index on
// accounting_connection_reminder_log.dedupe_key itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const candidateRows: unknown[] = [];
const vendorMembershipRows: unknown[] = [];
const creatorRows: unknown[] = [];
const insertedLogs: Array<Record<string, unknown>> = [];
const updatedLogs: Array<{ key: string; set: Record<string, unknown> }> = [];
const existingLogByKey = new Map<string, { failureMessage: string | null }>();
let logIdCounter = 1;

const sendEmailMock = vi.fn();
const notifyUsersMock = vi.fn();

vi.mock("@workspace/db", () => {
  const accountingConnectionsTable = { __tag: "conns" } as const;
  const vendorsTable = { __tag: "vendors" } as const;
  const userOrgMembershipsTable = { __tag: "memberships" } as const;
  const usersTable = { __tag: "users" } as const;
  const accountingConnectionReminderLogTable = {
    __tag: "log",
    dedupeKey: { __col: "dedupe_key" },
  } as const;

  function selectChain(rowsRef: () => unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rowsRef());
    return chain;
  }

  return {
    accountingConnectionsTable,
    vendorsTable,
    userOrgMembershipsTable,
    usersTable,
    accountingConnectionReminderLogTable,
    db: {
      select: () => ({
        from: (table: { __tag: string }) => {
          if (table.__tag === "conns") return selectChain(() => candidateRows);
          if (table.__tag === "memberships")
            return selectChain(() => vendorMembershipRows);
          if (table.__tag === "users")
            return selectChain(() => creatorRows);
          if (table.__tag === "log") {
            // Used to look up the existing log row by dedupe_key when
            // the INSERT lost the race. Returns the most recently
            // queued existing row for the test (single-row paths).
            const chain: Record<string, unknown> = {};
            chain.from = () => chain;
            chain.where = (predicate: unknown) => {
              void predicate;
              const last = Array.from(existingLogByKey.values()).pop();
              return {
                then: (resolve: (rows: unknown[]) => unknown) =>
                  resolve(last ? [last] : []),
              };
            };
            return chain;
          }
          throw new Error(`unexpected select table ${table.__tag}`);
        },
      }),
      insert: (table: { __tag: string }) => {
        if (table.__tag !== "log") {
          throw new Error(`unexpected insert table ${table.__tag}`);
        }
        return {
          values: (row: Record<string, unknown>) => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                const key = String(row["dedupeKey"] ?? "");
                if (existingLogByKey.has(key)) return [];
                existingLogByKey.set(key, { failureMessage: null });
                insertedLogs.push(row);
                return [{ id: logIdCounter++ }];
              },
            }),
          }),
        };
      },
      update: (table: { __tag: string }) => {
        if (table.__tag !== "log") {
          throw new Error(`unexpected update table ${table.__tag}`);
        }
        return {
          set: (changes: Record<string, unknown>) => ({
            where: async (predicate: unknown) => {
              void predicate;
              const lastKey = Array.from(existingLogByKey.keys()).pop() ?? "";
              updatedLogs.push({ key: lastKey, set: changes });
              if (existingLogByKey.has(lastKey)) {
                existingLogByKey.set(lastKey, {
                  failureMessage:
                    typeof changes["failureMessage"] === "string"
                      ? (changes["failureMessage"] as string)
                      : null,
                });
              }
              return undefined;
            },
          }),
        };
      },
    },
  };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./sendgrid", () => ({
  sendOaConnectionReminderEmail: (...args: unknown[]) =>
    sendEmailMock(...args),
}));

vi.mock("../routes/notifications", () => ({
  notifyUsers: (...args: unknown[]) => notifyUsersMock(...args),
}));

import { runOaConnectionReminderScan } from "./oa-connection-reminder-worker";

beforeEach(() => {
  candidateRows.length = 0;
  vendorMembershipRows.length = 0;
  creatorRows.length = 0;
  insertedLogs.length = 0;
  updatedLogs.length = 0;
  existingLogByKey.clear();
  logIdCounter = 1;
  sendEmailMock.mockReset();
  notifyUsersMock.mockReset();
  notifyUsersMock.mockResolvedValue(0);
  sendEmailMock.mockResolvedValue({ messageId: "msg-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runOaConnectionReminderScan", () => {
  it("notifies for a revoked connection and stamps the dedupe log", async () => {
    const updatedAt = new Date("2026-04-01T12:00:00Z");
    candidateRows.push({
      connectionId: 7,
      vendorId: 42,
      vendorName: "Acme Field Services",
      displayName: "Acme Books",
      status: "revoked",
      accessTokenExpiresAt: null,
      updatedAt,
      createdByUserId: 99,
    });
    vendorMembershipRows.push({ id: 11, suspendedAt: null });
    vendorMembershipRows.push({ id: 12, suspendedAt: null });
    creatorRows.push({
      email: "creator@example.com",
      username: "creator",
      displayName: "Casey Creator",
      suspendedAt: null,
    });
    notifyUsersMock.mockResolvedValueOnce(2);

    const result = await runOaConnectionReminderScan(
      new Date("2026-05-03T00:00:00Z"),
    );

    expect(result.scanned).toBe(1);
    expect(result.triggersFired).toBe(1);
    expect(result.triggersSkipped).toBe(0);
    expect(result.emailSent).toBe(1);
    expect(result.emailFailed).toBe(0);
    expect(result.inAppRecipients).toBe(2);

    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]).toMatchObject({
      connectionId: 7,
      reason: "revoked",
      dedupeKey: `oa_conn_revoked:7:${updatedAt.getTime()}`,
    });

    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0]!;
    expect(new Set(recipients as number[])).toEqual(new Set([11, 12, 99]));
    expect(payload).toMatchObject({
      type: "oa_connection_revoked",
      dedupeKey: `oa_conn_revoked:7:${updatedAt.getTime()}`,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailArg = sendEmailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(emailArg).toMatchObject({
      to: "creator@example.com",
      reason: "revoked",
      vendorName: "Acme Field Services",
    });

    // Successful delivery clears failureMessage.
    expect(updatedLogs.length).toBeGreaterThanOrEqual(1);
    const last = updatedLogs[updatedLogs.length - 1]!;
    expect(last.set).toMatchObject({ failureMessage: null });
  });

  it("notifies for a stale active connection (expiring_soon branch)", async () => {
    const now = new Date("2026-05-03T00:00:00Z");
    // updatedAt is older than the 7-day "no recent refresh" gate, and
    // expiresAt is still in the future but within the 7-day "approaching
    // expiration" window — the worker should fire BEFORE expiry.
    const updatedAt = new Date("2026-04-15T00:00:00Z"); // > 7 days old
    const expiresAt = new Date("2026-05-08T00:00:00Z"); // 5 days from now
    candidateRows.push({
      connectionId: 9,
      vendorId: 50,
      vendorName: "Vendor 50",
      displayName: null,
      status: "active",
      accessTokenExpiresAt: expiresAt,
      updatedAt,
      createdByUserId: null,
    });

    const result = await runOaConnectionReminderScan(now);

    expect(result.scanned).toBe(1);
    expect(result.triggersFired).toBe(1);
    expect(insertedLogs[0]).toMatchObject({
      reason: "expiring_soon",
      dedupeKey: "oa_conn_expiring_soon:9:2026-05",
    });
    // No creator → no email, no in-app fan-out.
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
    expect(result.emailSent).toBe(0);
    expect(result.inAppRecipients).toBe(0);
  });

  it("skips a candidate already claimed and previously delivered", async () => {
    const updatedAt = new Date("2026-04-01T12:00:00Z");
    const key = `oa_conn_revoked:7:${updatedAt.getTime()}`;
    existingLogByKey.set(key, { failureMessage: null });
    candidateRows.push({
      connectionId: 7,
      vendorId: 42,
      vendorName: "Acme",
      displayName: "Acme Books",
      status: "revoked",
      accessTokenExpiresAt: null,
      updatedAt,
      createdByUserId: 99,
    });
    creatorRows.push({
      email: "creator@example.com",
      username: "creator",
      displayName: null,
      suspendedAt: null,
    });

    const result = await runOaConnectionReminderScan(
      new Date("2026-05-03T00:00:00Z"),
    );

    expect(result.scanned).toBe(1);
    expect(result.triggersFired).toBe(0);
    expect(result.triggersSkipped).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
    expect(insertedLogs).toHaveLength(0);
  });

  it("retries a previously-failed claim and stamps failure message on email error", async () => {
    const updatedAt = new Date("2026-04-01T12:00:00Z");
    const key = `oa_conn_revoked:7:${updatedAt.getTime()}`;
    // Pre-existing failed claim — eligible for retry.
    existingLogByKey.set(key, { failureMessage: "previous send failed" });
    candidateRows.push({
      connectionId: 7,
      vendorId: 42,
      vendorName: "Acme",
      displayName: "Acme Books",
      status: "revoked",
      accessTokenExpiresAt: null,
      updatedAt,
      createdByUserId: 99,
    });
    vendorMembershipRows.push({ id: 11, suspendedAt: null });
    creatorRows.push({
      email: "creator@example.com",
      username: "creator",
      displayName: null,
      suspendedAt: null,
    });
    notifyUsersMock.mockResolvedValueOnce(1);
    sendEmailMock.mockRejectedValueOnce(new Error("sendgrid 503"));

    const result = await runOaConnectionReminderScan(
      new Date("2026-05-03T00:00:00Z"),
    );

    expect(result.triggersFired).toBe(1);
    expect(result.emailFailed).toBe(1);
    expect(result.emailSent).toBe(0);
    // Failure message should be persisted on the log row so the next
    // scan retries it again instead of treating the slot as delivered.
    const failureUpdate = updatedLogs.find(
      (u) =>
        typeof u.set["failureMessage"] === "string" &&
        (u.set["failureMessage"] as string).includes("sendgrid"),
    );
    expect(failureUpdate).toBeTruthy();
  });
});
