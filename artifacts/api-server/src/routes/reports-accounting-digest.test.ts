import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests that lock in the send-once contract on the accounting push failure
// digest email. Task #276 added a database-backed idempotency claim
// (report_export_audit_log.accounting_digest_emailed_at) so that retries of
// a QuickBooks / OpenAccountant push never spam admins with a second copy
// of the same warning summary. These tests cover the four critical paths
// of `maybeSendAccountingDigest`:
//
//  1. First call with non-empty warnings → sends exactly one email and
//     stamps `accounting_digest_emailed_at`.
//  2. A second call for the same audit row → no email, no DB write.
//  3. SendGrid throws → the claim is rolled back so the next call retries.
//  4. Empty warnings → no email and no stamp.

type Row = Record<string, unknown>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: unknown }
  | { kind: "isNull"; col: ColRef }
  | { kind: "isNotNull"; col: ColRef }
  | { kind: "and"; preds: Pred[] }
  | { kind: "or"; preds: Pred[] }
  | { kind: "true" };
type TableTag = { __name: string } & Record<string, ColRef | string>;

function tableTag(name: string, cols: string[]): TableTag {
  const t: Record<string, ColRef | string> = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t as TableTag;
}

const tables = {
  vendors: tableTag("vendors", [
    "id",
    "name",
    "accountingFailureNotificationsEnabled",
  ]),
  reportExportAuditLog: tableTag("reportExportAuditLog", [
    "id",
    "accountingDigestEmailedAt",
  ]),
  userOrgMemberships: tableTag("userOrgMemberships", [
    "id",
    "userId",
    "vendorId",
    "orgType",
    "role",
  ]),
  users: tableTag("users", ["id", "email", "preferredLanguage"]),
  // Other tables imported by reports.ts; the digest path doesn't touch
  // them, but they need stable references so the module loads.
  invoices: tableTag("invoices", ["id"]),
  invoiceLines: tableTag("invoiceLines", ["id"]),
  partners: tableTag("partners", ["id"]),
  qbAccountMapping: tableTag("qbAccountMapping", ["id"]),
  qbAccountMappingAuditLog: tableTag("qbAccountMappingAuditLog", ["id"]),
  qbAccountMappingBulkActions: tableTag("qbAccountMappingBulkActions", ["id"]),
  tax1099Filings: tableTag("tax1099Filings", ["id"]),
};

// ──────────────────────────────────────────────────────────────────
// Mutable fixture state — reset per test by `beforeEach`.
// ──────────────────────────────────────────────────────────────────

interface AuditFixture {
  id: number;
  accountingDigestEmailedAt: Date | null;
}

interface VendorFixture {
  id: number;
  name: string;
  accountingFailureNotificationsEnabled: boolean;
}

interface RecipientFixture {
  email: string;
  preferredLanguage: string | null;
}

interface DbWriteRecord {
  table: string;
  set: Row;
}

let auditRow: AuditFixture | null;
let vendorRow: VendorFixture | null;
let recipients: RecipientFixture[];
let writeLog: DbWriteRecord[];

function evalPred(pred: Pred, row: Row): boolean {
  switch (pred.kind) {
    case "eq":
      return row[pred.col.__col] === pred.val;
    case "isNull":
      return row[pred.col.__col] === null || row[pred.col.__col] === undefined;
    case "isNotNull":
      return row[pred.col.__col] !== null && row[pred.col.__col] !== undefined;
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
    case "or":
      return pred.preds.some((p) => evalPred(p, row));
    case "true":
      return true;
  }
}

vi.mock("@workspace/db", () => {
  // Keep the chain shape narrow — the digest helper only needs select
  // (with from + where + limit, plus from + innerJoin + where) and update
  // (with set + where, optionally + returning).
  const selectFrom = (t: TableTag) => {
    let preds: Pred = { kind: "true" };
    let joinedUsers = false;
    const chain = {
      innerJoin: (joinTable: TableTag, _on: Pred) => {
        if (joinTable.__name === "users") joinedUsers = true;
        return chain;
      },
      where: (p: Pred) => {
        preds = p;
        return chain;
      },
      limit: (_n: number) => runSelect(),
      then: (
        resolve: (value: Row[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(runSelect()).then(resolve, reject),
    };
    function runSelect(): Row[] {
      if (t.__name === "vendors") {
        if (!vendorRow) return [];
        if (!evalPred(preds, vendorRow as unknown as Row)) return [];
        return [vendorRow as unknown as Row];
      }
      if (t.__name === "userOrgMemberships" && joinedUsers) {
        return recipients.map((r) => ({
          email: r.email,
          preferredLanguage: r.preferredLanguage,
        }));
      }
      return [];
    }
    return chain;
  };

  const updateTable = (t: TableTag) => ({
    set: (s: Row) => {
      const whereChain = {
        where: (p: Pred) => {
          const applied: Row[] = [];
          if (t.__name === "reportExportAuditLog" && auditRow) {
            if (evalPred(p, auditRow as unknown as Row)) {
              writeLog.push({ table: t.__name, set: { ...s } });
              Object.assign(auditRow, s);
              applied.push(auditRow as unknown as Row);
            }
          }
          const result = {
            returning: async (_cols?: unknown): Promise<Row[]> => applied,
            then: (
              resolve: (value: undefined) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => Promise.resolve(undefined).then(resolve, reject),
          };
          return result;
        },
      };
      return whereChain;
    },
  });

  const db = {
    select: (_cols?: unknown) => ({
      from: (t: TableTag) => selectFrom(t),
    }),
    update: (t: TableTag) => updateTable(t),
    insert: (_t: TableTag) => ({
      values: () => ({
        returning: async () => [],
        then: (
          resolve: (value: undefined) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(undefined).then(resolve, reject),
      }),
    }),
    delete: (_t: TableTag) => ({
      where: () => ({ returning: async () => [] }),
    }),
    execute: async () => ({ rows: [] }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(db),
  };

  return {
    db,
    invoicesTable: tables.invoices,
    invoiceLinesTable: tables.invoiceLines,
    partnersTable: tables.partners,
    vendorsTable: tables.vendors,
    reportExportAuditLogTable: tables.reportExportAuditLog,
    qbAccountMappingTable: tables.qbAccountMapping,
    qbAccountMappingAuditLogTable: tables.qbAccountMappingAuditLog,
    qbAccountMappingBulkActionsTable: tables.qbAccountMappingBulkActions,
    userOrgMembershipsTable: tables.userOrgMemberships,
    usersTable: tables.users,
    tax1099FilingsTable: tables.tax1099Filings,
    REPORT_EXPORT_FORMATS: [
      "csv",
      "pdf",
      "iif",
      "qbo_zip",
      "oa_zip",
      "1099_csv",
      "1099_pdf",
      "qbo_api_push",
      "oa_api_push",
      "1099_fire_txt",
    ],
    QB_ACCOUNT_MAPPING_AUDIT_ACTIONS: ["insert", "update", "delete"],
    TAX_1099_FORM_TYPES: ["nec", "misc", "k"],
    TAX_1099_FILING_STATUSES: ["draft", "submitted", "accepted", "rejected"],
    TAX_1099_FILING_METHODS: ["fire", "paper"],
    TAX_1099_CORRECTION_STATUSES: ["none", "g", "c"],
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts", []),
    hotlistCommentsTable: tableTag("hotlistComments", []),
    ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: unknown[]): Pred => ({ kind: "true" });
  const sqlTag = Object.assign(
    (..._args: unknown[]): Pred => ({ kind: "true" }),
    { raw: passthrough },
  );
  return {
    and: (...preds: Pred[]): Pred => ({
      kind: "and",
      preds: preds.filter(Boolean),
    }),
    or: (...preds: Pred[]): Pred => ({
      kind: "or",
      preds: preds.filter(Boolean),
    }),
    eq: (col: ColRef, val: unknown): Pred => ({ kind: "eq", col, val }),
    isNull: (col: ColRef): Pred => ({ kind: "isNull", col }),
    isNotNull: (col: ColRef): Pred => ({ kind: "isNotNull", col }),
    inArray: passthrough,
    sql: sqlTag,
    desc: (col: ColRef) => ({ __desc: true, col }),
    gt: passthrough,
    gte: passthrough,
    lt: passthrough,
    lte: passthrough,
  };
});

// SendGrid: spy on the digest sender so tests can assert call count and
// payload, and inject a thrown error for the rollback test.
const sendDigest = vi.fn(async (_input: unknown) => ({ messageId: "ok" }));
vi.mock("../lib/sendgrid", () => ({
  sendAccountingPushDigestEmail: (input: unknown) => sendDigest(input),
  sendInvoiceEmail: async () => undefined,
  sendInvoiceReminderEmail: async () => undefined,
  send1099RecipientEmail: async () => undefined,
  sendPasswordResetEmail: async () => undefined,
  getUncachableSendGridClient: async () => ({}),
}));

// Silence the logger so failed-send tests don't pollute test output with
// the deliberately-thrown "boom" stack trace.
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Heavy modules pulled in by reports.ts that the digest path doesn't
// exercise. Stubbing them keeps the test isolated and prevents accidental
// outbound calls during module load.
vi.mock("../lib/accounting/qbo", () => ({
  loadQboConfig: () => ({}),
  ensureQboItemMap: async () => ({ itemMap: {}, warnings: [] }),
  pushBundleToQbo: async () => ({}),
  reconcileQboInvoices: async () => [],
  refreshAccessToken: async () => ({}),
  updateQboInvoice: async () => undefined,
}));
vi.mock("../lib/accounting/oa", () => ({
  pushBundleToOa: async () => ({}),
  reconcileOaInvoices: async () => [],
  oaRefreshAccessToken: async () => ({}),
  updateOaInvoice: async () => undefined,
  DEFAULT_OA_BASE_URL: "https://oa.example.com",
  validateOaBaseUrl: (s: string) => s,
  loadOaOAuthConfig: () => ({}),
  oaAuthorizationUrl: () => "",
  oaExchangeCodeForTokens: async () => ({}),
  oaRevokeToken: async () => undefined,
}));
vi.mock("../lib/accounting/connections", () => ({
  getConnection: async () => null,
  loadConnectionItemMap: async () => ({}),
  upsertConnectionItem: async () => undefined,
  markRevoked: async () => undefined,
  updateAccessToken: async () => undefined,
  upsertConnection: async () => ({}),
  listConnectionsForVendor: async () => [],
  deleteConnection: async () => undefined,
  toPublicView: <T,>(c: T): T => c,
  toDecryptedConnection: <T,>(c: T): T => c,
}));
vi.mock("../lib/accounting/pushedInvoices", () => ({
  getPushedInvoice: async () => null,
  loadPushedInvoiceStore: async () => ({
    has: () => false,
    set: () => undefined,
    list: () => [],
  }),
  touchPushedInvoice: async () => undefined,
  inMemoryPushedInvoiceStore: () => ({
    has: () => false,
    set: () => undefined,
    list: () => [],
  }),
}));

const baseArgs = {
  vendorId: 42,
  provider: "QuickBooks" as const,
  periodLabel: "Q1 2026",
  auditLogId: 7,
  warnings: [
    {
      kind: "invoice" as const,
      identifier: "INV-1001",
      message: "Item missing on QBO; mapped to fallback.",
    },
  ],
  customersCreated: 1,
  vendorsCreated: 0,
  invoicesCreated: 0,
};

beforeEach(() => {
  auditRow = { id: 7, accountingDigestEmailedAt: null };
  vendorRow = {
    id: 42,
    name: "Acme Drilling",
    accountingFailureNotificationsEnabled: true,
  };
  recipients = [{ email: "admin@example.com", preferredLanguage: "en" }];
  writeLog = [];
  sendDigest.mockReset();
  sendDigest.mockResolvedValue({ messageId: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("maybeSendAccountingDigest idempotency", () => {
  it("first call with warnings sends exactly one email and stamps the audit row", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");

    await maybeSendAccountingDigest(baseArgs);

    expect(sendDigest).toHaveBeenCalledTimes(1);
    const payload = sendDigest.mock.calls[0][0] as {
      vendorName: string;
      provider: string;
      recipients: Array<{ email: string }>;
      countsByKind: { customer: number; vendor: number; invoice: number };
      reconciliation?: unknown;
    };
    expect(payload.vendorName).toBe("Acme Drilling");
    expect(payload.provider).toBe("QuickBooks");
    expect(payload.recipients.map((r) => r.email)).toEqual([
      "admin@example.com",
    ]);
    expect(payload.countsByKind).toEqual({
      customer: 0,
      vendor: 0,
      invoice: 1,
    });
    // No reconciliation warnings in baseArgs → no call-out section.
    expect(payload.reconciliation).toBeUndefined();
    expect(auditRow?.accountingDigestEmailedAt).toBeInstanceOf(Date);
    // Exactly one DB write: the claim. No rollback.
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].table).toBe("reportExportAuditLog");
    expect(writeLog[0].set.accountingDigestEmailedAt).toBeInstanceOf(Date);
  });

  it("second call for the same audit row is a no-op (no email, no DB write)", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");

    await maybeSendAccountingDigest(baseArgs);
    expect(sendDigest).toHaveBeenCalledTimes(1);
    const stampedAt = auditRow?.accountingDigestEmailedAt;
    expect(stampedAt).toBeInstanceOf(Date);
    const writesAfterFirst = writeLog.length;

    // Simulate the route handler being retried for the same audit row.
    await maybeSendAccountingDigest(baseArgs);

    // No additional email and no additional DB write.
    expect(sendDigest).toHaveBeenCalledTimes(1);
    expect(writeLog).toHaveLength(writesAfterFirst);
    // The original timestamp must not be overwritten.
    expect(auditRow?.accountingDigestEmailedAt).toBe(stampedAt);
  });

  it("rolls back the claim when SendGrid throws so the next call retries", async () => {
    sendDigest.mockRejectedValueOnce(new Error("boom"));
    const { maybeSendAccountingDigest } = await import("./reports");

    await maybeSendAccountingDigest(baseArgs);

    // Send was attempted but the helper swallows the error.
    expect(sendDigest).toHaveBeenCalledTimes(1);
    // Two writes: the claim, then the rollback to NULL.
    expect(writeLog).toHaveLength(2);
    expect(writeLog[0].set.accountingDigestEmailedAt).toBeInstanceOf(Date);
    expect(writeLog[1].set.accountingDigestEmailedAt).toBeNull();
    // Persisted state is back to NULL — the next push attempt can claim
    // it again and try to send.
    expect(auditRow?.accountingDigestEmailedAt).toBeNull();

    // Second attempt with a working SendGrid succeeds and stamps.
    sendDigest.mockResolvedValueOnce({ messageId: "ok" });
    await maybeSendAccountingDigest(baseArgs);
    expect(sendDigest).toHaveBeenCalledTimes(2);
    expect(auditRow?.accountingDigestEmailedAt).toBeInstanceOf(Date);
  });

  it("empty warnings does not send any email and does not stamp the column", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");

    await maybeSendAccountingDigest({ ...baseArgs, warnings: [] });

    expect(sendDigest).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
    expect(auditRow?.accountingDigestEmailedAt).toBeNull();
  });

  it("skips when the vendor has accounting notifications disabled", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");
    vendorRow = {
      id: 42,
      name: "Acme Drilling",
      accountingFailureNotificationsEnabled: false,
    };

    await maybeSendAccountingDigest(baseArgs);

    expect(sendDigest).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
    expect(auditRow?.accountingDigestEmailedAt).toBeNull();
  });

  it("skips when there are no admin recipients", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");
    recipients = [];

    await maybeSendAccountingDigest(baseArgs);

    expect(sendDigest).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
    expect(auditRow?.accountingDigestEmailedAt).toBeNull();
  });

  it("skips when auditLogId is null (download path with no audit row)", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");

    await maybeSendAccountingDigest({ ...baseArgs, auditLogId: null });

    expect(sendDigest).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
    expect(auditRow?.accountingDigestEmailedAt).toBeNull();
  });

  // Task #295 — when a push surfaces both per-row failures AND silent
  // reconciliation drift, the failure digest must call out the drift
  // separately. The reconciliation-only digest is gated off in this case
  // (failureWarnings.length > 0), so the call-out here is the only signal
  // admins receive about the drift.
  it("calls out reconciliation drift separately when failures + drift coexist", async () => {
    const { maybeSendAccountingDigest } = await import("./reports");

    await maybeSendAccountingDigest({
      ...baseArgs,
      warnings: [
        // Real per-row failure.
        {
          kind: "invoice" as const,
          identifier: "INV-1001",
          message: "Item missing on QBO; mapped to fallback.",
        },
        // Per-state aggregate drift — `(state:XX)` identifier.
        {
          kind: "invoice" as const,
          identifier: "(state:CA)",
          message:
            "reconciliation: QuickBooks tax for CA totals 142.10 but VNDRLY shows 100.00",
        },
        // Per-invoice reconciliation mismatch — message starts with
        // "reconciliation:".
        {
          kind: "invoice" as const,
          identifier: "INV-1002",
          message: "reconciliation: QuickBooks total 500.00 differs from VNDRLY 510.00",
        },
        // Fail-soft "couldn't read invoices back" path.
        {
          kind: "invoice" as const,
          identifier: "(reconciliation)",
          message: "reconciliation skipped: QuickBooks API unreachable",
        },
      ],
    });

    expect(sendDigest).toHaveBeenCalledTimes(1);
    const payload = sendDigest.mock.calls[0][0] as {
      countsByKind: { customer: number; vendor: number; invoice: number };
      warnings: Array<{ identifier: string }>;
      reconciliation?: {
        countsByBucket: {
          perInvoice: number;
          perState: number;
          fetchSkipped: number;
        };
        warnings: Array<{ identifier: string }>;
      };
    };
    // Failure counts only count the real per-row failure, not the
    // reconciliation warnings.
    expect(payload.countsByKind).toEqual({
      customer: 0,
      vendor: 0,
      invoice: 1,
    });
    // The main warnings list contains only failures, so reconciliation
    // lines aren't duplicated above the call-out.
    expect(payload.warnings.map((w) => w.identifier)).toEqual(["INV-1001"]);
    // Reconciliation call-out is present and bucketed correctly.
    expect(payload.reconciliation).toBeDefined();
    expect(payload.reconciliation!.countsByBucket).toEqual({
      perInvoice: 1,
      perState: 1,
      fetchSkipped: 1,
    });
    expect(payload.reconciliation!.warnings.map((w) => w.identifier)).toEqual([
      "(state:CA)",
      "INV-1002",
      "(reconciliation)",
    ]);
  });
});
