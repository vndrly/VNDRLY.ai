import PillBg from "@/components/pill-bg";
import TintedPillBg from "@/components/tinted-pill-bg";
import btnGrey from "@assets/900x229_Grey_Button_1777067254819.png";

const PILL_ASPECT = 900 / 229;

/**
 * Shared brand-aware fill stacks used by the *-button.tsx components when
 * the viewer is on a partner-branded experience. Mirrors the visual
 * vocabulary of <SidebarButton> / <PortalButton>: a single mask-tinted
 * pill in the partner's color, with a white-tinted top-half gloss for
 * the glassy active sheen. By centralizing this here we don't duplicate
 * the same five lines (and accidentally drift their geometry) across
 * each of amber/green/orange/purple/blue/red/grey-* button files.
 *
 * The colored sprite the legacy non-branded buttons render is opted out
 * of at the call site (the caller picks which subtree to render), so
 * these helpers only own the brand-color rendering path.
 */

export interface BrandFillProps {
  /**
   * Tint color for the primary fill layer. Defaults to the live partner
   * brand-primary CSS variable so callers don't have to thread the
   * brand object through if they just want the partner's main color.
   * Pass `var(--brand-accent)` for buttons that want to look distinct
   * from the partner's primary CTA color (e.g. destructive / hover-red
   * variants).
   */
  color?: string;
}

/**
 * Always-on brand pill: a solid brand-color fill with a glossy white
 * top-half highlight. Use for primary action buttons that have no
 * idle/hover swap (Amber, Green, Orange, Purple).
 */
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

/**
 * Idle-gray, hover-brand pill: a translucent gray idle layer that fades
 * out on hover/active to reveal a solid brand-color fill, plus a
 * top-half white gloss that fades in on hover. Use for buttons that
 * historically swapped from gray to a hover color (Blue, GreenV2,
 * Red, Grey, GreyRed, LightGreyRed).
 */
export function BrandedHoverFill({ color = "var(--brand-primary)" }: BrandFillProps) {
  return (
    <>
      <PillBg
        src={btnGrey}
        imageAspect={PILL_ASPECT}
        className="opacity-50 group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-50 transition-opacity duration-200"
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
