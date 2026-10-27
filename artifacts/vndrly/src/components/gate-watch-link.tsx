import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import type { ChangeOverState } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import WatchPassControl from "./watch-pass-control";
import { useEffect, useState } from "react";
import GateAssumeWatchFlyout from "./gate-assume-watch-flyout";

/** Gate entry opens the same review/notes workflow as the Gate dashboard. */
export default function GateWatchLink({ stationId, siteId }: { stationId?: string; siteId?: number }) {
  const { user } = useAuth(), { t } = useTranslation(), [, navigate] = useLocation();
  const state = useQuery({ queryKey: ["gate-entry-watch", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, stationId], queryFn: () => changeOverRequest<ChangeOverState>(`/${stationId}/state`), enabled: Boolean(stationId), retry: false, throwOnError: false, refetchInterval: 15000 });
  const own = state.data?.shift?.operator_id === user?.userId;
  const [open,setOpen]=useState(false);
  useEffect(()=>setOpen(false),[stationId,user?.userId,user?.activeMembershipId]);
  return <><WatchPassControl active={own} label={t(own ? "watch.handover" : "watch.assume")} disabled={!state.data || state.isError} onClick={() => own?navigate(`/gate/change-over?${new URLSearchParams({ ...(siteId ? { siteId: String(siteId) } : {}), stationId: stationId! })}`):setOpen(true)} />{stationId&&<GateAssumeWatchFlyout stationId={stationId} open={open} onOpenChange={setOpen}/>}</>;
}
