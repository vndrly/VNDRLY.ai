import PillBg from "@/components/pill-bg";
import { cn } from "@/lib/utils";
import { TICKET_STATUS_PILL_ASPECT } from "@/lib/ticket-status-palette";

/** @deprecated Gloss is baked into PillsV1 PNGs — overlay removed site-wide. */
export function PillGlossOverlay(_props?: { className?: string }) {
  return null;
}

/** Colored/grey PNG base at full opacity — no CSS dimming or transitions. */
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
      className={cn(className)}
    />
  );
}

export { TICKET_STATUS_PILL_ASPECT as PILL_IMAGE_ASPECT };
