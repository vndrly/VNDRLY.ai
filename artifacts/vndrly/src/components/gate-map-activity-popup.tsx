import { useQuery } from "@tanstack/react-query";
import { LogIn, LogOut, Clock3, AlertTriangle } from "lucide-react";
import { changeOverRequest } from "@/lib/change-over-api";
import { formatGateMapTime } from "./gate-map-time-control";

export type GateMapActivity = {
  stationId: string; siteId: number; gateName: string; siteName: string;
  scope: "gate_attributed"; generatedAt: string; startedAt: string;
  window: "current_shift" | "released_watch" | "24h";
  metrics: { checkIns: number; checkOuts: number; pendingAdmission: number; itemsToReview: number };
};
export function GateMapActivityPopup({ stationId, siteId, siteName, gateName, userId, membershipId, historical, visit = 0, es, onEnter, onLeave }: {
  stationId: string; siteId: number; siteName: string; gateName: string;
  userId: number; membershipId?: number | null; historical: boolean; visit?: number; es: boolean;
  onEnter: () => void; onLeave: () => void;
}) {
  const c = (en: string, spanish: string) => es ? spanish : en;
  const activity = useQuery({
    queryKey: ["gate-map-activity", userId, membershipId, siteId, stationId, visit],
    queryFn: async () => {
      const value = await changeOverRequest<GateMapActivity>(`/${stationId}/map-activity`);
      if (value.stationId !== stationId || value.siteId !== siteId || value.scope !== "gate_attributed") throw new Error("Gate scope mismatch");
      return value;
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: "always", refetchInterval: 30000,
  });
  const rows = [
    ["checkIns", c("Check-in records", "Registros de entrada"), LogIn],
    ["checkOuts", c("Check-out records", "Registros de salida"), LogOut],
    ["pendingAdmission", c("Pending admission", "Admisión pendiente"), Clock3],
    ["itemsToReview", c("Items to review", "Elementos para revisar"), AlertTriangle],
  ] as const;
  return <section className="gate-map-activity-card" aria-label={c("Gate activity", "Actividad del acceso")}
    onMouseEnter={onEnter} onMouseLeave={onLeave} onFocusCapture={onEnter}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}>
    <h3>{c("Gate activity", "Actividad del acceso")}</h3>
    <strong className="gate-map-activity-name">{siteName} · {gateName}</strong>
    <p>{c("Current gate-attributed records", "Registros actuales atribuidos al acceso")}</p>
    {historical && <p>{c("Current counts; map shows a historical time.", "Cifras actuales; el mapa muestra una hora histórica.")}</p>}
    {activity.isPending ? <p role="status">{c("Loading current activity…", "Cargando actividad actual…")}</p> : activity.isError ?
      <div role="alert"><p>{c("Activity unavailable. Counts could not be loaded.", "Actividad no disponible. No se pudieron cargar las cifras.")}</p><button type="button" onClick={() => void activity.refetch()}>{c("Retry", "Reintentar")}</button></div> : <>
      <p>{c("Snapshot", "Captura")}: {formatGateMapTime(activity.data.generatedAt)}</p>
      <p>{activity.data.window === "24h" ? c("Last 24 hours", "Últimas 24 horas") : `${c("Since", "Desde")} ${formatGateMapTime(activity.data.startedAt)}`}</p>
      <dl>{rows.map(([key, label, Icon]) => <div key={key}><dt><Icon aria-hidden="true" />{label}</dt><dd>{activity.data.metrics[key]}</dd></div>)}</dl>
      {activity.isFetching && <p role="status">{c("Refreshing…", "Actualizando…")}</p>}
    </>}
  </section>;
}
