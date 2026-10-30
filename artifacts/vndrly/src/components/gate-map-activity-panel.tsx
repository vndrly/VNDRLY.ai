import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ChangeOverSnapshot, ChangeOverState } from "@workspace/gate-booth";
import { changeOverRequest } from "@/lib/change-over-api";
import { GateActivityCard } from "./gate-activity-card";

type Gate = { id: string; siteId: number; siteName: string };
export function GateMapActivityPanel({ gates, selectedGateId, userId, membershipId }: {
  gates: Gate[]; selectedGateId: string | null; userId: number; membershipId?: number | null;
}) {
  const { i18n } = useTranslation(), es = i18n.language?.startsWith("es");
  // Fetch each authorized site, then count each explicit parallel group once.
  const selected = gates.find(gate => gate.id === selectedGateId);
  const scoped = selected ? [selected] : [...new Map(gates.map(gate => [gate.siteId, gate])).values()];
  const activity = useQuery({
    queryKey: ["gate-map-dashboard-activity", userId, membershipId, scoped.map(gate => gate.id).join(",")],
    queryFn: () => Promise.all(scoped.map(gate => changeOverRequest<ChangeOverState>(`/${gate.id}/state`))),
    enabled: scoped.length > 0, retry: false, refetchInterval: 15000,
  });
  const states = activity.data ?? [];
  const received = states.flatMap(state => state.snapshot ? [{siteId:state.site.id,snapshot:state.snapshot}] : []);
  const shared = new Map<string, ChangeOverSnapshot>();
  for (const {siteId,snapshot:value} of received) {
    const key=value.linkedScope?.groupId ?? `site:${siteId}`, previous=shared.get(key);
    if (!previous || value.generatedAt > previous.generatedAt) shared.set(key,value);
  }
  const snapshots = [...shared.values()];
  let snapshot: ChangeOverSnapshot | null = null;
  if (!activity.isError && snapshots.length > 0 && received.length === scoped.length) {
    const first = snapshots[0]!;
    const keys = Object.keys(first.metrics) as (keyof ChangeOverSnapshot["metrics"])[];
    snapshot = { ...first,
      generatedAt: snapshots.map(value => value.generatedAt).sort()[0]!,
      metrics: Object.fromEntries(keys.map(key => [key, snapshots.reduce((total, value) => total + value.metrics[key], 0)])) as ChangeOverSnapshot["metrics"],
      metricRecordIds: Object.fromEntries(keys.map(key => [key, snapshots.flatMap(value => value.metricRecordIds?.[key] ?? [])])),
      records: snapshots.flatMap(value => value.records ?? []), outstanding: snapshots.flatMap(value => value.outstanding),
      exceptions: snapshots.flatMap(value => value.exceptions),
    };
  }
  const historyHref = (state: ChangeOverState) => `/gate/history?${new URLSearchParams({ siteId: String(state.site.id), stationId: state.station.id, range: state.shift ? "current_shift" : "24h" })}`;
  const links = new Map(states.flatMap(state => [...(state.snapshot?.records ?? []), ...(state.snapshot?.outstanding ?? [])].map(record => [record.id, historyHref(state)] as const)));
  const baseHref = states[0] ? historyHref(states[0]) : "/gate/history?range=24h";
  return <div className="min-w-0">
    {activity.isPending && scoped.length > 0 && <p role="status" className="text-xs">{es ? "Cargando actividad…" : "Loading activity…"}</p>}
    {activity.isError && <p role="alert" className="text-xs">{es ? "Actividad no disponible." : "Activity unavailable."}</p>}
    <GateActivityCard snapshot={snapshot} historyBaseHref={baseHref}
      scopeLabel={selected ? `${selected.siteName} · ${es ? "Registros del sitio" : "Site records"}` : es ? "Todos los sitios · Actividad actual" : "All sites · Current activity"}
      recordHistoryHref={id => links.get(id) ?? baseHref} showAllLogLink={scoped.length === 1} />
  </div>;
}
