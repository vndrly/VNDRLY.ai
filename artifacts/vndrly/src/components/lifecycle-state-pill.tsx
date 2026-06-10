import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Secondary lifecycle label — plain outline text (same family as bid counts). */
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
    <Badge
      variant="outline"
      title={title}
      data-testid={testId}
      className={cn("text-xs font-normal pointer-events-none", className)}
    >
      {children}
    </Badge>
  );
}
