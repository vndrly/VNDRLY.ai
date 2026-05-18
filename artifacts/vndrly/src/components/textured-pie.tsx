import { useId } from "react";
import glossOverlay from "@assets/askV_highlight2_1777729317718.png";

export type PieColor = "amber" | "blue" | "green" | "red" | "grey";

/**
 * Solid hex fills mirror `PILL_FILL` in
 * `vertical-pill-bar-shape.tsx` / the canonical `TOGGLE_PILL_COLORS`
 * palette in `toggle-pill.tsx`. Keeping the pie on the same palette
 * as the Tracking Status Breakdown bars means an `amber` slice and
 * an `amber` bar read as the same color across charts.
 */
const PILL_FILL: Record<PieColor, string> = {
  amber: "#F59E0B",
  blue: "#3260CD",
  green: "#15803D",
  red: "#DC2626",
  grey: "#9CA3AF",
};

/**
 * `askV_highlight2.png` is a sphere illustration with a soft
 * drop-shadow padding — the actual visible sphere body is roughly
 * 85% of the bitmap's edge-to-edge diameter, so we scale the
 * overlay by ~1.18× to align the sphere body with the pie disc.
 */
const GLOSS_OVERLAY_SCALE = 1.18;

export type TexturedPieDatum = {
  name: string;
  value: number;
  color: PieColor;
};

type Props = {
  data: TexturedPieDatum[];
  size?: number;
  showLabels?: boolean;
  formatValue?: (v: number) => string;
};

export function TexturedPie({
  data,
  size = 260,
  showLabels = true,
  formatValue,
}: Props) {
  // `useId` retained for future per-instance defs; currently unused
  // since solid fills don't need pattern ids.
  void useId();
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  if (total <= 0) {
    return (
      <svg width={size} height={size} role="img" aria-label="No data">
        <circle cx={cx} cy={cy} r={r} fill="#E5E7EB" />
      </svg>
    );
  }

  let acc = 0;
  const slices = data.map((d, i) => {
    const start = (acc / total) * Math.PI * 2;
    acc += Math.max(0, d.value);
    const end = (acc / total) * Math.PI * 2;
    const isFull = data.length === 1 || end - start >= Math.PI * 2 - 1e-6;
    const x1 = cx + r * Math.sin(start);
    const y1 = cy - r * Math.cos(start);
    const x2 = cx + r * Math.sin(end);
    const y2 = cy - r * Math.cos(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    const path = isFull
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    const mid = (start + end) / 2;
    const labelR = r * 0.62;
    const lx = cx + labelR * Math.sin(mid);
    const ly = cy - labelR * Math.cos(mid);
    const pct = (d.value / total) * 100;
    return {
      d,
      i,
      path,
      lx,
      ly,
      pct,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Pie chart"
      style={{ overflow: "visible" }}
    >
      {slices.map((s) => (
        <path
          key={s.i}
          d={s.path}
          fill={PILL_FILL[s.d.color]}
          stroke="rgba(0,0,0,0.1)"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      ))}
      {/*
        User-supplied "askV_highlight2" sphere highlight overlay.
        `mix-blend-mode: screen` keeps the bright top highlight and
        drops the dark sphere body to transparent, so the slice
        colors stay intact and only the spec highlight reads.

        The source PNG has a soft drop-shadow padding around the
        actual sphere body (~85% of the bitmap diameter), so we
        scale the overlay up so the visible sphere matches the
        pie disc edge. Overflowing dark padding stays invisible
        under `screen` blend on the surrounding white card
        background.
      */}
      <image
        href={glossOverlay}
        x={cx - r * GLOSS_OVERLAY_SCALE}
        y={cy - r * GLOSS_OVERLAY_SCALE}
        width={2 * r * GLOSS_OVERLAY_SCALE}
        height={2 * r * GLOSS_OVERLAY_SCALE}
        preserveAspectRatio="none"
        style={{ mixBlendMode: "screen", pointerEvents: "none" }}
      />
      {showLabels &&
        slices
          .filter((s) => s.pct >= 5)
          .map((s) => (
            <text
              key={`l-${s.i}`}
              x={s.lx}
              y={s.ly}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12}
              fontWeight={600}
              fill="#ffffff"
              style={{
                pointerEvents: "none",
                paintOrder: "stroke",
              }}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={2}
            >
              <tspan x={s.lx} dy="-0.5em">
                {s.d.name}
              </tspan>
              <tspan x={s.lx} dy="1.1em">
                {formatValue ? formatValue(s.d.value) : `${Math.round(s.pct)}%`}
              </tspan>
            </text>
          ))}
    </svg>
  );
}

export function TexturedPieLegend({
  data,
  formatValue,
}: {
  data: TexturedPieDatum[];
  formatValue?: (v: number) => string;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {data.map((d, i) => {
        const pct = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <li key={i} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-6 rounded-sm border"
              style={{
                backgroundColor: PILL_FILL[d.color],
                borderColor: "rgba(0,0,0,0.1)",
              }}
            />
            <span className="text-foreground">{d.name}</span>
            <span className="text-muted-foreground">
              {formatValue ? formatValue(d.value) : `${pct.toFixed(0)}%`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
