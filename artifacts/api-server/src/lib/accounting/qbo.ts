// QuickBooks Online (Intuit) OAuth2 + REST API helpers.
//
// We deliberately keep this module fetch-based with no SDK so it's
// trivially mockable in tests. Intuit's API is stable enough that the
// shapes we need (Customer, Vendor, Invoice) don't churn.
//
// Required env vars (configured via the secrets pane):
//   INTUIT_CLIENT_ID      — OAuth client id from the Intuit developer dashboard
//   INTUIT_CLIENT_SECRET  — OAuth client secret
//   INTUIT_REDIRECT_URI   — Absolute URL of /api/accounting/qbo/callback
//   INTUIT_ENVIRONMENT    — "production" (default) or "sandbox"
//
// All functions throw with a useful message on misconfiguration so the
// caller route can surface a 503.

import { incomeCategoryLabel } from "@workspace/db";
import type {
  IifInvoice,
  IifInvoiceLine,
  IifPartner,
  IifVendor,
} from "../reports/iif";
import type { QbAccount, QbAccountType } from "../reports/qb-mapping";
import type { PushedInvoiceStore } from "./pushedInvoices";
import { inMemoryPushedInvoiceStore } from "./pushedInvoices";

/** Returns the per-line description with a "[1099: <label>]" suffix so the
 *  income category survives the live push into QuickBooks (which has no
 *  dedicated 1099-box field on a SalesItemLine). Mirrors the IIF / QBO CSV
 *  exporters so the same string appears whether the vendor uses the
 *  file-based import or the OAuth push. Skips the suffix for blank /
 *  "none" categories so non-1099 lines stay clean. */
function descriptionWith1099Tag(
  description: string,
  incomeCategory: string | null | undefined,
): string {
  if (!incomeCategory || incomeCategory === "none") return description;
  return `${description} [1099: ${incomeCategoryLabel(incomeCategory)}]`;
}

export interface QboOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "production" | "sandbox";
}

export function loadQboConfig(): QboOAuthConfig {
  const clientId = process.env["INTUIT_CLIENT_ID"];
  const clientSecret = process.env["INTUIT_CLIENT_SECRET"];
  const redirectUri = process.env["INTUIT_REDIRECT_URI"];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "QuickBooks Online integration is not configured. Ask an admin to set INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET, and INTUIT_REDIRECT_URI.",
    );
  }
  const env = (process.env["INTUIT_ENVIRONMENT"] ?? "production").toLowerCase();
  return {
    clientId,
    clientSecret,
    redirectUri,
    environment: env === "sandbox" ? "sandbox" : "production",
  };
}

const SCOPE_ACCOUNTING = "com.intuit.quickbooks.accounting";
const TOKEN_ENDPOINT =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_ENDPOINT =
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export function authorizationUrl(state: string): string {
  const cfg = loadQboConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPE_ACCOUNTING,
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

export interface QboTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  tokenType: string;
}

interface RawTokenJson {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function basicAuth(cfg: QboOAuthConfig): string {
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

export async function exchangeCodeForTokens(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<QboTokenResponse> {
  const cfg = loadQboConfig();
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth(cfg)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Intuit token exchange failed: HTTP ${res.status} ${body}`);
  }
  const j = (await res.json()) as RawTokenJson;
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresInSec: j.expires_in,
    tokenType: j.token_type,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<QboTokenResponse> {
  const cfg = loadQboConfig();
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth(cfg)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Intuit token refresh failed: HTTP ${res.status} ${body}`);
  }
  const j = (await res.json()) as RawTokenJson;
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresInSec: j.expires_in,
    tokenType: j.token_type,
  };
}

export async function revokeToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const cfg = loadQboConfig();
  // Intuit accepts either access_token or refresh_token.
  await fetchImpl(REVOKE_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth(cfg)}`,
    },
    body: JSON.stringify({ token }),
  });
}

// ── Push API ────────────────────────────────────────────────────

function apiBase(env: "production" | "sandbox"): string {
  return env === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

interface QboCreateRef {
  Id: string;
  name?: string;
}

interface QboCustomerCreateResponse {
  Customer?: { Id: string; DisplayName: string };
  Fault?: { Error: Array<{ Message: string; Detail?: string }> };
}

interface QboVendorCreateResponse {
  Vendor?: { Id: string; DisplayName: string };
  Fault?: { Error: Array<{ Message: string; Detail?: string }> };
}

interface QboInvoiceCreateResponse {
  Invoice?: { Id: string; DocNumber?: string };
  Fault?: { Error: Array<{ Message: string; Detail?: string }> };
}

/** A single per-row failure from a push. `kind` + `identifier` is what
 *  the caller uses to filter the bundle on a "retry failed rows" run; the
 *  human-readable text is `${kind} ${identifier}: ${message}`. */
export interface PushWarning {
  kind: "customer" | "vendor" | "invoice";
  identifier: string;
  message: string;
}

interface QboPreferencesResponse {
  Preferences?: {
    TaxPrefs?: {
      UsingSalesTax?: boolean;
      // Intuit's Automated Sales Tax flag — true means QBO will compute
      // tax itself based on the customer/site address.
      PartnerTaxEnabled?: boolean;
      TaxGroupCodeRef?: { value: string };
    };
  };
  Fault?: { Error: Array<{ Message: string; Detail?: string }> };
}

interface QboTaxPrefs {
  /** Sales tax feature is turned on in QBO. */
  usingSalesTax: boolean;
  /** Automated Sales Tax (AST) is enabled — QBO recomputes tax. */
  ast: boolean;
  /**
   * Default tax code id to attach to invoices. For AST companies QBO
   * always exposes the reserved code "TAX" (taxable) / "NON" (non-taxable).
   * For non-AST companies the connected file's chosen default tax group
   * is used; this code is the one tied to the Sales Tax Payable account.
   */
  defaultTaxCodeId: string | null;
}

export interface QboPushResult {
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
  /** DocNumbers (== VNDRLY invoice numbers) of invoices QBO actually
   *  created. Distinct from `invoicesCreated` (a count) and from the
   *  warnings list because some invoices can be created and warned
   *  about at the same time (e.g. tax was non-zero but couldn't be
   *  posted). The reconciler reads these back to verify totals. */
  invoicesPushed: string[];
  /** Customers/vendors that already existed in QBO and were re-used
   *  instead of being created. */
  customersAlreadyExisted: number;
  vendorsAlreadyExisted: number;
  /** Invoices that were already pushed in a previous sync and were
   *  skipped this time. */
  invoicesAlreadyUpToDate: number;
  warnings: PushWarning[];
}

export interface QboPushBundle {
  invoices: IifInvoice[];
  lines: IifInvoiceLine[];
  partners: IifPartner[];
  vendors: IifVendor[];
}

interface PushOpts {
  accessToken: string;
  realmId: string;
  environment?: "production" | "sandbox";
  fetchImpl?: typeof fetch;
  /** Resolved {lineType -> QBO Item.Id} map produced by
   *  `ensureQboItemMap`. When provided, every invoice line uses the real
   *  Item Id from this map (and `defaultItemId` for unknown line types).
   *  When omitted, falls back to the legacy placeholder ItemRef so unit
   *  tests that don't exercise the cache continue to pass. */
  itemMap?: Record<string, string>;
  /** Item Id to use when a line's `lineType` isn't in `itemMap`. Should
   *  be set to the resolved "other" / catch-all Item id from
   *  `ensureQboItemMap`. */
  defaultItemId?: string;
  /** Tracks invoices already pushed to QBO so we don't duplicate them
   *  on a re-run. Defaults to an in-memory store (caller should pass
   *  the DB-backed store in production). */
  pushedInvoiceStore?: PushedInvoiceStore;
}

async function postJson<T>(
  url: string,
  accessToken: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`QBO API ${res.status}: ${txt.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`QBO API ${res.status}: ${txt.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ── Item / Account ensure helpers ───────────────────────────────────

/** Map our internal QbAccountType code to the QBO Account.AccountType
 *  enum string accepted by the v3 API. Only the codes we actually use for
 *  Items (income / other-income) need a precise mapping; the rest are
 *  here for completeness so future callers don't fall off the map. */
function qboAccountType(t: QbAccountType): string {
  switch (t) {
    case "INC":
      return "Income";
    case "EXINC":
      return "Other Income";
    case "AR":
      return "Accounts Receivable";
    case "AP":
      return "Accounts Payable";
    case "OCASSET":
      return "Other Current Asset";
    case "OCLIAB":
      return "Other Current Liability";
    case "EXP":
      return "Expense";
    case "EXEXP":
      return "Other Expense";
    default:
      return "Income";
  }
}

interface QboQueryResponse<T> {
  QueryResponse?: Partial<Record<string, T[]>>;
  Fault?: { Error: Array<{ Message: string; Detail?: string }> };
}

interface QboAccount {
  Id: string;
  Name: string;
  AcctNum?: string;
  AccountType?: string;
}

interface QboItem {
  Id: string;
  Name: string;
  IncomeAccountRef?: { value: string; name?: string };
}

/** Escape a single-quoted literal for a QBO query (`SELECT ... WHERE Name='x'`). */
function qboEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface EnsureOpts {
  accessToken: string;
  realmId: string;
  environment?: "production" | "sandbox";
  fetchImpl?: typeof fetch;
}

/** Find an Account by Name in the connected QBO company, or create it
 *  with the provided `AccountType` / `AccountSubType` / `AcctNum`. The
 *  `created` flag distinguishes "already existed in QBO" from "we just
 *  POSTed it" so callers can surface that to operators (the prepare-items
 *  admin action uses it to label rows as Existing vs Created). */
export async function findOrCreateAccount(
  account: QbAccount,
  opts: EnsureOpts,
): Promise<{ id: string; created: boolean }> {
  const env = opts.environment ?? "production";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `${apiBase(env)}/v3/company/${opts.realmId}`;

  const sql = `SELECT Id, Name, AccountType FROM Account WHERE Name = '${qboEscape(account.name)}'`;
  const queryUrl = `${base}/query?minorversion=70&query=${encodeURIComponent(sql)}`;
  const q = await getJson<QboQueryResponse<QboAccount>>(
    queryUrl,
    opts.accessToken,
    fetchImpl,
  );
  const existing = q.QueryResponse?.Account?.[0];
  if (existing?.Id) return { id: existing.Id, created: false };

  const body: Record<string, unknown> = {
    Name: account.name,
    AccountType: qboAccountType(account.qbType),
  };
  if (account.number) body.AcctNum = account.number;
  const created = await postJson<{
    Account?: { Id: string };
    Fault?: { Error: Array<{ Message: string; Detail?: string }> };
  }>(`${base}/account?minorversion=70`, opts.accessToken, body, fetchImpl);
  if (created.Account?.Id) return { id: created.Account.Id, created: true };
  const f = faultMessage(created.Fault);
  throw new Error(`Could not create QBO account "${account.name}": ${f ?? "unknown error"}`);
}

/** Find a Service Item by Name, or create it pointing at the given
 *  IncomeAccount.Id. Returns the Item.Id and a `created` flag indicating
 *  whether the Item was newly POSTed (true) or already existed (false). */
export async function findOrCreateServiceItem(
  itemName: string,
  incomeAccountId: string,
  opts: EnsureOpts,
): Promise<{ id: string; created: boolean }> {
  const env = opts.environment ?? "production";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `${apiBase(env)}/v3/company/${opts.realmId}`;

  const sql = `SELECT Id, Name, IncomeAccountRef FROM Item WHERE Name = '${qboEscape(itemName)}'`;
  const queryUrl = `${base}/query?minorversion=70&query=${encodeURIComponent(sql)}`;
  const q = await getJson<QboQueryResponse<QboItem>>(
    queryUrl,
    opts.accessToken,
    fetchImpl,
  );
  const existing = q.QueryResponse?.Item?.[0];
  if (existing?.Id) return { id: existing.Id, created: false };

  const body = {
    Name: itemName,
    Type: "Service",
    IncomeAccountRef: { value: incomeAccountId },
  };
  const created = await postJson<{
    Item?: { Id: string };
    Fault?: { Error: Array<{ Message: string; Detail?: string }> };
  }>(`${base}/item?minorversion=70`, opts.accessToken, body, fetchImpl);
  if (created.Item?.Id) return { id: created.Item.Id, created: true };
  const f = faultMessage(created.Fault);
  throw new Error(`Could not create QBO item "${itemName}": ${f ?? "unknown error"}`);
}

/** Map a VNDRLY internal line-type key (e.g. "labor_regular") to the
 *  Product/Service Name we want to use in QuickBooks. We pass the human
 *  account label through verbatim so the QBO admin sees a familiar list
 *  (e.g. "Service Income", "Mileage Income") instead of internal keys. */
export function itemNameForLineType(account: QbAccount): string {
  return account.name;
}

export interface EnsureItemMapInput {
  /** Existing cache from the DB; rows present here will be re-validated
   *  against the desired account and re-created on mismatch. */
  existing: Record<
    string,
    { qboItemId: string; qboAccountId: string | null }
  >;
  /** Line types we want to ensure, with their resolved QbAccount. */
  desired: Array<{ lineType: string; account: QbAccount }>;
  /** Called whenever a line type is freshly resolved (or re-resolved)
   *  so the caller can persist the row to the DB. */
  onResolve?: (entry: {
    lineType: string;
    qboItemId: string;
    qboAccountId: string;
    /** QbAccount.name we just resolved against. Persisted so the
     *  admin-facing item-map view can flag stale rows when the
     *  desired account from `qb_account_mapping` later changes. */
    qboAccountName: string;
  }) => Promise<void> | void;
}

export type EnsureItemEntryStatus = "existing" | "created" | "failed";

export interface EnsureItemEntry {
  /** VNDRLY internal line-type key. */
  lineType: string;
  /**
   * Coarse status surfaced to the prepare-items admin action:
   *  - "existing" — nothing was created in QBO this call (cache hit, or
   *    both the Account and the Item already existed in QBO).
   *  - "created" — at least one of the Account or the Item was newly
   *    POSTed to QBO this call.
   *  - "failed" — the resolve threw; see `message` for the reason.
   */
  status: EnsureItemEntryStatus;
  /** QBO Item.Id we resolved to, when known. Absent on "failed" unless
   *  a stale cached id was kept as a fallback. */
  qboItemId?: string;
  /** QBO Account.Id (IncomeAccountRef) the Item points at, when known. */
  qboAccountId?: string;
  /** Error message when `status === "failed"`. */
  message?: string;
}

export interface EnsureItemMapResult {
  /** lineType -> QBO Item.Id, ready to feed into `pushBundleToQbo`. */
  itemMap: Record<string, string>;
  /** Per-line-type errors that happened during ensure. The push proceeds
   *  with whatever items we did manage to resolve and these are surfaced
   *  in the route's response so the operator can fix the mapping. */
  warnings: Array<{ lineType: string; message: string }>;
  /** Per-line-type structured report — same length and order as
   *  `input.desired`. Used by the "Prepare QuickBooks Items" admin
   *  action to render an existing/created/failed table. */
  entries: EnsureItemEntry[];
}

/** Ensure each desired line type has a QBO Item, creating Account + Item
 *  on first use. Re-uses the supplied cache when the cached account still
 *  matches the desired one. */
export async function ensureQboItemMap(
  input: EnsureItemMapInput,
  opts: EnsureOpts,
): Promise<EnsureItemMapResult> {
  const itemMap: Record<string, string> = {};
  const warnings: Array<{ lineType: string; message: string }> = [];
  const entries: EnsureItemEntry[] = [];

  for (const d of input.desired) {
    try {
      // Always resolve the account first so we can both validate the
      // cached Item still points at the right account AND create new
      // Items with the right IncomeAccountRef.
      const accountResult = await findOrCreateAccount(d.account, opts);
      const accountId = accountResult.id;
      const cached = input.existing[d.lineType];
      if (
        cached &&
        cached.qboAccountId != null &&
        cached.qboAccountId === accountId
      ) {
        itemMap[d.lineType] = cached.qboItemId;
        entries.push({
          lineType: d.lineType,
          status: "existing",
          qboItemId: cached.qboItemId,
          qboAccountId: accountId,
        });
        continue;
      }
      const itemName = itemNameForLineType(d.account);
      const itemResult = await findOrCreateServiceItem(
        itemName,
        accountId,
        opts,
      );
      itemMap[d.lineType] = itemResult.id;
      if (input.onResolve) {
        await input.onResolve({
          lineType: d.lineType,
          qboItemId: itemResult.id,
          qboAccountId: accountId,
          qboAccountName: d.account.name,
        });
      }
      entries.push({
        lineType: d.lineType,
        // "created" iff we actually POSTed a new Account or Item to QBO
        // this call. A fresh cache miss where both the Account and the
        // Item already existed in the connected QBO company shows as
        // "existing" — the operator's intent is "did QBO change?" not
        // "did our cache change?".
        status:
          accountResult.created || itemResult.created ? "created" : "existing",
        qboItemId: itemResult.id,
        qboAccountId: accountId,
      });
    } catch (err) {
      const message = (err as Error).message;
      warnings.push({ lineType: d.lineType, message });
      // If we have any cached Id at all, fall back to it so the push
      // can still proceed instead of skipping every invoice that uses
      // this line type.
      const cached = input.existing[d.lineType];
      if (cached) itemMap[d.lineType] = cached.qboItemId;
      entries.push({
        lineType: d.lineType,
        status: "failed",
        qboItemId: cached?.qboItemId,
        qboAccountId: cached?.qboAccountId ?? undefined,
        message,
      });
    }
  }

  return { itemMap, warnings, entries };
}

function faultMessage(
  fault: { Error: Array<{ Message: string; Detail?: string }> } | undefined,
): string | null {
  if (!fault) return null;
  const e = fault.Error?.[0];
  if (!e) return "Unknown QBO fault";
  return `${e.Message}${e.Detail ? `: ${e.Detail}` : ""}`;
}

/**
 * Fetch the connected company's sales-tax preferences. We use this to
 * decide whether to attach a TxnTaxDetail block (and which tax code to
 * reference) when posting invoices, instead of folding tax into the
 * line Amount and overstating revenue.
 *
 * Returns null when sales tax is unconfigured or the call fails — the
 * caller should warn and skip the tax block in that case.
 */
async function fetchTaxPrefs(
  base: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<QboTaxPrefs | null> {
  try {
    const r = await getJson<QboPreferencesResponse>(
      `${base}/preferences?minorversion=70`,
      accessToken,
      fetchImpl,
    );
    if (faultMessage(r.Fault)) return null;
    const tp = r.Preferences?.TaxPrefs;
    if (!tp || !tp.UsingSalesTax) {
      return { usingSalesTax: false, ast: false, defaultTaxCodeId: null };
    }
    const ast = tp.PartnerTaxEnabled === true;
    // Prefer the explicitly-configured default tax code. Fall back to
    // QBO's reserved "TAX" code, which AST companies always expose.
    const defaultTaxCodeId = tp.TaxGroupCodeRef?.value ?? (ast ? "TAX" : null);
    return { usingSalesTax: true, ast, defaultTaxCodeId };
  } catch {
    return null;
  }
}

/** Find a Customer in QBO by exact DisplayName. Returns the Id when
 *  one exists, null otherwise. Throws on transport errors. */
async function findCustomerIdByName(
  base: string,
  accessToken: string,
  name: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const q = `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${qboEscape(name)}'`;
  const url = `${base}/query?minorversion=70&query=${encodeURIComponent(q)}`;
  const r = await getJson<QboQueryResponse<{ Id: string; DisplayName: string }>>(
    url,
    accessToken,
    fetchImpl,
  );
  const fault = faultMessage(r.Fault);
  if (fault) throw new Error(fault);
  const hit = r.QueryResponse?.Customer?.[0];
  return hit ? hit.Id : null;
}

/** Find a Vendor in QBO by exact DisplayName. */
async function findVendorIdByName(
  base: string,
  accessToken: string,
  name: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const q = `SELECT Id, DisplayName FROM Vendor WHERE DisplayName = '${qboEscape(name)}'`;
  const url = `${base}/query?minorversion=70&query=${encodeURIComponent(q)}`;
  const r = await getJson<QboQueryResponse<{ Id: string; DisplayName: string }>>(
    url,
    accessToken,
    fetchImpl,
  );
  const fault = faultMessage(r.Fault);
  if (fault) throw new Error(fault);
  const hit = r.QueryResponse?.Vendor?.[0];
  return hit ? hit.Id : null;
}

export async function pushBundleToQbo(
  bundle: QboPushBundle,
  opts: PushOpts,
): Promise<QboPushResult> {
  const env = opts.environment ?? "production";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `${apiBase(env)}/v3/company/${opts.realmId}`;
  const store = opts.pushedInvoiceStore ?? inMemoryPushedInvoiceStore();
  const result: QboPushResult = {
    customersCreated: 0,
    vendorsCreated: 0,
    invoicesCreated: 0,
    invoicesPushed: [],
    customersAlreadyExisted: 0,
    vendorsAlreadyExisted: 0,
    invoicesAlreadyUpToDate: 0,
    warnings: [],
  };

  // Customers: GET-by-DisplayName first so a re-run reuses the existing
  // QBO Id instead of POSTing and tripping QBO's "Duplicate Name Exists
  // Error". Without this the second sync would skip every invoice
  // because customerByName would never get populated.
  const customerByName = new Map<string, QboCreateRef>();
  for (const p of bundle.partners) {
    try {
      const existingId = await findCustomerIdByName(
        base,
        opts.accessToken,
        p.name,
        fetchImpl,
      );
      if (existingId) {
        customerByName.set(p.name, { Id: existingId, name: p.name });
        result.customersAlreadyExisted += 1;
        continue;
      }
    } catch (err) {
      result.warnings.push({
        kind: "customer",
        identifier: p.name,
        message: `lookup: ${(err as Error).message}`,
      });
      // Fall through to attempt the POST anyway — worst case QBO
      // returns Duplicate Name and we collect a warning.
    }
    const body: Record<string, unknown> = { DisplayName: p.name };
    if (p.email) body.PrimaryEmailAddr = { Address: p.email };
    if (p.address) body.BillAddr = { Line1: p.address };
    try {
      const r = await postJson<QboCustomerCreateResponse>(
        `${base}/customer?minorversion=70`,
        opts.accessToken,
        body,
        fetchImpl,
      );
      const fault = faultMessage(r.Fault);
      if (fault) {
        result.warnings.push({
          kind: "customer",
          identifier: p.name,
          message: fault,
        });
      } else if (r.Customer) {
        customerByName.set(p.name, { Id: r.Customer.Id, name: p.name });
        result.customersCreated += 1;
      }
    } catch (err) {
      result.warnings.push({
        kind: "customer",
        identifier: p.name,
        message: (err as Error).message,
      });
    }
  }

  for (const v of bundle.vendors) {
    try {
      const existingId = await findVendorIdByName(
        base,
        opts.accessToken,
        v.name,
        fetchImpl,
      );
      if (existingId) {
        result.vendorsAlreadyExisted += 1;
        continue;
      }
    } catch (err) {
      result.warnings.push({
        kind: "vendor",
        identifier: v.name,
        message: `lookup: ${(err as Error).message}`,
      });
    }
    const body: Record<string, unknown> = { DisplayName: v.name };
    if (v.email) body.PrimaryEmailAddr = { Address: v.email };
    if (v.address) body.BillAddr = { Line1: v.address };
    if (v.federalTaxId) body.TaxIdentifier = v.federalTaxId;
    try {
      const r = await postJson<QboVendorCreateResponse>(
        `${base}/vendor?minorversion=70`,
        opts.accessToken,
        body,
        fetchImpl,
      );
      const fault = faultMessage(r.Fault);
      if (fault) {
        result.warnings.push({
          kind: "vendor",
          identifier: v.name,
          message: fault,
        });
      } else if (r.Vendor) {
        result.vendorsCreated += 1;
      }
    } catch (err) {
      result.warnings.push({
        kind: "vendor",
        identifier: v.name,
        message: (err as Error).message,
      });
    }
  }

  // Group lines by invoice for the invoice POST loop.
  const linesByInv = new Map<string, IifInvoiceLine[]>();
  for (const l of bundle.lines) {
    const arr = linesByInv.get(l.invoiceNumber) ?? [];
    arr.push(l);
    linesByInv.set(l.invoiceNumber, arr);
  }

  // Pull the company's sales-tax preferences once. Without these we can't
  // safely attach a TxnTaxDetail block, so any tax dollars on invoices
  // would otherwise have to be either dropped or folded into the line
  // amount (the bug we're fixing). When prefs are unavailable we now warn
  // explicitly per invoice instead of silently overstating revenue.
  const taxPrefs = bundle.invoices.some(
    (i) => Number(i.taxTotal) !== 0,
  )
    ? await fetchTaxPrefs(base, opts.accessToken, fetchImpl)
    : null;

  for (const inv of bundle.invoices) {
    // Skip invoices we have already pushed in a previous sync — the
    // mapping table is the source of truth for "is this DocNumber
    // already in the remote".
    if (store.has(inv.invoiceNumber)) {
      result.invoicesAlreadyUpToDate += 1;
      continue;
    }
    const customerRef = customerByName.get(inv.partnerName);
    if (!customerRef) {
      result.warnings.push({
        kind: "invoice",
        identifier: inv.invoiceNumber,
        message: `customer "${inv.partnerName}" not created — skipped`,
      });
      continue;
    }
    const ls = linesByInv.get(inv.invoiceNumber) ?? [];
    const built = buildQboInvoiceBody({
      inv,
      lines: ls,
      customerId: customerRef.Id,
      taxPrefs,
      itemMap: opts.itemMap,
      defaultItemId: opts.defaultItemId,
    });
    if (built.taxWarningMessage) {
      result.warnings.push({
        kind: "invoice",
        identifier: inv.invoiceNumber,
        message: built.taxWarningMessage,
      });
    }
    const body = built.body;

    try {
      const r = await postJson<QboInvoiceCreateResponse>(
        `${base}/invoice?minorversion=70`,
        opts.accessToken,
        body,
        fetchImpl,
      );
      const fault = faultMessage(r.Fault);
      if (fault) {
        result.warnings.push({
          kind: "invoice",
          identifier: inv.invoiceNumber,
          message: fault,
        });
      } else if (r.Invoice) {
        result.invoicesCreated += 1;
        result.invoicesPushed.push(inv.invoiceNumber);
        await store.record({
          invoiceNumber: inv.invoiceNumber,
          externalInvoiceId: r.Invoice.Id ?? null,
          externalDocNumber: r.Invoice.DocNumber ?? inv.invoiceNumber,
        });
      }
    } catch (err) {
      result.warnings.push({
        kind: "invoice",
        identifier: inv.invoiceNumber,
        message: (err as Error).message,
      });
    }
  }

  return result;
}

// ── Shared invoice-body builder ─────────────────────────────────
//
// Both `pushBundleToQbo` (initial create) and `updateQboInvoice`
// (per-invoice re-sync) must produce the exact same QBO Invoice JSON
// shape — otherwise a re-sync would silently overwrite a previously-
// correct invoice with a different layout (e.g. losing TxnTaxDetail or
// switching DetailType). Centralizing the builder keeps the two call
// sites in lockstep.

interface BuildInvoiceBodyInput {
  inv: IifInvoice;
  lines: IifInvoiceLine[];
  customerId: string;
  taxPrefs: QboTaxPrefs | null;
  itemMap?: Record<string, string>;
  defaultItemId?: string;
}

interface BuiltInvoiceBody {
  body: Record<string, unknown>;
  /** Human-readable warning message when the invoice carries tax dollars
   *  that we couldn't safely post. The caller decides where to surface
   *  it (a push warning, a re-sync response, etc). null when no warning. */
  taxWarningMessage: string | null;
}

function buildQboInvoiceBody(input: BuildInvoiceBodyInput): BuiltInvoiceBody {
  const { inv, lines: ls, customerId, taxPrefs, itemMap, defaultItemId } = input;

  // Sum the per-line tax. Use this (not inv.taxTotal) to keep the
  // invoice internally consistent with the lines we're sending.
  const lineTaxSum = ls.reduce(
    (sum, l) => sum + Number(l.taxAmount || 0),
    0,
  );
  const taxTotal = ls.length > 0 ? lineTaxSum : Number(inv.taxTotal || 0);
  const taxCodeId = taxPrefs?.defaultTaxCodeId ?? null;
  const canPostTax =
    taxTotal > 0 && taxPrefs?.usingSalesTax === true && taxCodeId !== null;

  let taxWarningMessage: string | null = null;
  if (taxTotal > 0 && !canPostTax) {
    const reason = !taxPrefs
      ? "could not load QuickBooks tax preferences"
      : !taxPrefs.usingSalesTax
        ? "sales tax is disabled in QuickBooks"
        : "no default sales tax code is configured in QuickBooks";
    taxWarningMessage = `tax of ${taxTotal.toFixed(
      2,
    )} not posted (${reason}). Configure sales tax in QuickBooks and re-push.`;
  }

  const itemRefFor = (lineType: string): { value: string; name?: string } => {
    if (itemMap && itemMap[lineType]) {
      return { value: itemMap[lineType] };
    }
    if (defaultItemId) {
      return { value: defaultItemId, name: lineType };
    }
    return { name: lineType, value: "1" };
  };

  const lines = ls.length > 0
    ? ls.map((l) => {
        const lineHasTax = Number(l.taxAmount || 0) > 0;
        const detail: Record<string, unknown> = {
          ItemRef: itemRefFor(l.lineType),
        };
        if (canPostTax) {
          detail.TaxCodeRef = {
            value: lineHasTax ? taxCodeId : "NON",
          };
        }
        return {
          DetailType: "SalesItemLineDetail",
          Amount: Number(l.amount),
          // Tag the per-line description with the 1099 income category so
          // a vendor connected via OAuth gets the same year-end
          // auditability as the file-based IIF / QBO CSV exports. QBO has
          // no native 1099 box on a SalesItemLine, so the bracket suffix
          // is the durable place to land it.
          Description: descriptionWith1099Tag(l.description, l.incomeCategory),
          SalesItemLineDetail: detail,
        };
      })
    : [
        {
          DetailType: "SalesItemLineDetail",
          Amount: Number(inv.subtotal ?? inv.total),
          Description: inv.memo ?? "Service",
          SalesItemLineDetail: {
            ItemRef: itemRefFor("other"),
            ...(canPostTax ? { TaxCodeRef: { value: taxCodeId } } : {}),
          },
        },
      ];

  const body: Record<string, unknown> = {
    DocNumber: inv.invoiceNumber,
    TxnDate: inv.invoiceDate.toISOString().slice(0, 10),
    CustomerRef: { value: customerId },
    Line: lines,
  };
  if (canPostTax) {
    body.GlobalTaxCalculation = "TaxExcluded";
    body.TxnTaxDetail = {
      TxnTaxCodeRef: { value: taxCodeId },
      TotalTax: Number(taxTotal.toFixed(2)),
    };
  }
  if (inv.dueDate) body.DueDate = inv.dueDate.toISOString().slice(0, 10);
  if (inv.memo) body.PrivateNote = inv.memo;
  return { body, taxWarningMessage };
}

// ── Per-invoice sparse update ───────────────────────────────────
//
// Used by the per-invoice "Re-sync" admin action: takes the freshly
// rebuilt invoice body and overwrites the existing remote invoice in
// place via QBO's sparse-update endpoint, keyed by the stored
// external_invoice_id.
//
// Sparse update is the right tool because:
//   * we keep the same Id (no duplicate DocNumber),
//   * we don't need to enumerate every field — only ones we send are
//     overwritten, others are preserved (e.g. payment links, attached
//     documents),
//   * QBO rejects the request if SyncToken is stale, which protects
//     against losing in-flight edits.

export interface UpdateQboInvoiceOpts {
  accessToken: string;
  realmId: string;
  externalInvoiceId: string;
  /** Single-invoice bundle: must contain exactly one invoice entry plus
   *  its lines, the customer partner, and (optionally) its vendor. */
  bundle: QboPushBundle;
  itemMap?: Record<string, string>;
  defaultItemId?: string;
  environment?: "production" | "sandbox";
  fetchImpl?: typeof fetch;
}

export type UpdateQboInvoiceResult =
  | {
      status: "updated";
      externalInvoiceId: string;
      externalDocNumber: string | null;
      /** Tax-dollar warning the body builder produced, when applicable. */
      warning: string | null;
    }
  | {
      status: "missing";
      /** Diagnostic message; the caller surfaces this to the user as
       *  "the remote invoice no longer exists; please re-push". */
      message: string;
    };

interface QboInvoiceReadResponse {
  Invoice?: {
    Id: string;
    SyncToken: string;
    DocNumber?: string;
  };
  Fault?: { Error: Array<{ Message: string; Detail?: string; code?: string }> };
}

/** Recognize QBO's "Object Not Found" response — code 610 inside the
 *  Fault payload, returned with HTTP 200 not 404 even when the Id is
 *  unknown. We treat both shapes the same: the remote invoice has been
 *  deleted and the operator must do a fresh push instead. */
function isQboObjectNotFound(fault: QboInvoiceReadResponse["Fault"]): boolean {
  if (!fault) return false;
  return (fault.Error ?? []).some(
    (e) =>
      String(e.code ?? "") === "610" ||
      /Object Not Found/i.test(e.Message ?? ""),
  );
}

export async function updateQboInvoice(
  opts: UpdateQboInvoiceOpts,
): Promise<UpdateQboInvoiceResult> {
  const env = opts.environment ?? "production";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `${apiBase(env)}/v3/company/${opts.realmId}`;
  const inv = opts.bundle.invoices[0];
  if (!inv) {
    throw new Error("updateQboInvoice: bundle must contain one invoice");
  }

  // Step 1 — fetch the current SyncToken. QBO rejects sparse updates
  // without it, and the GET also tells us whether the remote invoice
  // still exists at all (404 / Fault 610 → operator deleted it).
  let read: QboInvoiceReadResponse;
  try {
    read = await getJson<QboInvoiceReadResponse>(
      `${base}/invoice/${encodeURIComponent(opts.externalInvoiceId)}?minorversion=70`,
      opts.accessToken,
      fetchImpl,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (/QBO API 404/.test(msg) || /QBO API 410/.test(msg)) {
      return {
        status: "missing",
        message:
          `The QuickBooks invoice (Id ${opts.externalInvoiceId}) no longer exists. ` +
          `It may have been deleted in QuickBooks — push it again to re-create it.`,
      };
    }
    throw err;
  }
  if (isQboObjectNotFound(read.Fault)) {
    return {
      status: "missing",
      message:
        `The QuickBooks invoice (Id ${opts.externalInvoiceId}) no longer exists. ` +
        `It may have been deleted in QuickBooks — push it again to re-create it.`,
    };
  }
  const fault = faultMessage(read.Fault);
  if (fault) throw new Error(`QBO read invoice: ${fault}`);
  const existing = read.Invoice;
  if (!existing?.SyncToken) {
    throw new Error(
      `QBO read invoice: response missing SyncToken for Id ${opts.externalInvoiceId}`,
    );
  }

  // Step 2 — re-resolve the customer by name so a renamed/changed
  // partner still binds to the right CustomerRef on update.
  const customerId = await findCustomerIdByName(
    base,
    opts.accessToken,
    inv.partnerName,
    fetchImpl,
  );
  if (!customerId) {
    throw new Error(
      `QBO customer "${inv.partnerName}" not found — create it before re-syncing.`,
    );
  }

  // Step 3 — rebuild the body (identical shape to initial push) and
  // tack on Id + SyncToken + sparse for the update.
  const taxPrefs =
    Number(inv.taxTotal || 0) !== 0
      ? await fetchTaxPrefs(base, opts.accessToken, fetchImpl)
      : null;
  const built = buildQboInvoiceBody({
    inv,
    lines: opts.bundle.lines,
    customerId,
    taxPrefs,
    itemMap: opts.itemMap,
    defaultItemId: opts.defaultItemId,
  });
  const body: Record<string, unknown> = {
    ...built.body,
    Id: existing.Id,
    SyncToken: existing.SyncToken,
    sparse: true,
  };

  let updated: QboInvoiceCreateResponse;
  try {
    updated = await postJson<QboInvoiceCreateResponse>(
      `${base}/invoice?operation=update&minorversion=70`,
      opts.accessToken,
      body,
      fetchImpl,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (/QBO API 404/.test(msg) || /QBO API 410/.test(msg)) {
      return {
        status: "missing",
        message:
          `The QuickBooks invoice (Id ${opts.externalInvoiceId}) was deleted between read and write. ` +
          `Push the invoice again to re-create it.`,
      };
    }
    throw err;
  }
  if (isQboObjectNotFound(updated.Fault)) {
    return {
      status: "missing",
      message:
        `The QuickBooks invoice (Id ${opts.externalInvoiceId}) was deleted between read and write. ` +
        `Push the invoice again to re-create it.`,
    };
  }
  const updateFault = faultMessage(updated.Fault);
  if (updateFault) throw new Error(`QBO update invoice: ${updateFault}`);

  return {
    status: "updated",
    externalInvoiceId: updated.Invoice?.Id ?? existing.Id,
    externalDocNumber: updated.Invoice?.DocNumber ?? null,
    warning: built.taxWarningMessage,
  };
}

// ── Reconciliation ──────────────────────────────────────────────
//
// After a successful push, we read the just-created invoices back from
// QBO and compare totals + per-state tax to what VNDRLY posted. This
// catches silent drift if a future code change lets QBO recompute tax
// (missing GlobalTaxCalculation, AST-induced rate change, rounding, or
// tax-code mismatch). Mismatches surface as invoice-kind warnings on
// the export-history record, alongside any push-time warnings.

/** What VNDRLY posted for one invoice. The reconciler compares each
 *  field against what QBO actually stored. `expectedTaxByState` is
 *  optional — when absent, only invoice-level totals are reconciled. */
export interface ReconcileExpectation {
  invoiceNumber: string;
  expectedTotal: number;
  expectedTax: number;
  /** Per-state tax breakdown for this invoice (should sum to expectedTax).
   *  Used to apportion QBO's invoice-level TotalTax across states for the
   *  aggregate per-state check. */
  expectedTaxByState?: Record<string, number>;
}

export interface ReconcileOpts {
  accessToken: string;
  realmId: string;
  environment?: "production" | "sandbox";
  fetchImpl?: typeof fetch;
  /** Dollar tolerance for matches; default $0.01 (one cent). */
  tolerance?: number;
  /** Expected aggregate per-state tax across all invoices, e.g. from
   *  VNDRLY's Sales-Tax-by-State report. Compared against the QBO totals
   *  apportioned via per-invoice expectedTaxByState. */
  expectedTaxByState?: Record<string, number>;
}

interface QboInvoiceQueryResponse {
  QueryResponse?: {
    Invoice?: Array<{
      Id: string;
      DocNumber?: string;
      TotalAmt?: number;
      TxnTaxDetail?: { TotalTax?: number };
    }>;
  };
  Fault?: { Error: Array<{ Message: string; Detail?: string }> };
}

/** Escape a DocNumber for inclusion in a single-quoted SQL-like literal.
 *  QBO's query API uses single quotes; we double them per ANSI SQL. */
function escapeQboLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

/** Fetch a batch of invoices from QBO by DocNumber. Returns the raw
 *  invoice records — caller is responsible for matching them back to
 *  expectations and emitting warnings. */
async function queryInvoicesByDocNumber(
  base: string,
  accessToken: string,
  docNumbers: string[],
  fetchImpl: typeof fetch,
): Promise<NonNullable<QboInvoiceQueryResponse["QueryResponse"]>["Invoice"]> {
  if (docNumbers.length === 0) return [];
  const inList = docNumbers.map((n) => `'${escapeQboLiteral(n)}'`).join(", ");
  const sql = `SELECT Id, DocNumber, TotalAmt, TxnTaxDetail FROM Invoice WHERE DocNumber IN (${inList})`;
  const url = `${base}/query?minorversion=70&query=${encodeURIComponent(sql)}`;
  const r = await getJson<QboInvoiceQueryResponse>(url, accessToken, fetchImpl);
  const fault = faultMessage(r.Fault);
  if (fault) throw new Error(fault);
  return r.QueryResponse?.Invoice ?? [];
}

/** Read the just-pushed invoices back from QBO and emit warnings for any
 *  mismatch in invoice-level total or tax, and (when per-state ratios are
 *  provided) for any mismatch in aggregate per-state tax against
 *  `expectedTaxByState`. Returns an empty array on a clean reconciliation.
 *
 *  This function is intentionally fail-soft: if the QBO query itself
 *  fails (network, auth, fault), it returns a single invoice-kind
 *  warning under identifier "(reconciliation)" rather than throwing.
 *  Reconciliation is a check, not a gate. */
export async function reconcileQboInvoices(
  expectations: ReconcileExpectation[],
  opts: ReconcileOpts,
): Promise<PushWarning[]> {
  if (expectations.length === 0) return [];
  const env = opts.environment ?? "production";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `${apiBase(env)}/v3/company/${opts.realmId}`;
  const tol = opts.tolerance ?? 0.01;

  // Batch queries — QBO's IN list is limited and very long URLs are
  // rejected by some intermediaries. 50 per batch is comfortably within
  // documented limits.
  const BATCH = 50;
  const fetched: NonNullable<
    QboInvoiceQueryResponse["QueryResponse"]
  >["Invoice"] = [];
  try {
    for (let i = 0; i < expectations.length; i += BATCH) {
      const chunk = expectations.slice(i, i + BATCH).map((e) => e.invoiceNumber);
      const rows = await queryInvoicesByDocNumber(
        base,
        opts.accessToken,
        chunk,
        fetchImpl,
      );
      if (rows) fetched.push(...rows);
    }
  } catch (err) {
    return [
      {
        kind: "invoice",
        identifier: "(reconciliation)",
        message: `could not read invoices back from QuickBooks for reconciliation: ${
          (err as Error).message
        }`,
      },
    ];
  }

  const warnings: PushWarning[] = [];
  const byDoc = new Map<string, { total: number; tax: number }>();
  for (const inv of fetched ?? []) {
    if (!inv.DocNumber) continue;
    byDoc.set(inv.DocNumber, {
      total: Number(inv.TotalAmt ?? 0),
      tax: Number(inv.TxnTaxDetail?.TotalTax ?? 0),
    });
  }

  // Per-invoice comparison. We also build the per-state QBO aggregate
  // here, apportioning each invoice's QBO TotalTax via the VNDRLY
  // expectedTaxByState ratios (single-state invoices: 100% to that
  // state; multi-state: proportional).
  const qboByState: Record<string, number> = {};
  for (const exp of expectations) {
    const got = byDoc.get(exp.invoiceNumber);
    if (!got) {
      warnings.push({
        kind: "invoice",
        identifier: exp.invoiceNumber,
        message:
          "reconciliation: invoice was reported as created but could not be found in QuickBooks",
      });
      continue;
    }
    if (Math.abs(got.total - exp.expectedTotal) > tol) {
      warnings.push({
        kind: "invoice",
        identifier: exp.invoiceNumber,
        message: `reconciliation: QuickBooks total ${got.total.toFixed(
          2,
        )} does not match posted total ${exp.expectedTotal.toFixed(2)}`,
      });
    }
    if (Math.abs(got.tax - exp.expectedTax) > tol) {
      warnings.push({
        kind: "invoice",
        identifier: exp.invoiceNumber,
        message: `reconciliation: QuickBooks tax ${got.tax.toFixed(
          2,
        )} does not match posted tax ${exp.expectedTax.toFixed(2)}`,
      });
    }

    // Apportion QBO's invoice tax to states using VNDRLY's per-state
    // ratios for this invoice. If we have no per-state breakdown for
    // this invoice we can't attribute it; skip the apportionment but
    // still let the aggregate check below run on whatever we do have.
    const breakdown = exp.expectedTaxByState;
    if (breakdown) {
      const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (const [state, stateTax] of Object.entries(breakdown)) {
          const apportioned = (got.tax * stateTax) / sum;
          qboByState[state] = (qboByState[state] ?? 0) + apportioned;
        }
      } else if (got.tax !== 0) {
        // VNDRLY reported zero tax for every state but QBO has tax —
        // surface that as an unattributable per-invoice mismatch (the
        // tax-mismatch warning above already covered it, so don't
        // double-warn here).
      }
    }
  }

  // Aggregate per-state comparison.
  if (opts.expectedTaxByState) {
    const states = new Set<string>([
      ...Object.keys(opts.expectedTaxByState),
      ...Object.keys(qboByState),
    ]);
    for (const state of states) {
      const expected = Number(opts.expectedTaxByState[state] ?? 0);
      const actual = Number(qboByState[state] ?? 0);
      if (Math.abs(actual - expected) > tol) {
        warnings.push({
          kind: "invoice",
          identifier: `(state:${state})`,
          message: `reconciliation: QuickBooks tax for ${state} totals ${actual.toFixed(
            2,
          )} but VNDRLY's Sales-Tax-by-State report shows ${expected.toFixed(2)}`,
        });
      }
    }
  }

  return warnings;
}
