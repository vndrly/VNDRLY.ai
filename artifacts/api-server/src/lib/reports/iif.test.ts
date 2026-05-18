import { describe, expect, it } from "vitest";
import { renderIif } from "./iif";
import { buildResolver, LINE_TYPE_AR, LINE_TYPE_TAX_PAYABLE } from "./qb-mapping";

describe("renderIif", () => {
  const baseInput = {
    partners: [{ name: "Mach Resources", email: "ap@mach.com", address: "100 Main St" }],
    vendors: [
      {
        name: "Winchester",
        email: "ar@winchester.com",
        address: "200 Oak Ave",
        federalTaxId: "12-3456789",
      },
    ],
    invoices: [
      {
        invoiceNumber: "INV-1001",
        invoiceDate: new Date(Date.UTC(2026, 3, 15)),
        dueDate: new Date(Date.UTC(2026, 4, 15)),
        total: "1080.00",
        subtotal: "1000.00",
        taxTotal: "80.00",
        memo: "April pad work",
        partnerName: "Mach Resources",
        vendorName: "Winchester",
      },
    ],
    lines: [
      {
        invoiceNumber: "INV-1001",
        description: "Labor — regular",
        amount: "1000.00",
        taxAmount: "80.00",
        lineType: "labor_regular",
        incomeCategory: "nec",
      },
    ],
  };

  it("includes all required header lines", () => {
    const out = renderIif(baseInput);
    expect(out).toMatch(/^!ACCNT\t/m);
    expect(out).toMatch(/^!CUST\t/m);
    expect(out).toMatch(/^!VEND\t/m);
    expect(out).toMatch(/^!TRNS\t/m);
    expect(out).toMatch(/^!SPL\t/m);
    expect(out).toMatch(/^!ENDTRNS$/m);
  });

  it("uses tab separators (no commas)", () => {
    const out = renderIif(baseInput);
    const dataLine = out.split(/\r?\n/).find((l) => l.startsWith("CUST\t"));
    expect(dataLine).toBeDefined();
    expect(dataLine!.split("\t").length).toBeGreaterThanOrEqual(4);
  });

  it("emits one TRNS, balanced SPLs, and ENDTRNS per invoice", () => {
    const out = renderIif(baseInput);
    const lines = out.split(/\r?\n/).filter(Boolean);
    const trns = lines.filter((l) => l.startsWith("TRNS\t"));
    const endtrns = lines.filter((l) => l === "ENDTRNS");
    expect(trns.length).toBe(1);
    expect(endtrns.length).toBe(1);
  });

  it("balances TRNS debit against SPL credits to zero", () => {
    const out = renderIif(baseInput);
    const lines = out.split(/\r?\n/).filter(Boolean);
    let sum = 0;
    for (const l of lines) {
      if (l.startsWith("TRNS\t") || l.startsWith("SPL\t")) {
        const cols = l.split("\t");
        const amt = parseFloat(cols[6]);
        if (!isNaN(amt)) sum += amt;
      }
    }
    expect(Math.abs(sum)).toBeLessThan(0.01);
  });

  it("skips zero-total invoices", () => {
    const out = renderIif({
      ...baseInput,
      invoices: [{ ...baseInput.invoices[0], total: "0.00" }],
      lines: [],
    });
    expect(out).not.toMatch(/^TRNS\t/m);
  });

  it("uses an override resolver to swap the income account name", () => {
    const resolver = buildResolver([
      {
        vendorId: null,
        partnerId: null,
        lineType: "labor_regular",
        accountName: "Custom Labor Income",
        accountNumber: null,
      },
    ]);
    const out = renderIif({ ...baseInput, resolver });
    // The SPL line for the labor line should reference the custom account.
    const splLine = out
      .split(/\r?\n/)
      .find((l) => l.startsWith("SPL\t") && l.includes("Custom Labor Income"));
    expect(splLine).toBeDefined();
    // ACCNT block must declare the custom account too.
    expect(out).toMatch(/ACCNT\tCustom Labor Income\t/);
    // The original "Service Income" account should NOT be declared since
    // no other line type currently maps to it for this input.
    expect(out).not.toMatch(/ACCNT\tService Income\t/);
  });

  it("uses scoped overrides per (vendor, partner)", () => {
    const resolver = buildResolver([
      {
        vendorId: 7,
        partnerId: 11,
        lineType: "labor_regular",
        accountName: "Vendor7Partner11 Labor",
        accountNumber: null,
      },
    ]);
    const scoped = {
      ...baseInput,
      invoices: [{ ...baseInput.invoices[0], vendorId: 7, partnerId: 11 }],
    };
    const out = renderIif({ ...scoped, resolver });
    expect(out).toMatch(/Vendor7Partner11 Labor/);
    // unrelated scope falls back to default
    const unrelated = {
      ...baseInput,
      invoices: [{ ...baseInput.invoices[0], vendorId: 99, partnerId: 99 }],
    };
    const out2 = renderIif({ ...unrelated, resolver });
    expect(out2).toMatch(/Service Income/);
    expect(out2).not.toMatch(/Vendor7Partner11/);
  });

  it("uses overridden AR + Sales Tax Payable accounts in TRNS / SPL output", () => {
    const resolver = buildResolver([
      {
        vendorId: null,
        partnerId: null,
        lineType: LINE_TYPE_AR,
        accountName: "Custom A/R",
        accountNumber: null,
      },
      {
        vendorId: null,
        partnerId: null,
        lineType: LINE_TYPE_TAX_PAYABLE,
        accountName: "Custom Tax",
        accountNumber: null,
      },
    ]);
    const out = renderIif({ ...baseInput, resolver });
    const trns = out.split(/\r?\n/).find((l) => l.startsWith("TRNS\t"));
    expect(trns).toBeDefined();
    expect(trns).toContain("Custom A/R");
    expect(out).toMatch(/SPL\t.*Custom Tax/);
  });

  it("appends a [1099: <label>] tag to the SPL memo for non-default categories", () => {
    const out = renderIif({
      ...baseInput,
      lines: [
        { ...baseInput.lines[0], incomeCategory: "misc_attorney" },
      ],
    });
    const spl = out.split(/\r?\n/).find((l) => l.startsWith("SPL\t"));
    expect(spl).toBeDefined();
    expect(spl).toContain("[1099: Attorney fees – 1099-MISC Box 10]");
  });

  it("includes the NEC tag on default lines so accountants can audit every line", () => {
    const out = renderIif(baseInput);
    const spl = out.split(/\r?\n/).find((l) => l.startsWith("SPL\t"));
    expect(spl).toBeDefined();
    expect(spl).toContain("[1099: Service – 1099-NEC]");
  });

  it("omits the 1099 tag entirely for the 'none' (not reportable) category", () => {
    const out = renderIif({
      ...baseInput,
      lines: [{ ...baseInput.lines[0], incomeCategory: "none" }],
    });
    expect(out).not.toContain("[1099:");
  });

  it("strips tabs/newlines from values to keep IIF parseable", () => {
    const out = renderIif({
      ...baseInput,
      partners: [
        { name: "Bad\tName\nCo", email: null, address: "A\rB" },
      ],
    });
    const cust = out.split(/\r?\n/).find((l) => l.startsWith("CUST\t"));
    expect(cust).toBeDefined();
    expect(cust).not.toMatch(/Bad\tName/);
    expect(cust).toContain("Bad Name Co");
  });
});
