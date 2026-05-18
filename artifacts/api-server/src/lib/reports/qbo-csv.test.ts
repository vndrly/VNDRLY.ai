import { describe, expect, it } from "vitest";
import { invoicesCsv, vendorsCsv, customersCsv, readmeQbo } from "./qbo-csv";
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

describe("invoicesCsv (QBO)", () => {
  it("declares an IncomeCategory column in the header", () => {
    const out = invoicesCsv([baseInvoice], []);
    const header = out.split(/\r?\n/)[0];
    expect(header.split(",")).toContain("IncomeCategory");
  });

  it("populates the IncomeCategory column with the human label per line", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Legal review",
        amount: "1000.00",
        taxAmount: "80.00",
        lineType: "labor_regular",
        incomeCategory: "misc_attorney",
      },
    ];
    const out = invoicesCsv([baseInvoice], lines);
    expect(out).toContain("Attorney fees – 1099-MISC Box 10");
  });

  it("appends a [1099: <label>] suffix to ItemDescription so the tag survives import", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Legal review",
        amount: "1000.00",
        taxAmount: "80.00",
        lineType: "labor_regular",
        incomeCategory: "misc_attorney",
      },
    ];
    const out = invoicesCsv([baseInvoice], lines);
    const dataRow = out.split(/\r?\n/)[1];
    // The bracketed 1099 tag should be glued onto the description in the
    // ItemDescription column. (No CSV-special chars, so unquoted.)
    expect(dataRow).toContain(
      "Legal review [1099: Attorney fees – 1099-MISC Box 10]",
    );
  });

  it("leaves IncomeCategory empty and skips the description tag for 'none'", () => {
    const lines: IifInvoiceLine[] = [
      {
        invoiceNumber: "INV-1001",
        description: "Reimbursement",
        amount: "100.00",
        taxAmount: "0.00",
        lineType: "other",
        incomeCategory: "none",
      },
    ];
    const out = invoicesCsv([baseInvoice], lines);
    expect(out).not.toContain("[1099:");
    // Last column on the data row should be empty (trailing comma + EOL).
    const dataRow = out.split(/\r?\n/)[1];
    expect(dataRow.endsWith(",")).toBe(true);
  });

  it("emits one empty IncomeCategory column for header-only invoices (no lines)", () => {
    const out = invoicesCsv([baseInvoice], []);
    const dataRow = out.split(/\r?\n/)[1];
    // Same column count as the header, with the trailing IncomeCategory empty.
    const headerCount = out.split(/\r?\n/)[0].split(",").length;
    // Counting columns on a row that contains a quoted/comma value is
    // tricky; instead, just assert the row ends with an empty trailing
    // cell and the header count matches expectation.
    expect(headerCount).toBe(10);
    expect(dataRow.endsWith(",")).toBe(true);
  });
});

describe("readmeQbo / customersCsv / vendorsCsv (smoke)", () => {
  it("README documents the new IncomeCategory column", () => {
    const txt = readmeQbo("Apr 2026", "Winchester");
    expect(txt).toMatch(/IncomeCategory/);
    expect(txt).toMatch(/1099/);
  });

  it("customer / vendor CSVs are unaffected by the 1099 column", () => {
    const c = customersCsv([
      { name: "P", email: "p@x.com", address: "1 St" },
    ]);
    const v = vendorsCsv([
      { name: "V", email: "v@x.com", address: "2 St", federalTaxId: "11" },
    ]);
    expect(c.split(/\r?\n/)[0]).not.toContain("IncomeCategory");
    expect(v.split(/\r?\n/)[0]).not.toContain("IncomeCategory");
  });
});
