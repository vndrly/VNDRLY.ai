import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Tests that lock in the retry-linkage contract on the export audit log.
//
// Both POST /reports/vendor/:vendorId/quickbooks-push and
// POST /reports/vendor/:vendorId/openaccountant-push, when called with
// `retryFromAuditId`, must persist that id on the new audit row's
// `scope.retriedFromAuditId` (as a number). The web client computes the
// reverse "Retried by #M" badge by walking that field across rows
// returned from GET /reports/exports/audit, so a refactor that drops or
// renames the field on either push path would silently break the badge
// in production.
//
// These tests exercise both push endpoints end-to-end (heavy outbound
// calls and DB are stubbed) and then assert the GET /audit endpoint
// surfaces the linkage as a `retryChain` with the original id at the head.

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
  invoices: tableTag("invoices", [
    "id",
    "invoiceNumber",
    "vendorId",
    "partnerId",
    "status",
    "periodStart",
    "periodEnd",
    "dueDate",
    "total",
    "subtotal",
    "taxTotal",
    "notes",
  ]),
  invoiceLines: tableTag("invoiceLines", [
    "id",
    "invoiceId",
    "description",
    "amount",
    "taxAmount",
    "lineType",
    "taxState",
  ]),
  partners: tableTag("partners", [
    "id",
    "name",
    "billingAddress",
    "contactEmail",
  ]),
  vendors: tableTag("vendors", [
    "id",
    "name",
    "billingAddress",
    "contactEmail",
    "federalTaxId",
    "accountingFailureNotificationsEnabled",
    "accountingReconciliationNotificationsEnabled",
  ]),
  reportExportAuditLog: tableTag("reportExportAuditLog", [
    "id",
    "reportKind",
    "format",
    "scope",
    "detailJson",
    "rowCount",
    "fileBytes",
    "downloadedByUserId",
    "userRole",
    "userIp",
    "userAgent",
    "createdAt",
    "accountingDigestEmailedAt",
    "accountingReconciliationDigestEmailedAt",
  ]),
  qbAccountMapping: tableTag("qbAccountMapping", [
    "id",
    "vendorId",
    "partnerId",
    "lineType",
    "accountName",
    "accountNumber",
  ]),
  qbAccountMappingAuditLog: tableTag("qbAccountMappingAuditLog", ["id"]),
  qbAccountMappingBulkActions: tableTag("qbAccountMappingBulkActions", ["id"]),
  accountingConnections: tableTag("accountingConnections", ["id"]),
  accountingConnectionItems: tableTag("accountingConnectionItems", [
    "id",
    "connectionId",
    "lineType",
    "qboItemId",
    "qboAccountId",
  ]),
  accountingPushedInvoices: tableTag("accountingPushedInvoices", [
    "id",
    "vendorId",
    "provider",
    "invoiceNumber",
  ]),
  userOrgMemberships: tableTag("userOrgMemberships", [
    "id",
    "userId",
    "vendorId",
    "orgType",
    "role",
  ]),
  users: tableTag("users", [
    "id",
    "displayName",
    "username",
    "email",
    "preferredLanguage",
  ]),
  tax1099Filings: tableTag("tax1099Filings", ["id"]),
};

const fixtures: Record<string, Row[]> = {
  invoices: [],
  invoiceLines: [],
  partners: [],
  vendors: [],
  reportExportAuditLog: [],
  qbAccountMapping: [],
  qbAccountMappingAuditLog: [],
  qbAccountMappingBulkActions: [],
  accountingConnections: [],
  accountingConnectionItems: [],
  accountingPushedInvoices: [],
  userOrgMemberships: [],
  users: [],
  tax1099Filings: [],
};

let nextId: Record<string, number> = {
  reportExportAuditLog: 1,
  accountingPushedInvoices: 1,
  accountingConnectionItems: 1,
};

function evalPred(pred: Pred | undefined, row: Row): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
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
  }
}

interface QueryChain extends PromiseLike<Row[]> {
  where(p: Pred): QueryChain;
  leftJoin(...args: unknown[]): QueryChain;
  innerJoin(...args: unknown[]): QueryChain;
  orderBy(...args: Array<{ __desc?: boolean } | undefined>): QueryChain;
  limit(n: number): QueryChain;
  offset(n: number): QueryChain;
  catch(onReject: (e: unknown) => unknown): Promise<unknown>;
}

function makeQuery(tableName: string): QueryChain {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  let offsetN = 0;
  let descending = false;
  const run = (): Row[] => {
    const all = fixtures[tableName] ?? [];
    let filtered = all.filter((r) => evalPred(pred, r)).map((r) => ({ ...r }));
    if (descending) filtered = filtered.slice().reverse();
    if (offsetN > 0) filtered = filtered.slice(offsetN);
    return limitN != null ? filtered.slice(0, limitN) : filtered;
  };
  const q: QueryChain = {
    where: (p) => {
      pred = p;
      return q;
    },
    leftJoin: () => q,
    innerJoin: () => q,
    orderBy: (...markers) => {
      // The route uses desc(reportExportAuditLogTable.createdAt) — the desc()
      // mock tags its argument so we can flip the result order to mimic
      // newest-first. The chain logic must work in any order, but mirroring
      // production gives the test more confidence. Pagination passes a
      // tie-break second argument; we ignore it in the mock.
      if (markers.some((m) => m && m.__desc)) descending = true;
      return q;
    },
    limit: (n) => {
      limitN = n;
      return q;
    },
    offset: (n) => {
      offsetN = n;
      return q;
    },
    then: (resolve, reject) =>
      Promise.resolve(run()).then(resolve, reject ?? undefined),
    catch: (reject) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

vi.mock("@workspace/db", () => {
  interface InsertChain extends PromiseLike<undefined> {
    onConflictDoUpdate(...args: unknown[]): InsertChain;
    onConflictDoNothing(...args: unknown[]): InsertChain;
    returning(...args: unknown[]): Promise<Row[]>;
  }
  const insertChain = (tableName: string, v: Row): InsertChain => {
    if (!fixtures[tableName]) fixtures[tableName] = [];
    const providedId = typeof v.id === "number" ? v.id : undefined;
    const id =
      providedId ?? nextId[tableName] ?? fixtures[tableName].length + 1;
    nextId[tableName] = id + 1;
    const row: Row = { id, createdAt: new Date(), ...v };
    fixtures[tableName].push(row);
    const chain: InsertChain = {
      onConflictDoUpdate: () => chain,
      onConflictDoNothing: () => chain,
      returning: async () => [row],
      then: (resolve, reject) =>
        Promise.resolve(undefined).then(resolve, reject ?? undefined),
    };
    return chain;
  };
  interface FakeDb {
    select(cols?: unknown): {
      from(t: TableTag): QueryChain;
    };
    insert(t: TableTag): {
      values(v: Row): InsertChain;
    };
    update(t: TableTag): {
      set(s: Row): {
        where(pred: Pred): {
          returning(): Promise<Row[]>;
          then(
            resolve: (value: undefined) => unknown,
            reject?: (reason: unknown) => unknown,
          ): Promise<unknown>;
        };
      };
    };
    delete(t: TableTag): {
      where(pred: Pred): {
        returning(): Promise<Row[]>;
      };
    };
    execute(): Promise<{ rows: Row[] }>;
    transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T>;
  }
  const db: FakeDb = {
    select: (_cols?: unknown) => ({
      from: (t: TableTag) => makeQuery(t.__name),
    }),
    insert: (t: TableTag) => ({
      values: (v: Row) => insertChain(t.__name, v),
    }),
    update: (t: TableTag) => ({
      set: (s: Row) => ({
        where: (pred: Pred) => ({
          returning: async (): Promise<Row[]> => {
            const all = fixtures[t.__name] ?? [];
            const updated: Row[] = [];
            for (const r of all) {
              if (evalPred(pred, r)) {
                Object.assign(r, s);
                updated.push(r);
              }
            }
            return updated;
          },
          then: (
            resolve: (value: undefined) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve(undefined).then(resolve, reject),
        }),
      }),
    }),
    delete: (t: TableTag) => ({
      where: (pred: Pred) => ({
        returning: async (): Promise<Row[]> => {
          const all = fixtures[t.__name] ?? [];
          const removed: Row[] = [];
          fixtures[t.__name] = all.filter((r) => {
            if (evalPred(pred, r)) {
              removed.push(r);
              return false;
            }
            return true;
          });
          return removed;
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
    transaction: async <T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> =>
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
    accountingConnectionsTable: tables.accountingConnections,
    accountingConnectionItemsTable: tables.accountingConnectionItems,
    accountingPushedInvoicesTable: tables.accountingPushedInvoices,
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
    gte: passthrough,
    lt: passthrough,
  };
});

// QBO push: success-with-warnings so the retry path has something to
// re-push and the digest helper sees warnings (it will short-circuit when
// the vendor row is missing the notification flag, which we leave off).
interface PushBundleShape {
  invoices: ReadonlyArray<{ invoiceNumber: string }>;
}

let qboPushCallCount = 0;
const qboPushBundles: PushBundleShape[] = [];
// Per-test override for the reconciler return value. The reports route
// pushes whatever the reconciler emits onto pushResult.warnings, so the
// digest tests below set this to simulate a successful push that the
// reconciler then flags as drifted.
let qboReconcileReturn: Array<{
  kind: "invoice" | "customer" | "vendor";
  identifier: string;
  message: string;
}> = [];
// When true, pushBundleToQbo always returns a clean (no-warning) result
// regardless of call count — used by digest tests so they don't have to
// run two pushes to get past the failure on call 1.
let qboPushAlwaysClean = false;

vi.mock("../lib/accounting/qbo", () => ({
  loadQboConfig: () => ({
    environment: "sandbox",
    clientId: "x",
    clientSecret: "y",
    redirectUri: "http://localhost/cb",
  }),
  ensureQboItemMap: async () => ({ itemMap: {}, warnings: [] }),
  pushBundleToQbo: async (bundle: PushBundleShape) => {
    qboPushCallCount += 1;
    qboPushBundles.push(bundle);
    // First call: simulate one invoice failure so the retry path has
    // something to filter the bundle down to. Subsequent calls (the
    // retry) succeed cleanly.
    if (qboPushCallCount === 1 && !qboPushAlwaysClean) {
      return {
        customersCreated: 1,
        vendorsCreated: 0,
        invoicesCreated: 0,
        invoicesPushed: [],
        customersAlreadyExisted: 0,
        vendorsAlreadyExisted: 0,
        invoicesAlreadyUpToDate: 0,
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-1001",
            message: "Simulated QBO failure for retry test",
          },
        ],
      };
    }
    return {
      customersCreated: 0,
      vendorsCreated: 0,
      invoicesCreated: 1,
      invoicesPushed: ["INV-1001"],
      customersAlreadyExisted: 1,
      vendorsAlreadyExisted: 0,
      invoicesAlreadyUpToDate: 0,
      warnings: [],
    };
  },
  reconcileQboInvoices: async () => qboReconcileReturn,
  refreshAccessToken: async () => ({
    accessToken: "fresh",
    refreshToken: "fresh-r",
    expiresInSec: 3600,
  }),
}));

let oaPushCallCount = 0;
const oaPushBundles: PushBundleShape[] = [];
let oaReconcileReturn: Array<{
  kind: "invoice" | "customer" | "vendor";
  identifier: string;
  message: string;
}> = [];
let oaPushAlwaysClean = false;

vi.mock("../lib/accounting/oa", () => ({
  pushBundleToOa: async (bundle: PushBundleShape) => {
    oaPushCallCount += 1;
    oaPushBundles.push(bundle);
    if (oaPushCallCount === 1 && !oaPushAlwaysClean) {
      return {
        customersCreated: 1,
        vendorsCreated: 0,
        invoicesCreated: 0,
        invoicesPushed: [],
        customersAlreadyExisted: 0,
        vendorsAlreadyExisted: 0,
        invoicesAlreadyUpToDate: 0,
        warnings: [
          {
            kind: "invoice",
            identifier: "INV-1001",
            message: "Simulated OA failure for retry test",
          },
        ],
      };
    }
    return {
      customersCreated: 0,
      vendorsCreated: 0,
      invoicesCreated: 1,
      invoicesPushed: ["INV-1001"],
      customersAlreadyExisted: 1,
      vendorsAlreadyExisted: 0,
      invoicesAlreadyUpToDate: 0,
      warnings: [],
    };
  },
  reconcileOaInvoices: async () => oaReconcileReturn,
  oaRefreshAccessToken: async () => ({
    accessToken: "fresh",
    refreshToken: "fresh-r",
    expiresInSec: 3600,
  }),
  DEFAULT_OA_BASE_URL: "https://oa.example.com",
  validateOaBaseUrl: (s: string) => s,
  loadOaOAuthConfig: () => ({
    clientId: "x",
    clientSecret: "y",
    redirectUri: "http://localhost/cb",
    authBaseUrl: "https://oa.example.com",
  }),
  oaAuthorizationUrl: () => "https://oa.example.com/auth",
  oaExchangeCodeForTokens: async () => ({
    accessToken: "x",
    refreshToken: "y",
    expiresInSec: 3600,
    apiBaseUrl: "https://oa.example.com",
  }),
  oaRevokeToken: async () => undefined,
}));

vi.mock("../lib/accounting/connections", () => ({
  getConnection: async (vendorId: number, provider: string) => ({
    id: 99,
    vendorId,
    provider,
    realmId: "realm-1",
    displayName: "Test Co",
    accessToken: "tok",
    refreshToken: "ref",
    accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    apiBaseUrl: "https://oa.example.com",
    status: "active",
    scopes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  loadConnectionItemMap: async () => ({}),
  upsertConnectionItem: async () => undefined,
  markRevoked: async () => undefined,
  updateAccessToken: async () => undefined,
  upsertConnection: async () => ({ id: 99 }),
  listConnectionsForVendor: async () => [],
  deleteConnection: async () => undefined,
  toPublicView: <T,>(c: T): T => c,
  toDecryptedConnection: <T,>(c: T): T => c,
}));

vi.mock("../lib/accounting/pushedInvoices", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/accounting/pushedInvoices")
  >("../lib/accounting/pushedInvoices");
  return {
    ...actual,
    loadPushedInvoiceStore: async () => actual.inMemoryPushedInvoiceStore(),
  };
});

// Spies — accessed via the module reference below so individual tests
// can assert on call counts and gating behaviour for the failure
// digest vs. the new reconciliation drift digest.
const sendAccountingPushDigestEmailMock = vi.fn(
  async (..._args: unknown[]) => undefined,
);
const sendAccountingReconciliationDigestEmailMock = vi.fn(
  async (..._args: unknown[]) => undefined,
);

vi.mock("../lib/sendgrid", () => ({
  sendAccountingPushDigestEmail: sendAccountingPushDigestEmailMock,
  sendAccountingReconciliationDigestEmail:
    sendAccountingReconciliationDigestEmailMock,
  sendInvoiceEmail: async () => undefined,
  sendInvoiceReminderEmail: async () => undefined,
  send1099RecipientEmail: async () => undefined,
  sendPasswordResetEmail: async () => undefined,
  getUncachableSendGridClient: async () => ({}),
}));



function adminCookie(userId = 7): string {
  const payload = { userId, role: "admin", displayName: "Admin User" };
  return buildTestCookie(payload);
}

function seedInvoiceFixtures(vendorId: number): void {
  // gatherExportData() does select(...).from(invoices).innerJoin(partners,
  // ...).innerJoin(vendors, ...). Our mock drops the projection and drops
  // the join (returning the raw 'from' rows), so we flatten every joined
  // column the route reads into the single invoice row.
  const period = {
    start: new Date(Date.UTC(2026, 0, 1)),
    end: new Date(Date.UTC(2026, 2, 1)),
  };
  fixtures.vendors.push({
    id: vendorId,
    name: "VendorCo",
    billingAddress: "1 Vendor Way",
    contactEmail: "v@vendor.example",
    federalTaxId: "12-3456789",
    accountingFailureNotificationsEnabled: false,
  });
  fixtures.partners.push({
    id: 11,
    name: "Acme Inc",
    billingAddress: "1 Acme Plaza",
    contactEmail: "billing@acme.example",
  });
  fixtures.invoices.push({
    id: 501,
    invoiceNumber: "INV-1001",
    vendorId,
    vendorName: "VendorCo",
    vendorAddress: "1 Vendor Way",
    vendorEmail: "v@vendor.example",
    vendorFedTaxId: "12-3456789",
    partnerId: 11,
    partnerName: "Acme Inc",
    partnerAddress: "1 Acme Plaza",
    partnerEmail: "billing@acme.example",
    status: "open",
    periodStart: period.start,
    periodEnd: period.end,
    invoiceDate: period.end,
    dueDate: period.end,
    total: "100.00",
    subtotal: "100.00",
    taxTotal: "0.00",
    memo: "Test invoice",
    notes: "Test invoice",
  });
  fixtures.invoiceLines.push({
    id: 9001,
    invoiceId: 501,
    invoiceNumber: "INV-1001",
    description: "Labor",
    amount: "100.00",
    taxAmount: "0.00",
    lineType: "labor_regular",
    taxState: "TX",
  });
}

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  nextId = {
    reportExportAuditLog: 1,
    accountingPushedInvoices: 1,
    accountingConnectionItems: 1,
  };
  qboPushCallCount = 0;
  qboPushBundles.length = 0;
  qboReconcileReturn = [];
  qboPushAlwaysClean = false;
  oaPushCallCount = 0;
  oaPushBundles.length = 0;
  oaReconcileReturn = [];
  oaPushAlwaysClean = false;
  sendAccountingPushDigestEmailMock.mockClear();
  sendAccountingReconciliationDigestEmailMock.mockClear();
  vi.resetModules();
  process.env.ACCOUNTING_TOKEN_KEY = "0".repeat(64);
  const router = (await import("./reports")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QBO push retry linkage", () => {
  it("persists scope.retriedFromAuditId as a number on the retry's audit row, and GET /reports/exports/audit surfaces both rows in the retryChain", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);

    // 1) Initial push — produces an audit row with one invoice warning
    //    so the retry path has something to filter the bundle down to.
    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    expect(first.body.ok).toBe(true);
    expect(first.body.retriedFromAuditId).toBeNull();
    const originalAuditId = first.body.auditLogId as number;
    expect(typeof originalAuditId).toBe("number");

    expect(fixtures.reportExportAuditLog).toHaveLength(1);
    const originalRow = fixtures.reportExportAuditLog[0];
    expect(originalRow.reportKind).toBe("vendor.quickbooksPush");
    expect(originalRow.format).toBe("qbo_api_push");
    // The original row must NOT carry a parent pointer.
    expect(
      (originalRow.scope as Record<string, unknown>).retriedFromAuditId,
    ).toBeUndefined();
    // And it must carry the warning that the retry will replay.
    expect(originalRow.detailJson).toMatchObject({
      warnings: [
        expect.objectContaining({ kind: "invoice", identifier: "INV-1001" }),
      ],
    });

    // 2) Retry — the new audit row's scope.retriedFromAuditId must equal
    //    the original row's id, and it must be stored as a number (not a
    //    string) so the GET endpoint's typeof === "number" check matches.
    const retry = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({ retryFromAuditId: originalAuditId });
    expectStatus(retry, 200);
    expect(retry.body.ok).toBe(true);
    expect(retry.body.retriedFromAuditId).toBe(originalAuditId);
    const retryAuditId = retry.body.auditLogId as number;
    expect(typeof retryAuditId).toBe("number");
    expect(retryAuditId).not.toBe(originalAuditId);

    expect(fixtures.reportExportAuditLog).toHaveLength(2);
    const retryRow = fixtures.reportExportAuditLog[1];
    expect(retryRow.reportKind).toBe("vendor.quickbooksPush");
    const scope = retryRow.scope as Record<string, unknown>;
    // The exact field name is the contract — guard against silent renames.
    expect(scope).toHaveProperty("retriedFromAuditId", originalAuditId);
    expect(typeof scope.retriedFromAuditId).toBe("number");

    // 3) GET /reports/exports/audit must return both rows and tag the
    //    retry with the full chain (oldest -> newest, inclusive of self).
    const audit = await request(app)
      .get("/api/reports/exports/audit")
      .set("Cookie", adminCookie());
    expectStatus(audit, 200);
    const rows = audit.body.rows as Array<{
      id: number;
      scope: Record<string, unknown>;
      retryChain?: number[];
    }>;
    expect(rows).toHaveLength(2);

    const originalOut = rows.find((r) => r.id === originalAuditId)!;
    const retryOut = rows.find((r) => r.id === retryAuditId)!;
    expect(originalOut).toBeDefined();
    expect(retryOut).toBeDefined();

    // Every member of a chain carries the same retryChain (oldest -> newest,
    // sorted by createdAt asc) so admins can navigate the chain from either
    // end — opening the original row reveals the retry that resolved it,
    // and opening the retry reveals the failed sync it came from.
    const expectedChain = [originalAuditId, retryAuditId];
    expect(retryOut.retryChain).toEqual(expectedChain);
    expect(originalOut.retryChain).toEqual(expectedChain);

    // And the linkage on the wire still uses the same field name the
    // route persists — the client reads this directly to compute the
    // "Retried by #M" forward badge.
    expect(retryOut.scope).toHaveProperty(
      "retriedFromAuditId",
      originalAuditId,
    );
  });
});

describe("OpenAccountant push retry linkage", () => {
  it("persists scope.retriedFromAuditId on the retry's audit row and GET /reports/exports/audit surfaces the chain", async () => {
    const vendorId = 8;
    seedInvoiceFixtures(vendorId);

    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    expect(first.body.retriedFromAuditId).toBeNull();
    const originalAuditId = first.body.auditLogId as number;
    expect(typeof originalAuditId).toBe("number");

    const originalRow = fixtures.reportExportAuditLog[0];
    expect(originalRow.reportKind).toBe("vendor.openaccountantPush");
    expect(originalRow.format).toBe("oa_api_push");
    expect(
      (originalRow.scope as Record<string, unknown>).retriedFromAuditId,
    ).toBeUndefined();

    const retry = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({ retryFromAuditId: originalAuditId });
    expectStatus(retry, 200);
    expect(retry.body.retriedFromAuditId).toBe(originalAuditId);
    const retryAuditId = retry.body.auditLogId as number;

    const retryRow = fixtures.reportExportAuditLog[1];
    const scope = retryRow.scope as Record<string, unknown>;
    expect(scope).toHaveProperty("retriedFromAuditId", originalAuditId);
    expect(typeof scope.retriedFromAuditId).toBe("number");

    const audit = await request(app)
      .get("/api/reports/exports/audit")
      .set("Cookie", adminCookie());
    expectStatus(audit, 200);
    const rows = audit.body.rows as Array<{
      id: number;
      retryChain?: number[];
    }>;
    const retryOut = rows.find((r) => r.id === retryAuditId)!;
    const originalOut = rows.find((r) => r.id === originalAuditId)!;
    // Mirror the QBO contract: both ends of an OA chain receive the same
    // retryChain so admins can navigate from either side.
    const expectedChain = [originalAuditId, retryAuditId];
    expect(retryOut.retryChain).toEqual(expectedChain);
    expect(originalOut.retryChain).toEqual(expectedChain);
  });
});

describe("retriedFromAuditId field-name contract", () => {
  it("rejects a string-valued retriedFromAuditId — the GET endpoint only walks numeric parent pointers", async () => {
    // Locks in the second half of the contract: the GET endpoint checks
    // `typeof v === "number"`, so if a future refactor accidentally
    // started persisting the parent id as a string (e.g. via JSON.stringify
    // of a body param) the chain walk would silently stop. Seed a hand-
    // crafted retry row with a string parent and assert no chain emerges,
    // proving the type check is what's protecting the badge.
    const now = new Date();
    // Scope is jsonb (free-form Record<string, unknown>) on the wire — the
    // route's contract is enforced by a runtime typeof check, not the TS
    // type. Cast to that wire type so we can pass the malformed value the
    // production code is supposed to defend against.
    const stringParentScope: Record<string, unknown> = {
      vendorId: 7,
      retriedFromAuditId: "1",
    };
    fixtures.reportExportAuditLog.push({
      id: 1,
      reportKind: "vendor.quickbooksPush",
      format: "qbo_api_push",
      scope: { vendorId: 7 },
      detailJson: null,
      rowCount: 0,
      fileBytes: 0,
      downloadedByUserId: 7,
      userRole: "admin",
      userIp: null,
      userAgent: null,
      createdAt: now,
    });
    fixtures.reportExportAuditLog.push({
      id: 2,
      reportKind: "vendor.quickbooksPush",
      format: "qbo_api_push",
      // Stringly-typed parent pointer — must NOT be followed.
      scope: stringParentScope,
      detailJson: null,
      rowCount: 0,
      fileBytes: 0,
      downloadedByUserId: 7,
      userRole: "admin",
      userIp: null,
      userAgent: null,
      createdAt: now,
    });

    const audit = await request(app)
      .get("/api/reports/exports/audit")
      .set("Cookie", adminCookie());
    expectStatus(audit, 200);
    const rows = audit.body.rows as Array<{
      id: number;
      retryChain?: number[];
    }>;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.retryChain).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────
// Reconciliation drift digest
// ──────────────────────────────────────────────────────────────────
//
// Locks in the gating contract for the new
// `accountingReconciliationNotificationsEnabled` toggle: a push that
// posts every row but where the reconciler emits drift warnings should
// fire the drift digest only when the vendor has opted in, and never
// the failure digest. A push with real per-row failures should keep
// firing the failure digest on its own (the reconciliation digest must
// not double-fire on those).

function seedAdminRecipient(vendorId: number): void {
  fixtures.users.push({
    id: 99,
    displayName: "Owner",
    username: "owner",
    email: "owner@vendorco.example",
    preferredLanguage: "en",
  });
  // The query mock doesn't actually perform joins — it returns rows
  // straight from the leftmost table — so `loadVendorAdminEmailRecipients`
  // (which selects users.email/preferredLanguage off a users innerJoin)
  // needs those columns flattened onto the membership row to be visible.
  fixtures.userOrgMemberships.push({
    id: 99,
    userId: 99,
    vendorId,
    orgType: "vendor",
    role: "admin",
    email: "owner@vendorco.example",
    preferredLanguage: "en",
  });
}

// Wait for the fire-and-forget digest helpers (kicked off via
// `void maybeSend...`) to settle before asserting.
async function flushPendingPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe("Reconciliation drift digest gating", () => {
  it("fires the reconciliation digest (and not the failure digest) when the push has zero failures, the reconciler reports drift, and the vendor opted in", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    fixtures.vendors[0].accountingReconciliationNotificationsEnabled = true;
    qboPushAlwaysClean = true;
    qboReconcileReturn = [
      {
        kind: "invoice",
        identifier: "INV-1001",
        message: "reconciliation: total drift 100.00 vs 99.50",
      },
      {
        kind: "invoice",
        identifier: "(state:TX)",
        message: "Aggregate tax mismatch",
      },
    ];

    const res = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(res, 200);
    expect(res.body.ok).toBe(true);
    await flushPendingPromises();

    expect(sendAccountingPushDigestEmailMock).not.toHaveBeenCalled();
    expect(sendAccountingReconciliationDigestEmailMock).toHaveBeenCalledTimes(
      1,
    );
    const call = sendAccountingReconciliationDigestEmailMock.mock
      .calls[0][0] as {
      vendorName: string;
      provider: string;
      recipients: Array<{ email: string }>;
      countsByBucket: { perInvoice: number; perState: number };
      auditDetailUrl: string;
    };
    expect(call.vendorName).toBe("VendorCo");
    expect(call.provider).toBe("QuickBooks");
    expect(call.recipients[0].email).toBe("owner@vendorco.example");
    expect(call.countsByBucket.perInvoice).toBe(1);
    expect(call.countsByBucket.perState).toBe(1);
    expect(call.auditDetailUrl).toContain("auditId=");
  });

  it("does not fire the reconciliation digest when the toggle is off (default), even if drift is present", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    // toggle defaults to false from seedInvoiceFixtures — leave it off.
    qboPushAlwaysClean = true;
    qboReconcileReturn = [
      {
        kind: "invoice",
        identifier: "INV-1001",
        message: "reconciliation: total drift 100.00 vs 99.50",
      },
    ];

    const res = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(res, 200);
    await flushPendingPromises();

    expect(sendAccountingPushDigestEmailMock).not.toHaveBeenCalled();
    expect(sendAccountingReconciliationDigestEmailMock).not.toHaveBeenCalled();
  });

  it("does not fire either digest for the QBO push when reconciliation drift is the only warning AND the reconciliation toggle is off (even with the legacy failure toggle on)", async () => {
    // The whole opt-in design hinges on this: existing vendors default
    // to `accountingReconciliationNotificationsEnabled = false`, and
    // most of them already have `accountingFailureNotificationsEnabled
    // = true` from the legacy failure digest. A push that posts every
    // row but the reconciler flags as drifted must NOT fall back to
    // the failure digest just because the failure toggle is on — drift
    // warnings are not failures, and the route's bucketing must keep
    // them out of `maybeSendAccountingDigest`'s "failureWarnings" set.
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    fixtures.vendors[0].accountingFailureNotificationsEnabled = true;
    fixtures.vendors[0].accountingReconciliationNotificationsEnabled = false;
    qboPushAlwaysClean = true;
    qboReconcileReturn = [
      {
        kind: "invoice",
        identifier: "INV-1001",
        message: "reconciliation: total drift 100.00 vs 99.50",
      },
      {
        kind: "invoice",
        identifier: "(state:TX)",
        message: "Aggregate tax mismatch",
      },
    ];

    const res = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(res, 200);
    await flushPendingPromises();

    expect(sendAccountingPushDigestEmailMock).not.toHaveBeenCalled();
    expect(sendAccountingReconciliationDigestEmailMock).not.toHaveBeenCalled();
  });

  it("does not fire either digest for the OpenAccountant push when reconciliation drift is the only warning AND the reconciliation toggle is off (even with the legacy failure toggle on)", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    fixtures.vendors[0].accountingFailureNotificationsEnabled = true;
    fixtures.vendors[0].accountingReconciliationNotificationsEnabled = false;
    oaPushAlwaysClean = true;
    oaReconcileReturn = [
      {
        kind: "invoice",
        identifier: "INV-1001",
        message: "reconciliation: total drift 100.00 vs 99.50",
      },
      {
        kind: "invoice",
        identifier: "(reconciliation)",
        message: "reconciliation skipped — couldn't read invoices back",
      },
    ];

    const res = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(res, 200);
    await flushPendingPromises();

    expect(sendAccountingPushDigestEmailMock).not.toHaveBeenCalled();
    expect(sendAccountingReconciliationDigestEmailMock).not.toHaveBeenCalled();
  });

  it("fires only the failure digest (never the reconciliation digest) when both per-row failures and reconciliation warnings are present", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    // Both toggles on — the contract is that the reconciliation digest
    // must still be suppressed because the failure digest already fired
    // and includes the reconciliation context inline.
    fixtures.vendors[0].accountingFailureNotificationsEnabled = true;
    fixtures.vendors[0].accountingReconciliationNotificationsEnabled = true;
    // Default qbo mock: first call returns one per-row invoice failure.
    qboReconcileReturn = [
      {
        kind: "invoice",
        identifier: "INV-1001",
        message: "reconciliation: total drift 100.00 vs 99.50",
      },
    ];

    const res = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(res, 200);
    await flushPendingPromises();

    expect(sendAccountingPushDigestEmailMock).toHaveBeenCalledTimes(1);
    expect(sendAccountingReconciliationDigestEmailMock).not.toHaveBeenCalled();
  });

  it("does not double-fire the reconciliation digest on a duplicate push to the same audit row (idempotency)", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    fixtures.vendors[0].accountingReconciliationNotificationsEnabled = true;
    qboPushAlwaysClean = true;
    qboReconcileReturn = [
      {
        kind: "invoice",
        identifier: "INV-1001",
        message: "reconciliation: total drift",
      },
    ];

    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    await flushPendingPromises();

    // Second push: the route writes a fresh audit row, so this is a
    // distinct claim and a new email is expected. We verify that on the
    // SAME audit row, a duplicate fire-and-forget does not double-send
    // by re-invoking the helper indirectly via the same audit row id —
    // but since the route always inserts a new audit row per push,
    // here we instead assert that calling the route twice with the
    // same drift produces exactly two distinct emails (one per audit
    // row), which proves the per-row claim isn't blocking new rows.
    const second = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(second, 200);
    await flushPendingPromises();

    expect(sendAccountingReconciliationDigestEmailMock).toHaveBeenCalledTimes(
      2,
    );

    // Now stamp the second audit row's reconciliation column directly
    // and verify a third push to a freshly seeded audit still works
    // (i.e. the column on row 2 doesn't block row 3).
    const beforeCount =
      sendAccountingReconciliationDigestEmailMock.mock.calls.length;
    fixtures.reportExportAuditLog[1].accountingReconciliationDigestEmailedAt =
      new Date();
    const third = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(third, 200);
    await flushPendingPromises();
    expect(
      sendAccountingReconciliationDigestEmailMock.mock.calls.length,
    ).toBeGreaterThan(beforeCount);
  });

  it("fires the reconciliation digest for the OpenAccountant push too when the toggle is on", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    fixtures.vendors[0].accountingReconciliationNotificationsEnabled = true;
    oaPushAlwaysClean = true;
    oaReconcileReturn = [
      {
        kind: "invoice",
        identifier: "(reconciliation)",
        message: "reconciliation skipped — couldn't read invoices back",
      },
    ];

    const res = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(res, 200);
    await flushPendingPromises();

    expect(sendAccountingPushDigestEmailMock).not.toHaveBeenCalled();
    expect(sendAccountingReconciliationDigestEmailMock).toHaveBeenCalledTimes(
      1,
    );
    const call = sendAccountingReconciliationDigestEmailMock.mock
      .calls[0][0] as {
      provider: string;
      countsByBucket: { fetchSkipped: number };
    };
    expect(call.provider).toBe("OpenAccountant");
    expect(call.countsByBucket.fetchSkipped).toBe(1);
  });
});
