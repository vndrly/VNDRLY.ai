import { ticketLifecyclePills } from "@/lib/ticket-status-palette";
import StatusIndicator from "@/components/status-indicator";
export type ImagePillColor = "amber" | "blue" | "green" | "red" | "grey";
interface ImagePillProps {
  activeSrc?: string;

  color?: ImagePillColor;

  rest?: boolean;

  height?: number;

  className?: string;

  /** Allow nested controls (e.g. crew-chip remove button). */
  interactive?: boolean;

  children: React.ReactNode;

  title?: string;

  "aria-label"?: string;

  "data-testid"?: string;

}



/** Compatibility entry point for read-only chips; all share the indicator standard. */
export default function ImagePill({ activeSrc, color = "grey", rest = false, className, children, title,
  "aria-label": ariaLabel, "data-testid": testId }: ImagePillProps) {
  const sourceColor = !rest && activeSrc ? Object.values(ticketLifecyclePills).find(pill => pill.src === activeSrc)?.hex : undefined;
  return <StatusIndicator color={rest ? "grey" : color} className={className} title={title} style={sourceColor ? { color: sourceColor } : undefined}
    aria-label={ariaLabel} data-testid={testId}>{children}</StatusIndicator>;
}
