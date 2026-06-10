import { useId } from "react";
import {
  type TicketLifecycleColor,
  ticketLifecyclePillForStatus,
} from "@/lib/ticket-status-palette";

// Same canonical 900×229 pill PNGs used by `TicketStatusBadge` and
// `PillBg` for the status pills on the tracking page. Rotating one
// of these 90° CCW and stretching it inside the bar's clip path
// gives the chart bars the exact same chrome (color + gloss +
// rounded caps) as a status pill — same artwork, same proportions,
// same gloss direction (top half of the horizontal pill ends up on
// the left half of the vertical bar).
// Native pill image dimensions (matches the `900x229_*` PNG family
// imported above). Used to scale the rotated image so its long axis
// fills the bar's height and its short axis fills the bar's width.
const PILL_IMG_W = 900;
const PILL_IMG_H = 229;

interface VerticalPillBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { color?: TicketLifecycleColor; status?: string };
  fallbackColor?: TicketLifecycleColor;
  /**
   * When true, the bottom edge is rendered flat so the bar visually
   * butts up against the chart's X-axis line. Only the top of the
   * bar keeps the rounded TogglePill cap. Default false (fully
   * rounded both ends).
   */
  flatBottom?: boolean;
  /**
   * Optional click handler invoked with `payload.status` when the
   * bar is clicked. When set, the bar becomes interactive (cursor
   * pointer, accepts pointer events). Mirrors `PillBarShape`'s
   * click contract for drop-in replacement on status charts.
   */
  onBarClick?: (status: string) => void;
}

/**
 * Recharts `<Bar shape>` for vertical bar charts that renders each
 * bar as a TogglePill rotated 90° CCW from `HorizontalPillBarShape`:
 * solid tonal fill + 50% white left-half gloss highlight + 1px
 * black/10 border, in a rounded-pill shape. Mirrors the visual
 * language of `<PngPill>` (see `png-pill-rollover.tsx`).
 *
 * The gloss runs along the short (horizontal) axis — the rotated
 * equivalent of the horizontal pill's top-half gloss running along
 * its short (vertical) axis.
 *
 * Per-row color is taken from `payload.color`, falling back to the
 * shared ticket lifecycle palette.
 */
export function VerticalPillBarShape(props: VerticalPillBarShapeProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    payload,
    fallbackColor = "amber",
    flatBottom = false,
    onBarClick,
  } = props;
  const glossId = useId();
  if (width <= 0 || height <= 0) return null;

  const status = payload?.status ?? "";
  const pill = ticketLifecyclePillForStatus(status);
  const r = Math.min(width / 2, height);

  // Bar outline path. `flatBottom` keeps the bottom edge butted to
  // the X-axis line and only the top is rounded.
  const d = flatBottom
    ? `M${x},${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height} H${x} Z`
    : `M${x + r},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

  const clickable = !!onBarClick && !!status;
  const handleClick = clickable ? () => onBarClick!(status) : undefined;

  // Three-slice render of the 900×229 pill into a vertical bar so
  // the rounded top cap stays a true half-circle (no horizontal
  // squash, no vertical stretch). Pattern mirrors `<PillBg>`'s 15%
  // cap / 70% body convention, but rotated 90° CCW so the pill
  // stands up.
  //
  //   ┌────┐  y                  ← top of bar
  //   │ ╭──┤                     top cap: full pill rendered at
  //   │ │  │                       natural aspect, clipped to a
  //   │ │  │  y + capRadius      ← W×(W/2) rect. Cap is therefore
  //   │ │  │                       a true half-circle of radius W/2.
  //   │ │  │
  //   │ │  │                     body: middle 70% of the source pill
  //   │ │  │                       stretched along the bar's long
  //   │ │  │                       axis to fill the rest of the bar.
  //   │ │  │                       Cap regions of the source are
  //   │ │  │                       outside this stretch so the body
  //   │ │  │                       chrome (gloss + tonal fill) keeps
  //   │ │  │                       its proportions and never bleeds
  //   │ │  │                       into a fake elongated cap.
  //   │ │  │
  //   └─┴──┘  y + height         ← X-axis. flatBottom path clips here.
  //
  // Both layers are clipped by the same flat-bottom path so the
  // body slice can't poke past the axis line at the bottom.
  //
  // Gloss orientation: image y=0 → screen x=x (left edge of bar),
  // so the original pill's top half (where the gloss lives) ends
  // up on the LEFT half of the vertical bar — same orientation as
  // the previous SVG-only impl.
  const capRadius = width / 2;
  const sShort = width / PILL_IMG_H; // image-y → bar-width (W/229)

  // --- TOP CAP (natural aspect, clipped to W × capRadius rect) ---
  // Render the full pill at uniform scale `sShort` so the cap stays
  // a true circle. The pill's "right cap" (image x ≈ 900) lands at
  // the top of the bar; clipping to the bar outline shows just the
  // top half-circle. The body extends below into the body slot but
  // is overdrawn by the body image so any seam is hidden.
  const topTy = y + PILL_IMG_W * sShort;
  const topTransform = `translate(${x} ${topTy}) rotate(-90) scale(${sShort} ${sShort})`;

  // --- BODY (middle 70% of source, stretched to fill remaining bar) ---
  // The 15% / 70% / 15% split matches `<PillBg>`. We map:
  //   image x = 765 → screen y = y + capRadius   (just below cap)
  //   image x = 135 → screen y = y + height       (axis line)
  // so the source's body chrome stretches uniformly along the bar.
  // Only render when there's a real body region to fill.
  const BODY_X_HI = PILL_IMG_W * 0.85; // 765
  const BODY_X_LO = PILL_IMG_W * 0.15; // 135
  const bodySpanPx = height - capRadius;
  const sBody = bodySpanPx > 0 ? bodySpanPx / (BODY_X_HI - BODY_X_LO) : 0;
  const bodyTy = y + capRadius + BODY_X_HI * sBody;
  const bodyTransform = `translate(${x} ${bodyTy}) rotate(-90) scale(${sBody} ${sShort})`;

  return (
    <g
      pointerEvents={clickable ? "auto" : "none"}
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={handleClick}
    >
      <defs>
        <clipPath id={glossId}>
          <path d={d} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${glossId})`}>
        {/* Top cap — natural aspect, half-circle preserved. */}
        <image
          href={pill.src}
          x={0}
          y={0}
          width={PILL_IMG_W}
          height={PILL_IMG_H}
          preserveAspectRatio="none"
          transform={topTransform}
          style={{ pointerEvents: "none" }}
        />
        {/* Body — middle slice stretched along the bar's long axis. */}
        {sBody > 0 && (
          <image
            href={pill.src}
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
      {/* Subtle border, same as the previous impl. */}
      <path
        d={d}
        fill="none"
        stroke="rgba(0,0,0,0.1)"
        strokeWidth={1}
      />
      {clickable && (
        <rect x={x} y={y} width={width} height={height} fill="transparent" />
      )}
    </g>
  );
}
