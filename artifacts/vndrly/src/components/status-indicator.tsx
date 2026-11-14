import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const INDICATOR_COLORS = {
  amber: "#FBBF24", blue: "#60A5FA", green: "#4ADE80", red: "#F87171", grey: "#CBD5E1",
} as const;
const readableColors: Record<string, string> = {
  "#f59e0b": INDICATOR_COLORS.amber, "#dc2626": INDICATOR_COLORS.red,
  "#991b1b": "#FB7185", "#15803d": INDICATOR_COLORS.green, "#16a34a": INDICATOR_COLORS.green,
  "#166534": INDICATOR_COLORS.green, "#3260cd": INDICATOR_COLORS.blue,
  "#1d4ed8": INDICATOR_COLORS.blue, "#4f46e5": "#A5B4FC", "#7c3aed": "#C084FC",
  "#0d9488": "#2DD4BF", "#9ca3af": INDICATOR_COLORS.grey,
  "#db2777": "#F472B6", "#ec4899": "#F472B6", "#b89463": "#E7C693",
};
export function readableIndicatorColor(color: string) { return readableColors[color.toLowerCase()] ?? color; }
export const STATUS_INDICATOR_CLASS = "status-live-indicator inline-flex min-h-[26px] items-center justify-center gap-[5px] rounded-full px-[10px] py-[3px] text-xs font-semibold";

/** Shared read-only status treatment. Surface, dot and label inherit one hue. */
export default function StatusIndicator({ color = "grey", className, children, style, ...props }:
  HTMLAttributes<HTMLSpanElement> & { color?: keyof typeof INDICATOR_COLORS }) {
  return <span role="status" {...props} className={cn(STATUS_INDICATOR_CLASS, className)}
    style={{ ...style, color: readableIndicatorColor(String(style?.color ?? INDICATOR_COLORS[color])) }}>
    <span aria-hidden="true" className="status-indicator-dot h-1.5 w-1.5 shrink-0 rounded-full !bg-current" />
    {children}
  </span>;
}
