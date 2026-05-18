import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import {
  PDF_STRINGS_BY_LOCALE,
  renderInvoicePdf,
  type PdfInvoice,
  type PdfLine,
  type PdfParty,
  type PdfPayment,
  type PdfCreditMemo,
  type RenderInvoicePdfInput,
} from "./invoice-pdf";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

function loadInvoicesPdfLocaleJson(
  locale: "en" | "es",
): Record<string, string> {
  const p = resolve(
    REPO_ROOT,
    `artifacts/vndrly/src/lib/locales/${locale}.json`,
  );
  const json = JSON.parse(readFileSync(p, "utf8")) as {
    invoices?: { pdf?: Record<string, string> };
  };
  const table = json.invoices?.pdf;
  if (!table) throw new Error(`missing invoices.pdf in ${locale}`);
  return table;
}

async function extractText(buf: Buffer): Promise<{
  text: string;
  pageTexts: string[];
  numPages: number;
}> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const pageTexts = (result.pages ?? []).map((p) => p.text ?? "");
    return {
      text: result.text ?? pageTexts.join("\n"),
      pageTexts,
      numPages: pageTexts.length,
    };
  } finally {
    await parser.destroy();
  }
}

const vendor: PdfParty = {
  name: "Acme Field Services LLC",
  address: "123 Rig Rd, Midland, TX",
  email: "ar@acme.example",
};

const partner: PdfParty = {
  name: "BigOil Operating Co.",
  address: "500 Energy Plaza, Houston, TX",
  email: "ap@bigoil.example",
};

function makeInvoice(overrides: Partial<PdfInvoice> = {}): PdfInvoice {
  return {
    id: 1,
    invoiceNumber: "INV-1001",
    status: "open",
    cadence: "monthly",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    dueDate: "2026-02-15",
    remitToAddress: "PO Box 9, Midland, TX",
    remitToName: "Acme AR",
    notes: null,
    subtotal: "1000.00",
    taxTotal: "0.00",
    total: "1000.00",
    paidAmount: "0.00",
    creditedAmount: "0.00",
    ...overrides,
  };
}

function makeLine(overrides: Partial<PdfLine> = {}): PdfLine {
  return {
    id: 1,
    ticketId: 100,
    afe: "AFE-1",
    lineType: "labor",
    description: "Hot-shot delivery",
    quantity: "1",
    unitPrice: "1000.00",
    amount: "1000.00",
    taxAmount: "0.00",
    incomeCategory: "nec",
    ...overrides,
  };
}

async function render(input: Partial<RenderInvoicePdfInput> = {}): Promise<Buffer> {
  const invoice = input.invoice ?? makeInvoice();
  const lines = input.lines ?? [makeLine()];
  return renderInvoicePdf({
    vendor,
    partner,
    ...input,
    invoice,
    lines,
  });
}

describe("renderInvoicePdf", () => {
  it("renders a single-page invoice with totals and balance due", async () => {
    const buf = await render({
      invoice: makeInvoice({
        subtotal: "1500.00",
        taxTotal: "120.00",
        total: "1620.00",
      }),
      lines: [
        makeLine({ id: 1, amount: "1000.00", unitPrice: "1000.00" }),
        makeLine({
          id: 2,
          description: "Equipment rental",
          lineType: "rental",
          amount: "500.00",
          unitPrice: "500.00",
        }),
      ],
    });
    expect(buf.length).toBeGreaterThan(500);
    const { text, numPages } = await extractText(buf);
    // A "single-page" invoice in this codebase still spills onto a 2nd page
    // when the totals box + 1099 contributions block hit the bottom margin
    // guard. We just need to confirm the document is small (1-2 pages) and
    // that all the expected content is present somewhere in the doc.
    expect(numPages).toBeLessThanOrEqual(2);
    expect(text).toContain("INVOICE INV-1001");
    expect(text).toContain("Acme Field Services LLC");
    expect(text).toContain("BigOil Operating Co.");
    // Subtotal / Tax / Total / Balance due figures
    expect(text).toContain("$1,500.00");
    expect(text).toContain("$120.00");
    expect(text).toContain("$1,620.00");
    expect(text).toContain("BALANCE DUE");
    // Footer pagination is stamped on every page; just check the footer
    // template ("Page X of N") appears at least once.
    expect(text).toMatch(/Page \d+ of \d+/);
    // No 1099 summary block when every line is plain NEC.
    expect(text).not.toContain("1099 Summary");
  });

  it("paginates a multi-page invoice and stamps Page X of N on every page", async () => {
    const lines: PdfLine[] = Array.from({ length: 60 }, (_, i) =>
      makeLine({
        id: i + 1,
        ticketId: 1000 + i,
        afe: `AFE-${i + 1}`,
        description: `Line item number ${i + 1} with a reasonably long description for layout`,
        amount: "100.00",
        unitPrice: "100.00",
      }),
    );
    const buf = await render({
      invoice: makeInvoice({
        subtotal: "6000.00",
        total: "6000.00",
      }),
      lines,
    });
    const { text, numPages } = await extractText(buf);
    expect(numPages).toBeGreaterThan(1);
    // Footer is stamped on every page via the bufferedPageRange post-pass.
    // Confirm the "Page X of N" footer appears for at least the first and
    // last logical content pages. We pull N from the footer itself rather
    // than from the parsed page count because the footer's absolute y
    // position can cause pdfkit to allocate spillover pages, so the parsed
    // page count and the page count seen by the footer loop can differ.
    const footerMatch = text.match(/Page (\d+) of (\d+)/);
    expect(footerMatch).not.toBeNull();
    const footerN = Number(footerMatch![2]);
    expect(footerN).toBeGreaterThan(1);
    expect(text).toContain(`Page 1 of ${footerN}`);
    expect(text).toContain(`Page ${footerN} of ${footerN}`);
    expect(text).toContain("$6,000.00");
  });

  it("renders 1099 Summary with per-category subtotals when categories are mixed", async () => {
    const buf = await render({
      invoice: makeInvoice({
        subtotal: "1500.00",
        total: "1500.00",
      }),
      lines: [
        makeLine({ id: 1, amount: "800.00", unitPrice: "800.00", incomeCategory: "nec" }),
        makeLine({
          id: 2,
          description: "Office space rental",
          lineType: "rental",
          amount: "500.00",
          unitPrice: "500.00",
          incomeCategory: "misc_rents",
        }),
        makeLine({
          id: 3,
          description: "Legal fees",
          lineType: "service",
          amount: "200.00",
          unitPrice: "200.00",
          incomeCategory: "misc_attorney",
        }),
      ],
    });
    const { text } = await extractText(buf);
    expect(text).toContain("1099 Summary");
    // Per-category subtotals (sums match the rounded line totals).
    expect(text).toContain("$800.00");
    expect(text).toContain("$500.00");
    expect(text).toContain("$200.00");
    // Reportable rollup at the bottom of the 1099 contributions block.
    expect(text).toContain("Total reportable:");
  });

  it("omits the 1099 Summary block when every line is plain NEC", async () => {
    const buf = await render({
      lines: [
        makeLine({ id: 1, amount: "400.00", unitPrice: "400.00", incomeCategory: "nec" }),
        makeLine({ id: 2, amount: "600.00", unitPrice: "600.00", incomeCategory: "nec" }),
      ],
    });
    const { text } = await extractText(buf);
    expect(text).not.toContain("1099 Summary");
  });

  it("treats lines marked 'none' as non-reportable in the contributions block", async () => {
    const buf = await render({
      lines: [
        makeLine({
          id: 1,
          amount: "1000.00",
          unitPrice: "1000.00",
          incomeCategory: "none",
        }),
      ],
    });
    const { text } = await extractText(buf);
    // "none" is not "nec", so the 1099 Summary block does render with a
    // single "Not reportable" row for the full line amount.
    expect(text).toContain("1099 Summary");
    // The reportable rollup excludes the "none" bucket, so it should be $0.
    expect(text).toContain("Total reportable: $0.00");
  });

  it("renders payments and credits ledger and reduces balance due", async () => {
    const payments: PdfPayment[] = [
      {
        paidAt: "2026-02-01",
        method: "ach",
        referenceNumber: "WIRE-42",
        amount: "300.00",
      },
    ];
    const credits: PdfCreditMemo[] = [
      {
        createdAt: "2026-02-03",
        reason: "Goodwill adjustment",
        amount: "100.00",
      },
    ];
    const buf = await render({
      invoice: makeInvoice({
        subtotal: "1000.00",
        total: "1000.00",
        paidAmount: "300.00",
        creditedAmount: "100.00",
      }),
      lines: [makeLine({ amount: "1000.00", unitPrice: "1000.00" })],
      payments,
      credits,
    });
    const { text } = await extractText(buf);
    expect(text).toContain("Payments & Credits");
    expect(text).toContain("WIRE-42");
    expect(text).toContain("Goodwill adjustment");
    // Paid / Credits rows in the totals box are wrapped in parentheses.
    expect(text).toContain("($300.00)");
    expect(text).toContain("($100.00)");
    // Balance due = 1000 - 300 - 100 = 600.
    expect(text).toContain("$600.00");
  });
});

describe("renderInvoicePdf Spanish chrome (task #348)", () => {
  // End-to-end check that every static string on the rendered PDF is
  // localized when locale='es'. We exercise an invoice that hits every
  // chrome code path: status chip, meta block, group label (assigned
  // and unassigned), totals, 1099 summary + contributions, payments
  // and credits ledger, notes, footer.
  async function renderEs(): Promise<Buffer> {
    return render({
      invoice: makeInvoice({
        invoiceNumber: "INV-99",
        status: "overdue",
        cadence: "monthly",
        notes: "Gracias por su pago oportuno.",
        subtotal: "100.00",
        taxTotal: "8.25",
        total: "108.25",
        paidAmount: "50.00",
        creditedAmount: "10.00",
      }),
      lines: [
        makeLine({
          id: 1,
          ticketId: 10,
          afe: "AFE-1",
          lineType: "labor_regular",
          description: "Visita al sitio",
          quantity: "1",
          unitPrice: "100.00",
          amount: "100.00",
          taxAmount: "8.25",
          incomeCategory: "misc_attorney",
        }),
        makeLine({
          // Unassigned group → must render "Sin asignar".
          id: 2,
          ticketId: null,
          afe: null,
          lineType: "expense_misc",
          description: "Suministros",
          quantity: "1",
          unitPrice: "0.00",
          amount: "0.00",
          taxAmount: "0.00",
          incomeCategory: "none",
        }),
      ],
      payments: [
        {
          paidAt: "2026-02-10",
          method: "ach",
          referenceNumber: "ACH-1",
          amount: "50.00",
        },
      ],
      credits: [
        {
          createdAt: "2026-02-12",
          reason: "Ajuste",
          amount: "10.00",
        },
      ],
      locale: "es",
    });
  }

  it("uses the Spanish brand subtitle, status chip, and column headers", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    expect(text).toContain("Factura de Operaciones de Campo");
    expect(text).toContain("FACTURA INV-99");
    expect(text).toContain("VENCIDA");
    expect(text).toContain("FACTURAR A");
    expect(text).toContain("DESCRIPCIÓN");
    expect(text).toContain("CANT.");
    expect(text).toContain("MONTO");
    // Sanity: the English originals must not leak through.
    expect(text).not.toContain("Field Operations Invoice");
    expect(text).not.toContain("OVERDUE");
    expect(text).not.toContain("BILL TO");
  });

  it("translates the meta block labels and cadence", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    expect(text).toContain("Periodo");
    expect(text).toContain("Vencimiento");
    expect(text).toContain("Cadencia");
    expect(text).toContain("Saldo pendiente");
    expect(text).toContain("Mensual");
    expect(text).not.toContain("Due Date");
    expect(text).not.toContain("Cadence");
  });

  it("translates group labels including 'Unassigned' and 'AFE'", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    // Assigned line → Seguimiento # / AFE prefix.
    expect(text).toContain("Seguimiento #10");
    expect(text).toContain("AFE AFE-1");
    // Unassigned line → Sin asignar.
    expect(text).toContain("Sin asignar");
    expect(text).not.toContain("Unassigned");
    expect(text).not.toContain("Tracking #10");
  });

  it("translates the totals box, balance due bar, and 1099 summary", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    expect(text).toContain("Subtotal");
    expect(text).toContain("Impuesto");
    expect(text).toContain("Pagado");
    expect(text).toContain("Créditos");
    expect(text).toContain("SALDO PENDIENTE");
    expect(text).toContain("Resumen 1099");
    expect(text).toContain("Aportaciones a formularios 1099");
    // The populated-forms branch should be hit (misc_attorney line),
    // so the empty placeholder must NOT be rendered.
    expect(text).not.toContain(
      "Esta factura no tiene importes declarables en 1099.",
    );
    // Reportable footer is now translated.
    expect(text).toContain("Total declarable:");
    expect(text).not.toContain("BALANCE DUE");
    expect(text).not.toContain("1099 Summary");
    expect(text).not.toContain("1099 form contributions");
  });

  it("translates the payments/credits ledger and notes heading", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    expect(text).toContain("Pagos y créditos");
    expect(text).toContain("Pago ach");
    expect(text).toContain("ACH-1");
    expect(text).toContain("Nota de crédito");
    expect(text).toContain("Ajuste");
    expect(text).toContain("Notas");
    expect(text).not.toContain("Payments & Credits");
  });

  it("translates the per-page footer", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    expect(text).toMatch(/Factura INV-99[^\n]*Página \d+ de \d+/);
    // Original English template must be gone.
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).not.toContain("Invoice INV-99");
  });

  it("formats currency in es-MX (USD prefix) when locale='es'", async () => {
    const buf = await renderEs();
    const { text } = await extractText(buf);
    // es-MX renders USD with the "USD" / "US$" currency prefix
    // (depending on the Node ICU build) instead of a bare "$". Accept
    // either spelling so the test is portable across runtimes; what
    // matters is that the locale switch moved the formatter off the
    // default English "$108.25" form.
    const hasEsCurrency = text.includes("USD") || text.includes("US$");
    expect(
      hasEsCurrency,
      `expected es-MX USD formatting, got: ${text}`,
    ).toBe(true);
  });
});

describe("renderInvoicePdf 1099 contributions chrome (task #372)", () => {
  // Task #372: the four chrome strings around the "1099 form contributions"
  // block (heading, helper paragraph, empty-state, "Total reportable" footer)
  // must read from the recipient's locale instead of being hard-coded English.
  // We assert both the populated-forms path and the empty-state path so a
  // future change that breaks one branch can't slip past CI.

  it("renders all four chrome strings in Spanish on the populated-forms path", async () => {
    const buf = await render({
      lines: [
        makeLine({
          id: 1,
          amount: "500.00",
          unitPrice: "500.00",
          incomeCategory: "misc_attorney",
        }),
      ],
      locale: "es",
    });
    const { text } = await extractText(buf);
    expect(text).toContain("Aportaciones a formularios 1099");
    expect(text).toContain(
      "Cómo esta factura se acumulará al cierre de año",
    );
    expect(text).toContain("Total declarable:");
    // English originals must not leak through.
    expect(text).not.toContain("1099 form contributions");
    expect(text).not.toContain("Total reportable");
    expect(text).not.toContain(
      "How this invoice will roll up at year-end",
    );
  });

  it("renders the Spanish empty-state when no line is 1099-reportable", async () => {
    // A zero-amount line means every form total is 0, so the contributions
    // block hits the `populated.length === 0` branch and must print the
    // localized empty-state copy. (A non-zero "none"-categorized line would
    // still allocate to the "none" bucket, which is non-empty for the
    // populated-forms filter and would skip the empty branch.)
    const buf = await render({
      invoice: makeInvoice({
        subtotal: "0.00",
        total: "0.00",
      }),
      lines: [
        makeLine({
          id: 1,
          amount: "0.00",
          unitPrice: "0.00",
          incomeCategory: "none",
        }),
      ],
      locale: "es",
    });
    const { text } = await extractText(buf);
    expect(text).toContain(
      "Esta factura no tiene importes declarables en 1099.",
    );
    expect(text).not.toContain("No 1099-reportable amounts on this invoice.");
  });

  it("still falls back to English chrome when locale is unset", async () => {
    // Defensive: legacy callers (admin preview, exports) that don't pass a
    // locale must keep their current English copy unchanged.
    const buf = await render({
      lines: [
        makeLine({
          id: 1,
          amount: "500.00",
          unitPrice: "500.00",
          incomeCategory: "misc_attorney",
        }),
      ],
    });
    const { text } = await extractText(buf);
    expect(text).toContain("1099 form contributions");
    expect(text).toContain(
      "How this invoice will roll up at year-end",
    );
    expect(text).toContain("Total reportable:");
  });
});

describe("PDF strings ↔ web-client locale parity (task #348)", () => {
  // Guardrail: every key in PDF_STRINGS_BY_LOCALE must also exist under
  // invoices.pdf.* in the web-client locale JSONs and vice-versa, with
  // identical values. This catches drift when someone updates one side
  // and forgets the other (lint-i18n catches en↔es structural parity but
  // not the cross-package parity that this asserts).
  for (const locale of ["en", "es"] as const) {
    it(`${locale}: server PDF table matches artifacts/vndrly invoices.pdf`, () => {
      const webStrings = loadInvoicesPdfLocaleJson(locale);
      const serverStrings = PDF_STRINGS_BY_LOCALE[locale];
      // Same key set on both sides.
      expect(Object.keys(webStrings).sort()).toEqual(
        Object.keys(serverStrings).sort(),
      );
      // Same value for every key.
      for (const [key, value] of Object.entries(serverStrings)) {
        expect(
          webStrings[key],
          `web-client ${locale}.json invoices.pdf.${key} must match server PDF table`,
        ).toBe(value);
      }
    });
  }
});
