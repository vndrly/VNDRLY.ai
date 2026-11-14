import StatusIndicator from "@/components/status-indicator";
import { cn } from "@/lib/utils";

/** Secondary lifecycle indicator using the shared status treatment. */
export default function LifecycleStatePill({
  children,
  title,
  "data-testid": testId,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  "data-testid"?: string;
  className?: string;
}) {
  return (
    <StatusIndicator
      color="grey"
      title={title}
      data-testid={testId}
      className={cn("text-xs font-normal pointer-events-none", className)}
    >
      {children}
    </StatusIndicator>
  );
}
