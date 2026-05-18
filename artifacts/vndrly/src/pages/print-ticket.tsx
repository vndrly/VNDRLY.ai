import { useEffect, useMemo, useState } from "react";
import {
  useGetTicket,
  getGetTicketQueryKey,
  useGetSiteLocation,
  getGetSiteLocationQueryKey,
  useGetPartner,
  getGetPartnerQueryKey,
  useGetTicketLineItems,
  getGetTicketLineItemsQueryKey,
  useGetTaxRateByState,
  getGetTaxRateByStateQueryKey,
} from "@workspace/api-client-react";
import { getBrandColors, hexToRgb } from "@/lib/brand-colors";

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function formatMoney(n: string | number): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "$0.00";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  pending_review: "Pending Review",
  completed: "Completed",
  submitted: "Submitted",
  approved: "Approved",
  kicked_back: "Kicked Back",
  cancelled: "Cancelled",
  awaiting_payment: "Awaiting Payment",
  funds_dispersed: "Funds Dispersed",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  etf: "ETF / Wire",
  check: "Check",
  other: "Other",
};

export default function PrintTicketPage({ id }: { id: number }) {
  const validId = Number.isFinite(id) && id > 0;
  const { data: ticket, isLoading, isError } = useGetTicket(id, {
    query: { enabled: validId, queryKey: getGetTicketQueryKey(id) },
  });
  const siteLocationId = ticket?.siteLocationId;
  const { data: site, isLoading: siteLoading } = useGetSiteLocation(siteLocationId ?? 0, {
    query: { enabled: !!siteLocationId, queryKey: getGetSiteLocationQueryKey(siteLocationId ?? 0) },
  });
  const partnerId = site?.partnerId;
  const { data: partner, isLoading: partnerLoading } = useGetPartner(partnerId ?? 0, {
    query: { enabled: !!partnerId, queryKey: getGetPartnerQueryKey(partnerId ?? 0) },
  });
  const { data: lineItems } = useGetTicketLineItems(id, {
    query: { enabled: validId, queryKey: getGetTicketLineItemsQueryKey(id) },
  });
  const siteState = site?.state ?? "";
  const { data: taxRate, isLoading: taxRateLoading } = useGetTaxRateByState(siteState, {
    query: { enabled: !!siteState, queryKey: getGetTaxRateByStateQueryKey(siteState) },
  });

  const partnerName = partner?.name ?? ticket?.partnerName ?? null;
  const { primary: primaryColor, accent: accentColor } = getBrandColors(partner);

  const subtotal = useMemo(() => {
    if (!lineItems || lineItems.length === 0) return 0;
    return lineItems.reduce(
      (sum, it) => sum + parseFloat(it.quantity) * parseFloat(it.unitPrice),
      0,
    );
  }, [lineItems]);

  const taxRateValue = taxRate ? parseFloat(taxRate.rate) : 0;
  const taxAmount = subtotal * taxRateValue;
  const grandTotal = subtotal + taxAmount;
  const taxLabelState = site?.state || "N/A";
  const taxLabelPct = (taxRateValue * 100).toFixed(2);

  const readyToPrint = useMemo(() => {
    if (!ticket) return false;
    if (siteLocationId && siteLoading) return false;
    if (partnerId && partnerLoading) return false;
    if (siteState && taxRateLoading) return false;
    return true;
  }, [ticket, siteLocationId, siteLoading, partnerId, partnerLoading, siteState, taxRateLoading]);

  useEffect(() => {
    if (!readyToPrint) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [readyToPrint]);

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (!ticket) return;
    setDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
      const pageW = 8.5;
      const pageH = 11;
      const margin = 0.5;
      const contentW = pageW - margin * 2;
      const left = margin;
      const right = pageW - margin;

      const [pr, pg, pb] = hexToRgb(primaryColor);
      const [ar, ag, ab] = hexToRgb(accentColor);

      doc.setLineWidth(0.05);
      doc.setDrawColor(pr, pg, pb);
      doc.roundedRect(left, margin, contentW, pageH - margin * 2, 0.08, 0.08, "S");

      let y = margin + 0.4;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(pr, pg, pb);
      doc.setFontSize(22);
      const heading = partnerName ? `${partnerName} — Tracking Ticket` : "Tracking Ticket";
      doc.text(heading, pageW / 2, y, { align: "center", maxWidth: contentW - 0.4 });
      y += 0.35;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(80);
      doc.text(`Tracking #${String(ticket.id).padStart(8, "0")}`, pageW / 2, y, { align: "center" });
      y += 0.35;

      doc.setDrawColor(ar, ag, ab);
      doc.setLineWidth(0.03);
      doc.line(left + 0.3, y, right - 0.3, y);
      y += 0.25;

      const rowL = (label: string, value: string) => {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(ar, ag, ab);
        doc.setFontSize(10);
        doc.text(label, left + 0.3, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40);
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(value || "-", contentW - 1.8) as string[];
        doc.text(lines, left + 1.7, y);
        y += 0.2 * Math.max(1, lines.length) + 0.04;
      };

      rowL("Site", ticket.siteName ?? "-");
      if (site?.address) rowL("Address", site.address);
      rowL("Vendor", ticket.vendorName ?? "-");
      rowL("Work Type", ticket.workTypeName ?? "-");
      rowL("Field Employee", ticket.fieldEmployeeName ?? "-");
      rowL("Status", STATUS_LABELS[ticket.status] ?? ticket.status);
      rowL("Check In", formatDateTime(ticket.checkInTime));
      rowL("Check Out", formatDateTime(ticket.checkOutTime));

      y += 0.1;

      if (ticket.description) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(ar, ag, ab);
        doc.setFontSize(12);
        doc.text("Description", left + 0.3, y);
        y += 0.2;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40);
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(ticket.description, contentW - 0.6) as string[];
        doc.text(lines, left + 0.3, y);
        y += 0.18 * lines.length + 0.1;
      }

      if (ticket.notes) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(ar, ag, ab);
        doc.setFontSize(12);
        doc.text("Notes", left + 0.3, y);
        y += 0.2;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40);
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(ticket.notes, contentW - 0.6) as string[];
        doc.text(lines, left + 0.3, y);
        y += 0.18 * lines.length + 0.1;
      }

      if (lineItems && lineItems.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(pr, pg, pb);
        doc.setFontSize(13);
        doc.text("Line Items", left + 0.3, y);
        y += 0.2;

        doc.setDrawColor(ar, ag, ab);
        doc.setLineWidth(0.02);
        doc.line(left + 0.3, y, right - 0.3, y);
        y += 0.16;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(ar, ag, ab);
        doc.text("Type", left + 0.3, y);
        doc.text("Description", left + 1.1, y);
        doc.text("Qty", right - 1.9, y, { align: "right" });
        doc.text("Unit", right - 1.1, y, { align: "right" });
        doc.text("Total", right - 0.3, y, { align: "right" });
        y += 0.18;

        doc.setFont("helvetica", "normal");
        doc.setTextColor(40);
        doc.setFontSize(10);
        for (const item of lineItems) {
          const qty = parseFloat(item.quantity);
          const unit = parseFloat(item.unitPrice);
          const total = qty * unit;
          const descLines = doc.splitTextToSize(item.description, 3.0) as string[];
          const rowH = 0.18 * Math.max(1, descLines.length);
          doc.text(item.type, left + 0.3, y);
          doc.text(descLines, left + 1.1, y);
          doc.text(String(qty), right - 1.9, y, { align: "right" });
          doc.text(formatMoney(unit), right - 1.1, y, { align: "right" });
          doc.text(formatMoney(total), right - 0.3, y, { align: "right" });
          y += rowH + 0.02;
        }

        y += 0.05;
        doc.setDrawColor(ar, ag, ab);
        doc.setLineWidth(0.02);
        doc.line(right - 2.2, y, right - 0.3, y);
        y += 0.18;
        doc.setFont("helvetica", "bold");
        doc.setTextColor(pr, pg, pb);
        doc.setFontSize(11);
        doc.text("Subtotal", right - 1.1, y, { align: "right" });
        doc.text(formatMoney(subtotal), right - 0.3, y, { align: "right" });
        y += 0.2;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40);
        doc.setFontSize(10);
        doc.text(`Tax (${taxLabelState} — ${taxLabelPct}%)`, right - 1.1, y, { align: "right" });
        doc.text(formatMoney(taxAmount), right - 0.3, y, { align: "right" });
        y += 0.2;
        doc.setDrawColor(ar, ag, ab);
        doc.setLineWidth(0.02);
        doc.line(right - 2.2, y - 0.1, right - 0.3, y - 0.1);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(pr, pg, pb);
        doc.setFontSize(12);
        doc.text("Total", right - 1.1, y, { align: "right" });
        doc.text(formatMoney(grandTotal), right - 0.3, y, { align: "right" });
        y += 0.22;
      }

      if (ticket.paymentDispersedAt) {
        y += 0.1;
        doc.setFont("helvetica", "bold");
        doc.setTextColor(pr, pg, pb);
        doc.setFontSize(13);
        doc.text("Payment Details", left + 0.3, y);
        y += 0.2;

        doc.setDrawColor(ar, ag, ab);
        doc.setLineWidth(0.02);
        doc.line(left + 0.3, y, right - 0.3, y);
        y += 0.16;

        rowL("Method", ticket.paymentMethod ? (PAYMENT_METHOD_LABELS[ticket.paymentMethod] ?? ticket.paymentMethod) : "-");
        if (ticket.paymentReference) rowL("Reference", ticket.paymentReference);
        rowL("Dispersed On", formatDateTime(ticket.paymentDispersedAt));
        if (ticket.paymentDispersedByName) rowL("Dispersed By", ticket.paymentDispersedByName);
        if (ticket.paymentNote) rowL("Note", ticket.paymentNote);
      }

      const footerY = pageH - margin - 0.4;
      doc.setDrawColor(200);
      doc.setLineWidth(0.01);
      doc.line(left + 0.3, footerY - 0.15, right - 0.3, footerY - 0.15);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      const footer = partnerName
        ? `${partnerName}  •  Tracking #${String(ticket.id).padStart(8, "0")}  •  Generated ${new Date().toLocaleDateString()}`
        : `Tracking #${String(ticket.id).padStart(8, "0")}  •  Generated ${new Date().toLocaleDateString()}`;
      doc.text(footer, pageW / 2, footerY, { align: "center" });

      doc.save(`ticket-${String(ticket.id).padStart(8, "0")}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  if (!validId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-ticket-invalid">
        <p className="text-lg font-semibold">Invalid ticket id</p>
        <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-ticket-error">
        <p className="text-lg font-semibold">Unable to load ticket</p>
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600">Retry</button>
          <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
        </div>
      </div>
    );
  }
  if (isLoading || !ticket) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center p-8 print:p-0" data-testid="print-ticket-page">
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print w-full max-w-2xl flex justify-end mb-4 gap-2">
        <button onClick={() => window.print()} className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600" data-testid="button-trigger-print">Print</button>
        <button onClick={handleDownloadPdf} disabled={downloading} className="px-4 py-2 rounded bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed" data-testid="button-download-pdf">
          {downloading ? "Preparing..." : "Download PDF"}
        </button>
        <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100" data-testid="button-close">Close</button>
      </div>

      <div
        className="w-full max-w-2xl border-4 rounded-lg p-8 bg-white"
        style={{ borderColor: primaryColor }}
        data-testid="ticket-printable"
      >
        <h1 className="text-2xl font-extrabold tracking-tight text-center" style={{ color: primaryColor }} data-testid="text-ticket-heading">
          {partnerName ? `${partnerName} — Tracking Ticket` : "Tracking Ticket"}
        </h1>
        <p className="text-sm text-gray-600 text-center mt-1" data-testid="text-ticket-number">
          Tracking #{String(ticket.id).padStart(8, "0")}
        </p>

        <hr className="my-4" style={{ borderColor: accentColor }} />

        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="font-semibold" style={{ color: accentColor }}>Site</dt>
          <dd className="col-span-2">{ticket.siteName ?? "-"}</dd>
          {site?.address && (
            <>
              <dt className="font-semibold" style={{ color: accentColor }}>Address</dt>
              <dd className="col-span-2">{site.address}</dd>
            </>
          )}
          <dt className="font-semibold" style={{ color: accentColor }}>Vendor</dt>
          <dd className="col-span-2">{ticket.vendorName ?? "-"}</dd>
          <dt className="font-semibold" style={{ color: accentColor }}>Work Type</dt>
          <dd className="col-span-2">{ticket.workTypeName ?? "-"}</dd>
          <dt className="font-semibold" style={{ color: accentColor }}>Field Employee</dt>
          <dd className="col-span-2">{ticket.fieldEmployeeName ?? "-"}</dd>
          <dt className="font-semibold" style={{ color: accentColor }}>Status</dt>
          <dd className="col-span-2">{STATUS_LABELS[ticket.status] ?? ticket.status}</dd>
          <dt className="font-semibold" style={{ color: accentColor }}>Check In</dt>
          <dd className="col-span-2">{formatDateTime(ticket.checkInTime)}</dd>
          <dt className="font-semibold" style={{ color: accentColor }}>Check Out</dt>
          <dd className="col-span-2">{formatDateTime(ticket.checkOutTime)}</dd>
        </dl>

        {ticket.description && (
          <>
            <h2 className="text-base font-bold mt-4" style={{ color: accentColor }}>Description</h2>
            <p className="text-sm whitespace-pre-wrap mt-1">{ticket.description}</p>
          </>
        )}
        {ticket.notes && (
          <>
            <h2 className="text-base font-bold mt-4" style={{ color: accentColor }}>Notes</h2>
            <p className="text-sm whitespace-pre-wrap mt-1">{ticket.notes}</p>
          </>
        )}

        {lineItems && lineItems.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-bold" style={{ color: primaryColor }}>Line Items</h2>
            <table className="w-full mt-2 text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: accentColor }}>
                  <th className="text-left py-1" style={{ color: accentColor }}>Type</th>
                  <th className="text-left py-1" style={{ color: accentColor }}>Description</th>
                  <th className="text-right py-1" style={{ color: accentColor }}>Qty</th>
                  <th className="text-right py-1" style={{ color: accentColor }}>Unit</th>
                  <th className="text-right py-1" style={{ color: accentColor }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((it) => {
                  const qty = parseFloat(it.quantity);
                  const unit = parseFloat(it.unitPrice);
                  return (
                    <tr key={it.id} className="border-b border-gray-200">
                      <td className="py-1">{it.type}</td>
                      <td className="py-1">{it.description}</td>
                      <td className="py-1 text-right">{qty}</td>
                      <td className="py-1 text-right">{formatMoney(unit)}</td>
                      <td className="py-1 text-right">{formatMoney(qty * unit)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}></td>
                  <td className="py-2 text-right font-bold" style={{ color: primaryColor }} data-testid="print-subtotal-label">Subtotal</td>
                  <td className="py-2 text-right font-bold" style={{ color: primaryColor }} data-testid="print-subtotal-value">{formatMoney(subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3}></td>
                  <td className="py-1 text-right text-sm" data-testid="print-tax-label">
                    Tax ({taxLabelState} — {taxLabelPct}%)
                  </td>
                  <td className="py-1 text-right text-sm" data-testid="print-tax-value">{formatMoney(taxAmount)}</td>
                </tr>
                <tr className="border-t" style={{ borderColor: accentColor }}>
                  <td colSpan={3}></td>
                  <td className="py-2 text-right font-bold" style={{ color: primaryColor }} data-testid="print-total-label">Total</td>
                  <td className="py-2 text-right font-bold" style={{ color: primaryColor }} data-testid="print-total-value">{formatMoney(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {ticket.paymentDispersedAt && (
          <div className="mt-6" data-testid="print-payment-details">
            <h2 className="text-lg font-bold" style={{ color: primaryColor }}>Payment Details</h2>
            <hr className="mt-1 mb-2" style={{ borderColor: accentColor }} />
            <dl className="grid grid-cols-3 gap-y-1 text-sm">
              <dt className="font-semibold" style={{ color: accentColor }}>Method</dt>
              <dd className="col-span-2" data-testid="print-payment-method">
                {ticket.paymentMethod
                  ? (PAYMENT_METHOD_LABELS[ticket.paymentMethod] ?? ticket.paymentMethod)
                  : "-"}
              </dd>
              {ticket.paymentReference && (
                <>
                  <dt className="font-semibold" style={{ color: accentColor }}>Reference</dt>
                  <dd className="col-span-2" data-testid="print-payment-reference">{ticket.paymentReference}</dd>
                </>
              )}
              <dt className="font-semibold" style={{ color: accentColor }}>Dispersed On</dt>
              <dd className="col-span-2" data-testid="print-payment-dispersed-at">
                {formatDateTime(ticket.paymentDispersedAt)}
              </dd>
              {ticket.paymentDispersedByName && (
                <>
                  <dt className="font-semibold" style={{ color: accentColor }}>Dispersed By</dt>
                  <dd className="col-span-2" data-testid="print-payment-dispersed-by">{ticket.paymentDispersedByName}</dd>
                </>
              )}
              {ticket.paymentNote && (
                <>
                  <dt className="font-semibold" style={{ color: accentColor }}>Note</dt>
                  <dd className="col-span-2 whitespace-pre-wrap" data-testid="print-payment-note">{ticket.paymentNote}</dd>
                </>
              )}
            </dl>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-300 text-xs text-gray-500 text-center">
          {partnerName ? <span data-testid="text-print-partner-name">{partnerName} • </span> : null}
          Generated {new Date().toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
