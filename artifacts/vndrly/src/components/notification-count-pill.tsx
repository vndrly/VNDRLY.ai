import type { LucideIcon } from "lucide-react";
import ImagePill from "@/components/image-pill";
import { cn } from "@/lib/utils";

interface NotificationCountPillProps {
  icon: LucideIcon;
  count: number;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

export default function NotificationCountPill({
  icon: Icon,
  count,
  title,
  ariaLabel,
  testId,
  className,
}: NotificationCountPillProps) {
  return (
    <ImagePill
      color="blue"
      className={cn("pointer-events-none min-w-[38px]", className)}
      data-testid={testId}
      title={title}
      aria-label={ariaLabel}
    >
      <Icon className="w-3 h-3" />
      {count}
    </ImagePill>
  );
}
