import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { visitsApi } from "@/lib/visits-api";
import { formatPlateForDisplay } from "@/lib/plate-display";
import { gateArrivalsApi } from "@/lib/gate-arrivals-api";

export function GateVisitDetails({ visitId, onClose, onOpenRun }: { visitId: number | null; onClose: () => void; onOpenRun?: (runId: string) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const record = useQuery({
    queryKey: ["gate-visit-detail", user?.userId, user?.activeMembershipId, visitId],
    queryFn: () => visitsApi.get(visitId!), enabled: visitId !== null, retry: false,
  });
  const visit = record.data;
  const links = useQuery({
    queryKey: ["gate-visit-runs", user?.userId, user?.activeMembershipId, visit?.siteLocationId, visitId],
    queryFn: () => gateArrivalsApi.visitLinks(visit!.siteLocationId, visitId!), enabled: Boolean(visit && onOpenRun), retry: false,
  });
  const elapsed = visit ? Math.max(0, Math.floor(((visit.checkOutTime ? Date.parse(visit.checkOutTime) : Date.now()) - Date.parse(visit.checkInTime)) / 60_000)) : 0;
  return <Dialog open={visitId !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogTitle>{t("gatekeeper.recordDetails")}</DialogTitle>
      <DialogDescription>{t("gatekeeper.recordDetailsHint")}</DialogDescription>
      {record.isLoading ? <Loader2 className="animate-spin" /> : record.isError ? <p role="alert">{t("gatekeeper.recordLoadFailed")}</p> : visit ? <div className="space-y-3 text-sm">
        <p className="text-lg font-bold">{visit.firstName} {visit.lastName}</p>
        <dl className="gate-record-facts">
          {[
            [t("gatekeeper.company"), visit.company],
            [t("gatekeeper.vehiclePlate"), formatPlateForDisplay(visit.plateState, visit.vehiclePlate, t("gatekeeper.plateStateUnconfirmed"))],
            [t("changeOver.site"), visit.siteName],
            [t("gatekeeper.historyCheckedIn"), new Date(visit.checkInTime).toLocaleString()],
            [t("gatekeeper.historyCheckedOut"), visit.checkOutTime ? new Date(visit.checkOutTime).toLocaleString() : t("gatekeeper.onSiteTab")],
            [t("gatekeeper.timeOnSite"), t("gatekeeper.minutesOnSite", { minutes: elapsed })],
            [t("gatekeeper.purpose"), visit.purpose],
            [t("gatekeeper.notes"), visit.notes],
          ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {onOpenRun && links.data?.runs.map(run => <button className="gate-record-link" key={run.id} type="button" onClick={() => onOpenRun(run.runId)}>{run.title} · #{run.ticketNumber}</button>)}
        {links.isError && <p role="alert" className="text-xs text-muted-foreground">{t("gatekeeper.linkedRunsUnavailable")}</p>}
      </div> : null}
    </DialogContent>
  </Dialog>;
}
