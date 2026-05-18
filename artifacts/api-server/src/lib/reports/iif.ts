// QuickBooks Desktop IIF emitter.
//
// IIF format reference: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data/format-iif-files-import-quickbooks-desktop/L9XEorqlw_US_en_US
//
// Three header sections precede the data:
//   !ACCNT  → chart of accounts (we emit only the accounts we use)
//   !CUST   → customer list (one per partner)
//   !VEND   → vendor list (one per vendor — used for the "FROM" account)
//   !TRNS / !SPL / !ENDTRNS  → transactions
//
// Each invoice becomes one TRNS (the AR debit) + N SPL (one per invoice line
// crediting income, plus one SPL per non-zero tax line). Every TRNS group is
// terminated by ENDTRNS. Tab-separated; values are NOT quoted (IIF doesn't
// support quoting — newlines in field values must be stripped).

import { incomeCategoryLabel } from "@workspace/db";
import {
  defaultResolver,
  LINE_TYPE_AR,
  LINE_TYPE_TAX_PAYABLE,
  type QbAccount,
  type QbAccountResolver,
} from "./qb-mapping";

export interface IifInvoice {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  total: string;
  subtotal: string;
  taxTotal: string;
  memo: string | null;
  partnerName: string;
  vendorName: string;
  /** Optional partner ID for resolver scope lookups. */
  partnerId?: number | null;
  /** Optional vendor ID for resolver scope lookups. */
  vendorId?: number | null;
  /** Optional invoice row ID. Surfaced into the QuickBooks export
   *  preview so the UI can deep-link each invoice back to its detail
   *  page (`/invoices/:id`). Not used by the IIF/CSV writers. */
  id?: number;
}
export interface IifInvoiceLine {
  invoiceNumber: string;
  description: string;
  amount: string;
  taxAmount: string;
  lineType: string;
  /** 1099 income category key. Surfaced into the SPL MEMO column so the
   *  classification survives a round-trip into QuickBooks (where it can be
   *  read back when reconciling the recipient's year-end 1099). Optional;
   *  callers that pre-date the column behave as before. */
  incomeCategory?: string | null;
}
export interface IifPartner {
  name: string;
  email: string | null;
  address: string | null;
}
export interface IifVendor {
  name: string;
  email: string | null;
  address: string | null;
  federalTaxId: string | null;
}

const TAB = "\t";
const EOL = "\r\n";

function safe(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v).replace(/[\t\r\n]+/g, " ").trim();
}

function fmtIifDate(d: Date): string {
  // QB Desktop expects MM/DD/YYYY in US locales.
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${m}/${day}/${d.getUTCFullYear()}`;
}

export interface RenderIifInput {
  invoices: IifInvoice[];
  lines: IifInvoiceLine[];
  partners: IifPartner[];
  vendors: IifVendor[];
  /** Optional account resolver — defaults to the built-in defaults. */
  resolver?: QbAccountResolver;
}

export function renderIif(input: RenderIifInput): string {
  const out: string[] = [];
  const resolver = input.resolver ?? defaultResolver;

  // Group lines by invoice number — needed for both !ACCNT collection and
  // the !TRNS emission below.
  const linesByInv = new Map<string, IifInvoiceLine[]>();
  for (const l of input.lines) {
    const arr = linesByInv.get(l.invoiceNumber) ?? [];
    arr.push(l);
    linesByInv.set(l.invoiceNumber, arr);
  }

  // ── !ACCNT block ─────────────────────────────────────────────
  // Collect every account that will actually show up in the txn block.
  // Resolver may produce different accounts per (vendor, partner) so we
  // walk each invoice + line once to know what to declare.
  out.push(["!ACCNT", "NAME", "ACCNTTYPE", "DESC"].join(TAB));
  const accts = new Map<string, QbAccount>();
  function addAcct(a: QbAccount): void {
    if (!accts.has(a.name)) accts.set(a.name, a);
  }
  for (const inv of input.invoices) {
    const scope = { vendorId: inv.vendorId ?? null, partnerId: inv.partnerId ?? null };
    addAcct(resolver(LINE_TYPE_AR, scope));
    addAcct(resolver(LINE_TYPE_TAX_PAYABLE, scope));
    const lines = linesByInv.get(inv.invoiceNumber) ?? [];
    for (const l of lines) addAcct(resolver(l.lineType, scope));
    // Always include the "other" fallback so rounding adjustments emit cleanly.
    addAcct(resolver("other", scope));
  }
  for (const a of accts.values()) {
    out.push(["ACCNT", safe(a.name), safe(a.qbType), `VNDRLY auto-import`].join(TAB));
  }

  // ── !CUST block ──────────────────────────────────────────────
  out.push(["!CUST", "NAME", "BADDR1", "EMAIL"].join(TAB));
  for (const p of input.partners) {
    out.push(["CUST", safe(p.name), safe(p.address), safe(p.email)].join(TAB));
  }

  // ── !VEND block ──────────────────────────────────────────────
  out.push(["!VEND", "NAME", "BADDR1", "EMAIL", "TAXID"].join(TAB));
  for (const v of input.vendors) {
    out.push(
      ["VEND", safe(v.name), safe(v.address), safe(v.email), safe(v.federalTaxId)].join(TAB),
    );
  }

  // ── !TRNS / !SPL / !ENDTRNS block ────────────────────────────
  out.push(
    [
      "!TRNS",
      "TRNSID",
      "TRNSTYPE",
      "DATE",
      "ACCNT",
      "NAME",
      "AMOUNT",
      "DOCNUM",
      "MEMO",
    ].join(TAB),
  );
  out.push(
    [
      "!SPL",
      "SPLID",
      "TRNSTYPE",
      "DATE",
      "ACCNT",
      "NAME",
      "AMOUNT",
      "MEMO",
    ].join(TAB),
  );
  out.push(["!ENDTRNS"].join(TAB));

  for (const inv of input.invoices) {
    const total = Number(inv.total);
    if (total === 0) continue; // QB rejects zero-amount transactions.
    const scope = { vendorId: inv.vendorId ?? null, partnerId: inv.partnerId ?? null };
    const arAccount = resolver(LINE_TYPE_AR, scope);
    const taxAccount = resolver(LINE_TYPE_TAX_PAYABLE, scope);
    // TRNS: debit AR for the invoice total (positive amount = debit AR).
    out.push(
      [
        "TRNS",
        "",
        "INVOICE",
        fmtIifDate(inv.invoiceDate),
        arAccount.name,
        safe(inv.partnerName),
        total.toFixed(2),
        safe(inv.invoiceNumber),
        safe(inv.memo),
      ].join(TAB),
    );

    // SPLs: credit each income account. IIF convention: SPL amounts are
    // negative for the credit side so the txn balances to zero.
    const lines = linesByInv.get(inv.invoiceNumber) ?? [];
    let lineSum = 0;
    let taxSum = 0;
    for (const l of lines) {
      const amt = Number(l.amount);
      const tax = Number(l.taxAmount);
      lineSum += amt;
      taxSum += tax;
      if (amt !== 0) {
        const acct = resolver(l.lineType, scope);
        // Append a "[1099: <label>]" suffix to the memo so the income-category
        // classification is preserved in QB Desktop (which doesn't have a
        // dedicated 1099-box field on the line). Skip "none" since printing
        // it on every reimbursement just adds noise.
        const cat = l.incomeCategory ?? null;
        const memo = cat && cat !== "none"
          ? `${l.description} [1099: ${incomeCategoryLabel(cat)}]`
          : l.description;
        out.push(
          [
            "SPL",
            "",
            "INVOICE",
            fmtIifDate(inv.invoiceDate),
            acct.name,
            safe(inv.partnerName),
            (-amt).toFixed(2),
            safe(memo),
          ].join(TAB),
        );
      }
    }
    if (taxSum !== 0) {
      out.push(
        [
          "SPL",
          "",
          "INVOICE",
          fmtIifDate(inv.invoiceDate),
          taxAccount.name,
          safe(inv.partnerName),
          (-taxSum).toFixed(2),
          "Sales tax",
        ].join(TAB),
      );
    }
    // Balance check — if QB receives an unbalanced TRNS it rejects the
    // entire file. Pad with a rounding SPL if a penny got lost to summing.
    const computed = lineSum + taxSum;
    const drift = +(total - computed).toFixed(2);
    if (drift !== 0) {
      out.push(
        [
          "SPL",
          "",
          "INVOICE",
          fmtIifDate(inv.invoiceDate),
          resolver("other", scope).name,
          safe(inv.partnerName),
          (-drift).toFixed(2),
          "Rounding adjustment",
        ].join(TAB),
      );
    }
    out.push(["ENDTRNS"].join(TAB));
  }

  return out.join(EOL) + EOL;
}
