import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { GateRecordFlag } from "@/lib/gate-record-flags";

/** Shared crossing/arrival layout; quick controls stay outside the record opener. */
export function GateTrafficRecord({ name, description, status, flags = [], footer, action, children, onOpen, overdue = false, className = "", testId }: {
  name: string; description?: string; status: ReactNode; footer?: ReactNode;
  action?: ReactNode; children?: ReactNode; onOpen: () => void; overdue?: boolean;
  className?: string; testId?: string; flags?: GateRecordFlag[];
}) {
  return <div className={`gate-traffic-record ${className}`} data-overdue={overdue}>
    <button type="button" className="gate-record-link gate-arrival-record" onClick={onOpen} data-testid={testId}>
      <span className="flex items-center justify-between gap-2"><span className="font-semibold">{name}</span><span className="gate-traffic-status">{status}</span></span>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
      {children}
    </button>
    {(flags.length > 0 || footer || action) && <div className="gate-traffic-footer"><span className="gate-traffic-summary">
      {flags.map(flag => <span className="gate-traffic-flag" key={flag.key} title={flag.title} data-flag={flag.key}><AlertTriangle aria-hidden="true" />{flag.label}</span>)}
      {footer}
    </span>{action}</div>}
  </div>;
}
