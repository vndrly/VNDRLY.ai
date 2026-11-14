import "./ticket-activity-card.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useBrand } from "@/hooks/use-brand";
import TicketStatusBadge from "@/components/ticket-status-badge";
import TicketLifecyclePill from "@/components/ticket-lifecycle-pill";
import { CARD_INNER_TILE_CLICKABLE_CLASS } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function TicketActivityCard({ ticketId, timestamp, status, lifecycleState, siteName, vendorName, workTypeName, testId, statusTestId, className, children }: {
  ticketId: number; timestamp: string; status: string; lifecycleState?: string | null;
  siteName?: string | null; vendorName?: string | null; workTypeName?: string | null;
  testId?: string; statusTestId?: string; className?: string; children?: ReactNode;
}) {
  const brand = useBrand();
  return <div data-ticket-activity data-testid={testId} className={cn(CARD_INNER_TILE_CLICKABLE_CLASS, "ticket-activity-card group w-full min-w-0", className)}>
    <Link href={`/tickets/${ticketId}`} data-testid={`link-ticket-${ticketId}`} className="ticket-activity-layout grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <div className="ticket-activity-heading min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="hotlist-job-title break-words text-sm font-medium">Tracking #{ticketId}</p>
        <p className="text-xs text-muted-foreground">{new Date(timestamp).toLocaleString()}</p>
      </div>
      <div className="ticket-activity-status col-start-2 row-start-1 row-span-3 flex max-w-[160px] flex-col items-end gap-1">
        <TicketStatusBadge appearance="indicator" status={status} updatedAt={timestamp} data-testid={statusTestId} />
        <TicketLifecyclePill state={lifecycleState} idSuffix={ticketId} />
      </div>
      <p className="ticket-activity-site col-start-1 min-w-0 break-words text-xs" style={{color:brand.isOrgBranded ? brand.primary : "#F59E0B"}}>{siteName || "—"} | {vendorName || "—"}</p>
      <p className="ticket-activity-service col-start-1 min-w-0 break-words text-xs text-muted-foreground">{workTypeName || "—"}</p>
    </Link>
    {children && <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">{children}</div>}
  </div>;
}

export function RecentTicketActivityScroll({children}:{children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  const [height,setHeight]=useState<number>();
  useEffect(()=>{
    const el=ref.current;
    if(!el) return;
    const measure=()=>{
      const rows=el.querySelectorAll<HTMLElement>("[data-ticket-activity]");
      if(rows.length<=10) {setHeight(undefined);return;}
      setHeight(rows[9].getBoundingClientRect().bottom-rows[0].getBoundingClientRect().top);
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(el);
    el.querySelectorAll("[data-ticket-activity]").forEach(row=>observer.observe(row));
    return ()=>observer.disconnect();
  },[children]);
  return <div ref={ref} style={{maxHeight:height}} className="overflow-y-auto overscroll-contain space-y-2" data-testid="recent-activity-scroll">{children}</div>;
}
