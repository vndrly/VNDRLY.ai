import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RemovePillProps {
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
}

export default function RemovePill({
  onClick,
  className,
  type = "button",
  disabled,
  "aria-label": ariaLabel = "Remove",
  ...props
}: RemovePillProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      data-testid={props["data-testid"]}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
