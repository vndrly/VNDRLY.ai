import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  useGetSiteLocation,
  getGetSiteLocationQueryKey,
  useGetPartner,
  getGetPartnerQueryKey,
} from "@workspace/api-client-react";
import { getBrandColors, hexToRgb } from "@/lib/brand-colors";

type LoadedLogo = {
  dataUrl: string;
  format: "PNG" | "JPEG";
  width: number;
  height: number;
};

async function loadLogoForPdf(url: string): Promise<LoadedLogo | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = (blob.type || "").toLowerCase();
    if (type.includes("svg")) return null;
    const format: "PNG" | "JPEG" = type.includes("jpeg") || type.includes("jpg") ? "JPEG" : "PNG";

    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

    const dims: { width: number; height: number } = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("logo decode failed"));
      img.src = dataUrl;
    });

    return { dataUrl, format, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

export default function PrintVisitorQrPage({ id }: { id: number }) {
  const validId = Number.isFinite(id) && id > 0;
  const { data: site, isLoading, isError } = useGetSiteLocation(id, {
    query: { enabled: validId, queryKey: getGetSiteLocationQueryKey(id) },
  });

  const partnerId = site?.partnerId;
  const { data: partner, isLoading: partnerLoading } = useGetPartner(partnerId ?? 0, {
    query: {
      enabled: !!partnerId,
      queryKey: getGetPartnerQueryKey(partnerId ?? 0),
    },
  });

  const partnerLogoUrl = partner?.logoUrl ?? null;
  const partnerName = partner?.name ?? site?.partnerName ?? null;
  const { primary: primaryColor, accent: accentColor } = getBrandColors(partner);

  const visitUrl = site ? `${window.location.origin}${import.meta.env.BASE_URL}visit/${site.siteCode}` : "";
  const qrRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  // Wait until site (and partner, if any) finished loading before auto-printing,
  // so the logo is included in the printout.
  const readyToPrint = useMemo(() => {
    if (!site) return false;
    if (partnerId && partnerLoading) return false;
    return true;
  }, [site, partnerId, partnerLoading]);

  useEffect(() => {
    if (!readyToPrint) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [readyToPrint]);

  const handleDownloadPdf = async () => {
    if (!site || !qrRef.current) return;
    setDownloading(true);
    try {
      const [{ jsPDF }, { svg2pdf }] = await Promise.all([
        import("jspdf"),
        import("svg2pdf.js"),
      ]);

      const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
      const pageW = 8.5;
      const margin = 0.5;
      const contentW = pageW - margin * 2;
      const left = margin;
      const right = pageW - margin;

      const [pr, pg, pb] = hexToRgb(primaryColor);
      const [ar, ag, ab] = hexToRgb(accentColor);

      doc.setLineWidth(0.05);
      doc.setDrawColor(pr, pg, pb);
      doc.roundedRect(left, margin, contentW, 11 - margin * 2, 0.08, 0.08, "S");

      let y = margin + 0.4;

      // Partner logo or fallback
      const logoMaxH = 0.9;
      const logoMaxW = 2.4;
      let logo: LoadedLogo | null = null;
      if (partnerLogoUrl) {
        logo = await loadLogoForPdf(partnerLogoUrl);
      }
      if (logo) {
        const ratio = logo.width / logo.height;
        let lh = logoMaxH;
        let lw = lh * ratio;
        if (lw > logoMaxW) {
          lw = logoMaxW;
          lh = lw / ratio;
        }
        doc.addImage(logo.dataUrl, logo.format, (pageW - lw) / 2, y, lw, lh);
        y += lh + 0.15;
      } else {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(pr, pg, pb);
        doc.setFontSize(16);
        const fallback = partnerName ?? "Visitor Access";
        doc.text(fallback, pageW / 2, y + 0.2, { align: "center", maxWidth: contentW - 0.4 });
        y += 0.45;
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(pr, pg, pb);
      doc.setFontSize(30);
      doc.text("Visitor Sign-In", pageW / 2, y + 0.2, { align: "center" });
      y += 0.5;

      doc.setFontSize(18);
      doc.text(site.name, pageW / 2, y, { align: "center", maxWidth: contentW - 0.4 });
      y += 0.3;

      if (site.address) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.setTextColor(90);
        const addrLines = doc.splitTextToSize(site.address, contentW - 0.4) as string[];
        doc.text(addrLines, pageW / 2, y, { align: "center" });
        y += 0.18 * addrLines.length;
      }

      y += 0.15;

      // QR with branded border
      const qrSize = 3.6;
      const qrPad = 0.15;
      const qrBoxSize = qrSize + qrPad * 2;
      const qrBoxX = (pageW - qrBoxSize) / 2;
      const qrBoxY = y;
      doc.setDrawColor(pr, pg, pb);
      doc.setLineWidth(0.04);
      doc.rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, "S");

      await svg2pdf(qrRef.current, doc, {
        x: qrBoxX + qrPad,
        y: qrBoxY + qrPad,
        width: qrSize,
        height: qrSize,
      });

      y = qrBoxY + qrBoxSize + 0.3;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(ar, ag, ab);
      doc.text("How to sign in", left + 0.3, y);
      y += 0.25;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      const steps = [
        "Open your phone's camera",
        "Point it at the QR code above",
        "Tap the link that appears",
        "Fill out the visitor form to check in",
      ];
      steps.forEach((s, i) => {
        doc.text(`${i + 1}. ${s}`, left + 0.45, y);
        y += 0.22;
      });

      y += 0.05;
      doc.setFontSize(9);
      doc.setTextColor(90);
      const urlLines = doc.splitTextToSize(`Or visit: ${visitUrl}`, contentW - 0.6) as string[];
      doc.text(urlLines, left + 0.3, y);
      y += 0.14 * urlLines.length;

      // Footer site code (and partner attribution if available)
      const footerY = 11 - margin - 0.4;
      doc.setDrawColor(200);
      doc.setLineWidth(0.01);
      doc.line(left + 0.3, footerY - 0.15, right - 0.3, footerY - 0.15);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      const footerText = partnerName
        ? `${partnerName}  •  Site Code: ${site.siteCode}`
        : `Site Code: ${site.siteCode}`;
      doc.text(footerText, pageW / 2, footerY, { align: "center" });

      const safeName = site.siteCode.replace(/[^a-zA-Z0-9_-]+/g, "_");
      doc.save(`visitor-qr-${safeName}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  if (!validId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-visitor-qr-invalid">
        <p className="text-lg font-semibold">Invalid site id</p>
        <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-visitor-qr-error">
        <p className="text-lg font-semibold">Unable to load site QR</p>
        <p className="text-sm text-muted-foreground">Please check that the site exists and try again.</p>
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600">Retry</button>
          <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
        </div>
      </div>
    );
  }

  if (isLoading || !site) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  const showLogo = !!partnerLogoUrl && !logoFailed;

  return (
    <div
      className="min-h-screen bg-white text-black flex flex-col items-center justify-center p-8 print:p-0"
      data-testid="print-visitor-qr-page"
    >
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print w-full max-w-2xl flex justify-end mb-4 gap-2">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600"
          data-testid="button-trigger-print"
        >
          Print
        </button>
        <button
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="px-4 py-2 rounded bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          data-testid="button-download-pdf"
        >
          {downloading ? "Preparing..." : "Download PDF"}
        </button>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100"
          data-testid="button-close"
        >
          Close
        </button>
      </div>

      <div
        className="w-full max-w-2xl border-4 rounded-lg p-8 flex flex-col items-center text-center bg-white"
        style={{ borderColor: primaryColor }}
        data-testid="poster-container"
      >
        <div className="w-full flex items-center justify-center mb-4 min-h-[72px]" data-testid="partner-branding">
          {showLogo ? (
            <img
              src={partnerLogoUrl!}
              alt={partnerName ? `${partnerName} logo` : "Partner logo"}
              className="max-h-20 max-w-[60%] object-contain"
              onError={() => setLogoFailed(true)}
              data-testid="img-partner-logo"
            />
          ) : (
            <p className="text-base font-bold uppercase tracking-wider text-gray-700" data-testid="text-partner-fallback">
              {partnerName ?? "Visitor Access"}
            </p>
          )}
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight mb-2" style={{ color: primaryColor }} data-testid="text-print-title">
          Visitor Sign-In
        </h1>
        <p className="text-xl font-semibold mb-1" data-testid="text-print-site-name">
          {site.name}
        </p>
        {site.address && (
          <p className="text-sm text-gray-600 mb-6" data-testid="text-print-address">
            {site.address}
          </p>
        )}

        <div className="bg-white p-4 border-2 mb-6" style={{ borderColor: primaryColor }}>
          <QRCodeSVG
            ref={qrRef}
            value={visitUrl}
            size={384}
            level="H"
            marginSize={2}
            data-testid="qr-visitor"
          />
        </div>

        <div className="text-left max-w-md w-full">
          <h2 className="text-lg font-bold mb-2" style={{ color: accentColor }}>How to sign in</h2>
          <ol className="list-decimal list-inside text-base space-y-1 mb-4">
            <li>Open your phone's camera</li>
            <li>Point it at the QR code above</li>
            <li>Tap the link that appears</li>
            <li>Fill out the visitor form to check in</li>
          </ol>
          <p className="text-xs text-gray-600 break-all">
            Or visit: <span className="font-mono">{visitUrl}</span>
          </p>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-300 w-full text-xs text-gray-500" data-testid="text-print-footer">
          {partnerName ? (
            <>
              <span data-testid="text-print-partner-name">{partnerName}</span>
              <span className="mx-2">•</span>
            </>
          ) : null}
          Site Code: <span className="font-mono font-semibold">{site.siteCode}</span>
        </div>
      </div>
    </div>
  );
}
