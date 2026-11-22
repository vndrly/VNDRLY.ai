import type { ButtonHTMLAttributes } from "react";
import { STATUS_INDICATOR_CLASS, INDICATOR_COLORS } from "@/components/status-indicator";
import { cn } from "@/lib/utils";

/** Uses the shared indicator treatment while preserving the voice action. */
export default function AskVListeningPill({ active, waiting = false, statusLabel, startStop = false, tone, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; waiting?: boolean; statusLabel?: string; startStop?: boolean; tone?: "green" | "red" | "grey" }) {
  const label = statusLabel ?? (active ? "V is listening" : waiting ? "Waiting for consent" : "Click to restart V");
  const color = tone ?? (startStop ? (active ? "red" : "green") : (active ? "green" : "grey"));
  return <button {...props} type="button" aria-label={label} aria-pressed={active} data-color={color}
    className={cn(STATUS_INDICATOR_CLASS, "shrink-0 self-center border-0 cursor-pointer disabled:cursor-default disabled:opacity-60 focus-visible:outline-none", className)}
    style={{ color: INDICATOR_COLORS[color] }}>
    <span aria-hidden="true" className="status-indicator-dot h-1.5 w-1.5 shrink-0 rounded-full !bg-current" />
    <span className="inline-flex items-center gap-1.5">{label}{children}</span>
  </button>;
}
