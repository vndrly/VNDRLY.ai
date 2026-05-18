import { describe, expect, it } from "vitest";
import { oaInvoicesCsv, readmeOa } from "./oa-csv";
import type { IifInvoice, IifInvoiceLine } from "./iif";

const baseInvoice: IifInvoice = {
  invoiceNumber: "INV-1001",
  invoiceDate: new Date(Date.UTC(2026, 3, 15)),
  dueDate: new Date(Date.UTC(2026, 4, 15)),
  total: "1080.00",
  subtotal: "1000.00",
  taxTotal: "80.00",
  memo: "April pad work",
  partnerName: "Mach Resources",
  vendorName: "Winchester",
};

describe("oaInvoicesCsv", () => {
  it("declares both income_category columns in the header", () => {
    const out = oaInvoicesCsv([baseInvoice], []);
    const cols = out.split(/\r?\n/)[0].split(",");
    expect(cols).toContain("income_category");
    expect(cols).toContain("income_category_label");
  });

  it("emits the raw key + human label per line", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Rent on yard",
        amount: "500.00",
        taxAmount: "0.00",
        lineType: "other",
        incomeCategory: "misc_rents",
      },
    ];
    const out = oaInvoicesCsv([baseInvoice], lines);
    expect(out).toContain("misc_rents");
    expect(out).toContain("Rent – 1099-MISC Box 1");
  });

  it("appends a [1099: <label>] tag to the memo so it survives even if the column-mapper drops the dedicated columns", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Rent on yard",
        amount: "500.00",
        taxAmount: "0.00",
        lineType: "other",
        incomeCategory: "misc_rents",
      },
    ];
    const out = oaInvoicesCsv([baseInvoice], lines);
    // The memo column carries the original invoice memo plus the tag suffix.
    expect(out).toContain("[1099: Rent – 1099-MISC Box 1]");
  });

  it("does not add the memo tag for 'none' lines", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Reimbursement",
        amount: "50.00",
        taxAmount: "0.00",
        lineType: "other",
        incomeCategory: "none",
      },
    ];
    const out = oaInvoicesCsv([baseInvoice], lines);
    expect(out).not.toContain("[1099:");
  });

  it("leaves the income_category cells blank when the line has no category", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Untagged legacy line",
        amount: "100.00",
        taxAmount: "0.00",
        lineType: "other",
      },
    ];
    const out = oaInvoicesCsv([baseInvoice], lines);
    const dataRow = out.split(/\r?\n/)[1];
    // The last two CSV cells should be empty (manifested by trailing comma + EOL).
    expect(dataRow.endsWith(",")).toBe(true);
  });

  it("preserves the 'none' classification verbatim (it's not the same as missing)", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Reimbursement",
        amount: "50.00",
        taxAmount: "0.00",
        lineType: "other",
        incomeCategory: "none",
      },
    ];
    const out = oaInvoicesCsv([baseInvoice], lines);
    expect(out).toContain("none");
    expect(out).toContain("Not reportable");
  });
});

describe("readmeOa", () => {
  it("documents the new income_category columns", () => {
    const txt = readmeOa("Apr 2026", "Winchester");
    expect(txt).toMatch(/income_category/);
    expect(txt).toMatch(/income_category_label/);
  });
});
