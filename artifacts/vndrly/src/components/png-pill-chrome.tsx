import PillBg from "@/components/pill-bg";
import { cn } from "@/lib/utils";
import {
  TICKET_STATUS_PILL_ASPECT,
  ticketLifecyclePillGloss,
} from "@/lib/ticket-status-palette";

/** Diagonal gloss overlay — same layer as Crew Tracker status pills. */
export function PillGlossOverlay({ className }: { className?: string }) {
  return (
    <PillBg
      src={ticketLifecyclePillGloss}
      stretch
      className={cn("opacity-60", className)}
    />
  );
}

/** Colored/grey PNG base — same aspect + opacity as TicketStatusBadge. */
export function PillColorLayer({
  src,
  className,
  imageAspect = TICKET_STATUS_PILL_ASPECT,
  stretch = false,
}: {
  src: string;
  className?: string;
  imageAspect?: number;
  stretch?: boolean;
}) {
  return (
    <PillBg
      src={src}
      imageAspect={imageAspect}
      stretch={stretch}
      className={cn("opacity-90 transition-opacity", className)}
    />
  );
}

export { TICKET_STATUS_PILL_ASPECT as PILL_IMAGE_ASPECT };
