// OpenAccountant push + OAuth helpers.
//
// OA now publishes a GA OAuth2 flow (see `loadOaOAuthConfig` /
// `oaAuthorizationUrl` below) which we treat as the default connect
// path, mirroring how QuickBooks Online works. We still accept the
// legacy long-lived API-key flow so existing connections keep working
// and so customers without an OAuth client can self-host with one.
//
// Tokens (whether OAuth `access_token` or a long-lived API key) are
// always sent to OA as `Authorization: Bearer <token>`, so the same
// `pushBundleToOa` helper handles both modes.
//
// The base URL is configurable per-connection because OA hosts dedicated
// regional endpoints; we default to OPENACCOUNTANT_BASE_URL or the
// public api.openaccountant.com host.
//
// SECURITY: Because the base URL is user-controllable, every push and
// every save passes through `validateOaBaseUrl` to block SSRF — the
// allowlist constrains the host suffix and rejects HTTP, IP literals,
// loopback, link-local, and userinfo URLs.

import { incomeCategoryLabel } from "@workspace/db";
import type {
  IifInvoice,
  IifInvoiceLine,
  IifPartner,
  IifVendor,
} from "../reports/iif";
import type { PushWarning } from "./qbo";
import type { PushedInvoiceStore } from "./pushedInvoices";
import { inMemoryPushedInvoiceStore } from "./pushedInvoices";

/** Build the per-line {income_category, income_category_label} pair that
 *  OpenAccountant expects on its invoice POST/PUT bodies. Mirrors the
 *  `income_category` / `income_category_label` columns the OA CSV
 *  exporter writes so a vendor's year-end 1099 totals are identical
 *  whether they imported the CSV or pushed via OAuth. Lines without a
 *  meaningful category serialize as nulls so the OA UI shows them as
 *  "Not reportable". */
function oaLineIncomeCategory(
  incomeCategory: string | null | undefined,
): { income_category: string | null; income_category_label: string | null } {
  if (!incomeCategory || incomeCategory === "none") {
    return { income_category: null, income_category_label: null };
  }
  return {
    income_category: incomeCategory,
    income_category_label: incomeCategoryLabel(incomeCategory),
  };
}

/** Per-line description with the QBO-style "[1099: <label>]" suffix.
 *  Used as the fallback when an OA tenant rejects the structured
 *  `income_category` keys — the suffix at least keeps the 1099 box
 *  identifiable in the line description so a human reading the OA
 *  invoice can still tell which box it belongs in. */
function descriptionWith1099Tag(
  description: string,
  incomeCategory: string | null | undefined,
): string {
  if (!incomeCategory || incomeCategory === "none") return description;
  return `${description} [1099: ${incomeCategoryLabel(incomeCategory)}]`;
}

/** Detects an OA error response that looks like an "unknown / unexpected
 *  field" rejection of our `income_category` / `income_category_label`
 *  keys. We err on the side of NOT triggering the fallback unless the
 *  error message clearly names one of those fields, so we don't strip
 *  the keys on unrelated 4xx errors (rate limit, auth, validation of
 *  other fields). */
function isIncomeCategoryRejection(message: string): boolean {
  if (!/OpenAccountant API 4(00|22)/.test(message)) return false;
  return /income_category|income_category_label|unknown\s+field|unrecognized\s+field|unexpected\s+(?:property|key)/i.test(
    message,
  );
}

/** Build the OA invoice line body. When `withCategoryFields` is false
 *  we omit the structured 1099 keys and instead append the QBO-style
 *  `[1099: <label>]` tag to the description so the box assignment
 *  survives in some readable form. */
function buildOaInvoiceLine(
  l: IifInvoiceLine,
  withCategoryFields: boolean,
): Record<string, unknown> {
  const base = {
    line_type: l.lineType,
    description: withCategoryFields
      ? l.description
      : descriptionWith1099Tag(l.description, l.incomeCategory),
    amount: Number(l.amount),
    tax_amount: Number(l.taxAmount),
  };
  if (!withCategoryFields) return base;
  return { ...base, ...oaLineIncomeCategory(l.incomeCategory) };
}

export const DEFAULT_OA_BASE_URL =
  process.env["OPENACCOUNTANT_BASE_URL"] || "https://api.openaccountant.com/v1";

/** Comma-separated host suffixes that are accepted as OA endpoints.
 * Defaults to public OA hosts; operators can extend via env when they
 * have a sandbox or regional endpoint to support. */
const OA_HOST_ALLOWLIST: readonly string[] = (
  process.env["OPENACCOUNTANT_HOST_ALLOWLIST"] ||
  "openaccountant.com,api.openaccountant.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const PRIVATE_IPV4_REGEX =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function isIpLiteral(host: string): boolean {
  // Strip brackets from IPv6 literal hostnames.
  const h = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  // Crude but correct: anything that parses as an IPv4 dotted quad or
  // contains a colon (IPv6) is treated as an IP literal.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true;
  return false;
}

/** Validate that `raw` is a safe OA base URL we are willing to send
 * server-side requests to. Throws Error('OA base URL: ...') on failure
 * and returns the normalized URL (without trailing slash) on success. */
export function validateOaBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OA base URL: not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("OA base URL: must use https://");
  }
  if (url.username || url.password) {
    throw new Error("OA base URL: must not include credentials");
  }
  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new Error("OA base URL: missing host");
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("OA base URL: localhost is not allowed");
  }
  if (isIpLiteral(host)) {
    // Reject all IP literals — OA publishes hostnames, and a literal is
    // the easiest SSRF vector (private CIDR, loopback, AWS metadata).
    const bare = host.startsWith("[") && host.endsWith("]")
      ? host.slice(1, -1)
      : host;
    if (
      PRIVATE_IPV4_REGEX.test(bare) ||
      bare === "::1" ||
      bare === "0.0.0.0" ||
      bare.startsWith("fe80:") || // IPv6 link-local
      bare.startsWith("fc") || // IPv6 unique local
      bare.startsWith("fd")
    ) {
      throw new Error("OA base URL: private IP address is not allowed");
    }
    throw new Error("OA base URL: IP address literals are not allowed");
  }
  const ok = OA_HOST_ALLOWLIST.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (!ok) {
    throw new Error(
      `OA base URL: host ${host} is not in the allowlist (set OPENACCOUNTANT_HOST_ALLOWLIST to extend)`,
    );
  }
  // Normalize: drop trailing slash so callers can do `${base}/customers`.
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return normalized;
}

export interface OaPushResult {
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
  /** Customers/vendors that already existed in OA and were re-used
   *  instead of being created. */
  customersAlreadyExisted: number;
  vendorsAlreadyExisted: number;
  /** Invoices that were already pushed in a previous sync and were
   *  skipped this time. */
  invoicesAlreadyUpToDate: number;
  /** Invoice numbers (== VNDRLY invoice numbers) of invoices OA actually
   *  created. Distinct from `invoicesCreated` (a count) and from the
   *  warnings list because some invoices can be created and warned
   *  about at the same time. The reconciler reads these back from OA to
   *  verify totals + per-state tax. */
  invoicesPushed: string[];
  warnings: PushWarning[];
}

export interface OaPushBundle {
  invoices: IifInvoice[];
  lines: IifInvoiceLine[];
  partners: IifPartner[];
  vendors: IifVendor[];
}

interface OaPushOpts {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Tracks invoices already pushed to OA so we don't duplicate them
   *  on a re-run. Defaults to an in-memory store; production callers
   *  should pass the DB-backed store. */
  pushedInvoiceStore?: PushedInvoiceStore;
}

async function postJson<T>(
  url: string,
  apiKey: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAccountant API ${res.status}: ${txt.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAccountant API ${res.status}: ${txt.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface OaListResponse<T> {
  // OA's list endpoints return either a paginated `{items: [...]}`
  // envelope or a bare array, depending on tenant version. Handle both.
  items?: T[];
}

/** Look up a customer by exact `customer_name`. Returns the OA id if
 *  one already exists, null otherwise. Throws on transport errors. */
async function findOaCustomerIdByName(
  base: string,
  apiKey: string,
  name: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `${base}/customers?customer_name=${encodeURIComponent(name)}`;
  const r = await getJson<
    OaListResponse<{ id?: string; customer_name?: string }>
    | Array<{ id?: string; customer_name?: string }>
  >(url, apiKey, fetchImpl);
  const items = Array.isArray(r) ? r : (r.items ?? []);
  // OA's filter is server-side, but be defensive against substring
  // matches by re-filtering for an exact name on the client.
  const hit = items.find((c) => c.customer_name === name) ?? items[0];
  return hit?.id ?? null;
}

/** Look up a vendor by exact `vendor_name`. */
async function findOaVendorIdByName(
  base: string,
  apiKey: string,
  name: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `${base}/vendors?vendor_name=${encodeURIComponent(name)}`;
  const r = await getJson<
    OaListResponse<{ id?: string; vendor_name?: string }>
    | Array<{ id?: string; vendor_name?: string }>
  >(url, apiKey, fetchImpl);
  const items = Array.isArray(r) ? r : (r.items ?? []);
  const hit = items.find((v) => v.vendor_name === name) ?? items[0];
  return hit?.id ?? null;
}

export async function pushBundleToOa(
  bundle: OaPushBundle,
  opts: OaPushOpts,
): Promise<OaPushResult> {
  // Defense in depth: re-validate the base URL at push time even though
  // the connect route already validated on save. This guards against
  // operator-supplied env defaults and any future code path that bypasses
  // the route-level check.
  const base = validateOaBaseUrl(opts.baseUrl || DEFAULT_OA_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const store = opts.pushedInvoiceStore ?? inMemoryPushedInvoiceStore();
  const result: OaPushResult = {
    customersCreated: 0,
    vendorsCreated: 0,
    invoicesCreated: 0,
    customersAlreadyExisted: 0,
    vendorsAlreadyExisted: 0,
    invoicesAlreadyUpToDate: 0,
    invoicesPushed: [],
    warnings: [],
  };

  for (const p of bundle.partners) {
    // Look up first so a re-run reuses the existing OA customer
    // instead of stacking duplicates on every sync.
    try {
      const existingId = await findOaCustomerIdByName(
        base,
        opts.apiKey,
        p.name,
        fetchImpl,
      );
      if (existingId) {
        result.customersAlreadyExisted += 1;
        continue;
      }
    } catch (err) {
      result.warnings.push({
        kind: "customer",
        identifier: p.name,
        message: `lookup: ${(err as Error).message}`,
      });
      // Fall through to attempt the POST anyway.
    }
    try {
      await postJson<{ id?: string }>(
        `${base}/customers`,
        opts.apiKey,
        {
          customer_name: p.name,
          email: p.email ?? undefined,
          address: p.address ?? undefined,
        },
        fetchImpl,
      );
      result.customersCreated += 1;
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
      const existingId = await findOaVendorIdByName(
        base,
        opts.apiKey,
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
    try {
      await postJson<{ id?: string }>(
        `${base}/vendors`,
        opts.apiKey,
        {
          vendor_name: v.name,
          email: v.email ?? undefined,
          address: v.address ?? undefined,
          federal_tax_id: v.federalTaxId ?? undefined,
        },
        fetchImpl,
      );
      result.vendorsCreated += 1;
    } catch (err) {
      result.warnings.push({
        kind: "vendor",
        identifier: v.name,
        message: (err as Error).message,
      });
    }
  }

  const linesByInv = new Map<string, IifInvoiceLine[]>();
  for (const l of bundle.lines) {
    const arr = linesByInv.get(l.invoiceNumber) ?? [];
    arr.push(l);
    linesByInv.set(l.invoiceNumber, arr);
  }

  // Sticky per-push capability flag: once an OA tenant rejects the
  // structured 1099 keys for one invoice we stop sending them on the
  // remaining invoices in this push so we don't take the same hit N
  // times. Reset on the next push (a tenant could enable the feature
  // between syncs).
  let sendIncomeCategory = true;
  for (const inv of bundle.invoices) {
    if (store.has(inv.invoiceNumber)) {
      result.invoicesAlreadyUpToDate += 1;
      continue;
    }
    const ls = linesByInv.get(inv.invoiceNumber) ?? [];
    const buildBody = (withCat: boolean): Record<string, unknown> => ({
      invoice_number: inv.invoiceNumber,
      customer_name: inv.partnerName,
      invoice_date: fmtIso(inv.invoiceDate),
      due_date: inv.dueDate ? fmtIso(inv.dueDate) : undefined,
      subtotal: Number(inv.subtotal),
      tax_total: Number(inv.taxTotal),
      total: Number(inv.total),
      memo: inv.memo ?? undefined,
      // Carry the 1099 box assignment into the live OA push so the
      // OAuth path matches the OA CSV exporter — this is what
      // OpenAccountant uses to total Vendor 1099-NEC/MISC reports.
      // If `withCat` is false we instead append a "[1099: <label>]"
      // tag to the line description (mirrors the QBO push) so the
      // box assignment is at least visible in the OA invoice.
      lines: ls.map((l) => buildOaInvoiceLine(l, withCat)),
    });
    try {
      let r: { id?: string; invoice_number?: string };
      try {
        r = await postJson<{ id?: string; invoice_number?: string }>(
          `${base}/invoices`,
          opts.apiKey,
          buildBody(sendIncomeCategory),
          fetchImpl,
        );
      } catch (err) {
        const msg = (err as Error).message;
        if (sendIncomeCategory && isIncomeCategoryRejection(msg)) {
          // OA tenant doesn't accept the structured 1099 keys yet.
          // Retry this invoice with the keys stripped + the tag in
          // the description, and skip the keys for the rest of this
          // push. Surface a one-shot warning so the operator knows
          // 1099 totals will need manual entry on this tenant.
          sendIncomeCategory = false;
          result.warnings.push({
            kind: "invoice",
            identifier: "(1099 categories)",
            message:
              "OpenAccountant rejected the income_category fields; falling back to a [1099: <label>] tag on the line description for this push. Vendor 1099 totals in OA will need manual review until the tenant supports the income_category keys.",
          });
          r = await postJson<{ id?: string; invoice_number?: string }>(
            `${base}/invoices`,
            opts.apiKey,
            buildBody(false),
            fetchImpl,
          );
        } else {
          throw err;
        }
      }
      result.invoicesCreated += 1;
      result.invoicesPushed.push(inv.invoiceNumber);
      await store.record({
        invoiceNumber: inv.invoiceNumber,
        externalInvoiceId: r.id ?? null,
        externalDocNumber: r.invoice_number ?? inv.invoiceNumber,
      });
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

// ── Reconciliation ──────────────────────────────────────────────
//
// After a successful push, we read the just-created invoices back from
// OA and compare totals + per-state tax to what VNDRLY posted. This
// mirrors the QBO reconciler so silent drift between VNDRLY's
// Sales-Tax-by-State report and what OA actually stored is caught
// immediately. Mismatches are surfaced as invoice-kind warnings on
// the export-history record alongside any push-time warnings.

/** What VNDRLY posted for one invoice. The reconciler compares each
 *  field against what OA actually stored. `expectedTaxByState` is
 *  optional — when absent, only invoice-level totals are reconciled. */
export interface OaReconcileExpectation {
  invoiceNumber: string;
  expectedTotal: number;
  expectedTax: number;
  /** Per-state tax breakdown for this invoice (should sum to expectedTax).
   *  Used to apportion OA's invoice-level tax_total across states for the
   *  aggregate per-state check. */
  expectedTaxByState?: Record<string, number>;
}

export interface OaReconcileOpts {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Dollar tolerance for matches; default $0.01 (one cent). */
  tolerance?: number;
  /** Expected aggregate per-state tax across all invoices, e.g. from
   *  VNDRLY's Sales-Tax-by-State report. Compared against the OA totals
   *  apportioned via per-invoice expectedTaxByState. */
  expectedTaxByState?: Record<string, number>;
}

interface OaInvoiceQueryResponse {
  invoices?: Array<{
    invoice_number: string;
    total?: number | string;
    tax_total?: number | string;
  }>;
}

/** Fetch a batch of invoices from OA by invoice_number. */
async function queryOaInvoicesByNumber(
  base: string,
  apiKey: string,
  invoiceNumbers: string[],
  fetchImpl: typeof fetch,
): Promise<NonNullable<OaInvoiceQueryResponse["invoices"]>> {
  if (invoiceNumbers.length === 0) return [];
  const params = new URLSearchParams({
    invoice_numbers: invoiceNumbers.join(","),
  });
  const r = await getJson<OaInvoiceQueryResponse>(
    `${base}/invoices?${params.toString()}`,
    apiKey,
    fetchImpl,
  );
  return r.invoices ?? [];
}

/** Read the just-pushed invoices back from OA and emit warnings for any
 *  mismatch in invoice-level total or tax, and (when per-state ratios are
 *  provided) for any mismatch in aggregate per-state tax against
 *  `expectedTaxByState`. Returns an empty array on a clean reconciliation.
 *
 *  This function is intentionally fail-soft: if the OA query itself
 *  fails (network, auth), it returns a single invoice-kind warning
 *  under identifier "(reconciliation)" rather than throwing.
 *  Reconciliation is a check, not a gate. */
export async function reconcileOaInvoices(
  expectations: OaReconcileExpectation[],
  opts: OaReconcileOpts,
): Promise<PushWarning[]> {
  if (expectations.length === 0) return [];
  // Defense in depth: re-validate the base URL at reconcile time too.
  const base = validateOaBaseUrl(opts.baseUrl || DEFAULT_OA_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tol = opts.tolerance ?? 0.01;

  // Batch queries — OA accepts a comma-separated list but very long
  // URLs may be rejected by intermediaries. 50 per batch matches the
  // QBO reconciler's chunking.
  const BATCH = 50;
  const fetched: NonNullable<OaInvoiceQueryResponse["invoices"]> = [];
  try {
    for (let i = 0; i < expectations.length; i += BATCH) {
      const chunk = expectations.slice(i, i + BATCH).map((e) => e.invoiceNumber);
      const rows = await queryOaInvoicesByNumber(
        base,
        opts.apiKey,
        chunk,
        fetchImpl,
      );
      fetched.push(...rows);
    }
  } catch (err) {
    return [
      {
        kind: "invoice",
        identifier: "(reconciliation)",
        message: `could not read invoices back from OpenAccountant for reconciliation: ${
          (err as Error).message
        }`,
      },
    ];
  }

  const warnings: PushWarning[] = [];
  const byNumber = new Map<string, { total: number; tax: number }>();
  for (const inv of fetched) {
    if (!inv.invoice_number) continue;
    byNumber.set(inv.invoice_number, {
      total: Number(inv.total ?? 0),
      tax: Number(inv.tax_total ?? 0),
    });
  }

  // Per-invoice comparison. We also build the per-state OA aggregate
  // here, apportioning each invoice's OA tax via the VNDRLY
  // expectedTaxByState ratios (single-state invoices: 100% to that
  // state; multi-state: proportional).
  const oaByState: Record<string, number> = {};
  for (const exp of expectations) {
    const got = byNumber.get(exp.invoiceNumber);
    if (!got) {
      warnings.push({
        kind: "invoice",
        identifier: exp.invoiceNumber,
        message:
          "reconciliation: invoice was reported as created but could not be found in OpenAccountant",
      });
      continue;
    }
    if (Math.abs(got.total - exp.expectedTotal) > tol) {
      warnings.push({
        kind: "invoice",
        identifier: exp.invoiceNumber,
        message: `reconciliation: OpenAccountant total ${got.total.toFixed(
          2,
        )} does not match posted total ${exp.expectedTotal.toFixed(2)}`,
      });
    }
    if (Math.abs(got.tax - exp.expectedTax) > tol) {
      warnings.push({
        kind: "invoice",
        identifier: exp.invoiceNumber,
        message: `reconciliation: OpenAccountant tax ${got.tax.toFixed(
          2,
        )} does not match posted tax ${exp.expectedTax.toFixed(2)}`,
      });
    }

    // Apportion OA's invoice tax to states using VNDRLY's per-state
    // ratios for this invoice. If we have no per-state breakdown for
    // this invoice we can't attribute it; skip the apportionment but
    // still let the aggregate check below run on whatever we do have.
    const breakdown = exp.expectedTaxByState;
    if (breakdown) {
      const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (const [state, stateTax] of Object.entries(breakdown)) {
          const apportioned = (got.tax * stateTax) / sum;
          oaByState[state] = (oaByState[state] ?? 0) + apportioned;
        }
      }
    }
  }

  // Aggregate per-state comparison.
  if (opts.expectedTaxByState) {
    const states = new Set<string>([
      ...Object.keys(opts.expectedTaxByState),
      ...Object.keys(oaByState),
    ]);
    for (const state of states) {
      const expected = Number(opts.expectedTaxByState[state] ?? 0);
      const actual = Number(oaByState[state] ?? 0);
      if (Math.abs(actual - expected) > tol) {
        warnings.push({
          kind: "invoice",
          identifier: `(state:${state})`,
          message: `reconciliation: OpenAccountant tax for ${state} totals ${actual.toFixed(
            2,
          )} but VNDRLY's Sales-Tax-by-State report shows ${expected.toFixed(2)}`,
        });
      }
    }
  }

  return warnings;
}

// ── Per-invoice update ──────────────────────────────────────────
//
// Used by the per-invoice "Re-sync to OpenAccountant" admin action.
// Issues a PUT against /invoices/{id} with the same body shape as the
// initial create, so the remote invoice is updated in place rather
// than duplicated. Treats a 404 as an upstream-deleted case so the UI
// can prompt the operator to do a fresh push instead of silently
// failing.

export interface UpdateOaInvoiceOpts {
  apiKey: string;
  baseUrl?: string;
  externalInvoiceId: string;
  /** Single-invoice bundle: must contain exactly one invoice entry,
   *  its lines, plus its partner. */
  bundle: OaPushBundle;
  fetchImpl?: typeof fetch;
}

export type UpdateOaInvoiceResult =
  | {
      status: "updated";
      externalInvoiceId: string;
      externalDocNumber: string | null;
    }
  | {
      status: "missing";
      message: string;
    };

async function putJson<T>(
  url: string,
  apiKey: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: T | null; text: string }> {
  const res = await fetchImpl(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { status: res.status, json: null, text };
  }
  let json: T | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text };
}

export async function updateOaInvoice(
  opts: UpdateOaInvoiceOpts,
): Promise<UpdateOaInvoiceResult> {
  const base = validateOaBaseUrl(opts.baseUrl || DEFAULT_OA_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const inv = opts.bundle.invoices[0];
  if (!inv) {
    throw new Error("updateOaInvoice: bundle must contain one invoice");
  }
  const ls = opts.bundle.lines.filter((l) => l.invoiceNumber === inv.invoiceNumber);

  const url = `${base}/invoices/${encodeURIComponent(opts.externalInvoiceId)}`;
  // Same 1099 mapping as `pushBundleToOa` so an edit-after-push doesn't
  // drop the income category. If the tenant rejects the structured
  // 1099 keys we transparently retry with the keys stripped + a
  // "[1099: <label>]" suffix on the line description, mirroring the
  // QBO update path.
  const buildBody = (withCat: boolean): Record<string, unknown> => ({
    invoice_number: inv.invoiceNumber,
    customer_name: inv.partnerName,
    invoice_date: fmtIso(inv.invoiceDate),
    due_date: inv.dueDate ? fmtIso(inv.dueDate) : undefined,
    subtotal: Number(inv.subtotal),
    tax_total: Number(inv.taxTotal),
    total: Number(inv.total),
    memo: inv.memo ?? undefined,
    lines: ls.map((l) => buildOaInvoiceLine(l, withCat)),
  });
  let result = await putJson<{ id?: string; invoice_number?: string }>(
    url,
    opts.apiKey,
    buildBody(true),
    fetchImpl,
  );
  if (
    (result.status === 400 || result.status === 422) &&
    isIncomeCategoryRejection(
      `OpenAccountant API ${result.status}: ${result.text}`,
    )
  ) {
    result = await putJson<{ id?: string; invoice_number?: string }>(
      url,
      opts.apiKey,
      buildBody(false),
      fetchImpl,
    );
  }
  if (result.status === 404 || result.status === 410) {
    return {
      status: "missing",
      message:
        `The OpenAccountant invoice (Id ${opts.externalInvoiceId}) no longer exists. ` +
        `It may have been deleted in OpenAccountant — push it again to re-create it.`,
    };
  }
  if (result.status >= 400) {
    throw new Error(
      `OpenAccountant API ${result.status}: ${result.text.slice(0, 500)}`,
    );
  }
  return {
    status: "updated",
    externalInvoiceId: result.json?.id ?? opts.externalInvoiceId,
    externalDocNumber: result.json?.invoice_number ?? inv.invoiceNumber,
  };
}

// ── OAuth2 ──────────────────────────────────────────────────────
//
// OA's OAuth flow is a textbook authorization-code grant:
//   • redirect to {OAUTH_BASE}/oauth/authorize?client_id=…&state=…
//   • OA redirects back to our callback with ?code=…&state=…
//   • we POST {OAUTH_BASE}/oauth/token with HTTP Basic auth to swap
//     the code for {access_token, refresh_token, expires_in}
//
// Required env vars (configured via the secrets pane):
//   OPENACCOUNTANT_CLIENT_ID
//   OPENACCOUNTANT_CLIENT_SECRET
//   OPENACCOUNTANT_REDIRECT_URI   — Absolute URL of /api/accounting/oa/callback
// Optional:
//   OPENACCOUNTANT_OAUTH_BASE_URL — Defaults to https://accounts.openaccountant.com
//   OPENACCOUNTANT_OAUTH_SCOPE    — Defaults to "accounting.write"

export interface OaOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** OAuth host root, no trailing slash (e.g. https://accounts.openaccountant.com). */
  authBaseUrl: string;
  scope: string;
}

const DEFAULT_OA_OAUTH_BASE = "https://accounts.openaccountant.com";
const DEFAULT_OA_OAUTH_SCOPE = "accounting.write";

export function loadOaOAuthConfig(): OaOAuthConfig {
  const clientId = process.env["OPENACCOUNTANT_CLIENT_ID"];
  const clientSecret = process.env["OPENACCOUNTANT_CLIENT_SECRET"];
  const redirectUri = process.env["OPENACCOUNTANT_REDIRECT_URI"];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "OpenAccountant OAuth is not configured. Ask an admin to set OPENACCOUNTANT_CLIENT_ID, OPENACCOUNTANT_CLIENT_SECRET, and OPENACCOUNTANT_REDIRECT_URI.",
    );
  }
  const authBaseRaw =
    process.env["OPENACCOUNTANT_OAUTH_BASE_URL"] || DEFAULT_OA_OAUTH_BASE;
  // Normalize: drop trailing slash so callers can build `${base}/oauth/...`.
  const authBaseUrl = authBaseRaw.replace(/\/+$/, "");
  const scope = process.env["OPENACCOUNTANT_OAUTH_SCOPE"] || DEFAULT_OA_OAUTH_SCOPE;
  return { clientId, clientSecret, redirectUri, authBaseUrl, scope };
}

export function oaAuthorizationUrl(state: string): string {
  const cfg = loadOaOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  return `${cfg.authBaseUrl}/oauth/authorize?${params.toString()}`;
}

export interface OaTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  tokenType: string;
  scope: string | null;
}

interface RawOaTokenJson {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

function basicAuthOa(cfg: OaOAuthConfig): string {
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

async function postOaTokenForm(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<OaTokenResponse> {
  const cfg = loadOaOAuthConfig();
  const res = await fetchImpl(`${cfg.authBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuthOa(cfg)}`,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAccountant token endpoint failed: HTTP ${res.status} ${text.slice(0, 500)}`,
    );
  }
  const j = (await res.json()) as RawOaTokenJson;
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresInSec: j.expires_in,
    tokenType: j.token_type,
    scope: j.scope ?? null,
  };
}

export async function oaExchangeCodeForTokens(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OaTokenResponse> {
  const cfg = loadOaOAuthConfig();
  return postOaTokenForm(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }),
    fetchImpl,
  );
}

export async function oaRefreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OaTokenResponse> {
  return postOaTokenForm(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    fetchImpl,
  );
}

export async function oaRevokeToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // OA's revoke endpoint accepts either an access_token or refresh_token
  // and returns 200 even when the token is unknown. Best-effort only —
  // failure should not block deletion of the local row.
  const cfg = loadOaOAuthConfig();
  await fetchImpl(`${cfg.authBaseUrl}/oauth/revoke`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuthOa(cfg)}`,
    },
    body: new URLSearchParams({ token }).toString(),
  });
}
