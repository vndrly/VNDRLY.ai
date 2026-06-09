import { PillColorLayer } from "@/components/png-pill-chrome";
import TintedPillBg from "@/components/tinted-pill-bg";
import btnGrey from "@assets/900x229_Grey_Button_1777067254819.png";
import { TICKET_STATUS_PILL_ASPECT } from "@/lib/ticket-status-palette";

export interface BrandFillProps {
  color?: string;
}

export function BrandedSolidFill({ color = "var(--brand-primary)" }: BrandFillProps) {
  return (
    <>
      <TintedPillBg
        src={btnGrey}
        color={color}
        className="transition-all duration-200 group-hover:brightness-110 group-disabled:brightness-100"
      />
      <TintedPillBg
        src={btnGrey}
        color="#ffffff"
        className="opacity-50 [clip-path:inset(0_0_50%_0)]"
      />
    </>
  );
}

export function BrandedHoverFill({ color = "var(--brand-primary)" }: BrandFillProps) {
  return (
    <>
      <PillColorLayer
        src={btnGrey}
        imageAspect={TICKET_STATUS_PILL_ASPECT}
        className="opacity-50 group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-50"
      />
      <TintedPillBg
        src={btnGrey}
        color={color}
        className="opacity-0 group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0 transition-opacity duration-200"
      />
      <TintedPillBg
        src={btnGrey}
        color="#ffffff"
        className="opacity-0 group-hover:opacity-50 group-active:opacity-50 [clip-path:inset(0_0_50%_0)] transition-opacity duration-200"
      />
    </>
  );
}
