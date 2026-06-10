import { type PillColor } from "@/components/status-pill-assets";
import { verticalPillMap, VERTICAL_PILL_CAP_PX } from "@/components/status-pill-assets-vertical";
import { type TicketStatusBadgeColor } from "@/lib/ticket-status-meta";
import { statusToTicketLifecycleColor } from "@/lib/ticket-status-palette";

// Legacy 36px sliced pills only ship five color families. Coarse-map the
// full ROYGBIV lifecycle bucket onto the nearest family so this shape
// stays roughly aligned with `VerticalPillBarShape` / `TicketStatusBadge`.
const LIFECYCLE_TO_LEGACY_PILL: Record<TicketStatusBadgeColor, PillColor> = {
  red: "red",
  darkRed: "red",
  hotPink: "red",
  pink: "red",
  orange: "amber",
  amber: "amber",
  lime: "amber",
  tan: "amber",
  green: "green",
  darkGreen: "green",
  teal: "green",
  blue: "blue",
  babyBlue: "blue",
  navy: "blue",
  indigo: "blue",
  purple: "blue",
  grey: "grey",
};

export function statusToPillColor(status: string): PillColor {
  return LIFECYCLE_TO_LEGACY_PILL[statusToTicketLifecycleColor(status)] ?? "grey";
}

interface PillBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { status?: string; color?: PillColor };
  onBarClick?: (status: string) => void;
}

export function PillBarShape(props: PillBarShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload, onBarClick } = props;
  if (width <= 0 || height <= 0) return null;
  const status = payload?.status ?? "";
  const color: PillColor = payload?.color ?? statusToPillColor(status);
  const imgs = verticalPillMap[color];

  const capH = Math.min(VERTICAL_PILL_CAP_PX, height / 2);
  const middleH = Math.max(0, height - capH);

  const clickable = !!onBarClick && !!status;
  const handleClick = clickable ? () => onBarClick!(status) : undefined;

  return (
    <g
      pointerEvents={clickable ? "auto" : "none"}
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={handleClick}
    >
      <image
        href={imgs.top}
        x={x}
        y={y}
        width={width}
        height={capH}
        preserveAspectRatio="none"
      />
      <image
        href={imgs.middle}
        x={x}
        y={y + capH}
        width={width}
        height={middleH}
        preserveAspectRatio="none"
      />
      {clickable && (
        <rect x={x} y={y} width={width} height={height} fill="transparent" />
      )}
    </g>
  );
}
