import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GateArrival } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { gateArrivalsApi } from "@/lib/gate-arrivals-api";

/** Run identities, rather than location ping identities, trigger a short alert. */
export function useGateArrivals(siteId?: number) {
  const { user } = useAuth();
  const scope = `${user?.userId}:${user?.activeMembershipId}:${siteId}`;
  const query = useQuery({
    queryKey: ["gate-arrivals", user?.userId, user?.activeMembershipId, siteId],
    queryFn: () => gateArrivalsApi.list(siteId!), enabled: Boolean(siteId),
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
  return { ...query, newInboundIds };
}

export function GateArrivalsPanel({ query, onOpen, limit }: {
  query: ReturnType<typeof useGateArrivals>; onOpen: (runId: string) => void; limit?: number;
}) {
  const { t } = useTranslation();
  if (query.isLoading) return <Loader2 className="animate-spin" />;
  if (query.isError) return <p role="alert" className="text-sm text-destructive">{t("gatekeeper.arrivalsLoadFailed")}</p>;
  if (!query.data?.arrivals.length) return <p className="text-sm text-muted-foreground">{t(query.data?.truncated ? "gatekeeper.arrivalsTruncated" : "gatekeeper.noArrivals")}</p>;
  return <div className="space-y-2">
    {query.data.arrivals.slice(0, limit).map((run: GateArrival) => <button type="button" className="gate-record-link gate-arrival-record" key={run.id} onClick={() => onOpen(run.runId)}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold">{run.driverName || run.title}</span>
        <span className={query.newInboundIds.has(run.id) ? "gate-arriving is-new" : "gate-arriving"}>{t("gatekeeper.arriving")}</span>
      </span>
      <span className="text-xs text-muted-foreground">{[run.companyName, run.vehicleLabel].filter(Boolean).join(" · ")}</span>
      <span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{run.ticketNumber ? `#${run.ticketNumber}` : run.title}</span>
        <span>{run.etaMinutes == null ? t("gatekeeper.etaUnavailable") : t("gatekeeper.arrivalEta", { minutes: Math.ceil(run.etaMinutes) })}</span>
      </span>
    </button>)}
    {query.data.truncated && <p className="text-xs text-muted-foreground">{t("gatekeeper.arrivalsTruncated")}</p>}
  </div>;
}
