// Default QuickBooks Online chart-of-accounts mapping for VNDRLY invoice
// line types. Defaults match QBO's standard service-business chart of
// accounts so the IIF / QBO CSV import lands cleanly into a fresh QBO
// file. Admins can override any of these per-vendor, per-partner, or
// per-(vendor,partner) via the qb_account_mapping table — see
// `loadAccountMapOverrides` and `resolverFor`.
//
// IIF !ACCNT account-type codes used here:
//   AR     — Accounts Receivable (asset)
//   OCASSET — Other Current Asset
//   AP     — Accounts Payable (liability)
//   OCLIAB — Other Current Liability (sales tax payable lives here)
//   INC    — Income
//   EXINC  — Other Income (e.g. customer discounts given)
//   EXP    — Expense
//   EXEXP  — Other Expense
// See Intuit's IIF spec for the full list.

import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { db, qbAccountMappingTable } from "@workspace/db";

export type QbAccountType =
  | "AR"
  | "OCASSET"
  | "AP"
  | "OCLIAB"
  | "INC"
  | "EXINC"
  | "EXP"
  | "EXEXP";

export interface QbAccount {
  /** QuickBooks account name as shown in the chart of accounts. */
  name: string;
  /** QBO account number (5-digit; QBO's "Use account numbers" feature). */
  number: string;
  /** QB account type — used in the IIF !ACCNT block. */
  qbType: QbAccountType;
}

// Mapping by VNDRLY invoice_lines.line_type → QB account.
// Numbers chosen to match QBO's default service-business COA so a fresh
// QuickBooks file accepts the import without manual mapping.
export const LINE_TYPE_TO_ACCOUNT: Record<string, QbAccount> = {
  labor_regular: { name: "Service Income", number: "4000", qbType: "INC" },
  labor_overtime: { name: "Service Income", number: "4000", qbType: "INC" },
  equipment: { name: "Equipment Rental Income", number: "4010", qbType: "INC" },
  materials: { name: "Materials Income", number: "4020", qbType: "INC" },
  mileage: { name: "Mileage Income", number: "4030", qbType: "INC" },
  per_diem: { name: "Per Diem Income", number: "4040", qbType: "INC" },
  markup: { name: "Markup Income", number: "4050", qbType: "INC" },
  // Discounts given is contra-income; QB treats it as Other Income with a
  // negative typical balance.
  discount: { name: "Discounts Given", number: "4900", qbType: "EXINC" },
  other: { name: "Other Income", number: "4090", qbType: "INC" },
};

export const FALLBACK_ACCOUNT: QbAccount = LINE_TYPE_TO_ACCOUNT.other;

/**
 * A/R control account — every invoice posts to this debit. Accounts
 * Receivable is an asset; in IIF the proper type code is `AR`.
 */
export const AR_ACCOUNT: QbAccount = {
  name: "Accounts Receivable",
  number: "1100",
  qbType: "AR",
};

/**
 * Sales tax payable — credit side of every invoice that has tax. This is a
 * Liability (specifically an Other Current Liability) — IIF code `OCLIAB`.
 */
export const TAX_PAYABLE_ACCOUNT: QbAccount = {
  name: "Sales Tax Payable",
  number: "2200",
  qbType: "OCLIAB",
};

/** Virtual line-type keys used for accounts that aren't tied to invoice lines. */
export const LINE_TYPE_AR = "ar";
export const LINE_TYPE_TAX_PAYABLE = "tax_payable";

/** All line types the mapping UI knows about (the order is also the UI order). */
export const MAPPABLE_LINE_TYPES: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "labor_regular", label: "Labor — regular" },
  { key: "labor_overtime", label: "Labor — overtime" },
  { key: "equipment", label: "Equipment" },
  { key: "materials", label: "Materials" },
  { key: "mileage", label: "Mileage" },
  { key: "per_diem", label: "Per diem" },
  { key: "markup", label: "Markup" },
  { key: "discount", label: "Discount" },
  { key: "other", label: "Other" },
  { key: LINE_TYPE_AR, label: "Accounts Receivable (control)" },
  { key: LINE_TYPE_TAX_PAYABLE, label: "Sales Tax Payable" },
];

/** Look up the built-in default account for a line type. */
export function defaultAccountForKey(key: string): QbAccount {
  if (key === LINE_TYPE_AR) return AR_ACCOUNT;
  if (key === LINE_TYPE_TAX_PAYABLE) return TAX_PAYABLE_ACCOUNT;
  return LINE_TYPE_TO_ACCOUNT[key] ?? FALLBACK_ACCOUNT;
}

export interface QbMappingFormItem {
  lineType: string;
  label: string;
  defaultAccountName: string;
  defaultAccountNumber: string;
  accountName: string;
  accountNumber: string;
  isOverride: boolean;
  overrideId: number | null;
}

/** Load mapping form rows for a vendor/partner scope (exact match only). */
export async function fetchQbMappingFormItems(scope: {
  vendorId: number | null;
  partnerId: number | null;
}): Promise<{ scope: typeof scope; items: QbMappingFormItem[] }> {
  const { vendorId, partnerId } = scope;
  const rows = await db
    .select()
    .from(qbAccountMappingTable)
    .where(
      and(
        vendorId == null
          ? isNull(qbAccountMappingTable.vendorId)
          : eq(qbAccountMappingTable.vendorId, vendorId),
        partnerId == null
          ? isNull(qbAccountMappingTable.partnerId)
          : eq(qbAccountMappingTable.partnerId, partnerId),
      ),
    );
  const exactByLineType = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    exactByLineType.set(r.lineType, r);
  }
  const items = MAPPABLE_LINE_TYPES.map((m) => {
    const def = defaultAccountForKey(m.key);
    const ov = exactByLineType.get(m.key);
    return {
      lineType: m.key,
      label: m.label,
      defaultAccountName: def.name,
      defaultAccountNumber: def.number,
      accountName: ov?.accountName ?? def.name,
      accountNumber: ov?.accountNumber ?? def.number,
      isOverride: Boolean(ov),
      overrideId: ov?.id ?? null,
    };
  });
  return { scope: { vendorId, partnerId }, items };
}

// ── Override loading & resolution ───────────────────────────────────────

export interface QbAccountOverride {
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
  accountName: string;
  accountNumber: string | null;
}

export interface QbAccountResolverScope {
  vendorId?: number | null;
  partnerId?: number | null;
}

/**
 * A resolver answers "what QB account should we post this line type to?".
 * Implementations look at the most-specific scope match first
 * (vendorId+partnerId), then vendor-only, then partner-only, then global,
 * then the built-in default.
 */
export type QbAccountResolver = (
  lineType: string,
  scope?: QbAccountResolverScope,
) => QbAccount;

/** Default resolver — returns built-in defaults regardless of scope. */
export const defaultResolver: QbAccountResolver = (lineType) =>
  defaultAccountForKey(lineType);

/**
 * Build a resolver from a list of overrides. Lookup priority is:
 *   1. (vendorId, partnerId) match
 *   2. (vendorId, null) match
 *   3. (null, partnerId) match
 *   4. (null, null) global override
 *   5. built-in default account
 *
 * Account number falls back to the default when the override leaves it blank
 * so we never lose the QBO account-number metadata.
 */
export function buildResolver(overrides: QbAccountOverride[]): QbAccountResolver {
  // Index by lineType → list of overrides for that line type, in lookup-priority order.
  const byLineType = new Map<string, QbAccountOverride[]>();
  for (const ov of overrides) {
    const arr = byLineType.get(ov.lineType) ?? [];
    arr.push(ov);
    byLineType.set(ov.lineType, arr);
  }

  return (lineType, scope) => {
    const def = defaultAccountForKey(lineType);
    const candidates = byLineType.get(lineType);
    if (!candidates || candidates.length === 0) return def;
    const v = scope?.vendorId ?? null;
    const p = scope?.partnerId ?? null;
    // Try each priority in order.
    const priorities: Array<(o: QbAccountOverride) => boolean> = [
      (o) => v != null && p != null && o.vendorId === v && o.partnerId === p,
      (o) => v != null && o.vendorId === v && o.partnerId === null,
      (o) => p != null && o.partnerId === p && o.vendorId === null,
      (o) => o.vendorId === null && o.partnerId === null,
    ];
    for (const match of priorities) {
      const found = candidates.find(match);
      if (found) {
        return {
          name: found.accountName,
          number: found.accountNumber || def.number,
          qbType: def.qbType,
        };
      }
    }
    return def;
  };
}

/**
 * Load all overrides relevant to a vendor (and the partners that vendor
 * invoices). Pulling in unrelated partner-only overrides would still be
 * correct since the resolver picks the most specific match, but we keep
 * the query narrow for performance.
 */
export async function loadAccountMapOverrides(args: {
  vendorId?: number | null;
  partnerIds?: number[];
}): Promise<QbAccountOverride[]> {
  const conds: SQL[] = [];
  // Always include global overrides (vendorId=null AND partnerId=null).
  conds.push(
    and(
      isNull(qbAccountMappingTable.vendorId),
      isNull(qbAccountMappingTable.partnerId),
    )!,
  );
  if (args.vendorId != null) {
    // vendor-only override row (partnerId IS NULL).
    conds.push(
      and(
        eq(qbAccountMappingTable.vendorId, args.vendorId),
        isNull(qbAccountMappingTable.partnerId),
      )!,
    );
    // any vendor+partner overrides for this vendor.
    conds.push(eq(qbAccountMappingTable.vendorId, args.vendorId)!);
  }
  if (args.partnerIds && args.partnerIds.length > 0) {
    for (const pid of args.partnerIds) {
      // partner-only override row (vendorId IS NULL).
      conds.push(
        and(
          isNull(qbAccountMappingTable.vendorId),
          eq(qbAccountMappingTable.partnerId, pid),
        )!,
      );
    }
  }
  const where = conds.length === 1 ? conds[0] : or(...conds)!;
  const rows = await db.select().from(qbAccountMappingTable).where(where);
  return rows.map((r) => ({
    vendorId: r.vendorId,
    partnerId: r.partnerId,
    lineType: r.lineType,
    accountName: r.accountName,
    accountNumber: r.accountNumber,
  }));
}

/** Look up the QB account for a VNDRLY invoice line type, with fallback. */
export function accountForLineType(lineType: string): QbAccount {
  return LINE_TYPE_TO_ACCOUNT[lineType] ?? FALLBACK_ACCOUNT;
}

// ── Bulk-edit helpers ────────────────────────────────────────────────────
//
// These are pure functions used by the bulk-apply and CSV-import endpoints
// in routes/reports.ts. They are extracted here so they can be unit-tested
// without a database.

/** A (vendorId, partnerId) scope. `null` on either axis means "unscoped". */
export interface QbAccountScope {
  vendorId: number | null;
  partnerId: number | null;
}

/**
 * Expand the cross-product of selected vendors × partners into a list of
 * unique scopes the bulk endpoint should write to. An `undefined` /
 * empty-array axis means "leave that axis unscoped" (i.e. NULL in the row),
 * not "every value": the caller must pass actual ids when they want to
 * fan out across them.
 *
 * Examples:
 *   expandBulkScopes({}) → [{vendorId: null, partnerId: null}]   // global
 *   expandBulkScopes({vendorIds: [1,2]}) → [(1,null),(2,null)]    // per-vendor
 *   expandBulkScopes({partnerIds: [9]}) → [(null,9)]              // per-partner
 *   expandBulkScopes({vendorIds: [1,2], partnerIds: [9]}) →
 *     [(1,9),(2,9)]                                               // pair grid
 */
export function expandBulkScopes(args: {
  vendorIds?: ReadonlyArray<number> | null;
  partnerIds?: ReadonlyArray<number> | null;
}): QbAccountScope[] {
  const vs: Array<number | null> =
    args.vendorIds && args.vendorIds.length > 0 ? [...args.vendorIds] : [null];
  const ps: Array<number | null> =
    args.partnerIds && args.partnerIds.length > 0 ? [...args.partnerIds] : [null];
  const out: QbAccountScope[] = [];
  const seen = new Set<string>();
  for (const v of vs) {
    for (const p of ps) {
      const key = `${v ?? "_"}|${p ?? "_"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ vendorId: v, partnerId: p });
    }
  }
  return out;
}

export interface ParsedQbMappingCsvRow {
  /** 1-based row index in the source CSV (header is row 1, first data row is 2). */
  rowNumber: number;
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
  accountName: string;
  accountNumber: string | null;
}

export interface ParsedQbMappingCsvError {
  rowNumber: number;
  message: string;
}

export interface ParsedQbMappingCsv {
  rows: ParsedQbMappingCsvRow[];
  errors: ParsedQbMappingCsvError[];
}

/**
 * Existing row from `qb_account_mapping` shaped just enough for
 * `classifyCsvImport` to compare scope + values without coupling to
 * Drizzle's row type.
 */
export interface ExistingMappingRow {
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
  accountName: string;
  accountNumber: string | null;
}

export interface CsvImportInsertRow extends ParsedQbMappingCsvRow {
  kind: "insert";
}

export interface CsvImportUpdateRow extends ParsedQbMappingCsvRow {
  kind: "update";
  oldAccountName: string;
  oldAccountNumber: string | null;
}

export interface CsvImportUnchangedRow extends ParsedQbMappingCsvRow {
  kind: "unchanged";
}

/**
 * Classification of a parsed CSV import for preview / dry-run purposes.
 * `inserts` are scopes that don't yet exist in `qb_account_mapping`;
 * `updates` are scopes that exist with different values (we keep the old
 * values so the preview can show before/after); `unchanged` are scopes
 * whose CSV row matches the DB byte-for-byte and would be a no-op write;
 * `errors` are forwarded straight from the parser.
 */
export interface CsvImportPreview {
  inserts: CsvImportInsertRow[];
  updates: CsvImportUpdateRow[];
  unchanged: CsvImportUnchangedRow[];
  errors: ParsedQbMappingCsvError[];
}

function mappingScopeKey(
  vendorId: number | null,
  partnerId: number | null,
  lineType: string,
): string {
  return `${vendorId ?? "_"}|${partnerId ?? "_"}|${lineType}`;
}

/**
 * Classify each parsed CSV row against the existing mapping table so the
 * UI can show a preview ("X new, Y updated, Z skipped") before any DB
 * write. This is pure: callers fetch the existing rows separately and
 * pass them in, which keeps the function unit-testable without a DB.
 */
export function classifyCsvImport(
  parsed: ParsedQbMappingCsv,
  existing: ReadonlyArray<ExistingMappingRow>,
): CsvImportPreview {
  const idx = new Map<string, ExistingMappingRow>();
  for (const e of existing) {
    idx.set(mappingScopeKey(e.vendorId, e.partnerId, e.lineType), e);
  }
  const inserts: CsvImportInsertRow[] = [];
  const updates: CsvImportUpdateRow[] = [];
  const unchanged: CsvImportUnchangedRow[] = [];
  for (const row of parsed.rows) {
    const key = mappingScopeKey(row.vendorId, row.partnerId, row.lineType);
    const ex = idx.get(key);
    if (!ex) {
      inserts.push({ kind: "insert", ...row });
      continue;
    }
    const sameName = ex.accountName === row.accountName;
    const sameNumber = (ex.accountNumber ?? null) === (row.accountNumber ?? null);
    if (sameName && sameNumber) {
      unchanged.push({ kind: "unchanged", ...row });
    } else {
      updates.push({
        kind: "update",
        ...row,
        oldAccountName: ex.accountName,
        oldAccountNumber: ex.accountNumber,
      });
    }
  }
  return { inserts, updates, unchanged, errors: parsed.errors };
}

/**
 * Minimal RFC-4180 CSV reader. Supports quoted fields, doubled quotes,
 * embedded commas / newlines, and CRLF or LF line endings. Trailing blank
 * lines are ignored.
 */
export function readCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Flush the final cell / row if the file didn't end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  // Drop trailing all-empty rows (common with editors adding a trailing CRLF).
  while (out.length > 0 && out[out.length - 1].every((c) => c.trim() === "")) {
    out.pop();
  }
  return out;
}

/**
 * Parse a CSV blob into validated mapping rows. The CSV must have a header
 * row that names at least these columns (case-insensitive, extra columns
 * are ignored): vendor_id, partner_id, line_type, account_name,
 * account_number. Blank vendor_id / partner_id cells become NULL. Rows
 * with validation problems are returned in `errors`; valid rows in `rows`.
 */
export function parseQbMappingCsv(
  text: string,
  knownLineTypes: ReadonlySet<string>,
): ParsedQbMappingCsv {
  const result: ParsedQbMappingCsv = { rows: [], errors: [] };
  const matrix = readCsv(text);
  if (matrix.length === 0) return result;
  const header = matrix[0].map((c) => c.trim().toLowerCase());
  const idx = (name: string): number => header.indexOf(name);
  const colVendor = idx("vendor_id");
  const colPartner = idx("partner_id");
  const colLineType = idx("line_type");
  const colName = idx("account_name");
  const colNumber = idx("account_number");
  if (colLineType < 0 || colName < 0) {
    result.errors.push({
      rowNumber: 1,
      message:
        "Header row must include at least line_type and account_name columns.",
    });
    return result;
  }
  for (let r = 1; r < matrix.length; r++) {
    const rowNumber = r + 1;
    const row = matrix[r];
    if (row.every((c) => c.trim() === "")) continue;
    const rawVendor = colVendor >= 0 ? (row[colVendor] ?? "").trim() : "";
    const rawPartner = colPartner >= 0 ? (row[colPartner] ?? "").trim() : "";
    const lineType = (row[colLineType] ?? "").trim();
    const accountName = (row[colName] ?? "").trim();
    const accountNumber =
      colNumber >= 0 ? (row[colNumber] ?? "").trim() : "";
    let vendorId: number | null = null;
    let partnerId: number | null = null;
    if (rawVendor !== "") {
      const n = Number(rawVendor);
      if (!Number.isInteger(n) || n <= 0) {
        result.errors.push({
          rowNumber,
          message: `Invalid vendor_id "${rawVendor}".`,
        });
        continue;
      }
      vendorId = n;
    }
    if (rawPartner !== "") {
      const n = Number(rawPartner);
      if (!Number.isInteger(n) || n <= 0) {
        result.errors.push({
          rowNumber,
          message: `Invalid partner_id "${rawPartner}".`,
        });
        continue;
      }
      partnerId = n;
    }
    if (!lineType) {
      result.errors.push({ rowNumber, message: "line_type is required." });
      continue;
    }
    if (!knownLineTypes.has(lineType)) {
      result.errors.push({
        rowNumber,
        message: `Unknown line_type "${lineType}".`,
      });
      continue;
    }
    if (!accountName) {
      result.errors.push({
        rowNumber,
        message: "account_name is required.",
      });
      continue;
    }
    if (accountName.length > 200) {
      result.errors.push({
        rowNumber,
        message: "account_name must be 200 characters or fewer.",
      });
      continue;
    }
    if (accountNumber.length > 50) {
      result.errors.push({
        rowNumber,
        message: "account_number must be 50 characters or fewer.",
      });
      continue;
    }
    result.rows.push({
      rowNumber,
      vendorId,
      partnerId,
      lineType,
      accountName,
      accountNumber: accountNumber === "" ? null : accountNumber,
    });
  }
  return result;
}
