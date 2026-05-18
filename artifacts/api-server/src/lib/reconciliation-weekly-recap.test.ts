// Stub-based unit tests for the weekly reconciliation-drift recap
// worker (Task #368). We mock @workspace/db so the SQL pipeline is
// exercised without touching Postgres; the real cross-instance dedupe
// race is enforced by the unique index on
// `reconciliation_weekly_recap_log.dedupe_key`.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface FakeAuditRow {
  id: number;
  scope: { vendorId: number };
  detailJson: { warnings: Array<Record<string, unknown>> };
  createdAt: Date;
  reportKind: string;
}
interface FakeVendor {
  id: number;
  name: string;
}
interface FakeMembership {
  vendorId: number;
  email: string | null;
  preferredLanguage: string | null;
}

const vendors: FakeVendor[] = [];
const auditRows: FakeAuditRow[] = [];
const memberships: FakeMembership[] = [];
const insertedLogs: Array<Record<string, unknown> & { id: number }> = [];
const updatedLogs: Array<{ id: number; set: Record<string, unknown> }> = [];
let logIdCounter = 1;
let dedupeKeysSeen = new Set<string>();

vi.mock("@workspace/db", () => {
  const vendorsTable = { __tag: "vendors" } as const;
  const reportExportAuditLogTable = { __tag: "audit" } as const;
  const reconciliationWeeklyRecapLogTable = { __tag: "log" } as const;
  const userOrgMembershipsTable = { __tag: "memberships" } as const;
  const usersTable = { __tag: "users" } as const;

  function makeChain(tag: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => {
      if (tag === "vendors") return resolve(vendors);
      if (tag === "audit") return resolve(auditRows);
      if (tag === "memberships")
        return resolve(
          memberships.map((m) => ({
            email: m.email,
            preferredLanguage: m.preferredLanguage,
          })),
        );
      return resolve([]);
    };
    return chain;
  }

  return {
    db: {
      select: () => ({
        from: (t: { __tag: string }) => makeChain(t.__tag),
      }),
      insert: (t: { __tag: string }) => ({
        values: (vals: Record<string, unknown>) => {
          if (t.__tag !== "log")
            throw new Error(`unexpected insert table ${t.__tag}`);
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                const dk = vals.dedupeKey as string;
                if (dedupeKeysSeen.has(dk)) return [];
                dedupeKeysSeen.add(dk);
                const id = logIdCounter++;
                insertedLogs.push({ id, ...vals });
                return [{ id }];
              },
            }),
          };
        },
      }),
      update: (t: { __tag: string }) => ({
        set: (set: Record<string, unknown>) => ({
          where: async (whereClause: { __id: number }) => {
            updatedLogs.push({ id: whereClause.__id, set });
          },
        }),
      }),
    },
    vendorsTable,
    reportExportAuditLogTable,
    reconciliationWeeklyRecapLogTable,
    userOrgMembershipsTable,
    usersTable,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ __op: "and", args }),
  eq: (col: unknown, val: unknown) =>
    typeof val === "number"
      ? { __id: val }
      : { __op: "eq", col, val },
  gte: (col: unknown, val: unknown) => ({ __op: "gte", col, val }),
  sql: (..._args: unknown[]) => ({ __op: "sql" }),
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const sendMock = vi.fn(async (_input: unknown) => ({
  messageId: "test-msg",
}));
vi.mock("./sendgrid", () => ({
  sendReconciliationWeeklyRecapEmail: (input: unknown) => sendMock(input),
}));

import {
  runReconciliationWeeklyRecap,
  isoWeekLabel,
  buildReconciliationRecapUrl,
} from "./reconciliation-weekly-recap";

beforeEach(() => {
  vendors.length = 0;
  auditRows.length = 0;
  memberships.length = 0;
  insertedLogs.length = 0;
  updatedLogs.length = 0;
  logIdCounter = 1;
  dedupeKeysSeen = new Set();
  sendMock.mockClear();
  sendMock.mockResolvedValue({ messageId: "test-msg" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("isoWeekLabel", () => {
  it("formats ISO week as YYYY-Www (UTC)", () => {
    expect(isoWeekLabel(new Date("2026-05-03T12:00:00Z"))).toBe("2026-W18");
    expect(isoWeekLabel(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("buildReconciliationRecapUrl", () => {
  it("encodes from/to/onlyWarnings in YYYY-MM-DD", () => {
    const url = buildReconciliationRecapUrl(
      new Date("2026-04-26T00:00:00Z"),
      new Date("2026-05-03T12:00:00Z"),
    );
    expect(url).toContain("/reports?");
    expect(url).toContain("from=2026-04-26");
    expect(url).toContain("to=2026-05-03");
    expect(url).toContain("onlyWarnings=1");
    expect(url).toContain("reconciliationRecap=1");
  });
});

describe("runReconciliationWeeklyRecap", () => {
  it("returns zero counts when no vendors are opted in", async () => {
    const r = await runReconciliationWeeklyRecap({
      now: new Date("2026-05-03T10:00:00Z"),
    });
    expect(r).toEqual({ scanned: 0, sent: 0, skipped: 0, errors: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends one email per opted-in vendor with reconciliation drift", async () => {
    vendors.push({ id: 7, name: "Acme Vendor" });
    memberships.push({
      vendorId: 7,
      email: "ops@acme.test",
      preferredLanguage: "en",
    });
    auditRows.push({
      id: 100,
      scope: { vendorId: 7 },
      reportKind: "vendor.quickbooksPush",
      createdAt: new Date("2026-05-01T12:00:00Z"),
      detailJson: {
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-001",
            message: "reconciliation: total mismatch",
          },
          {
            kind: "invoice",
            identifier: "(state:CA)",
            message: "reconciliation: per-state aggregate mismatch",
          },
        ],
      },
    });
    auditRows.push({
      id: 101,
      scope: { vendorId: 7 },
      reportKind: "vendor.quickbooksPush",
      createdAt: new Date("2026-05-02T08:00:00Z"),
      detailJson: {
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-001",
            message: "reconciliation: total mismatch",
          },
        ],
      },
    });

    const r = await runReconciliationWeeklyRecap({
      now: new Date("2026-05-03T10:00:00Z"),
    });
    expect(r.scanned).toBe(1);
    expect(r.sent).toBe(1);
    expect(r.errors).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0]![0] as unknown as Record<
      string,
      unknown
    >;
    expect(arg.vendorName).toBe("Acme Vendor");
    expect(arg.weekLabel).toBe("2026-W18");
    expect(arg.totalWarnings).toBe(3);
    expect(arg.pushCount).toBe(2);
    const counts = arg.countsByBucket as Record<string, number>;
    expect(counts.perInvoice).toBe(2);
    expect(counts.perState).toBe(1);
    expect(counts.fetchSkipped).toBe(0);
    const worst = arg.worstInvoices as Array<{
      identifier: string;
      warningCount: number;
    }>;
    expect(worst[0]).toEqual({ identifier: "INV-001", warningCount: 2 });
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]!.dedupeKey).toBe(
      "reconciliation_weekly_recap:7:2026-W18",
    );
  });

  it("skips vendors whose drifted rows mix per-row failure warnings", async () => {
    // The per-push helper owns failure-bearing rows; the recap should
    // never double-email them. The gate excludes the entire row, even
    // if some warnings on it are reconciliation-only.
    vendors.push({ id: 9, name: "Mixed Vendor" });
    memberships.push({
      vendorId: 9,
      email: "ops@mixed.test",
      preferredLanguage: "en",
    });
    auditRows.push({
      id: 200,
      scope: { vendorId: 9 },
      reportKind: "vendor.quickbooksPush",
      createdAt: new Date("2026-05-02T08:00:00Z"),
      detailJson: {
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-9",
            message: "reconciliation: total mismatch",
          },
          {
            kind: "customer",
            identifier: "CUST-1",
            message: "could not create customer in QuickBooks",
          },
        ],
      },
    });
    const r = await runReconciliationWeeklyRecap({
      now: new Date("2026-05-03T10:00:00Z"),
    });
    expect(r.scanned).toBe(1);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("dedupes a second run within the same ISO week", async () => {
    vendors.push({ id: 7, name: "Acme Vendor" });
    memberships.push({
      vendorId: 7,
      email: "ops@acme.test",
      preferredLanguage: "en",
    });
    auditRows.push({
      id: 100,
      scope: { vendorId: 7 },
      reportKind: "vendor.quickbooksPush",
      createdAt: new Date("2026-05-01T12:00:00Z"),
      detailJson: {
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-001",
            message: "reconciliation: total mismatch",
          },
        ],
      },
    });

    const a = await runReconciliationWeeklyRecap({
      now: new Date("2026-05-03T10:00:00Z"),
    });
    const b = await runReconciliationWeeklyRecap({
      now: new Date("2026-05-03T16:00:00Z"),
    });
    expect(a.sent).toBe(1);
    expect(b.sent).toBe(0);
    expect(b.skipped).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("records failureMessage when no admin recipients are configured", async () => {
    vendors.push({ id: 7, name: "Acme Vendor" });
    auditRows.push({
      id: 100,
      scope: { vendorId: 7 },
      reportKind: "vendor.quickbooksPush",
      createdAt: new Date("2026-05-01T12:00:00Z"),
      detailJson: {
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-001",
            message: "reconciliation: total mismatch",
          },
        ],
      },
    });
    const r = await runReconciliationWeeklyRecap({
      now: new Date("2026-05-03T10:00:00Z"),
    });
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(updatedLogs).toHaveLength(1);
    expect(updatedLogs[0]!.set.failureMessage).toBe("no_admin_recipients");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
