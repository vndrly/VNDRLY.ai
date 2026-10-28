import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GateArrival } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { gateArrivalsApi } from "@/lib/gate-arrivals-api";
import { isGateArrivalPreview, sampleGateArrivals } from "@/lib/gate-arrival-preview";
import { GateTrafficRecord } from "./gate-traffic-record";
import { gateRecordFlags } from "@/lib/gate-record-flags";

/** Run identities, rather than location ping identities, trigger a short alert. */
export function useGateArrivals(siteId?: number) {
  const { user } = useAuth();
  const [preview] = useState(isGateArrivalPreview);
  const [previewApprovedIds, setPreviewApprovedIds] = useState<Set<string>>(new Set());
  const scope = `${user?.userId}:${user?.activeMembershipId}:${siteId}`;
  const query = useQuery({
    queryKey: ["gate-arrivals", user?.userId, user?.activeMembershipId, siteId, ...(preview ? ["sample"] : [])],
    queryFn: () => preview ? Promise.resolve(sampleGateArrivals(siteId!)) : gateArrivalsApi.list(siteId!), enabled: Boolean(siteId),
    retry: false, refetchInterval: 30_000,
  });
  const seen = useRef({ scope, ids: new Set<string>() });
  const [newInboundIds, setNewInboundIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (seen.current.scope !== scope) {
      seen.current = { scope, ids: new Set() };
      setNewInboundIds(new Set());
    }
    if (!query.data) return;
    const incoming = query.data.arrivals.filter(run => !seen.current.ids.has(run.id));
    for (const run of query.data.arrivals) seen.current.ids.add(run.id);
    if (!incoming.length) return;
    setNewInboundIds(new Set(incoming.map(run => run.id)));
  }, [scope, query.data]);
  useEffect(() => {
    if (!newInboundIds.size) return;
    const timer = setTimeout(() => setNewInboundIds(new Set()), 5000);
    return () => clearTimeout(timer);
  }, [newInboundIds]);
  return { ...query, newInboundIds, preview, previewApprovedIds,
    approvePreviewArrival: (id: string) => { if (preview) setPreviewApprovedIds(ids => new Set([...ids, id])); } };
}

export function GateArrivalsPanel({ query, onOpen, limit, search = "", hideEmpty = false }: {
  query: ReturnType<typeof useGateArrivals>; onOpen: (runId: string) => void; limit?: number; search?: string; hideEmpty?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n?.language?.startsWith("es") ? es : en;
  if (query.isLoading) return <Loader2 className="animate-spin" />;
  if (query.isError) return <p role="alert" className="text-sm text-destructive">{t("gatekeeper.arrivalsLoadFailed")}</p>;
  const arrivals = query.data?.arrivals.filter(run => !search.trim() || [run.driverName, run.title, run.companyName, run.vehicleLabel, run.ticketNumber, run.destinationName].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))) ?? [];
  if (!arrivals.length) return hideEmpty && !query.data?.truncated ? null : <p className="text-sm text-muted-foreground">{t(query.data?.truncated ? "gatekeeper.arrivalsTruncated" : "gatekeeper.noArrivals")}</p>;
  return <div className="space-y-2">
    {query.preview && <p className="text-xs text-muted-foreground">{c("Sample arrivals · approval preview", "Llegadas de ejemplo · vista previa de aprobación")}</p>}
    {arrivals.slice(0, limit).map(run => <GateArrivalCard key={run.id} run={run} query={query} onOpen={onOpen} />)}
    {query.data?.truncated && <p className="text-xs text-muted-foreground">{t("gatekeeper.arrivalsTruncated")}</p>}
  </div>;
}

export function GateArrivalCard({ run, query, onOpen }: { run: GateArrival; query: ReturnType<typeof useGateArrivals>; onOpen: (runId: string) => void }) {
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n?.language?.startsWith("es") ? es : en;
  const approved = query.preview && (run.id.endsWith("-2") || run.id.endsWith("-4") || query.previewApprovedIds.has(run.id));
  return <GateTrafficRecord name={run.driverName || run.title} onOpen={() => onOpen(run.runId)}
    flags={gateRecordFlags(run, i18n?.language?.startsWith("es"))}
    description={[run.companyName, run.vehicleLabel].filter(Boolean).join(" · ")}
    status={<span className={`gate-arriving${query.newInboundIds.has(run.id) ? " is-new" : ""}${query.preview && !approved ? " gate-arriving-awaiting" : ""}`}>{t("gatekeeper.arriving")}</span>}
    footer={query.preview && <span className="gate-arrival-approval-status" role="status">{approved ? c("Approved · Drive through", "Aprobado · Pase directo") : c("Waiting on booth approval", "Esperando aprobación de la caseta")}</span>}
    className={query.preview ? approved ? "gate-traffic-approved" : "gate-traffic-pending" : ""}
    action={query.preview && !approved && <button type="button" className="gate-history-filter" aria-label={`${c("Approve", "Aprobar")}: ${run.driverName}`} onClick={() => query.approvePreviewArrival(run.id)}>{c("Approve", "Aprobar")}</button>}>
  <span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
    <span>{run.ticketNumber ? `#${run.ticketNumber}` : run.title}</span>
    <span>{run.etaMinutes == null ? t("gatekeeper.etaUnavailable") : t("gatekeeper.arrivalEta", { minutes: Math.ceil(run.etaMinutes) })}</span>
  </span>
</GateTrafficRecord>;
}
