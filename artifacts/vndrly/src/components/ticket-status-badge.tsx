import { useTranslation } from "react-i18next";
import { ticketStatusMeta } from "@/lib/ticket-status-meta";
import { ticketLifecyclePillForStatus } from "@/lib/ticket-status-palette";
import StatusIndicator from "@/components/status-indicator";

interface TicketStatusBadgeProps {
  appearance?: "pill" | "indicator";

  status: string;

  updatedAt?: string | Date | null;

  compact?: boolean;

  className?: string;

  "data-testid"?: string;

}



export default function TicketStatusBadge({ status, className, "data-testid": testId }: TicketStatusBadgeProps) {
  const { t } = useTranslation();
  const meta = ticketStatusMeta[status];
  return <StatusIndicator data-testid={testId} className={className}
    style={{ color: ticketLifecyclePillForStatus(status).hex }}>
    {meta ? t(meta.badgeLabelKey) : status}
  </StatusIndicator>;
}
