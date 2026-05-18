import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readOnly?: boolean;
  className?: string;
  "data-testid"?: string;
}

export default function StarRating({ value, onChange, size = 20, readOnly = false, className, ...props }: StarRatingProps) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)} data-testid={props["data-testid"]}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n;
        const half = !filled && value >= n - 0.5;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(n)}
            className={cn(
              "relative leading-none",
              !readOnly && "cursor-pointer hover:scale-110 transition-transform",
              readOnly && "cursor-default",
            )}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            data-testid={`${props["data-testid"] ?? "star"}-${n}`}
          >
            <Star
              style={{ width: size, height: size }}
              className={cn(
                filled ? "fill-amber-400 text-amber-400" : half ? "fill-amber-200 text-amber-400" : "fill-none text-gray-300",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
