import { useId } from "react";
import { type PillColor } from "@/components/status-pill-assets";

/**
 * Hex fills mirror the canonical `PNG_PILL_COLORS` palette in
 * `png-pill-rollover.tsx`. Keep in sync.
 */
const PILL_FILL: Record<PillColor, string> = {
  amber: "#F59E0B",
  blue: "#3260CD",
  green: "#15803D",
  red: "#DC2626",
  grey: "#9CA3AF",
};

interface HorizontalPillBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { color?: PillColor };
  fallbackColor?: PillColor;
  /**
   * When true, the left edge is rendered flat so the bar visually
   * butts up against the chart's Y-axis line. Only the right end
   * keeps the rounded PngPill cap. Default false (fully rounded).
   */
  flatLeft?: boolean;
}

/**
 * Recharts `<Bar shape>` for horizontal bar charts that renders each
 * bar as a TogglePill: solid tonal fill + 50% white top-half gloss
 * highlight + 1px black/10 border, in a rounded-pill shape. Mirrors
 * the visual language of `<PngPill>` (see `png-pill-rollover.tsx`).
 *
 * Per-row color is taken from `payload.color` (a `PillColor` key),
 * falling back to `fallbackColor`.
 */
export function HorizontalPillBarShape(props: HorizontalPillBarShapeProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    payload,
    fallbackColor = "amber",
    flatLeft = false,
  } = props;
  const glossId = useId();
  if (width <= 0 || height <= 0) return null;

  const color: PillColor = payload?.color ?? fallbackColor;
  const fill = PILL_FILL[color];
  const r = Math.min(height / 2, width);

  const d = flatLeft
    ? `M${x},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x} Z`
    : `M${x + r},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

  return (
    <g pointerEvents="none">
      <defs>
        {/*
          50% white top half → transparent bottom half. Hard 50% stop
          mirrors the PNG_PILL_GLOSS_GRADIENT from png-pill-rollover.tsx.
        */}
        <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.5" />
          <stop offset="50%" stopColor="white" stopOpacity="0.5" />
          <stop offset="50%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Layer 1: solid tonal fill + subtle border. */}
      <path d={d} fill={fill} stroke="rgba(0,0,0,0.1)" strokeWidth={1} />
      {/* Layer 2: gloss highlight on the top half. */}
      <path d={d} fill={`url(#${glossId})`} />
    </g>
  );
}
