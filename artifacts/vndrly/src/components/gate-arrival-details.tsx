import { CardHeading } from "@/components/ui/card-heading";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { gateArrivalsApi } from "@/lib/gate-arrivals-api";
import { GateVisitDetails } from "./gate-visit-details";
import { useState } from "react";
import { isGateArrivalPreview, sampleGateArrivalDetail } from "@/lib/gate-arrival-preview";

export function GateArrivalDetails({ siteId, runId, onClose }: { siteId?: number; runId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [visitId, setVisitId] = useState<number | null>(null);
  const record = useQuery({
    queryKey: ["gate-arrival-detail", user?.userId, user?.activeMembershipId, siteId, runId],
    queryFn: () => isGateArrivalPreview() && runId?.startsWith("sample-inbound-")
      ? Promise.resolve(sampleGateArrivalDetail(siteId!, runId!))
      : gateArrivalsApi.get(siteId!, runId!), enabled: Boolean(siteId && runId), retry: false,
  });
  const run = record.data;
  return <>
    <Dialog open={runId !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{run?.title ?? t("gatekeeper.runDetails")}</DialogTitle>
        <DialogDescription>{t("gatekeeper.runDetailsHint")}</DialogDescription>
        {record.isLoading ? <Loader2 className="animate-spin" /> : record.isError ? <p role="alert">{t("gatekeeper.recordLoadFailed")}</p> : run ? <div className="space-y-4 text-sm">
          <dl className="gate-record-facts">
            {[
              [t("gatekeeper.runRecord"), `#${run.ticketNumber}`],
              [t("gatekeeper.driver"), run.driverName],
              [t("gatekeeper.vehiclePlate"), run.vehicleLabel],
              [t("gatekeeper.company"), run.companyName],
              [t("changeOver.site"), run.destinationName],
              [t("gatekeeper.recordState"), t(run.runComplete ? "gatekeeper.runComplete" : "gatekeeper.runPartial")],
              [t("gatekeeper.lastGpsReport"), run.observedAt ? new Date(run.observedAt).toLocaleString() : t("gatekeeper.etaUnavailable")],
            ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {run.loads.length > 0 && <section><CardHeading as="h3" className="font-semibold">{t("gatekeeper.runLoads")}</CardHeading><ul className="mt-2 space-y-2">{run.loads.map(load => <li key={load.id} className="border-t border-white/10 pt-2">{[load.commodity, load.quantity, load.unit].filter(value => value != null && value !== "").join(" · ")}{load.deliveredAt ? <span className="block text-xs text-muted-foreground">{new Date(load.deliveredAt).toLocaleString()}</span> : null}</li>)}</ul></section>}
          {run.events.length > 0 && <section><CardHeading as="h3" className="font-semibold">{t("gatekeeper.runTimeline")}</CardHeading><ul className="mt-2 space-y-2">{run.events.map((event, index) => <li key={`${event.type}:${event.recordedAt}:${index}`} className="flex justify-between gap-3 border-t border-white/10 pt-2"><span>{t(`gatekeeper.runEvents.${event.type}`, { defaultValue: event.type.replace(/_/g, " ") })}</span><time className="text-xs text-muted-foreground">{new Date(event.recordedAt).toLocaleString()}</time></li>)}</ul></section>}
          {run.linkedVisitIds.length > 0 && <section><CardHeading as="h3" className="font-semibold">{t("gatekeeper.linkedGateRecords")}</CardHeading>{run.linkedVisitIds.map(id => <button className="gate-record-link" key={id} type="button" onClick={() => setVisitId(id)}>{t("gatekeeper.gateRecordNumber", { id })}</button>)}</section>}
        </div> : null}
      </DialogContent>
    </Dialog>
    <GateVisitDetails visitId={visitId} onClose={() => setVisitId(null)} />
  </>;
}
