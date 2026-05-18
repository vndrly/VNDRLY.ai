import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";

const PILL_ASPECT = 900 / 229;

/**
 * Brand-tinted toggle pill — canonical pill-family doctrine.
 *
 * Layers (bottom → top):
 *   1. pillBase PNG (PillBg 3-slice) — opacity-90 rest, group-hover
 *      opacity-100. Always on; owns the silhouette.
 *   2. Active/hover canonical color PNG (currently blue from the new
 *      palette — there is no separate "brand" PNG so the canonical
 *      blue stands in for the active state). Fades in when `active`
 *      OR hovered.
 *   3. pillGloss PNG (stretched) — opacity-60 rest, fades to 0 when
 *      the colored chrome is active so a single shine is visible.
 *
 * Text: grey (no shadow) at rest; white with shadow when colored
 * chrome is showing (active or hovered).
 */
export default function BrandPill({
  active,
  onClick,
  children,
  testId,
  height = 24,
  className = "",
  disabled = false,
  tone: _tone = "brand",
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  testId?: string;
  height?: number;
  className?: string;
  disabled?: boolean;
  /**
   * Retained for backwards compatibility; both "brand" and "blue" now
   * resolve to the canonical blue pill PNG since the new palette
   * intentionally does not include a partner-brand-specific PNG.
   */
  tone?: "brand" | "blue";
}) {
  const colorOpacityClass = active
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100";
  const glossRestClass = active
    ? "opacity-0"
    : "opacity-60 group-hover:opacity-0";
  const textClass = active
    ? "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
    : "text-gray-800 group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        "relative cursor-pointer group select-none inline-flex items-center justify-center",
        "transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      style={{ height, padding: 0, background: "transparent", border: 0 }}
    >
      <PillBg
        src={pillBase}
        imageAspect={PILL_ASPECT}
        className="opacity-90 group-hover:opacity-100 transition-opacity"
      />
      <PillBg
        src={bluePill}
        imageAspect={PILL_ASPECT}
        className={cn("transition-opacity duration-200", colorOpacityClass)}
      />
      <PillBg
        src={pillGloss}
        stretch
        className={cn("transition-opacity duration-200", glossRestClass)}
      />
      <span
        className={cn(
          "relative z-10 inline-flex items-center whitespace-nowrap px-3 text-xs font-bold transition-colors",
          textClass,
        )}
      >
        {children}
      </span>
    </button>
  );
}
