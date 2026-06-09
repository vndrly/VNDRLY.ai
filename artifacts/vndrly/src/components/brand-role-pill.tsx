import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";

/**
 * Display-only role chip rendered with the canonical PNG image-pill
 * family. Maps the legacy `tone` API onto `ImagePill` colors so the
 * surface participates in the global pill doctrine (PillBg 3-slice,
 * height 23, opacity-90 rest / 100 hover, text-shadow on colored
 * pills only). The previous CSS-gradient + brand-primary fill is
 * retired — every pill in the content pane uses the canonical PNG
 * palette (Baker is the only exception).
 *
 * tone → color mapping:
 *   - "amber"  → amber pill
 *   - "green"  → green pill
 *   - "grey"   → grey pillBase (no shadow, light text)
 *   - "brand"  → blue pill (canonical primary fill from the new palette)
 */
export const AMBER_PILL_HEX = "#F59E0B";
export const GREEN_PILL_HEX = "#15803D";
export const GREY_PILL_HEX = "#9CA3AF";

export default function BrandRolePill({
  children,
  tone = "brand",
  height = PILL_HEIGHT_PX,
  className = "",
  testId,
}: {
  children: React.ReactNode;
  tone?: "brand" | "amber" | "green" | "grey";
  height?: number;
  className?: string;
  testId?: string;
}) {
  const color: ImagePillColor =
    tone === "amber"
      ? "amber"
      : tone === "green"
        ? "green"
        : tone === "grey"
          ? "grey"
          : "blue";
  const isRest = tone === "grey";
  return (
    <ImagePill
      color={color}
      rest={isRest}
      height={height}
      className={className}
      data-testid={testId}
    >
      {children}
    </ImagePill>
  );
}
