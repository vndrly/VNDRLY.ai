import { QRCodeSVG } from "qrcode.react";
import { DEFAULT_BRAND_PRIMARY } from "@/lib/brand-colors";

export interface VisitorQrPosterSite {
  id: number;
  name: string;
  address?: string | null;
  siteCode: string;
}

export interface VisitorQrPosterProps {
  site: VisitorQrPosterSite;
  pageBreak?: boolean;
  primaryColor?: string;
  accentColor?: string;
}

export default function VisitorQrPoster({
  site,
  pageBreak = false,
  primaryColor = DEFAULT_BRAND_PRIMARY,
  accentColor,
}: VisitorQrPosterProps) {
  const visitUrl = `${window.location.origin}${import.meta.env.BASE_URL}visit/${site.siteCode}`;
  const headingColor = accentColor || primaryColor;

  return (
    <div
      className={`w-full max-w-2xl border-4 rounded-lg p-8 flex flex-col items-center text-center bg-white mx-auto ${pageBreak ? "print:break-before-page" : ""}`}
      style={{ borderColor: primaryColor }}
      data-testid={`visitor-qr-poster-${site.id}`}
    >
      <h1
        className="text-4xl font-extrabold tracking-tight mb-2"
        style={{ color: primaryColor }}
        data-testid={`text-print-title-${site.id}`}
      >
        Visitor Sign-In
      </h1>
      <p className="text-xl font-semibold mb-1" data-testid={`text-print-site-name-${site.id}`}>
        {site.name}
      </p>
      {site.address && (
        <p className="text-sm text-gray-600 mb-6" data-testid={`text-print-address-${site.id}`}>
          {site.address}
        </p>
      )}

      <div className="bg-white p-4 border-2 mb-6" style={{ borderColor: primaryColor }}>
        <QRCodeSVG
          value={visitUrl}
          size={384}
          level="H"
          marginSize={2}
          data-testid={`qr-visitor-${site.id}`}
        />
      </div>

      <div className="text-left max-w-md w-full">
        <h2 className="text-lg font-bold mb-2" style={{ color: headingColor }}>
          How to sign in
        </h2>
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

      <div className="mt-6 pt-4 border-t border-gray-300 w-full text-xs text-gray-500">
        Site Code: <span className="font-mono font-semibold">{site.siteCode}</span>
      </div>
    </div>
  );
}
