import type { ReactNode } from "react";
import { useDashboardRowPulse } from "@/hooks/use-dashboard-row-pulse";

export function GateDashboardLiveSummary({ scope, row, value, children }: {
  scope?: string;
  row: string;
  value?: number | string;
  children: ReactNode;
}) {
  const ref = useDashboardRowPulse<HTMLElement>(scope ? `${scope}:${row}` : undefined, value);
  return <summary ref={ref}>{children}</summary>;
}
