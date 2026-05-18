import { describe, expect, it } from "vitest";
import { readCsv, suggestCanonicalName, writeCsv } from "./csv";

// These tests lock in the contract between the inline CSV row editor in
// reports.tsx (CsvImportPreviewDialog) and the server-side `readCsv` in
// artifacts/api-server/src/lib/reports/qb-mapping.ts. The dialog parses
// the uploaded CSV, lets admins fix individual cells, then writes it
// back out for a re-validate / apply round-trip — so any drift in
// quoting, escaping, or trailing-line handling between read and write
// silently corrupts user data.

describe("readCsv", () => {
  it("parses a simple header + row", () => {
    expect(readCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("unwraps quoted fields", () => {
    expect(readCsv('a,b\n"hello","world"\n')).toEqual([
      ["a", "b"],
      ["hello", "world"],
    ]);
  });

  it("handles commas inside quoted fields", () => {
    expect(readCsv('name,note\n"Smith, Jane","ok"\n')).toEqual([
      ["name", "note"],
      ["Smith, Jane", "ok"],
    ]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(readCsv('a\n"she said ""hi"""\n')).toEqual([
      ["a"],
      ['she said "hi"'],
    ]);
  });

  it("preserves embedded newlines inside a quoted field", () => {
    expect(readCsv('a,b\n"line1\nline2",x\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("preserves empty trailing fields", () => {
    expect(readCsv("a,b,c\n1,,\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("treats CRLF the same as LF", () => {
    expect(readCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("treats a bare CR before LF as a line ending (no stray cell)", () => {
    // Mixed line endings shouldn't introduce phantom blank rows.
    expect(readCsv("a,b\r\n1,2\r\n3,4\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("returns the last row even without a trailing newline", () => {
    expect(readCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops trailing fully-blank rows", () => {
    expect(readCsv("a,b\n1,2\n\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns an empty matrix for empty input", () => {
    expect(readCsv("")).toEqual([]);
  });
});

describe("writeCsv", () => {
  it("joins simple rows with LF and ends with a trailing newline", () => {
    expect(
      writeCsv([
        ["a", "b"],
        ["1", "2"],
      ]),
    ).toBe("a,b\n1,2\n");
  });

  it("quotes cells that contain commas", () => {
    expect(writeCsv([["Smith, Jane", "ok"]])).toBe('"Smith, Jane",ok\n');
  });

  it("quotes and escapes cells that contain double quotes", () => {
    expect(writeCsv([['she said "hi"']])).toBe('"she said ""hi"""\n');
  });

  it("quotes cells with embedded newlines", () => {
    expect(writeCsv([["line1\nline2", "x"]])).toBe('"line1\nline2",x\n');
  });

  it("preserves empty trailing fields", () => {
    expect(writeCsv([["1", "", ""]])).toBe("1,,\n");
  });

  it("does not add quotes to plain values", () => {
    expect(writeCsv([["plain", "value"]])).toBe("plain,value\n");
  });
});

describe("readCsv + writeCsv round-trip", () => {
  // The inline editor reads the uploaded CSV with `readCsv`, mutates a
  // few cells, then re-serializes with `writeCsv` and ships it back to
  // the server's identical parser. These cases protect that round-trip.

  it("round-trips a typical QB account-mapping CSV byte-for-byte", () => {
    const csv =
      "vendor_id,partner_id,line_type,account_name,account_number\n" +
      "1,,labor,Subcontracted Labor,5010\n" +
      ",2,materials,Job Materials,5020\n";
    expect(writeCsv(readCsv(csv))).toBe(csv);
  });

  it("round-trips quoted commas and escaped quotes", () => {
    const csv =
      'vendor_id,account_name\n' +
      '7,"Smith, Jane"\n' +
      '8,"she said ""hi"""\n';
    expect(writeCsv(readCsv(csv))).toBe(csv);
  });

  it("normalizes CRLF input to LF on the way back out", () => {
    const input = "a,b\r\n1,2\r\n";
    // The server-side parser the dialog re-validates against treats
    // CRLF and LF identically, so collapsing CRLF to LF is the
    // contract: write always uses LF.
    expect(writeCsv(readCsv(input))).toBe("a,b\n1,2\n");
  });

  it("preserves embedded newlines through a round-trip", () => {
    const csv = 'a,b\n"line1\nline2",x\n';
    expect(writeCsv(readCsv(csv))).toBe(csv);
  });

  it("drops trailing blank rows (matches server parser)", () => {
    const csv = "a,b\n1,2\n\n\n";
    expect(writeCsv(readCsv(csv))).toBe("a,b\n1,2\n");
  });
});

describe("suggestCanonicalName", () => {
  // The QB account-mapping import preview pre-picks the most likely
  // canonical name when an admin renames a header cell. These tests pin
  // the cases the header editor relies on so we don't silently start
  // suggesting the wrong column on the next refactor of the helper.
  const CANONICAL = [
    "vendor_id",
    "partner_id",
    "line_type",
    "account_name",
    "account_number",
  ] as const;

  it("matches a separator typo (space → underscore)", () => {
    const m = suggestCanonicalName("line type", CANONICAL);
    expect(m?.name).toBe("line_type");
    expect(m?.similarity).toBeGreaterThanOrEqual(0.99);
  });

  it("matches a casing-only difference", () => {
    const m = suggestCanonicalName("Vendor_ID", CANONICAL);
    expect(m?.name).toBe("vendor_id");
    expect(m?.similarity).toBe(1);
  });

  it("matches a common abbreviation (AcctName → account_name)", () => {
    const m = suggestCanonicalName("AcctName", CANONICAL);
    expect(m?.name).toBe("account_name");
    expect(m?.similarity).toBeGreaterThan(0.5);
  });

  it("matches a typo of an existing canonical (parnter_id → partner_id)", () => {
    const m = suggestCanonicalName("parnter_id", CANONICAL);
    expect(m?.name).toBe("partner_id");
    expect(m?.similarity).toBeGreaterThan(0.7);
  });

  it("returns null for an unrelated header", () => {
    expect(suggestCanonicalName("invoice_total", CANONICAL)).toBeNull();
  });

  it("returns null for an empty / whitespace-only header", () => {
    expect(suggestCanonicalName("", CANONICAL)).toBeNull();
    expect(suggestCanonicalName("   ", CANONICAL)).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(suggestCanonicalName("anything", [])).toBeNull();
  });

  it("respects a stricter threshold", () => {
    // "AcctName" → "account_name" similarity is ~0.73, below 0.9.
    expect(
      suggestCanonicalName("AcctName", CANONICAL, { threshold: 0.9 }),
    ).toBeNull();
  });

  it("prefers the closer of two near-misses", () => {
    // "vendor" is clearly closer to vendor_id than to partner_id.
    const m = suggestCanonicalName("vendor", CANONICAL);
    expect(m?.name).toBe("vendor_id");
  });
});
