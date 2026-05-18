import { describe, expect, it } from "vitest";
import {
  buildResolver,
  classifyCsvImport,
  defaultAccountForKey,
  defaultResolver,
  expandBulkScopes,
  parseQbMappingCsv,
  readCsv,
  LINE_TYPE_AR,
  LINE_TYPE_TAX_PAYABLE,
  MAPPABLE_LINE_TYPES,
  type ExistingMappingRow,
  type QbAccountOverride,
} from "./qb-mapping";

const KNOWN_LINE_TYPES = new Set(MAPPABLE_LINE_TYPES.map((m) => m.key));

describe("qb-mapping defaults", () => {
  it("returns built-in default for known line types", () => {
    expect(defaultAccountForKey("labor_regular").name).toBe("Service Income");
    expect(defaultAccountForKey("equipment").name).toBe(
      "Equipment Rental Income",
    );
  });

  it("returns AR / Sales Tax for special keys", () => {
    expect(defaultAccountForKey(LINE_TYPE_AR).name).toBe("Accounts Receivable");
    expect(defaultAccountForKey(LINE_TYPE_TAX_PAYABLE).name).toBe(
      "Sales Tax Payable",
    );
  });

  it("falls back to Other Income for unknown line types", () => {
    expect(defaultAccountForKey("totally_unknown").name).toBe("Other Income");
  });

  it("defaultResolver ignores scope and returns the default", () => {
    const acct = defaultResolver("labor_regular", { vendorId: 1, partnerId: 2 });
    expect(acct.name).toBe("Service Income");
  });
});

describe("buildResolver", () => {
  it("returns default when no overrides match", () => {
    const r = buildResolver([]);
    expect(r("labor_regular").name).toBe("Service Income");
  });

  it("uses a global override (vendorId=null, partnerId=null)", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: null,
        partnerId: null,
        lineType: "labor_regular",
        accountName: "Custom Labor",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r("labor_regular").name).toBe("Custom Labor");
    // unrelated line types still hit default
    expect(r("materials").name).toBe("Materials Income");
  });

  it("vendor-only override beats global override", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: null,
        partnerId: null,
        lineType: "materials",
        accountName: "Global Materials",
        accountNumber: null,
      },
      {
        vendorId: 7,
        partnerId: null,
        lineType: "materials",
        accountName: "Vendor7 Materials",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r("materials", { vendorId: 7 }).name).toBe("Vendor7 Materials");
    // a different vendor sees the global override
    expect(r("materials", { vendorId: 99 }).name).toBe("Global Materials");
    // no scope at all → global
    expect(r("materials").name).toBe("Global Materials");
  });

  it("vendor+partner override beats vendor-only", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: 7,
        partnerId: null,
        lineType: "equipment",
        accountName: "Vendor7 Eq",
        accountNumber: null,
      },
      {
        vendorId: 7,
        partnerId: 11,
        lineType: "equipment",
        accountName: "Vendor7+Partner11 Eq",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r("equipment", { vendorId: 7, partnerId: 11 }).name).toBe(
      "Vendor7+Partner11 Eq",
    );
    expect(r("equipment", { vendorId: 7, partnerId: 99 }).name).toBe(
      "Vendor7 Eq",
    );
  });

  it("partner-only override applies when no vendor override exists", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: null,
        partnerId: 22,
        lineType: "mileage",
        accountName: "Partner22 Mileage",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r("mileage", { vendorId: 7, partnerId: 22 }).name).toBe(
      "Partner22 Mileage",
    );
    expect(r("mileage", { vendorId: 7, partnerId: 99 }).name).toBe(
      "Mileage Income",
    );
  });

  it("override accountNumber is used when set, otherwise falls back to default number", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: null,
        partnerId: null,
        lineType: "labor_regular",
        accountName: "Custom Labor",
        accountNumber: "9999",
      },
      {
        vendorId: null,
        partnerId: null,
        lineType: "materials",
        accountName: "Custom Materials",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r("labor_regular").number).toBe("9999");
    expect(r("materials").number).toBe("4020");
  });

  it("preserves the qbType from the default for the line type", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: null,
        partnerId: null,
        lineType: "discount",
        accountName: "Custom Discount",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r("discount").qbType).toBe("EXINC");
  });

  it("can override AR and Sales Tax Payable", () => {
    const overrides: QbAccountOverride[] = [
      {
        vendorId: 7,
        partnerId: null,
        lineType: LINE_TYPE_AR,
        accountName: "1100 - A/R",
        accountNumber: "1100",
      },
      {
        vendorId: 7,
        partnerId: null,
        lineType: LINE_TYPE_TAX_PAYABLE,
        accountName: "Sales Tax Liability",
        accountNumber: null,
      },
    ];
    const r = buildResolver(overrides);
    expect(r(LINE_TYPE_AR, { vendorId: 7 }).name).toBe("1100 - A/R");
    expect(r(LINE_TYPE_TAX_PAYABLE, { vendorId: 7 }).name).toBe(
      "Sales Tax Liability",
    );
    expect(r(LINE_TYPE_AR, { vendorId: 7 }).qbType).toBe("AR");
  });
});

describe("expandBulkScopes", () => {
  it("returns the global (null,null) scope when nothing is selected", () => {
    expect(expandBulkScopes({})).toEqual([{ vendorId: null, partnerId: null }]);
    expect(expandBulkScopes({ vendorIds: [], partnerIds: [] })).toEqual([
      { vendorId: null, partnerId: null },
    ]);
  });

  it("fans out per vendor when only vendors are picked", () => {
    expect(expandBulkScopes({ vendorIds: [1, 2] })).toEqual([
      { vendorId: 1, partnerId: null },
      { vendorId: 2, partnerId: null },
    ]);
  });

  it("fans out per partner when only partners are picked", () => {
    expect(expandBulkScopes({ partnerIds: [9, 10] })).toEqual([
      { vendorId: null, partnerId: 9 },
      { vendorId: null, partnerId: 10 },
    ]);
  });

  it("emits the cross-product when both axes are populated", () => {
    expect(
      expandBulkScopes({ vendorIds: [1, 2], partnerIds: [9, 10] }),
    ).toEqual([
      { vendorId: 1, partnerId: 9 },
      { vendorId: 1, partnerId: 10 },
      { vendorId: 2, partnerId: 9 },
      { vendorId: 2, partnerId: 10 },
    ]);
  });

  it("dedupes duplicate ids on either axis", () => {
    expect(
      expandBulkScopes({ vendorIds: [1, 1, 2], partnerIds: [9, 9] }),
    ).toEqual([
      { vendorId: 1, partnerId: 9 },
      { vendorId: 2, partnerId: 9 },
    ]);
  });
});

describe("readCsv", () => {
  it("parses simple comma-separated rows", () => {
    expect(readCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted cells with commas, doubled quotes, and CRLF", () => {
    const text = 'h1,h2\r\n"hello, world","she said ""hi"""\r\n';
    expect(readCsv(text)).toEqual([
      ["h1", "h2"],
      ["hello, world", 'she said "hi"'],
    ]);
  });

  it("drops fully-blank trailing rows", () => {
    expect(readCsv("a,b\n1,2\n\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseQbMappingCsv", () => {
  it("parses a valid mapping CSV with optional vendor/partner ids", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      ",,labor_regular,Custom Labor,4001\n" +
      "5,,materials,Vendor5 Materials,\n" +
      ",9,equipment,Partner9 Eq,4011\n" +
      "5,9,mileage,V5+P9 Mileage,\n";
    const out = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    expect(out.errors).toEqual([]);
    expect(out.rows).toEqual([
      {
        rowNumber: 2,
        vendorId: null,
        partnerId: null,
        lineType: "labor_regular",
        accountName: "Custom Labor",
        accountNumber: "4001",
      },
      {
        rowNumber: 3,
        vendorId: 5,
        partnerId: null,
        lineType: "materials",
        accountName: "Vendor5 Materials",
        accountNumber: null,
      },
      {
        rowNumber: 4,
        vendorId: null,
        partnerId: 9,
        lineType: "equipment",
        accountName: "Partner9 Eq",
        accountNumber: "4011",
      },
      {
        rowNumber: 5,
        vendorId: 5,
        partnerId: 9,
        lineType: "mileage",
        accountName: "V5+P9 Mileage",
        accountNumber: null,
      },
    ]);
  });

  it("ignores extra columns and is case-insensitive on header names", () => {
    const csv =
      "VENDOR_ID,vendor_name,LINE_TYPE,Account_Name,partner_id,extra,account_number\n" +
      "5,Acme,labor_regular,Custom,,ignored,\n";
    const out = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      vendorId: 5,
      partnerId: null,
      lineType: "labor_regular",
      accountName: "Custom",
      accountNumber: null,
    });
  });

  it("collects per-row validation errors and keeps valid rows", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      "abc,,labor_regular,Bad Vendor,\n" +
      ",,nope,Unknown Type,\n" +
      ",,,Missing Type,\n" +
      ",,labor_regular,,\n" +
      ",,labor_regular,Good Row,4001\n";
    const out = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].accountName).toBe("Good Row");
    expect(out.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4, 5]);
  });

  it("rejects a CSV without required header columns", () => {
    const out = parseQbMappingCsv("foo,bar\n1,2\n", KNOWN_LINE_TYPES);
    expect(out.rows).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].rowNumber).toBe(1);
  });

  it("treats an empty CSV as zero rows, zero errors", () => {
    expect(parseQbMappingCsv("", KNOWN_LINE_TYPES)).toEqual({
      rows: [],
      errors: [],
    });
  });
});

describe("classifyCsvImport", () => {
  const existing: ExistingMappingRow[] = [
    {
      vendorId: null,
      partnerId: null,
      lineType: "labor_regular",
      accountName: "Service Income",
      accountNumber: "4000",
    },
    {
      vendorId: 5,
      partnerId: null,
      lineType: "materials",
      accountName: "Vendor5 Materials",
      accountNumber: null,
    },
  ];

  it("classifies a brand-new scope as an insert", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      ",,equipment,New Equipment Income,4011\n";
    const parsed = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    const out = classifyCsvImport(parsed, existing);
    expect(out.inserts).toHaveLength(1);
    expect(out.inserts[0].kind).toBe("insert");
    expect(out.inserts[0].lineType).toBe("equipment");
    expect(out.updates).toEqual([]);
    expect(out.unchanged).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  it("classifies a changed scope as an update with old values attached", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      ",,labor_regular,Renamed Labor,4001\n";
    const parsed = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    const out = classifyCsvImport(parsed, existing);
    expect(out.updates).toHaveLength(1);
    expect(out.updates[0]).toMatchObject({
      kind: "update",
      lineType: "labor_regular",
      accountName: "Renamed Labor",
      accountNumber: "4001",
      oldAccountName: "Service Income",
      oldAccountNumber: "4000",
    });
    expect(out.inserts).toEqual([]);
    expect(out.unchanged).toEqual([]);
  });

  it("classifies a byte-identical row as unchanged (treats null/empty number alike)", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      "5,,materials,Vendor5 Materials,\n" +
      ",,labor_regular,Service Income,4000\n";
    const parsed = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    const out = classifyCsvImport(parsed, existing);
    expect(out.unchanged.map((r) => r.lineType).sort()).toEqual([
      "labor_regular",
      "materials",
    ]);
    expect(out.inserts).toEqual([]);
    expect(out.updates).toEqual([]);
  });

  it("forwards parser errors verbatim", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      ",,nope,Unknown Type,\n";
    const parsed = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    const out = classifyCsvImport(parsed, existing);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].rowNumber).toBe(2);
    expect(out.inserts).toEqual([]);
    expect(out.updates).toEqual([]);
  });

  it("scope match keys on the (vendor, partner, line_type) triple — different vendor → insert", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      "9,,materials,Vendor9 Materials,\n";
    const parsed = parseQbMappingCsv(csv, KNOWN_LINE_TYPES);
    const out = classifyCsvImport(parsed, existing);
    expect(out.inserts).toHaveLength(1);
    expect(out.inserts[0]).toMatchObject({
      kind: "insert",
      vendorId: 9,
      lineType: "materials",
    });
    expect(out.updates).toEqual([]);
  });
});
