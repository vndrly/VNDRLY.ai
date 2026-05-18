import PDFDocument from "pdfkit";
import {
  INVOICE_LINE_INCOME_CATEGORIES,
  incomeCategoryLabel,
  type InvoiceLineIncomeCategoryLocale,
} from "@workspace/db";
import {
  FORMS_1099,
  type Form1099,
  form1099Label,
  routeLine,
  sumByForm,
  type IncomeCategory,
} from "@workspace/form1099";

export interface PdfInvoice {
  id: number;
  invoiceNumber: string;
  status: string;
  cadence: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  dueDate: Date | string | null;
  remitToAddress: string | null;
  remitToName: string | null;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  creditedAmount: string;
}

export interface PdfLine {
  id: number;
  ticketId: number | null;
  afe: string | null;
  lineType: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  taxAmount: string;
  /** 1099 income category key (see INVOICE_LINE_INCOME_CATEGORIES). When
   *  set to anything other than "none", the human-readable label is rendered
   *  as a small muted tag beneath the line description so the recipient's
   *  accountant can reconcile against the year-end 1099. Optional for
   *  back-compat with callers that pre-date the column. */
  incomeCategory?: string | null;
}

export interface PdfPayment {
  paidAt: Date | string;
  method: string;
  referenceNumber: string | null;
  amount: string;
}

/** Per-form contribution row rendered in the totals block at the bottom
 *  of the PDF. Mirrors the "1099 form contributions" card shown in the
 *  admin invoice detail page so the same set of forms and amounts
 *  appears in both surfaces. */
export interface PdfForm1099Total {
  form: Form1099;
  amount: number;
}

export interface PdfCreditMemo {
  createdAt: Date | string;
  reason: string;
  amount: string;
}

export interface PdfParty {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface RenderInvoicePdfInput {
  invoice: PdfInvoice;
  lines: PdfLine[];
  vendor: PdfParty;
  partner: PdfParty;
  payments?: PdfPayment[];
  credits?: PdfCreditMemo[];
  /** Recipient locale for human-facing strings that vary per partner.
   *  Currently only used to localize the 1099 income-category tag rendered
   *  beneath each line (other PDF copy is not yet localized). Defaults to
   *  English when unset so legacy/admin previews are unchanged. */
  locale?: InvoiceLineIncomeCategoryLocale;
}

// Map our two-letter recipient locale to the BCP-47 tag we hand to
// Intl/Date for currency and date formatting. Currency stays USD across
// both locales because invoices are US-tax / accountant-facing artifacts —
// we only switch the digit/separator/format style ("$1,234.56" vs
// "1,234.56 US$") so the numbers read naturally in the recipient's
// language. Dates likewise switch to the recipient's locale order.
const FORMAT_LOCALE: Record<InvoiceLineIncomeCategoryLocale, string> = {
  en: "en-US",
  es: "es-MX",
};

function fmtMoney(
  s: string | null | undefined,
  locale: InvoiceLineIncomeCategoryLocale = "en",
): string {
  const tag = FORMAT_LOCALE[locale] ?? "en-US";
  if (s == null) {
    return (0).toLocaleString(tag, { style: "currency", currency: "USD" });
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return (0).toLocaleString(tag, { style: "currency", currency: "USD" });
  }
  return n.toLocaleString(tag, { style: "currency", currency: "USD" });
}

function fmtDate(
  d: Date | string | null | undefined,
  locale: InvoiceLineIncomeCategoryLocale = "en",
): string {
  if (!d) return "—";
  const tag = FORMAT_LOCALE[locale] ?? "en-US";
  try {
    return new Date(d).toLocaleDateString(tag, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

function balanceDue(inv: PdfInvoice): number {
  return Number(inv.total) - Number(inv.paidAmount) - Number(inv.creditedAmount);
}

// ── Server-side localized PDF copy ────────────────────────────────
// Every static string on the rendered partner PDF is looked up here by
// the recipient's locale. Mirrors `invoices.pdf.*` in
// artifacts/vndrly/src/lib/locales/{en,es}.json — the parity test in
// invoice-pdf.test.ts asserts the two stay in sync so a translator who
// updates one side can't silently leave the other behind.
//
// English remains the default fallback so legacy callers (admin preview
// route, IIF/CSV exports, anything that doesn't pass `locale`) keep
// their current copy unchanged.
type PdfStringKey =
  | "brandSubtitle"
  | "invoiceTitle"
  | "statusDraft"
  | "statusOpen"
  | "statusSent"
  | "statusPaid"
  | "statusOverdue"
  | "statusCancelled"
  | "colFrom"
  | "colBillTo"
  | "colDescription"
  | "colQty"
  | "colUnit"
  | "colTax"
  | "colAmount"
  | "metaPeriod"
  | "metaDueDate"
  | "metaCadence"
  | "metaTotalDue"
  | "cadencePerTicket"
  | "cadenceWeekly"
  | "cadenceMonthly"
  | "groupUnassigned"
  | "groupTrackingPrefix"
  | "groupAfePrefix"
  | "totalsSubtotal"
  | "totalsTax"
  | "totalsTotal"
  | "totalsPaid"
  | "totalsCredits"
  | "totalsBalanceDue"
  | "summaryTitle"
  | "contributionsTitle"
  | "contributionsHelper"
  | "contributionsEmpty"
  | "reportableTotal"
  | "ledgerTitle"
  | "ledgerPayment"
  | "ledgerCreditMemo"
  | "notesHeading"
  | "footerInvoice"
  | "footerPage";

export const PDF_STRINGS_BY_LOCALE: Record<
  InvoiceLineIncomeCategoryLocale,
  Record<PdfStringKey, string>
> = {
  en: {
    brandSubtitle: "Field Operations Invoice",
    invoiceTitle: "INVOICE",
    statusDraft: "DRAFT",
    statusOpen: "OPEN",
    statusSent: "SENT",
    statusPaid: "PAID",
    statusOverdue: "OVERDUE",
    statusCancelled: "CANCELLED",
    colFrom: "FROM",
    colBillTo: "BILL TO",
    colDescription: "DESCRIPTION",
    colQty: "QTY",
    colUnit: "UNIT",
    colTax: "TAX",
    colAmount: "AMOUNT",
    metaPeriod: "Period",
    metaDueDate: "Due Date",
    metaCadence: "Cadence",
    metaTotalDue: "Total Due",
    cadencePerTicket: "Per ticket",
    cadenceWeekly: "Weekly",
    cadenceMonthly: "Monthly",
    groupUnassigned: "Unassigned",
    groupTrackingPrefix: "Tracking #",
    groupAfePrefix: "AFE",
    totalsSubtotal: "Subtotal",
    totalsTax: "Tax",
    totalsTotal: "Total",
    totalsPaid: "Paid",
    totalsCredits: "Credits",
    totalsBalanceDue: "BALANCE DUE",
    summaryTitle: "1099 Summary",
    contributionsTitle: "1099 form contributions",
    contributionsHelper:
      "How this invoice will roll up at year-end, based on each line's category and the payment method used. Credit-card payments on NEC-categorized lines route to 1099-K.",
    contributionsEmpty: "No 1099-reportable amounts on this invoice.",
    reportableTotal: "Total reportable",
    ledgerTitle: "Payments & Credits",
    ledgerPayment: "Payment",
    ledgerCreditMemo: "Credit memo",
    notesHeading: "Notes",
    footerInvoice: "Invoice",
    footerPage: "Page {{current}} of {{total}}",
  },
  es: {
    brandSubtitle: "Factura de Operaciones de Campo",
    invoiceTitle: "FACTURA",
    statusDraft: "BORRADOR",
    statusOpen: "ABIERTA",
    statusSent: "ENVIADA",
    statusPaid: "PAGADA",
    statusOverdue: "VENCIDA",
    statusCancelled: "CANCELADA",
    colFrom: "DE",
    colBillTo: "FACTURAR A",
    colDescription: "DESCRIPCIÓN",
    colQty: "CANT.",
    colUnit: "UNIT.",
    colTax: "IMPUESTO",
    colAmount: "MONTO",
    metaPeriod: "Periodo",
    metaDueDate: "Vencimiento",
    metaCadence: "Cadencia",
    metaTotalDue: "Saldo pendiente",
    cadencePerTicket: "Por ticket",
    cadenceWeekly: "Semanal",
    cadenceMonthly: "Mensual",
    groupUnassigned: "Sin asignar",
    groupTrackingPrefix: "Seguimiento #",
    groupAfePrefix: "AFE",
    totalsSubtotal: "Subtotal",
    totalsTax: "Impuesto",
    totalsTotal: "Total",
    totalsPaid: "Pagado",
    totalsCredits: "Créditos",
    totalsBalanceDue: "SALDO PENDIENTE",
    summaryTitle: "Resumen 1099",
    contributionsTitle: "Aportaciones a formularios 1099",
    contributionsHelper:
      "Cómo esta factura se acumulará al cierre de año, según la categoría de cada línea y el método de pago utilizado. Los pagos con tarjeta de crédito sobre líneas NEC se reportan en el 1099-K.",
    contributionsEmpty: "Esta factura no tiene importes declarables en 1099.",
    reportableTotal: "Total declarable",
    ledgerTitle: "Pagos y créditos",
    ledgerPayment: "Pago",
    ledgerCreditMemo: "Nota de crédito",
    notesHeading: "Notas",
    footerInvoice: "Factura",
    footerPage: "Página {{current}} de {{total}}",
  },
};

function t(
  locale: InvoiceLineIncomeCategoryLocale,
  key: PdfStringKey,
): string {
  const table =
    PDF_STRINGS_BY_LOCALE[locale] ?? PDF_STRINGS_BY_LOCALE.en;
  return table[key] ?? PDF_STRINGS_BY_LOCALE.en[key];
}

function statusLabel(
  status: string,
  locale: InvoiceLineIncomeCategoryLocale,
): string {
  switch (status) {
    case "draft":
      return t(locale, "statusDraft");
    case "open":
      return t(locale, "statusOpen");
    case "sent":
      return t(locale, "statusSent");
    case "paid":
      return t(locale, "statusPaid");
    case "overdue":
      return t(locale, "statusOverdue");
    case "cancelled":
      return t(locale, "statusCancelled");
    default:
      return status;
  }
}

function cadenceLabel(
  cadence: string,
  locale: InvoiceLineIncomeCategoryLocale,
): string {
  switch (cadence) {
    case "per_ticket":
      return t(locale, "cadencePerTicket");
    case "weekly":
      return t(locale, "cadenceWeekly");
    case "monthly":
      return t(locale, "cadenceMonthly");
    default:
      return cadence.replace(/_/g, " ");
  }
}

// Letter, 0.5" margins. All measurements in points (72/in).
const PAGE = { w: 612, h: 792 };
const M = { x: 36, y: 36 };

export async function renderInvoicePdf(
  input: RenderInvoicePdfInput,
): Promise<Buffer> {
  const {
    invoice,
    lines,
    vendor,
    partner,
    payments = [],
    credits = [],
    locale = "en",
  } = input;
  // bufferPages: true keeps every page in memory until the document is
  // ended, which is required for the post-pass that stamps "Page X of N"
  // into each page's footer (see the bufferedPageRange()/switchToPage()
  // loop near the end). Without it, only the page that pdfkit happens to
  // be on at the time of switchToPage() is mutable, and footers on
  // earlier pages of multi-page invoices would be skipped.
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: M.y, bottom: M.y, left: M.x, right: M.x },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── Brand band ────────────────────────────────────────────────
  doc.rect(0, 0, PAGE.w, 56).fill("#111827");
  doc
    .fillColor("#f59e0b")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("VNDRLY", M.x, 18, { align: "left" });
  doc
    .fillColor("#fef3c7")
    .font("Helvetica")
    .fontSize(10)
    .text(t(locale, "brandSubtitle"), M.x, 40, { align: "left" });

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(`${t(locale, "invoiceTitle")} ${invoice.invoiceNumber}`, M.x, 18, {
      width: PAGE.w - M.x * 2,
      align: "right",
    });
  doc
    .fillColor("#fef3c7")
    .font("Helvetica")
    .fontSize(10)
    .text(statusLabel(invoice.status, locale), M.x, 40, {
      width: PAGE.w - M.x * 2,
      align: "right",
    });

  // ── Header meta block ─────────────────────────────────────────
  let y = 80;
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11);

  // Two columns: vendor (from) | partner (bill to)
  const colW = (PAGE.w - M.x * 2 - 16) / 2;
  doc.text(t(locale, "colFrom"), M.x, y);
  doc.text(t(locale, "colBillTo"), M.x + colW + 16, y);
  y += 16;
  doc.font("Helvetica-Bold").fontSize(12).text(vendor.name, M.x, y, { width: colW });
  doc.text(partner.name, M.x + colW + 16, y, { width: colW });
  y += 16;
  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  if (invoice.remitToName)
    doc.text(invoice.remitToName, M.x, y, { width: colW });
  y += 12;
  if (invoice.remitToAddress)
    doc.text(invoice.remitToAddress, M.x, y, { width: colW });
  // partner column
  let py = y - 12;
  if (partner.address) {
    doc.text(partner.address, M.x + colW + 16, py, { width: colW });
    py += 12;
  }
  if (partner.email) {
    doc.text(partner.email, M.x + colW + 16, py, { width: colW });
  }
  y += 28;

  // Meta row: period / due / cadence
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(10);
  const meta = [
    [
      t(locale, "metaPeriod"),
      `${fmtDate(invoice.periodStart, locale)} – ${fmtDate(invoice.periodEnd, locale)}`,
    ],
    [t(locale, "metaDueDate"), fmtDate(invoice.dueDate, locale)],
    [t(locale, "metaCadence"), cadenceLabel(invoice.cadence, locale)],
    [t(locale, "metaTotalDue"), fmtMoney(String(balanceDue(invoice)), locale)],
  ];
  const cellW = (PAGE.w - M.x * 2) / meta.length;
  doc.rect(M.x, y, PAGE.w - M.x * 2, 36).fillAndStroke("#fef3c7", "#f59e0b");
  meta.forEach(([label, val], i) => {
    const cx = M.x + i * cellW;
    doc.fillColor("#92400e").font("Helvetica-Bold").fontSize(8).text(label, cx + 8, y + 6, { width: cellW - 16 });
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11).text(val, cx + 8, y + 18, { width: cellW - 16 });
  });
  y += 50;

  // ── Lines table ───────────────────────────────────────────────
  const colDesc = M.x;
  const colQty = PAGE.w - M.x - 200;
  const colPrice = PAGE.w - M.x - 130;
  const colTax = PAGE.w - M.x - 60;
  const colAmt = PAGE.w - M.x;

  const drawHeader = (yy: number) => {
    doc.rect(M.x, yy, PAGE.w - M.x * 2, 18).fill("#111827");
    doc.fillColor("#f59e0b").font("Helvetica-Bold").fontSize(9);
    doc.text(t(locale, "colDescription"), colDesc + 6, yy + 5);
    doc.text(t(locale, "colQty"), colQty - 30, yy + 5, { width: 30, align: "right" });
    doc.text(t(locale, "colUnit"), colPrice - 60, yy + 5, { width: 60, align: "right" });
    doc.text(t(locale, "colTax"), colTax - 60, yy + 5, { width: 60, align: "right" });
    doc.text(t(locale, "colAmount"), colAmt - 60, yy + 5, { width: 60, align: "right" });
    return yy + 22;
  };
  y = drawHeader(y);

  // Group by ticket+afe
  const groups = new Map<string, PdfLine[]>();
  for (const line of lines) {
    const k = `${line.ticketId ?? "x"}|${line.afe ?? ""}`;
    const arr = groups.get(k) ?? [];
    arr.push(line);
    groups.set(k, arr);
  }

  doc.fillColor("#111827").font("Helvetica").fontSize(9);

  // ── Compute per-line 1099 form routing ────────────────────────
  // Mirrors the in-app summary on the invoice detail page (task #278)
  // so the badge next to each amount and the totals block at the
  // bottom of the PDF are derived from the same logic the UI uses.
  // We compute once up front so each line render and the totals block
  // share a single snapshot of the routing.
  const invoiceTotalNum = Number(invoice.total);
  const paymentsForRouting = payments.map((p) => ({
    amount: p.amount,
    method: p.method,
  }));
  // Whitelist the IncomeCategory union so unknown legacy strings
  // (e.g. a category that was renamed in the DB but still lives on
  // an old line) get coerced to "none" instead of leaking through as
  // an unknown form key in `sumByForm`. Defensive — DB enums should
  // already enforce this at write time.
  const KNOWN_INCOME_CATEGORIES = new Set<IncomeCategory>([
    "nec",
    "misc_rents",
    "misc_royalties",
    "misc_other_income",
    "misc_prizes_awards",
    "misc_medical_health",
    "misc_attorney",
    "k_third_party_network",
    "none",
  ]);
  const normalizeCategory = (raw: string | null | undefined): IncomeCategory => {
    const v = (raw ?? "none") || "none";
    return KNOWN_INCOME_CATEGORIES.has(v as IncomeCategory)
      ? (v as IncomeCategory)
      : "none";
  };
  const routingByLineId = new Map<number, ReturnType<typeof routeLine>>();
  const allAllocations: { form: Form1099; amount: number }[] = [];
  for (const line of lines) {
    const r = routeLine({
      lineAmount: line.amount,
      category: normalizeCategory(line.incomeCategory),
      invoiceTotal: invoiceTotalNum,
      payments: paymentsForRouting,
    });
    routingByLineId.set(line.id, r);
    allAllocations.push(...r.effective);
  }
  const formTotals = sumByForm(allAllocations);

  for (const [key, group] of groups.entries()) {
    if (y > PAGE.h - 200) {
      doc.addPage();
      y = M.y;
      y = drawHeader(y);
    }
    const [tic, afe] = key.split("|");
    const groupLabel = tic === "x"
      ? t(locale, "groupUnassigned")
      : `${t(locale, "groupTrackingPrefix")}${tic}${afe ? `  ·  ${t(locale, "groupAfePrefix")} ${afe}` : ""}`;
    doc.fillColor("#92400e").font("Helvetica-Bold").fontSize(9).text(groupLabel, colDesc, y);
    y += 14;
    doc.fillColor("#111827").font("Helvetica").fontSize(9);
    for (const line of group) {
      if (y > PAGE.h - 100) {
        doc.addPage();
        y = M.y;
        y = drawHeader(y);
      }
      const desc = `${line.lineType.toUpperCase()} — ${line.description}`;
      const descW = colQty - colDesc - 14;
      // Body font (9pt) is set above the loop; measure description height now.
      const descH = doc.heightOfString(desc, { width: descW });
      // 1099 income-category tag goes on its own short line below the
      // description so it can't collide with the right-side numeric
      // columns. Suppressed for "none" (not reportable) since printing
      // it would just be noise on every line — the form badge on the
      // right will already say "Not reportable".
      const cat = line.incomeCategory ?? null;
      const showTag = cat != null && cat !== "" && cat !== "none";
      const tagText = showTag ? `1099: ${incomeCategoryLabel(cat, locale)}` : "";
      let tagH = 0;
      if (showTag) {
        // Switch to the tag font BEFORE measuring so heightOfString uses the
        // correct font metrics; switch back to body font after measuring so
        // the description text below renders with its intended style.
        doc.font("Helvetica-Oblique").fontSize(7);
        tagH = doc.heightOfString(tagText, { width: descW });
        doc.font("Helvetica").fontSize(9);
      }

      // Per-line 1099 form badge rendered below the amount column. We
      // always render this (even for "none" / non-reportable lines)
      // because task #309 wants the recipient to be able to scan down
      // the amounts and see exactly which form each line will land on.
      // For NEC-categorized lines paid by credit card we list both the
      // NEC and K parts and prefix with "⚠" + a destructive colour so
      // miscategorisations stand out.
      const routing = routingByLineId.get(line.id);
      const formBadgeWidth = 110;
      let formBadgeText = "";
      let formBadgeColor = "#6b7280";
      let formBadgeH = 0;
      if (routing && routing.effective.length > 0) {
        const parts = routing.effective.map((a) => form1099Label(a.form, locale));
        formBadgeText = routing.isFlagged
          ? `⚠ ${parts.join(" + ")}`
          : `→ ${parts[0]}`;
        formBadgeColor = routing.isFlagged ? "#b91c1c" : "#6b7280";
      } else {
        // Zero-amount or unknown — fall back to the planned form so
        // the column is never empty, mirroring the UI's behaviour.
        const planned = routing?.plannedForm ?? "none";
        formBadgeText = `→ ${form1099Label(planned, locale)}`;
      }
      doc.font("Helvetica-Oblique").fontSize(7);
      formBadgeH = doc.heightOfString(formBadgeText, { width: formBadgeWidth });
      doc.font("Helvetica").fontSize(9);

      // Row height has to fit the tallest of: description, the optional
      // category tag stack on the left, and the form badge on the right.
      const leftStackH = descH + (showTag ? tagH + 2 : 0);
      const rightStackH = 9 /*amount text height ≈ 9pt*/ + formBadgeH + 2;
      const rowH = Math.max(14, leftStackH, rightStackH) + 4;

      doc.text(desc, colDesc + 6, y, { width: descW });
      doc.text(line.quantity, colQty - 30, y, { width: 30, align: "right" });
      doc.text(fmtMoney(line.unitPrice, locale), colPrice - 60, y, { width: 60, align: "right" });
      doc.text(fmtMoney(line.taxAmount, locale), colTax - 60, y, { width: 60, align: "right" });
      doc.text(fmtMoney(line.amount, locale), colAmt - 60, y, { width: 60, align: "right" });
      if (showTag) {
        doc
          .fillColor("#6b7280")
          .font("Helvetica-Oblique")
          .fontSize(7)
          .text(tagText, colDesc + 6, y + descH + 1, { width: descW });
      }
      // Form badge — anchored to the right under the AMOUNT column.
      // Width covers ~110pt so longer labels like "1099-MISC Box 10"
      // and the "⚠ 1099-NEC + 1099-K" split fit on one line.
      doc
        .fillColor(formBadgeColor)
        .font("Helvetica-Oblique")
        .fontSize(7)
        .text(formBadgeText, colAmt - formBadgeWidth, y + 11, {
          width: formBadgeWidth,
          align: "right",
        });
      // Restore the body style for the next line.
      doc.fillColor("#111827").font("Helvetica").fontSize(9);
      y += rowH;
    }
    y += 4;
  }

  // ── 1099 Summary + Totals box ─────────────────────────────────
  // The 1099 summary only renders when at least one line carries a
  // non-default income category (anything other than "nec"). When shown,
  // it sits to the LEFT of the totals box so accountants can reconcile
  // per-1099-box subtotals without re-adding line items, while the totals
  // box keeps its existing position on the right (no layout shift for
  // invoices that don't need the summary).
  const has1099Summary = lines.some(
    (l) => (l.incomeCategory ?? "nec") !== "nec",
  );
  // Stable, deterministic ordering driven by the canonical category list
  // so the summary always reads NEC → MISC boxes → K → Not reportable,
  // regardless of line ordering on the invoice.
  const summaryRows: Array<[string, number]> = [];
  if (has1099Summary) {
    const totals = new Map<string, number>();
    for (const l of lines) {
      const cat = l.incomeCategory ?? "nec";
      const amt = Number(l.amount);
      if (!Number.isFinite(amt)) continue;
      totals.set(cat, (totals.get(cat) ?? 0) + amt);
    }
    // Round to cents before the zero check so floating-point residuals
    // (e.g. 0.1 + 0.2 = 0.30000000000000004) can't sneak past the
    // omit-zero rule. Also use the rounded value for display so the
    // summary always sums cleanly to the invoice subtotal.
    const roundCents = (n: number) => Math.round(n * 100) / 100;
    for (const cat of INVOICE_LINE_INCOME_CATEGORIES) {
      const amt = roundCents(totals.get(cat) ?? 0);
      // Skip zero-amount categories per spec — only show what actually
      // contributes to the year-end form.
      if (amt === 0) continue;
      summaryRows.push([cat, amt]);
    }
    // Catch any unknown/legacy category keys that aren't in the canonical
    // list so we never silently drop dollars from the summary.
    for (const [cat, amt] of totals.entries()) {
      const rounded = roundCents(amt);
      if (rounded === 0) continue;
      if ((INVOICE_LINE_INCOME_CATEGORIES as readonly string[]).includes(cat)) {
        continue;
      }
      summaryRows.push([cat, rounded]);
    }
  }

  // Pre-compute heights so the summary and totals box stay on the same
  // page together — avoids a stranded summary above an orphan totals box.
  const totalsBoxH = 96;
  const balanceBarH = 22;
  const totalsBlockH = totalsBoxH + balanceBarH - 8; // 110 advance below
  const summaryHeaderH = 16;
  const summaryRowH = 12;
  const summaryBlockH =
    summaryRows.length > 0
      ? summaryHeaderH + summaryRows.length * summaryRowH
      : 0;
  const blockH = Math.max(totalsBlockH, summaryBlockH);

  if (y > PAGE.h - blockH - 40) {
    doc.addPage();
    y = M.y;
  }

  const boxX = PAGE.w - M.x - 220;

  if (summaryRows.length > 0) {
    const sx = M.x;
    // Reserve a 16pt gutter between the summary and the totals box.
    const sw = boxX - M.x - 16;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(t(locale, "summaryTitle"), sx, y);
    let sy = y + summaryHeaderH;
    for (const [cat, amt] of summaryRows) {
      doc
        .fillColor("#374151")
        .font("Helvetica")
        .fontSize(9)
        .text(incomeCategoryLabel(cat, locale), sx, sy, { width: sw });
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(fmtMoney(String(amt), locale), sx, sy, { width: sw, align: "right" });
      sy += summaryRowH;
    }
  }

  doc
    .rect(boxX, y, 220, 96)
    .lineWidth(0.5)
    .strokeColor("#d1d5db")
    .stroke();

  const totalRows = [
    [t(locale, "totalsSubtotal"), fmtMoney(invoice.subtotal, locale)],
    [t(locale, "totalsTax"), fmtMoney(invoice.taxTotal, locale)],
    [t(locale, "totalsTotal"), fmtMoney(invoice.total, locale)],
    [t(locale, "totalsPaid"), `(${fmtMoney(invoice.paidAmount, locale)})`],
    [t(locale, "totalsCredits"), `(${fmtMoney(invoice.creditedAmount, locale)})`],
  ];
  let ty = y + 6;
  doc.fontSize(9).fillColor("#374151");
  for (const [label, val] of totalRows) {
    doc.font("Helvetica").text(label, boxX + 8, ty);
    doc.font("Helvetica-Bold").text(val, boxX + 8, ty, { width: 220 - 16, align: "right" });
    ty += 12;
  }
  // Balance due — emphasized
  doc.rect(boxX, ty + 2, 220, 22).fill("#111827");
  doc.fillColor("#f59e0b").font("Helvetica-Bold").fontSize(12);
  doc.text(t(locale, "totalsBalanceDue"), boxX + 8, ty + 8);
  doc.text(fmtMoney(String(balanceDue(invoice)), locale), boxX + 8, ty + 8, {
    width: 220 - 16,
    align: "right",
  });
  // Advance past whichever block (totals or 1099 summary) is taller so a
  // long summary can't collide with the payments/credits ledger or notes
  // section that follows. blockH was computed earlier from the actual
  // rendered heights of both candidate blocks.
  y += blockH;

  // ── 1099 form contributions block ─────────────────────────────
  // Mirrors the "1099 form contributions" card on the admin invoice
  // detail page (task #278): one row per non-zero form, plus a
  // "Total reportable" footer that excludes the "none" bucket. The
  // block is always rendered so recipients always see how (or whether)
  // the invoice contributes to year-end 1099s.
  {
    const populated = FORMS_1099.filter((f) => formTotals[f] > 0);
    const blockHeight = 32 + 12 + populated.length * 14 + 14 + 8;
    if (y > PAGE.h - blockHeight - 40) {
      doc.addPage();
      y = M.y;
    }
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(t(locale, "contributionsTitle"), M.x, y);
    y += 14;
    doc
      .fillColor("#6b7280")
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(t(locale, "contributionsHelper"), M.x, y, {
        width: PAGE.w - M.x * 2,
      });
    y += 18;

    if (populated.length === 0) {
      doc
        .fillColor("#374151")
        .font("Helvetica")
        .fontSize(9)
        .text(t(locale, "contributionsEmpty"), M.x, y, {
          width: PAGE.w - M.x * 2,
        });
      y += 14;
    } else {
      // Two-column grid mirroring the in-app card. Each row: form label
      // (left) and amount (right). Column widths chosen so two rows fit
      // side-by-side on letter and a single column when narrow.
      const tableW = PAGE.w - M.x * 2;
      const cellW = tableW / 2 - 4;
      populated.forEach((form, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = M.x + col * (cellW + 8);
        const cy = y + row * 16;
        doc
          .rect(cx, cy, cellW, 14)
          .lineWidth(0.5)
          .strokeColor("#d1d5db")
          .stroke();
        doc
          .fillColor("#111827")
          .font("Helvetica")
          .fontSize(9)
          .text(form1099Label(form, locale), cx + 6, cy + 3, {
            width: cellW - 12,
          });
        doc
          .font("Helvetica-Bold")
          .text(fmtMoney(formTotals[form].toFixed(2), locale), cx + 6, cy + 3, {
            width: cellW - 12,
            align: "right",
          });
      });
      y += Math.ceil(populated.length / 2) * 16;
    }

    // Reportable footer — sums every form except "none".
    const reportable = FORMS_1099
      .filter((f) => f !== "none")
      .reduce((s, f) => s + formTotals[f], 0);
    doc
      .fillColor("#6b7280")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${t(locale, "reportableTotal")}: ${fmtMoney(reportable.toFixed(2), locale)}`,
        M.x,
        y + 4,
        {
          width: PAGE.w - M.x * 2,
          align: "right",
        },
      );
    y += 18;
  }

  // ── Payments / Credits ledger ─────────────────────────────────
  if (payments.length > 0 || credits.length > 0) {
    if (y > PAGE.h - 120) {
      doc.addPage();
      y = M.y;
    }
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(t(locale, "ledgerTitle"), M.x, y);
    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor("#374151");
    for (const p of payments) {
      doc.text(
        `${fmtDate(p.paidAt, locale)}  ·  ${t(locale, "ledgerPayment")} ${p.method}${p.referenceNumber ? ` (#${p.referenceNumber})` : ""}`,
        M.x,
        y,
      );
      doc.text(fmtMoney(p.amount, locale), M.x, y, {
        width: PAGE.w - M.x * 2,
        align: "right",
      });
      y += 12;
    }
    for (const c of credits) {
      doc.text(
        `${fmtDate(c.createdAt, locale)}  ·  ${t(locale, "ledgerCreditMemo")} — ${c.reason}`,
        M.x,
        y,
      );
      doc.text(`(${fmtMoney(c.amount, locale)})`, M.x, y, {
        width: PAGE.w - M.x * 2,
        align: "right",
      });
      y += 12;
    }
    y += 8;
  }

  // ── Notes ─────────────────────────────────────────────────────
  if (invoice.notes) {
    if (y > PAGE.h - 80) {
      doc.addPage();
      y = M.y;
    }
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(t(locale, "notesHeading"), M.x, y);
    y += 14;
    doc.font("Helvetica").fontSize(9).fillColor("#374151").text(invoice.notes, M.x, y, { width: PAGE.w - M.x * 2 });
  }

  // ── Footer on every page ──────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor("#9ca3af").font("Helvetica").fontSize(8);
    const pageText = t(locale, "footerPage")
      .replace("{{current}}", String(i - range.start + 1))
      .replace("{{total}}", String(range.count));
    doc.text(
      `${vendor.name}  ·  ${t(locale, "footerInvoice")} ${invoice.invoiceNumber}  ·  ${pageText}`,
      M.x,
      PAGE.h - 24,
      { width: PAGE.w - M.x * 2, align: "center" },
    );
  }

  doc.end();
  return done;
}
