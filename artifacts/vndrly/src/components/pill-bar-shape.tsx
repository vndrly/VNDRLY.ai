import { type PillColor } from "@/components/status-pill-assets";
import { verticalPillMap, VERTICAL_PILL_CAP_PX } from "@/components/status-pill-assets-vertical";

// Mirrors `ticketStatusMeta[status].badgeColor` from
// `@workspace/ticket-status-meta` so the chart bar for a given status
// always uses the same pill artwork as the `<TicketStatusBadge>` for
// that status. Statuses whose badge is `null` (no badge rendered —
// e.g. `draft`, `denied`) fall back to grey for chart purposes since
// the chart still needs a bar color.
export const statusToPillColor: Record<string, PillColor> = {
  draft: "grey",
  initiated: "blue",
  in_progress: "blue",
  pending_review: "grey",
  completed: "green",
  submitted: "amber",
  kicked_back: "red",
  approved: "green",
  awaiting_payment: "amber",
  funds_dispersed: "green",
  // User override (May 2026): the chart paints `cancelled` with the
  // same dark-red pill as `kicked_back` so the two fail-state buckets
  // at the right edge read as a unified "exit-without-completion"
  // pair. Differs intentionally from `ticketStatusMeta.cancelled`
  // (`grey`), which still drives the read-only `<TicketStatusBadge>`.
  cancelled: "red",
  awaiting_acceptance: "amber",
  denied: "grey",
};

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
  const color: PillColor = payload?.color ?? statusToPillColor[status] ?? "grey";
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
