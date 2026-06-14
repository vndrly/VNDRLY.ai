import { useId } from "react";
import { type PillColor } from "@/components/status-pill-assets";
import {
  pillAmber,
  pillBlue,
  pillGreen,
  pillLightGrey,
  pillRed,
} from "@/lib/pill-palette-assets";

// Same canonical 900×229 pill PNGs used by `VerticalPillBarShape`,
// `TicketStatusBadge`, and `PillBg`. Three-slice rendering keeps the
// rounded cap at natural aspect while the middle 70% stretches along
// the bar's long (horizontal) axis.
const PILL_IMG_W = 900;
const PILL_IMG_H = 229;
const BODY_X_HI = PILL_IMG_W * 0.85; // 765
const BODY_X_LO = PILL_IMG_W * 0.15; // 135

const PILL_SRC: Record<PillColor, string> = {
  amber: pillAmber,
  blue: pillBlue,
  green: pillGreen,
  red: pillRed,
  grey: pillLightGrey,
};

interface HorizontalPillBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { color?: PillColor };
  fallbackColor?: PillColor;
  /**
   * When true, the left edge is rendered flat so the bar visually butts
   * up against the chart's Y-axis line. Only the right end keeps the
   * rounded pill cap. Default false (fully rounded both ends).
   */
  flatLeft?: boolean;
}

/**
 * Recharts `<Bar shape>` for horizontal bar charts (`layout="vertical"`)
 * that renders each bar as a native horizontal TogglePill: same 900×229
 * PNG artwork, gloss, and rounded caps as `VerticalPillBarShape`, but
 * oriented along the bar's width instead of rotated 90°.
 *
 * Per-row color is taken from `payload.color` (amber / blue / green /
 * red / grey), falling back to `fallbackColor`.
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
  const clipId = useId();
  if (width <= 0 || height <= 0) return null;

  const color: PillColor = payload?.color ?? fallbackColor;
  const pillSrc = PILL_SRC[color];
  const r = Math.min(height / 2, width);

  const d = flatLeft
    ? `M${x},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x} Z`
    : `M${x + r},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

  const capRadius = height / 2;
  const sShort = height / PILL_IMG_H;

  // Right cap — natural aspect; pill's right edge lands at x + width.
  const rightTx = x + width - PILL_IMG_W * sShort;
  const rightTransform = `translate(${rightTx} ${y}) scale(${sShort} ${sShort})`;

  // Left cap — only when both ends are rounded.
  const leftTransform = `translate(${x} ${y}) scale(${sShort} ${sShort})`;

  // Body — middle 70% stretched from bodyStartX to the inner edge of caps.
  const bodyStartX = flatLeft ? x : x + capRadius;
  const bodySpanPx = flatLeft ? width - capRadius : width - 2 * capRadius;
  const sBody = bodySpanPx > 0 ? bodySpanPx / (BODY_X_HI - BODY_X_LO) : 0;
  const bodyTx = bodyStartX - BODY_X_LO * sBody;
  const bodyTransform = `translate(${bodyTx} ${y}) scale(${sBody} ${sShort})`;

  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={clipId}>
          <path d={d} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {!flatLeft && (
          <image
            href={pillSrc}
            x={0}
            y={0}
            width={PILL_IMG_W}
            height={PILL_IMG_H}
            preserveAspectRatio="none"
            transform={leftTransform}
            style={{ pointerEvents: "none" }}
          />
        )}
        <image
          href={pillSrc}
          x={0}
          y={0}
          width={PILL_IMG_W}
          height={PILL_IMG_H}
          preserveAspectRatio="none"
          transform={rightTransform}
          style={{ pointerEvents: "none" }}
        />
        {sBody > 0 && (
          <image
            href={pillSrc}
            x={0}
            y={0}
            width={PILL_IMG_W}
            height={PILL_IMG_H}
            preserveAspectRatio="none"
            transform={bodyTransform}
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
      <path d={d} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={1} />
    </g>
  );
}
