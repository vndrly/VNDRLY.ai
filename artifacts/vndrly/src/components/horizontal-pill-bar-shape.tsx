import { type PillColor } from "@/components/status-pill-assets";

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
  flatLeft?: boolean;
}

/** Recharts `<Bar shape>` — flat tonal fill, no gloss overlay. */
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
  if (width <= 0 || height <= 0) return null;

  const color: PillColor = payload?.color ?? fallbackColor;
  const fill = PILL_FILL[color];
  const r = Math.min(height / 2, width);

  const d = flatLeft
    ? `M${x},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x} Z`
    : `M${x + r},${y} H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

  return (
    <g pointerEvents="none">
      <path d={d} fill={fill} stroke="rgba(0,0,0,0.1)" strokeWidth={1} />
    </g>
  );
}
