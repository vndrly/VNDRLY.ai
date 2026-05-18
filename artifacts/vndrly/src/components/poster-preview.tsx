import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const QR_PATTERN = [
  1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1,
] as const;

export function PosterPreview({
  primaryColor,
  accentColor,
  partnerName,
  logoUrl,
}: {
  primaryColor: string;
  accentColor: string;
  partnerName: string | null;
  logoUrl: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-md p-3 flex flex-col items-center text-center bg-white"
      style={{ border: `2px solid ${primaryColor}` }}
      data-testid="poster-preview"
    >
      <div className="w-full flex items-center justify-center mb-1.5 min-h-[24px]">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={partnerName ? `${partnerName} logo` : "Partner logo"}
            className="max-h-6 max-w-[60%] object-contain"
            data-testid="poster-preview-logo"
          />
        ) : (
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-700" data-testid="poster-preview-fallback">
            {partnerName ?? t("partners.poster.visitorAccess")}
          </p>
        )}
      </div>
      <h3
        className="text-sm font-extrabold tracking-tight leading-tight"
        style={{ color: primaryColor }}
        data-testid="poster-preview-title"
      >
        {t("partners.poster.visitorSignIn")}
      </h3>
      <p className="text-[10px] font-semibold text-gray-800 mt-0.5">{t("partners.poster.siteName")}</p>
      <div
        className="my-2 p-1.5 bg-white"
        style={{ border: `1.5px solid ${primaryColor}` }}
      >
        <div className="w-12 h-12 grid grid-cols-5 grid-rows-5 gap-px" aria-hidden>
          {QR_PATTERN.map((on, i) => (
            <span
              key={i}
              className="w-full h-full"
              style={{ backgroundColor: on ? primaryColor : "transparent" }}
            />
          ))}
        </div>
      </div>
      <p
        className="text-[10px] font-bold self-start"
        style={{ color: accentColor }}
        data-testid="poster-preview-accent-heading"
      >
        {t("partners.poster.howToSignIn")}
      </p>
      <p className="text-[9px] text-gray-600 self-start leading-tight">
        {t("partners.poster.step1")}<br />
        {t("partners.poster.step2")}
      </p>
    </div>
  );
}

const DEFAULT_PRIMARY = "#1f2937";

export function PosterThumbnail({
  partnerId,
  partnerName,
  primaryColor,
  accentColor,
  logoUrl,
}: {
  partnerId: number;
  partnerName: string;
  primaryColor: string | null | undefined;
  accentColor: string | null | undefined;
  logoUrl: string | null | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const primary = (primaryColor ?? "").trim() || DEFAULT_PRIMARY;
  const accent = (accentColor ?? "").trim() || primary;
  const tooltip = t("partners.posterThumbnailTooltip", {
    defaultValue: "Preview {{name}}'s visitor sign-in poster",
    name: partnerName,
  });
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        title={tooltip}
        aria-label={tooltip}
        className="group inline-flex items-center justify-center rounded-sm bg-white p-0.5 hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 transition-shadow"
        data-testid={`button-poster-thumbnail-${partnerId}`}
      >
        <span
          className="block rounded-sm"
          style={{
            width: 28,
            height: 36,
            border: `2px solid ${primary}`,
            background: "white",
            position: "relative",
            overflow: "hidden",
          }}
          aria-hidden
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: 2,
              right: 2,
              height: 4,
              backgroundColor: accent,
              borderRadius: 1,
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: 10,
              transform: "translateX(-50%)",
              width: 16,
              height: 16,
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gridTemplateRows: "repeat(5, 1fr)",
              gap: 1,
            }}
          >
            {QR_PATTERN.map((on, i) => (
              <span
                key={i}
                style={{ backgroundColor: on ? primary : "transparent" }}
              />
            ))}
          </span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs" data-testid={`dialog-poster-preview-${partnerId}`}>
          <DialogHeader>
            <DialogTitle>{partnerName}</DialogTitle>
          </DialogHeader>
          <PosterPreview
            primaryColor={primary}
            accentColor={accent}
            partnerName={partnerName}
            logoUrl={logoUrl ?? null}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
