import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Route-level coverage of the QBO/OA push retry chain on top of
// `maybeSendAccountingDigest`. The unit tests in
// `reports-accounting-digest.test.ts` lock the per-row claim on
// `report_export_audit_log.accounting_digest_emailed_at`, but they call
// the helper directly with a fixed audit id. They cannot catch a route-
// level refactor that, e.g., starts firing a fresh digest on every
// retry attempt.
//
// These tests drive the full POST endpoints end-to-end against a fake
// DB (modelled on `reports-retry-linkage.test.ts`) and assert the
// double-call / retry-after-emailed contract is held symmetrically by
// both providers.

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
    select(cols?: unknown): { from(t: TableTag): QueryChain };
    insert(t: TableTag): { values(v: Row): InsertChain };
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
      where(pred: Pred): { returning(): Promise<Row[]> };
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

interface PushBundleShape {
  invoices: ReadonlyArray<{ invoiceNumber: string }>;
}
interface PushWarning {
  kind: "invoice" | "customer" | "vendor";
  identifier: string;
  message: string;
}

// Per-call warning queue: each test scripts the warnings each
// successive `pushBundleToQbo` / `pushBundleToOa` invocation should
// return. Modelling production semantics where a previously-failed
// invoice succeeds on retry once the underlying mapping/auth issue is
// fixed, leaving the second call clean.
let qboWarningQueue: PushWarning[][] = [];
let oaWarningQueue: PushWarning[][] = [];

vi.mock("../lib/accounting/qbo", () => ({
  loadQboConfig: () => ({
    environment: "sandbox",
    clientId: "x",
    clientSecret: "y",
    redirectUri: "http://localhost/cb",
  }),
  ensureQboItemMap: async () => ({ itemMap: {}, warnings: [] }),
  pushBundleToQbo: async (bundle: PushBundleShape) => {
    const warnings = qboWarningQueue.shift() ?? [];
    return {
      customersCreated: 0,
      vendorsCreated: 0,
      invoicesCreated: warnings.length === 0 ? bundle.invoices.length : 0,
      invoicesPushed:
        warnings.length === 0
          ? bundle.invoices.map((i) => i.invoiceNumber)
          : [],
      customersAlreadyExisted: 0,
      vendorsAlreadyExisted: 0,
      invoicesAlreadyUpToDate: 0,
      warnings,
    };
  },
  reconcileQboInvoices: async () => [],
  refreshAccessToken: async () => ({
    accessToken: "fresh",
    refreshToken: "fresh-r",
    expiresInSec: 3600,
  }),
}));

vi.mock("../lib/accounting/oa", () => ({
  pushBundleToOa: async (bundle: PushBundleShape) => {
    const warnings = oaWarningQueue.shift() ?? [];
    return {
      customersCreated: 0,
      vendorsCreated: 0,
      invoicesCreated: warnings.length === 0 ? bundle.invoices.length : 0,
      invoicesPushed:
        warnings.length === 0
          ? bundle.invoices.map((i) => i.invoiceNumber)
          : [],
      customersAlreadyExisted: 0,
      vendorsAlreadyExisted: 0,
      invoicesAlreadyUpToDate: 0,
      warnings,
    };
  },
  reconcileOaInvoices: async () => [],
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

const sendDigestMock = vi.fn(async (..._args: unknown[]) => undefined);
const sendReconcileDigestMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("../lib/sendgrid", () => ({
  sendAccountingPushDigestEmail: sendDigestMock,
  sendAccountingReconciliationDigestEmail: sendReconcileDigestMock,
  sendInvoiceEmail: async () => undefined,
  sendInvoiceReminderEmail: async () => undefined,
  send1099RecipientEmail: async () => undefined,
  sendPasswordResetEmail: async () => undefined,
  getUncachableSendGridClient: async () => ({}),
}));

function adminCookie(userId = 7): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin User",
  });
}

function seedInvoiceFixtures(vendorId: number): void {
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
    accountingFailureNotificationsEnabled: true,
    accountingReconciliationNotificationsEnabled: false,
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

function seedAdminRecipient(vendorId: number): void {
  fixtures.users.push({
    id: 99,
    displayName: "Owner",
    username: "owner",
    email: "owner@vendorco.example",
    preferredLanguage: "en",
  });
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

async function flushPendingPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  nextId = {
    reportExportAuditLog: 1,
    accountingPushedInvoices: 1,
    accountingConnectionItems: 1,
  };
  qboWarningQueue = [];
  oaWarningQueue = [];
  sendDigestMock.mockClear();
  sendReconcileDigestMock.mockClear();
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

const FAILURE: PushWarning = {
  kind: "invoice",
  identifier: "INV-1001",
  message: "Simulated push failure for retry test",
};

describe("QuickBooks push: digest is sent at most once across the retry chain", () => {
  it("two pushes with the same payload only fire one digest when the second push has no new failures", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    // Production semantics on a same-payload retry: once the initial
    // failure clears (mapping fixed, transient outage resolved, etc.)
    // the second push posts cleanly. The digest must therefore fire
    // exactly once across the two-call chain.
    qboWarningQueue = [[FAILURE], []];

    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    await flushPendingPromises();

    const second = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(second, 200);
    await flushPendingPromises();

    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    expect(
      (sendDigestMock.mock.calls[0][0] as { provider: string }).provider,
    ).toBe("QuickBooks");
    // The first audit row is the only one that should ever have been
    // claimed; the second push had no failures so its row stays clean.
    expect(fixtures.reportExportAuditLog).toHaveLength(2);
    expect(
      fixtures.reportExportAuditLog[0].accountingDigestEmailedAt,
    ).toBeInstanceOf(Date);
    expect(
      fixtures.reportExportAuditLog[1].accountingDigestEmailedAt ?? null,
    ).toBeNull();
  });

  it("retryFromAuditId for a row that already had its digest emailed does not send another digest", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    // Initial push fails INV-1001 → digest sent, original row stamped.
    // The explicit retry then succeeds (the reason admins kicked off
    // a retry in the first place), so no second digest may fire even
    // though a brand-new audit row is created for the retry.
    qboWarningQueue = [[FAILURE], []];

    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    await flushPendingPromises();

    const originalAuditId = first.body.auditLogId as number;
    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    const originalStamp = (
      fixtures.reportExportAuditLog.find((r) => r.id === originalAuditId) ?? {}
    ).accountingDigestEmailedAt as Date | undefined;
    expect(originalStamp).toBeInstanceOf(Date);

    const retry = await request(app)
      .post(`/api/reports/vendor/${vendorId}/quickbooks-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({ retryFromAuditId: originalAuditId });
    expectStatus(retry, 200);
    await flushPendingPromises();

    expect(retry.body.retriedFromAuditId).toBe(originalAuditId);
    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    // The original row's stamp must be the exact same Date instance —
    // i.e. the retry path never re-claimed or mutated it.
    const originalAfter = fixtures.reportExportAuditLog.find(
      (r) => r.id === originalAuditId,
    );
    expect(originalAfter?.accountingDigestEmailedAt).toBe(originalStamp);
    // The new (retry) audit row exists but was never stamped because
    // the retry produced no failure warnings to email about.
    const retryRow = fixtures.reportExportAuditLog.find(
      (r) => r.id !== originalAuditId,
    );
    expect(retryRow).toBeDefined();
    expect(retryRow?.accountingDigestEmailedAt ?? null).toBeNull();
    const scope = retryRow?.scope as { retriedFromAuditId?: number };
    expect(scope.retriedFromAuditId).toBe(originalAuditId);
  });
});

describe("OpenAccountant push: digest is sent at most once across the retry chain", () => {
  it("two pushes with the same payload only fire one digest when the second push has no new failures", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    oaWarningQueue = [[FAILURE], []];

    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    await flushPendingPromises();

    const second = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(second, 200);
    await flushPendingPromises();

    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    expect(
      (sendDigestMock.mock.calls[0][0] as { provider: string }).provider,
    ).toBe("OpenAccountant");
    expect(fixtures.reportExportAuditLog).toHaveLength(2);
    expect(
      fixtures.reportExportAuditLog[0].accountingDigestEmailedAt,
    ).toBeInstanceOf(Date);
    expect(
      fixtures.reportExportAuditLog[1].accountingDigestEmailedAt ?? null,
    ).toBeNull();
  });

  it("retryFromAuditId for a row that already had its digest emailed does not send another digest", async () => {
    const vendorId = 7;
    seedInvoiceFixtures(vendorId);
    seedAdminRecipient(vendorId);
    oaWarningQueue = [[FAILURE], []];

    const first = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({});
    expectStatus(first, 200);
    await flushPendingPromises();

    const originalAuditId = first.body.auditLogId as number;
    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    const originalStamp = (
      fixtures.reportExportAuditLog.find((r) => r.id === originalAuditId) ?? {}
    ).accountingDigestEmailedAt as Date | undefined;
    expect(originalStamp).toBeInstanceOf(Date);

    const retry = await request(app)
      .post(`/api/reports/vendor/${vendorId}/openaccountant-push`)
      .set("Cookie", adminCookie())
      .query({ periodStart: "2026-01-01", periodEnd: "2026-01-31" })
      .send({ retryFromAuditId: originalAuditId });
    expectStatus(retry, 200);
    await flushPendingPromises();

    expect(retry.body.retriedFromAuditId).toBe(originalAuditId);
    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    const originalAfter = fixtures.reportExportAuditLog.find(
      (r) => r.id === originalAuditId,
    );
    expect(originalAfter?.accountingDigestEmailedAt).toBe(originalStamp);
    const retryRow = fixtures.reportExportAuditLog.find(
      (r) => r.id !== originalAuditId,
    );
    expect(retryRow).toBeDefined();
    expect(retryRow?.accountingDigestEmailedAt ?? null).toBeNull();
    const scope = retryRow?.scope as { retriedFromAuditId?: number };
    expect(scope.retriedFromAuditId).toBe(originalAuditId);
  });
});
