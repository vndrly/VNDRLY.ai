export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function toCsv(headers: string[], rows: unknown[][]) { return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"); }
export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Small RFC-4180 reader for local preview, including quoted newlines and escaped quotes. */
export function parseCsv(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error("Choose a CSV smaller than 2 MB.");
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else value += c;
    if (rows.length > 10000) throw new Error("Preview supports up to 10,000 rows.");
  }
  if (quoted) throw new Error("A quoted field is not closed.");
  row.push(value); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error("This CSV is empty.");
  if (rows.some(r => r.length !== rows[0].length)) throw new Error("CSV rows must have the same number of columns.");
  return rows;
}
