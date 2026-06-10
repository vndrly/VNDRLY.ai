import ImagePill from "@/components/image-pill";
import { PILL_HEIGHT_PX } from "@/lib/pill-doctrine";
import { cn } from "@/lib/utils";

/**
 * Read-only company-role chip (Operations Manager, Ticket Approver, etc.).
 * Uses the same blue PNG + label depth as partner contact tables.
 */
export default function CompanyRolePill({
  children,
  className,
  height = PILL_HEIGHT_PX,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  height?: number;
  testId?: string;
}) {
  return (
    <ImagePill
      color="blue"
      height={height}
      className={cn("min-w-0", className)}
      data-testid={testId}
    >
      {children}
    </ImagePill>
  );
}
