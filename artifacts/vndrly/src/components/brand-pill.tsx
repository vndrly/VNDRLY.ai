import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";
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
  height = PILL_HEIGHT_PX,
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

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "cursor-pointer border-0 bg-transparent p-0",
        "transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      style={{ height }}
    >
      <PillColorLayer
        src={pillBase}
        className="group-hover:opacity-100"
      />
      <PillColorLayer
        src={bluePill}
        className={cn("transition-opacity duration-200", colorOpacityClass)}
      />
      <PillGlossOverlay className={cn("transition-opacity duration-200", glossRestClass)} />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full transition-colors",
          active
            ? "text-white"
            : "text-gray-800 group-hover:text-white",
        )}
        style={
          active
            ? { textShadow: PILL_TEXT_SHADOW }
            : undefined
        }
      >
        {children}
      </span>
    </button>
  );
}
