import PDFDocument from "pdfkit";
import type { ManagedSubcontractorHoursReport } from "../services/managed-subcontractor-hours";

const hours = (minutes: number | null) => minutes === null ? "Pending" : (minutes / 60).toFixed(2);

export async function renderManagedSubcontractorHoursPdf(report: ManagedSubcontractorHoursReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text(report.title);
    doc.moveDown(0.35).fontSize(11).text(`${report.organization.name} · sponsored by ${report.sponsor.name}`);
    doc.text(`${new Date(report.range.start).toLocaleDateString()} – ${new Date(report.range.end).toLocaleDateString()}`);
    doc.text(`Approval policy: ${report.approvalPolicy} · Status: ${report.approved ? "Approved" : "Awaiting approval"}`);
    doc.moveDown();
    for (const line of report.lines) {
      doc.fontSize(11).font("Helvetica-Bold").text(`${line.workerName} — ${line.siteName}`);
      doc.font("Helvetica").fontSize(9).text(`Scheduled ${hours(line.scheduledMinutes)} hrs · Accrued ${hours(line.actualMinutes)} hrs · Approved ${hours(line.approvedMinutes)} hrs`);
      doc.text(`${new Date(line.scheduledStart).toLocaleString()} – ${new Date(line.scheduledEnd).toLocaleString()} · Source: ${line.source}`);
      if (line.exceptions.length) doc.fillColor("#9a3412").text(`Needs review: ${line.exceptions.join(", ")}`).fillColor("black");
      doc.moveDown(0.55);
      if (doc.y > 700) doc.addPage();
    }
    doc.moveDown().font("Helvetica-Bold").fontSize(11).text(`Totals: ${hours(report.totals.scheduledMinutes)} scheduled · ${hours(report.totals.actualMinutes)} accrued · ${hours(report.totals.approvedMinutes)} approved`);
    doc.moveDown().font("Helvetica").fontSize(8).fillColor("#475569").text("This operational hours report does not calculate wages, taxes, or payroll.");
    doc.end();
  });
}
