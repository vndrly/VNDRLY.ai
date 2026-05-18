// RFC 4180 CSV writer. Quotes any field that contains comma, quote, CR,
// or LF; doubles internal quotes; uses CRLF line endings (Excel-friendly).
//
// Formula-injection defense: cells whose first character is a spreadsheet
// formula trigger (=, +, -, @, tab) are prefixed with a tab character so
// that Excel / LibreOffice treat the field as plain text rather than
// evaluating it as a formula.  The tab prefix is invisible in most UIs and
// does not alter the semantic value for downstream import wizards.

export type CsvCell = string | number | null | undefined;

const NEEDS_QUOTING = /[",\r\n\t]/;

// Characters that cause spreadsheet applications to treat a cell as a formula
// even when the field is RFC-4180 quoted.
//
// `=` and `@` are always formula triggers.
// `+` and `-` are only triggers when NOT immediately followed by a digit or
// decimal point — this preserves plain negative/positive numeric strings such
// as "-2.50" or "+0.00" while still neutralizing operator-prefixed payloads
// like "-SUM(A1)" or "+HYPERLINK(...)".
// A leading tab is also a known formula-injection vector.
const FORMULA_TRIGGERS = /^([=@\t]|[+\-](?![\d.]))/;

export function csvEscape(v: CsvCell): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralize formula injection: prefix dangerous cells with a tab so the
  // spreadsheet cannot interpret the cell as a formula.
  if (FORMULA_TRIGGERS.test(s)) {
    s = `\t${s}`;
  }
  if (NEEDS_QUOTING.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(r.map(csvEscape).join(","));
  }
  // Trailing CRLF is conventional; Excel accepts either way.
  return lines.join("\r\n") + "\r\n";
}

export function csvFilename(parts: string[], ext = "csv"): string {
  const safe = parts
    .filter(Boolean)
    .map((p) => p.replace(/[^A-Za-z0-9_-]+/g, "_"))
    .join("-");
  return `${safe || "export"}.${ext}`;
}
