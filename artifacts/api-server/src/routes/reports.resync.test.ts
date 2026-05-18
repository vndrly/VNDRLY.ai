import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// End-to-end coverage for the per-invoice "Re-sync to QuickBooks" /
// "Re-sync to OpenAccountant" routes. These routes were previously
// covered only at the helper level (updateQboInvoice / updateOaInvoice
// unit tests). The cases below lock in the HTTP contract:
//
//   - 401 when no session is present
//   - 403 when a vendor session targets a different vendor
//   - 412 when this invoice has never been pushed for that provider
//   - 404 when the invoice id does not exist for the requested vendor
//   - 409 when the remote invoice has been deleted
//     (mocked QBO/OA "missing" result)
//   - 200 happy path bumps accounting_pushed_invoices.pushed_at and
//     writes a report_export_audit_log row
//
// Outbound HTTP (QBO + OA) and the Express-injected db are stubbed so
// the test can run without real infra. The accounting_pushed_invoices
// onConflictDoUpdate flow is special-cased in the db mock so the
// "pushed_at is bumped" assertion mirrors production semantics rather
// than the default "always insert a new row" behaviour.

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
    "externalInvoiceId",
    "externalDocNumber",
    "pushedAt",
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
  orderBy(...args: unknown[]): QueryChain;
  limit(n: number): QueryChain;
  offset(n: number): QueryChain;
  catch(onReject: (e: unknown) => unknown): Promise<unknown>;
}

function makeQuery(tableName: string): QueryChain {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  let offsetN = 0;
  const run = (): Row[] => {
    const all = fixtures[tableName] ?? [];
    let filtered = all.filter((r) => evalPred(pred, r)).map((r) => ({ ...r }));
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
    orderBy: () => q,
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
    onConflictDoUpdate(args: { target: ColRef[]; set: Row }): InsertChain;
    onConflictDoNothing(args?: { target?: ColRef[] }): InsertChain;
    returning(...args: unknown[]): Promise<Row[]>;
  }
  const insertChain = (tableName: string, v: Row): InsertChain => {
    if (!fixtures[tableName]) fixtures[tableName] = [];
    let conflictTarget: ColRef[] | null = null;
    let conflictSet: Row | null = null;
    let conflictDoNothing = false;
    let resolved = false;
    let resolvedRow: Row | null = null;
    const apply = (): Row => {
      if (resolved && resolvedRow) return resolvedRow;
      resolved = true;
      // Honour onConflictDoUpdate / onConflictDoNothing on the
      // accountingPushedInvoices table so the route's "touch" semantics
      // (bump pushed_at on an existing (vendor, provider, invoice)
      // mapping) are reproduced faithfully. Without this, the
      // happy-path assertion would only ever see freshly-inserted rows
      // and could not distinguish "bumped" from "duplicate row".
      if (conflictTarget && conflictTarget.length > 0) {
        const existing = fixtures[tableName].find((r) =>
          conflictTarget!.every((c) => r[c.__col] === v[c.__col]),
        );
        if (existing) {
          if (conflictDoNothing) {
            resolvedRow = existing;
            return existing;
          }
          if (conflictSet) Object.assign(existing, conflictSet);
          resolvedRow = existing;
          return existing;
        }
      }
      const providedId = typeof v.id === "number" ? v.id : undefined;
      const id =
        providedId ?? nextId[tableName] ?? fixtures[tableName].length + 1;
      nextId[tableName] = id + 1;
      const defaults: Row = { id, createdAt: new Date() };
      if (tableName === "accountingPushedInvoices") {
        defaults.pushedAt = new Date();
      }
      const row: Row = { ...defaults, ...v };
      fixtures[tableName].push(row);
      resolvedRow = row;
      return row;
    };
    const chain: InsertChain = {
      onConflictDoUpdate: (args) => {
        conflictTarget = args.target;
        conflictSet = args.set;
        return chain;
      },
      onConflictDoNothing: (args) => {
        conflictTarget = args?.target ?? [];
        conflictDoNothing = true;
        return chain;
      },
      returning: async () => [apply()],
      then: (resolve, reject) => {
        try {
          apply();
          return Promise.resolve(undefined).then(resolve, reject ?? undefined);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject ?? undefined);
        }
      },
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
    select: () => ({
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
      "qbo_api_resync",
      "oa_api_resync",
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

// QBO mocks. The two helpers the re-sync route hits are
// `loadQboConfig` (sync — returns environment) and `updateQboInvoice`
// (async — performs the sparse update). The default behaviour is
// "updated" so the happy-path test passes; per-test overrides flip
// it to "missing" for the 409 case or to throw for the 502 case.
type QboUpdateResult =
  | {
      status: "updated";
      externalInvoiceId: string;
      externalDocNumber: string | null;
      warning?: string;
    }
  | { status: "missing"; message: string };

let qboUpdateImpl: () => Promise<QboUpdateResult> = async () => ({
  status: "updated" as const,
  externalInvoiceId: "qbo-ext-1",
  externalDocNumber: "QBO-DOC-1",
});

let loadQboConfigImpl: () => {
  environment: "production" | "sandbox";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} = () => ({
  environment: "sandbox" as const,
  clientId: "x",
  clientSecret: "y",
  redirectUri: "http://localhost/cb",
});

let ensureQboItemMapImpl: () => Promise<{
  itemMap: Record<string, string>;
  warnings: unknown[];
}> = async () => ({ itemMap: {}, warnings: [] });

vi.mock("../lib/accounting/qbo", () => ({
  loadQboConfig: () => loadQboConfigImpl(),
  ensureQboItemMap: (...args: unknown[]) =>
    ensureQboItemMapImpl(...(args as [])),
  pushBundleToQbo: async () => ({
    customersCreated: 0,
    vendorsCreated: 0,
    invoicesCreated: 0,
    invoicesPushed: [],
    customersAlreadyExisted: 0,
    vendorsAlreadyExisted: 0,
    invoicesAlreadyUpToDate: 0,
    warnings: [],
  }),
  updateQboInvoice: (...args: unknown[]) => qboUpdateImpl(...(args as [])),
  reconcileQboInvoices: async () => [],
  refreshAccessToken: async () => ({
    accessToken: "fresh",
    refreshToken: "fresh-r",
    expiresInSec: 3600,
  }),
}));

type OaUpdateResult =
  | {
      status: "updated";
      externalInvoiceId: string;
      externalDocNumber: string | null;
    }
  | { status: "missing"; message: string };

let oaUpdateImpl: () => Promise<OaUpdateResult> = async () => ({
  status: "updated" as const,
  externalInvoiceId: "oa-ext-1",
  externalDocNumber: "OA-DOC-1",
});

vi.mock("../lib/accounting/oa", () => ({
  pushBundleToOa: async () => ({
    customersCreated: 0,
    vendorsCreated: 0,
    invoicesCreated: 0,
    invoicesPushed: [],
    customersAlreadyExisted: 0,
    vendorsAlreadyExisted: 0,
    invoicesAlreadyUpToDate: 0,
    warnings: [],
  }),
  updateOaInvoice: (...args: unknown[]) => oaUpdateImpl(...(args as [])),
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

type Connection = {
  id: number;
  vendorId: number;
  provider: string;
  realmId: string | null;
  displayName: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  apiBaseUrl: string | null;
  status: string;
  scopes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let getConnectionImpl: (
  vendorId: number,
  provider: string,
) => Promise<Connection | null> = async (vendorId, provider) => ({
  id: 99,
  vendorId,
  provider,
  realmId: provider === "qbo" ? "realm-1" : null,
  displayName: "Test Co",
  accessToken: "tok",
  refreshToken: "ref",
  accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  apiBaseUrl: provider === "oa" ? "https://oa.example.com" : null,
  status: "active",
  scopes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

vi.mock("../lib/accounting/connections", () => ({
  getConnection: (vendorId: number, provider: string) =>
    getConnectionImpl(vendorId, provider),
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

// SendGrid is touched only by the bulk-push route; stub it so the
// import resolves without side effects.
vi.mock("../lib/sendgrid", () => ({
  sendAccountingPushDigestEmail: async () => undefined,
  sendAccountingReconciliationDigestEmail: async () => undefined,
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

function vendorCookie(vendorId: number, userId = 8): string {
  const payload = { userId, role: "vendor", vendorId, displayName: "Vendor" };
  return buildTestCookie(payload);
}

const VENDOR_ID = 7;
const INVOICE_ID = 501;
const INVOICE_NUMBER = "INV-1001";

function seedInvoiceFixtures(): void {
  const period = {
    start: new Date(Date.UTC(2026, 0, 1)),
    end: new Date(Date.UTC(2026, 2, 1)),
  };
  fixtures.vendors.push({
    id: VENDOR_ID,
    name: "VendorCo",
    billingAddress: "1 Vendor Way",
    contactEmail: "v@vendor.example",
    federalTaxId: "12-3456789",
  });
  fixtures.partners.push({
    id: 11,
    name: "Acme Inc",
    billingAddress: "1 Acme Plaza",
    contactEmail: "billing@acme.example",
  });
  fixtures.invoices.push({
    id: INVOICE_ID,
    invoiceNumber: INVOICE_NUMBER,
    vendorId: VENDOR_ID,
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
    invoiceId: INVOICE_ID,
    invoiceNumber: INVOICE_NUMBER,
    description: "Labor",
    amount: "100.00",
    taxAmount: "0.00",
    lineType: "labor_regular",
    taxState: "TX",
  });
}

const STALE_PUSHED_AT = new Date(Date.UTC(2025, 0, 1));

function seedPushedInvoice(provider: "qbo" | "oa"): void {
  fixtures.accountingPushedInvoices.push({
    id: nextId.accountingPushedInvoices ?? 1,
    vendorId: VENDOR_ID,
    provider,
    invoiceNumber: INVOICE_NUMBER,
    externalInvoiceId: provider === "qbo" ? "qbo-ext-1" : "oa-ext-1",
    externalDocNumber: provider === "qbo" ? "QBO-DOC-1" : "OA-DOC-1",
    pushedAt: STALE_PUSHED_AT,
  });
  nextId.accountingPushedInvoices =
    (nextId.accountingPushedInvoices ?? 1) + 1;
}

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  nextId = {
    reportExportAuditLog: 1,
    accountingPushedInvoices: 1,
    accountingConnectionItems: 1,
  };
  qboUpdateImpl = async () => ({
    status: "updated" as const,
    externalInvoiceId: "qbo-ext-1",
    externalDocNumber: "QBO-DOC-1",
  });
  oaUpdateImpl = async () => ({
    status: "updated" as const,
    externalInvoiceId: "oa-ext-1",
    externalDocNumber: "OA-DOC-1",
  });
  loadQboConfigImpl = () => ({
    environment: "sandbox" as const,
    clientId: "x",
    clientSecret: "y",
    redirectUri: "http://localhost/cb",
  });
  ensureQboItemMapImpl = async () => ({ itemMap: {}, warnings: [] });
  getConnectionImpl = async (vendorId, provider) => ({
    id: 99,
    vendorId,
    provider,
    realmId: provider === "qbo" ? "realm-1" : null,
    displayName: "Test Co",
    accessToken: "tok",
    refreshToken: "ref",
    accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    apiBaseUrl: provider === "oa" ? "https://oa.example.com" : null,
    status: "active",
    scopes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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

describe("POST /reports/vendor/:vendorId/invoices/:invoiceId/qbo-resync", () => {
  it("400 when vendorId is not an integer", async () => {
    const res = await request(app)
      .post(`/api/reports/vendor/not-a-number/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("report.invalid_vendor_id_or_invoice_id");
  });

  it("400 when invoiceId is not an integer", async () => {
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/not-a-number/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("report.invalid_vendor_id_or_invoice_id");
  });

  it("503 qbo.not_configured when loadQboConfig() throws", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    loadQboConfigImpl = () => {
      throw new Error("QBO_CLIENT_ID env var is not set");
    };
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("qbo.not_configured");
    expect(res.body.error).toMatch(/QBO_CLIENT_ID/);
  });

  it("412 when the vendor has no active QBO connection", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    getConnectionImpl = async () => null;
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("accounting.token_error");
    expect(res.body.error).toMatch(/not connected to QuickBooks/i);
  });

  it("502 when the QBO item map resolution throws", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    ensureQboItemMapImpl = async () => {
      throw new Error("QBO Items API returned 500");
    };
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("server.upstream_error");
    expect(res.body.error).toMatch(/Items API/);
    // No audit row written for upstream failures before updateQboInvoice.
    expect(fixtures.reportExportAuditLog).toHaveLength(0);
    // pushed_at must NOT be bumped.
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.pushedAt).toEqual(STALE_PUSHED_AT);
  });

  it("502 when updateQboInvoice throws a non-missing error", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    qboUpdateImpl = async () => {
      throw new Error("QBO sparse update returned 500");
    };
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("server.upstream_error");
    expect(res.body.error).toMatch(/sparse update/);
    // pushed_at must NOT be bumped on a thrown error.
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.pushedAt).toEqual(STALE_PUSHED_AT);
  });

  it("401 when no session cookie is present", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  it("403 when a vendor session targets a different vendor", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", vendorCookie(VENDOR_ID + 1))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it("404 when the invoice does not exist for this vendor", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    const res = await request(app)
      .post(
        `/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID + 999}/qbo-resync`,
      )
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("404 when the invoice belongs to a different vendor", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    // Admin can target any vendor, so RBAC passes; the invoice's
    // vendorId predicate must keep us out instead of leaking the row.
    const res = await request(app)
      .post(
        `/api/reports/vendor/${VENDOR_ID + 1}/invoices/${INVOICE_ID}/qbo-resync`,
      )
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("412 when this invoice has not been pushed to QuickBooks yet", async () => {
    seedInvoiceFixtures();
    // No accountingPushedInvoices row → re-sync has no remote id to PUT to.
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("qbo.not_pushed");
  });

  it("409 when the remote QBO invoice has been deleted (missing)", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    qboUpdateImpl = async () => ({
      status: "missing" as const,
      message: "The QuickBooks invoice no longer exists.",
    });

    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("qbo.invoice_missing");
    // Audit row is still written so the operator can see the failed
    // attempt in the export audit log.
    expect(fixtures.reportExportAuditLog).toHaveLength(1);
    const audit = fixtures.reportExportAuditLog[0];
    expect(audit.reportKind).toBe("vendor.quickbooksPush");
    expect(audit.format).toBe("qbo_api_resync");
    const scope = audit.scope as Record<string, unknown>;
    expect(scope.outcome).toBe("missing");
    expect(scope.invoiceId).toBe(INVOICE_ID);
    // pushed_at must NOT be bumped on a missing-remote outcome.
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.pushedAt).toEqual(STALE_PUSHED_AT);
  });

  it("200 happy path bumps pushed_at and writes a vendor.quickbooksPush audit row", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("qbo");
    qboUpdateImpl = async () => ({
      status: "updated" as const,
      externalInvoiceId: "qbo-ext-1",
      externalDocNumber: "QBO-DOC-1-v2",
    });
    const before = Date.now();

    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/qbo-resync`)
      .set("Cookie", adminCookie())
      .send({});

    expectStatus(res, 200);
    expect(res.body.ok).toBe(true);
    expect(res.body.provider).toBe("qbo");
    expect(res.body.invoiceNumber).toBe(INVOICE_NUMBER);
    expect(res.body.externalInvoiceId).toBe("qbo-ext-1");
    expect(res.body.externalDocNumber).toBe("QBO-DOC-1-v2");
    expect(typeof res.body.auditLogId).toBe("number");

    // accounting_pushed_invoices row was bumped (not duplicated) and
    // its externalDocNumber overwritten with the fresh value.
    expect(fixtures.accountingPushedInvoices).toHaveLength(1);
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.externalDocNumber).toBe("QBO-DOC-1-v2");
    expect((mapping.pushedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((mapping.pushedAt as Date).getTime()).toBeGreaterThan(
      STALE_PUSHED_AT.getTime(),
    );

    // Audit row exists and matches the route's contract.
    expect(fixtures.reportExportAuditLog).toHaveLength(1);
    const audit = fixtures.reportExportAuditLog[0];
    expect(audit.reportKind).toBe("vendor.quickbooksPush");
    expect(audit.format).toBe("qbo_api_resync");
    expect(audit.rowCount).toBe(1);
    const scope = audit.scope as Record<string, unknown>;
    expect(scope.outcome).toBe("updated");
    expect(scope.vendorId).toBe(VENDOR_ID);
    expect(scope.invoiceId).toBe(INVOICE_ID);
    expect(scope.invoiceNumber).toBe(INVOICE_NUMBER);
    expect(audit.id).toBe(res.body.auditLogId);
  });
});

describe("POST /reports/vendor/:vendorId/invoices/:invoiceId/oa-resync", () => {
  it("400 when vendorId is not an integer", async () => {
    const res = await request(app)
      .post(`/api/reports/vendor/not-a-number/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("report.invalid_vendor_id_or_invoice_id");
  });

  it("400 when invoiceId is not an integer", async () => {
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/not-a-number/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("report.invalid_vendor_id_or_invoice_id");
  });

  it("412 when the vendor has no active OpenAccountant connection", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    getConnectionImpl = async () => null;
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("accounting.token_error");
    expect(res.body.error).toMatch(/not connected to OpenAccountant/i);
  });

  it("502 when updateOaInvoice throws a non-missing error", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    oaUpdateImpl = async () => {
      throw new Error("OA invoice update returned 500");
    };
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("server.upstream_error");
    expect(res.body.error).toMatch(/invoice update/);
    // pushed_at must NOT be bumped on a thrown error.
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.pushedAt).toEqual(STALE_PUSHED_AT);
  });

  it("401 when no session cookie is present", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  it("403 when a vendor session targets a different vendor", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", vendorCookie(VENDOR_ID + 1))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it("404 when the invoice does not exist for this vendor", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    const res = await request(app)
      .post(
        `/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID + 999}/oa-resync`,
      )
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("404 when the invoice belongs to a different vendor", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    const res = await request(app)
      .post(
        `/api/reports/vendor/${VENDOR_ID + 1}/invoices/${INVOICE_ID}/oa-resync`,
      )
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("412 when this invoice has not been pushed to OpenAccountant yet", async () => {
    seedInvoiceFixtures();
    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("oa.not_pushed");
  });

  it("409 when the remote OA invoice has been deleted (missing)", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    oaUpdateImpl = async () => ({
      status: "missing" as const,
      message: "The OpenAccountant invoice no longer exists.",
    });

    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("oa.invoice_missing");
    expect(fixtures.reportExportAuditLog).toHaveLength(1);
    const audit = fixtures.reportExportAuditLog[0];
    expect(audit.reportKind).toBe("vendor.openaccountantPush");
    expect(audit.format).toBe("oa_api_resync");
    const scope = audit.scope as Record<string, unknown>;
    expect(scope.outcome).toBe("missing");
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.pushedAt).toEqual(STALE_PUSHED_AT);
  });

  it("200 happy path bumps pushed_at and writes a vendor.openaccountantPush audit row", async () => {
    seedInvoiceFixtures();
    seedPushedInvoice("oa");
    oaUpdateImpl = async () => ({
      status: "updated" as const,
      externalInvoiceId: "oa-ext-1",
      externalDocNumber: "OA-DOC-1-v2",
    });
    const before = Date.now();

    const res = await request(app)
      .post(`/api/reports/vendor/${VENDOR_ID}/invoices/${INVOICE_ID}/oa-resync`)
      .set("Cookie", adminCookie())
      .send({});

    expectStatus(res, 200);
    expect(res.body.ok).toBe(true);
    expect(res.body.provider).toBe("oa");
    expect(res.body.invoiceNumber).toBe(INVOICE_NUMBER);
    expect(res.body.externalInvoiceId).toBe("oa-ext-1");
    expect(res.body.externalDocNumber).toBe("OA-DOC-1-v2");
    expect(typeof res.body.auditLogId).toBe("number");

    expect(fixtures.accountingPushedInvoices).toHaveLength(1);
    const mapping = fixtures.accountingPushedInvoices[0];
    expect(mapping.externalDocNumber).toBe("OA-DOC-1-v2");
    expect((mapping.pushedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((mapping.pushedAt as Date).getTime()).toBeGreaterThan(
      STALE_PUSHED_AT.getTime(),
    );

    expect(fixtures.reportExportAuditLog).toHaveLength(1);
    const audit = fixtures.reportExportAuditLog[0];
    expect(audit.reportKind).toBe("vendor.openaccountantPush");
    expect(audit.format).toBe("oa_api_resync");
    expect(audit.rowCount).toBe(1);
    const scope = audit.scope as Record<string, unknown>;
    expect(scope.outcome).toBe("updated");
    expect(scope.vendorId).toBe(VENDOR_ID);
    expect(scope.invoiceId).toBe(INVOICE_ID);
    expect(scope.invoiceNumber).toBe(INVOICE_NUMBER);
    expect(audit.id).toBe(res.body.auditLogId);
  });
});
