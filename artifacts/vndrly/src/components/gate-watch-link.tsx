import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import type { ChangeOverState } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import WatchPassControl from "./watch-pass-control";
import { useEffect, useState } from "react";
import GateAssumeWatchFlyout, { type GateWatchCalendarContext } from "./gate-assume-watch-flyout";
import { useNextSteps } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
import { gateGuideMatches, gateGuideScope } from "@/lib/gate-operational-helpers";

/** Gate entry opens the same review/notes workflow as the Gate dashboard. */
export default function GateWatchLink({ stationId, siteId, calendarContext }: { stationId?: string; siteId?: number; calendarContext?: Omit<GateWatchCalendarContext, "siteId"> }) {
  const { user } = useAuth(), { t, i18n } = useTranslation(), [, navigate] = useLocation();
  const state = useQuery({ queryKey: ["gate-entry-watch", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, stationId, calendarContext ? "assume" : "default"], queryFn: () => changeOverRequest<ChangeOverState>(`/${stationId}/state${calendarContext ? "?purpose=assume" : ""}`), enabled: Boolean(stationId), retry: false, throwOnError: false, refetchInterval: 15000 });
  const own = state.data?.shift?.operator_id === user?.userId;
  const wrongCalendarGate = Boolean(calendarContext && state.data && (state.data.site.id !== siteId || state.data.station.id !== stationId));
  const [now, setNow] = useState(Date.now);
  const calendarNotCurrent = Boolean(calendarContext && !(Date.parse(calendarContext.startsAt) <= now && now < Date.parse(calendarContext.endsAt)));
  const es = (i18n?.language ?? "en").startsWith("es");
  const [open,setOpen]=useState(false);
  const helper = useNextSteps();
  const context = { siteId, stationId, shiftId: calendarContext?.shiftId, day: calendarContext?.date };
  const scopeId = gateGuideScope("watch-link", context);
  const guided = (["gate-staffing-recovery", "gate-watch-handoff", "first-watch"] as const).some(key => gateGuideMatches(helper?.selected, key, context));
  useGuidedTarget({ scopeId, targetId: "watch-action", prompt: own ? "Open the saved watch handoff. Returning to Admin never releases this watch." : "Open Assume Watch to review this exact gate before explicitly accepting custody." }, guided && !open && !wrongCalendarGate && !calendarNotCurrent, 30);
  useEffect(() => { if (!calendarContext) return; const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [calendarContext?.startsAt, calendarContext?.endsAt]);
  useEffect(()=>setOpen(false),[stationId,user?.userId,user?.activeMembershipId,calendarContext?.shiftId,calendarContext?.date]);
  return <div className="inline-flex flex-wrap items-center gap-2" data-guidance-scope={scopeId}><WatchPassControl guidanceId="watch-action" active={own} label={t(own ? "watch.handover" : "watch.assume")} disabled={!state.data || state.isError || wrongCalendarGate || calendarNotCurrent} onClick={() => own?navigate(`/gate/change-over?${new URLSearchParams({ ...(siteId ? { siteId: String(siteId) } : {}), stationId: stationId!, ...(calendarContext ? { shiftId: calendarContext.shiftId, date: calendarContext.date } : {}) })}`):setOpen(true)} />
    {wrongCalendarGate && <p role="alert">{es ? "No se pudo verificar el acceso del calendario." : "The calendar gate could not be verified."}</p>}
    {calendarNotCurrent && <p role="status">{es ? "Asumir vigilancia solo está disponible durante esta guardia programada." : "Assume Watch is available only while this scheduled watch is current."}</p>}
    {stationId&&<GateAssumeWatchFlyout stationId={stationId} open={open} onOpenChange={setOpen} calendarContext={calendarContext && siteId ? { ...calendarContext, siteId } : undefined}/>}</div>;
}
