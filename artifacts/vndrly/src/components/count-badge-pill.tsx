import type { LucideIcon } from "lucide-react";
import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import { cn } from "@/lib/utils";

/** Small numeric / icon+count chip (unread comments, vendor counts, etc.). */
export default function CountBadgePill({
  children,
  icon: Icon,
  color = "grey",
  rest = color === "grey",
  className,
  title,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  color?: ImagePillColor;
  rest?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  return (
    <ImagePill
      color={color}
      rest={rest}
      className={cn("whitespace-nowrap pointer-events-none", className)}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {Icon ? <Icon className="w-3 h-3" /> : null}
      {children}
    </ImagePill>
  );
}
