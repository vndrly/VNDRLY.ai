// Generic landscape-letter PDF table renderer + IRS-layout 1099-NEC PDF.
//
// Uses pdfkit (already a dependency for invoice PDFs). The 1099 PDF mimics
// the IRS box layout (title, payer/recipient blocks, Box 1 NEC) but is
// explicitly NOT a red-ink filing form — IRS rules require the official
// pre-printed Copy A. We watermark "FOR RECORD-KEEPING ONLY" so users do
// not mistake it for a fileable copy.

import PDFDocument from "pdfkit";

const PAGE = { wL: 792, hL: 612, wP: 612, hP: 792 }; // landscape vs portrait letter
const M = { x: 36, y: 36 };

type Doc = InstanceType<typeof PDFDocument>;

function collect(doc: Doc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export interface ReportTableSpec {
  title: string;
  subtitle?: string;
  /** Period label e.g. "Jan 2026" or "2026 YTD". */
  periodLabel?: string;
  /** "VNDRLY" header brand colour band stays in all reports. */
  columns: { header: string; width: number; align?: "left" | "right" }[];
  rows: (string | number)[][];
  /** Bottom totals row; rendered with bold and a top border. */
  totals?: (string | number)[];
  /** Right-aligned footer note (e.g. disclaimer). */
  footer?: string;
}

export async function renderReportPdf(spec: ReportTableSpec): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margins: { top: M.y, bottom: M.y, left: M.x, right: M.x },
    bufferPages: true,
  });
  const done = collect(doc);

  // Brand band
  doc.rect(0, 0, PAGE.wL, 48).fill("#111827");
  doc
    .fillColor("#f59e0b")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("VNDRLY", M.x, 14, { align: "left" });
  doc
    .fillColor("#fef3c7")
    .font("Helvetica")
    .fontSize(10)
    .text("Field Operations Report", M.x, 34);
  if (spec.periodLabel) {
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(spec.periodLabel, M.x, 14, {
        width: PAGE.wL - M.x * 2,
        align: "right",
      });
  }

  let y = 64;
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(14).text(spec.title, M.x, y);
  y += 18;
  if (spec.subtitle) {
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(10)
      .text(spec.subtitle, M.x, y);
    y += 14;
  }
  y += 6;

  // Column widths normalize to total available width.
  const totalW = PAGE.wL - M.x * 2;
  const sumW = spec.columns.reduce((s, c) => s + c.width, 0);
  const colsX: number[] = [];
  let cx = M.x;
  for (const c of spec.columns) {
    colsX.push(cx);
    cx += (c.width / sumW) * totalW;
  }
  const colWidth = (i: number): number => {
    const next = i + 1 < colsX.length ? colsX[i + 1] : M.x + totalW;
    return next - colsX[i];
  };

  // Header row
  const drawHeader = (yy: number): number => {
    doc.rect(M.x, yy, totalW, 18).fill("#111827");
    doc.fillColor("#f59e0b").font("Helvetica-Bold").fontSize(9);
    spec.columns.forEach((c, i) => {
      doc.text(c.header, colsX[i] + 4, yy + 5, {
        width: colWidth(i) - 8,
        align: c.align ?? "left",
      });
    });
    return yy + 22;
  };
  y = drawHeader(y);

  doc.fillColor("#111827").font("Helvetica").fontSize(9);
  spec.rows.forEach((r, idx) => {
    if (y > PAGE.hL - 60) {
      doc.addPage();
      y = M.y;
      y = drawHeader(y);
    }
    if (idx % 2 === 0) {
      doc.rect(M.x, y - 2, totalW, 14).fill("#f9fafb");
      doc.fillColor("#111827");
    }
    spec.columns.forEach((c, i) => {
      doc.text(String(r[i] ?? ""), colsX[i] + 4, y, {
        width: colWidth(i) - 8,
        align: c.align ?? "left",
      });
    });
    y += 14;
  });

  if (spec.totals) {
    if (y > PAGE.hL - 60) {
      doc.addPage();
      y = M.y;
      y = drawHeader(y);
    }
    y += 4;
    doc.moveTo(M.x, y).lineTo(M.x + totalW, y).strokeColor("#111827").lineWidth(1).stroke();
    y += 4;
    doc.font("Helvetica-Bold").fillColor("#111827").fontSize(9);
    spec.columns.forEach((c, i) => {
      doc.text(String(spec.totals![i] ?? ""), colsX[i] + 4, y, {
        width: colWidth(i) - 8,
        align: c.align ?? "left",
      });
    });
    y += 14;
  }

  if (spec.footer) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#6b7280");
    doc.text(spec.footer, M.x, PAGE.hL - 28, { width: totalW, align: "left" });
  }

  // Page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor("#9ca3af").font("Helvetica").fontSize(8);
    doc.text(
      `Page ${i - range.start + 1} of ${range.count}  ·  Generated ${new Date().toISOString().slice(0, 10)}`,
      M.x,
      PAGE.hL - 16,
      { width: PAGE.wL - M.x * 2, align: "center" },
    );
  }

  doc.end();
  return done;
}

// ── Shared 1099 PDF helpers ─────────────────────────────────────

function draw1099Banner(doc: Doc, w: number): void {
  doc.rect(0, 0, w, 28).fill("#fef3c7");
  doc
    .fillColor("#92400e")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(
      "FOR RECORD-KEEPING ONLY — Not for IRS submission. File Copy A on official red-ink form.",
      M.x,
      9,
      { width: w - M.x * 2, align: "center" },
    );
}

function draw1099PartyBlock(
  doc: Doc,
  label: string,
  name: string,
  tin: string | null,
  addr: string | null,
  x: number,
  y: number,
  colW: number,
): void {
  doc.rect(x, y, colW, 110).strokeColor("#111827").lineWidth(0.8).stroke();
  doc
    .fillColor("#92400e")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(label, x + 6, y + 4);
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(name, x + 6, y + 16, { width: colW - 12 });
  doc
    .fillColor("#374151")
    .font("Helvetica")
    .fontSize(9)
    .text(addr ?? "", x + 6, y + 36, { width: colW - 12 });
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(`TIN/EIN: ${tin ?? "—"}`, x + 6, y + 90);
}

function drawBox(
  doc: Doc,
  labelNum: string,
  labelText: string,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.rect(x, y, w, h).strokeColor("#111827").lineWidth(0.8).stroke();
  doc
    .fillColor("#92400e")
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(`Box ${labelNum}`, x + 4, y + 3);
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(labelText, x + 4, y + 13, { width: w - 8 });
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(value, x + 4, y + h - 22, {
      width: w - 8,
      align: "right",
    });
}

// ── 1099-NEC PDF ────────────────────────────────────────────────
//
// IRS Form 1099-NEC layout (2026): payer block, recipient block,
// Box 1 (Nonemployee compensation), Box 4 (Federal income tax withheld),
// Box 5-7 (state info). We populate Box 1 only; the rest are blank since
// VNDRLY doesn't withhold tax.

export interface Nec1099PdfInput {
  taxYear: number;
  payerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  recipientName: string;
  recipientTin: string | null;
  recipientAddress: string | null;
  totalPaid: string;
}

export async function renderNec1099Pdf(
  inputs: Nec1099PdfInput[],
): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: "LETTER",
    layout: "portrait",
    margins: { top: M.y, bottom: M.y, left: M.x, right: M.x },
    bufferPages: true,
  });
  const done = collect(doc);
  const W = PAGE.wP - M.x * 2;

  inputs.forEach((input, idx) => {
    if (idx > 0) doc.addPage();

    // Watermark / disclaimer band
    doc.rect(0, 0, PAGE.wP, 28).fill("#fef3c7");
    doc
      .fillColor("#92400e")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(
        "FOR RECORD-KEEPING ONLY — Not for IRS submission. File Copy A on official red-ink form.",
        M.x,
        9,
        { width: W, align: "center" },
      );

    let y = 44;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(`Form 1099-NEC`, M.x, y);
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(11)
      .text(`Tax Year ${input.taxYear}`, M.x, y, { width: W, align: "right" });
    y += 28;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Nonemployee Compensation", M.x, y);
    y += 24;

    // Two-column block: PAYER (left) | RECIPIENT (right)
    const colW = (W - 16) / 2;
    const drawBlock = (
      label: string,
      name: string,
      tin: string | null,
      addr: string | null,
      x: number,
      yy: number,
    ): number => {
      doc.rect(x, yy, colW, 110).strokeColor("#111827").lineWidth(0.8).stroke();
      doc
        .fillColor("#92400e")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(label, x + 6, yy + 4);
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(name, x + 6, yy + 16, { width: colW - 12 });
      doc
        .fillColor("#374151")
        .font("Helvetica")
        .fontSize(9)
        .text(addr ?? "", x + 6, yy + 36, { width: colW - 12 });
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(`TIN/EIN: ${tin ?? "—"}`, x + 6, yy + 90);
      return yy + 110;
    };
    drawBlock(
      "PAYER",
      input.payerName,
      input.payerEin,
      input.payerAddress,
      M.x,
      y,
    );
    drawBlock(
      "RECIPIENT",
      input.recipientName,
      input.recipientTin,
      input.recipientAddress,
      M.x + colW + 16,
      y,
    );
    y += 130;

    // Box grid
    const drawBox = (
      labelNum: string,
      labelText: string,
      value: string,
      x: number,
      yy: number,
      w: number,
      h: number,
    ): void => {
      doc.rect(x, yy, w, h).strokeColor("#111827").lineWidth(0.8).stroke();
      doc
        .fillColor("#92400e")
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(`Box ${labelNum}`, x + 4, yy + 3);
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(labelText, x + 4, yy + 13, { width: w - 8 });
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(14)
        .text(value, x + 4, yy + h - 22, {
          width: w - 8,
          align: "right",
        });
    };
    drawBox(
      "1",
      "Nonemployee compensation",
      `$${Number(input.totalPaid).toFixed(2)}`,
      M.x,
      y,
      W / 2 - 8,
      66,
    );
    drawBox(
      "4",
      "Federal income tax withheld",
      `$0.00`,
      M.x + W / 2 + 8,
      y,
      W / 2 - 8,
      66,
    );
    y += 80;
    drawBox(
      "5",
      "State tax withheld",
      `$0.00`,
      M.x,
      y,
      W / 3 - 6,
      48,
    );
    drawBox(
      "6",
      "State / Payer's state no.",
      "—",
      M.x + W / 3 + 3,
      y,
      W / 3 - 6,
      48,
    );
    drawBox(
      "7",
      "State income",
      `$${Number(input.totalPaid).toFixed(2)}`,
      M.x + (W / 3) * 2 + 6,
      y,
      W / 3 - 6,
      48,
    );

    // Footer
    doc
      .fillColor("#6b7280")
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(
        `Generated by VNDRLY on ${new Date().toISOString().slice(0, 10)}. Threshold: $600. Source: non-voided invoice payments in tax year ${input.taxYear}.`,
        M.x,
        PAGE.hP - 28,
        { width: W, align: "center" },
      );
  });

  doc.end();
  return done;
}

// ── 1099-MISC PDF ───────────────────────────────────────────────
//
// IRS Form 1099-MISC populates multiple boxes per recipient; we render
// one page per (payer, recipient) with the same payer/recipient block
// pattern as 1099-NEC and a 6-box grid covering the boxes we aggregate
// (1, 2, 3, 6, 10). Other boxes are drawn empty for completeness.

export interface Misc1099PdfInput {
  taxYear: number;
  payerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  recipientName: string;
  recipientTin: string | null;
  recipientAddress: string | null;
  box1Rents: string;
  box2Royalties: string;
  box3OtherIncome: string;
  box6MedicalHealth: string;
  box10Attorney: string;
}

export async function renderMisc1099Pdf(
  inputs: Misc1099PdfInput[],
): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: "LETTER",
    layout: "portrait",
    margins: { top: M.y, bottom: M.y, left: M.x, right: M.x },
    bufferPages: true,
  });
  const done = collect(doc);
  const W = PAGE.wP - M.x * 2;

  inputs.forEach((input, idx) => {
    if (idx > 0) doc.addPage();

    draw1099Banner(doc, PAGE.wP);
    let y = 44;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("Form 1099-MISC", M.x, y);
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(11)
      .text(`Tax Year ${input.taxYear}`, M.x, y, { width: W, align: "right" });
    y += 28;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Miscellaneous Information", M.x, y);
    y += 24;

    const colW = (W - 16) / 2;
    draw1099PartyBlock(
      doc,
      "PAYER",
      input.payerName,
      input.payerEin,
      input.payerAddress,
      M.x,
      y,
      colW,
    );
    draw1099PartyBlock(
      doc,
      "RECIPIENT",
      input.recipientName,
      input.recipientTin,
      input.recipientAddress,
      M.x + colW + 16,
      y,
      colW,
    );
    y += 130;

    // Two-column grid: 5 populated boxes + a few empty placeholders.
    const half = W / 2 - 8;
    drawBox(doc, "1", "Rents", money(input.box1Rents), M.x, y, half, 56);
    drawBox(
      doc,
      "2",
      "Royalties",
      money(input.box2Royalties),
      M.x + W / 2 + 8,
      y,
      half,
      56,
    );
    y += 64;
    drawBox(
      doc,
      "3",
      "Other income",
      money(input.box3OtherIncome),
      M.x,
      y,
      half,
      56,
    );
    drawBox(
      doc,
      "4",
      "Federal income tax withheld",
      money("0"),
      M.x + W / 2 + 8,
      y,
      half,
      56,
    );
    y += 64;
    drawBox(
      doc,
      "6",
      "Medical and health care payments",
      money(input.box6MedicalHealth),
      M.x,
      y,
      half,
      56,
    );
    drawBox(
      doc,
      "10",
      "Gross proceeds paid to attorney",
      money(input.box10Attorney),
      M.x + W / 2 + 8,
      y,
      half,
      56,
    );

    doc
      .fillColor("#6b7280")
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(
        `Generated by VNDRLY on ${new Date().toISOString().slice(0, 10)}. Box thresholds: rents/other/medical/attorney $600, royalties $10. Source: non-voided invoice payments in tax year ${input.taxYear}.`,
        M.x,
        PAGE.hP - 28,
        { width: W, align: "center" },
      );
  });

  doc.end();
  return done;
}

// ── 1099-K PDF ──────────────────────────────────────────────────
//
// 1099-K layout: payer (TPSO) block, recipient block, Box 1a (gross
// payments), Box 1b (card not present), Box 3 (transactions),
// Box 5a-5l (monthly).

export interface K1099PdfInput {
  taxYear: number;
  payerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  recipientName: string;
  recipientTin: string | null;
  recipientAddress: string | null;
  grossAmount: string;
  transactionCount: number;
  monthly: string[]; // 12 entries
}

export async function renderK1099Pdf(
  inputs: K1099PdfInput[],
): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: "LETTER",
    layout: "portrait",
    margins: { top: M.y, bottom: M.y, left: M.x, right: M.x },
    bufferPages: true,
  });
  const done = collect(doc);
  const W = PAGE.wP - M.x * 2;

  inputs.forEach((input, idx) => {
    if (idx > 0) doc.addPage();

    draw1099Banner(doc, PAGE.wP);
    let y = 44;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("Form 1099-K", M.x, y);
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(11)
      .text(`Tax Year ${input.taxYear}`, M.x, y, { width: W, align: "right" });
    y += 28;
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Payment Card and Third Party Network Transactions", M.x, y);
    y += 24;

    const colW = (W - 16) / 2;
    draw1099PartyBlock(
      doc,
      "FILER (TPSO)",
      input.payerName,
      input.payerEin,
      input.payerAddress,
      M.x,
      y,
      colW,
    );
    draw1099PartyBlock(
      doc,
      "PAYEE",
      input.recipientName,
      input.recipientTin,
      input.recipientAddress,
      M.x + colW + 16,
      y,
      colW,
    );
    y += 130;

    drawBox(
      doc,
      "1a",
      "Gross amount of payment card / TPSO transactions",
      money(input.grossAmount),
      M.x,
      y,
      W,
      54,
    );
    y += 62;
    drawBox(
      doc,
      "3",
      "Number of payment transactions",
      String(input.transactionCount),
      M.x,
      y,
      W / 2 - 6,
      48,
    );
    drawBox(
      doc,
      "4",
      "Federal income tax withheld",
      money("0"),
      M.x + W / 2 + 6,
      y,
      W / 2 - 6,
      48,
    );
    y += 56;

    // 5a-5l monthly grid (3 cols × 4 rows)
    const monthLabels = [
      "5a Jan",
      "5b Feb",
      "5c Mar",
      "5d Apr",
      "5e May",
      "5f Jun",
      "5g Jul",
      "5h Aug",
      "5i Sep",
      "5j Oct",
      "5k Nov",
      "5l Dec",
    ];
    const cellW = (W - 12) / 3;
    const cellH = 38;
    monthLabels.forEach((lab, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const xx = M.x + col * (cellW + 6);
      const yy = y + row * (cellH + 4);
      const parts = lab.split(" ");
      drawBox(
        doc,
        parts[0],
        parts[1],
        money(input.monthly[i] ?? "0"),
        xx,
        yy,
        cellW,
        cellH,
      );
    });

    doc
      .fillColor("#6b7280")
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(
        `Generated by VNDRLY on ${new Date().toISOString().slice(0, 10)}. Threshold for ${input.taxYear} applies. Source: invoice payments with method = credit_card.`,
        M.x,
        PAGE.hP - 28,
        { width: W, align: "center" },
      );
  });

  doc.end();
  return done;
}

function money(s: string | number): string {
  const n = Number(s || 0);
  return `$${n.toFixed(2)}`;
}
