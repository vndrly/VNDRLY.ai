import { useId, type ReactNode } from "react";
import "./gate-gps-selector.css";

/** A location-evidence gauge, not a submission gate or signal-strength meter. */
export default function GateGpsSelector({ children, status, label, detail }: {
  children: ReactNode;
  status: "verified" | "mismatch" | "unavailable";
  label: string;
  detail?: string;
}) {
  const gradientId = useId();
  const endpoint = status === "verified" ? "#22c55e" : status === "mismatch" ? "#ef4444" : "#9ca3af";
  return <span className="gate-gps-control" data-gps-status={status} data-testid="gate-gps-indicator" title={detail || label}>
    <span className="gate-gps-selector">
      {children}
      <svg className="gate-gps-arc" viewBox="0 0 32 52" aria-hidden="true" focusable="false">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor={endpoint} />
        </linearGradient></defs>
        <path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke="#151719" strokeWidth="8" strokeLinecap="round" />
        <path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke={`url(#${gradientId})`} strokeWidth="5" strokeLinecap="round" />
        <path d="M 20 9 L 23 6 M 27 26 L 31 26 M 20 43 L 23 46" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".7" />
      </svg>
    </span>
    <span className="sr-only" role="status" aria-live="polite">{label}</span>
  </span>;
}
