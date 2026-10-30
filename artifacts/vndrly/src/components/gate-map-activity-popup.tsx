import { CardHeading } from "@/components/ui/card-heading";
import { useQuery } from "@tanstack/react-query";
import { LogIn, LogOut, Clock3, AlertTriangle } from "lucide-react";
import { changeOverRequest } from "@/lib/change-over-api";
import { formatGateMapTime } from "./gate-map-time-control";
import { GateMapDirections } from "./gate-map-directions";
import { GateMapGateStatus } from "./gate-map-gate-status";
import { useState } from "react";

export type GateMapActivity = {
  stationId: string; siteId: number; gateName: string; siteName: string;
  scope: "gate_attributed" | "linked_gates"; generatedAt: string; startedAt: string;
  window: "current_shift" | "released_watch" | "24h";
  metrics: { checkIns: number; checkOuts: number; pendingAdmission: number; itemsToReview: number };
};
export function GateMapActivityPopup({ stationId, siteId, siteName, gateName, active, latitude, longitude, userId, membershipId, historical, visit = 0, es, onEnter, onLeave }: {
  stationId: string; siteId: number; siteName: string; gateName: string; active?: boolean;
  latitude?: number | null; longitude?: number | null;
  userId: number; membershipId?: number | null; historical: boolean; visit?: number; es: boolean;
  onEnter: () => void; onLeave: () => void;
}) {
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [changingStatus,setChangingStatus]=useState(false);
  const activity = useQuery({
    queryKey: ["gate-map-activity", userId, membershipId, siteId, stationId, visit],
    queryFn: async () => {
      const value = await changeOverRequest<GateMapActivity>(`/${stationId}/map-activity`);
      if (value.stationId !== stationId || value.siteId !== siteId || !["gate_attributed","linked_gates"].includes(value.scope)) throw new Error("Gate scope mismatch");
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
  return <section data-card-layout className="gate-map-activity-card" aria-label={c("Gate activity", "Actividad del acceso")}
    onMouseEnter={onEnter} onMouseLeave={onLeave} onFocusCapture={onEnter}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}>
    <CardHeading as="h3">{c("Gate activity", "Actividad del acceso")}</CardHeading>
    <strong className="gate-map-activity-name">{siteName} · {gateName} · <GateMapGateStatus stationId={stationId} siteId={siteId} userId={userId} membershipId={membershipId} active={active} historical={historical} es={es} onConfirmingChange={setChangingStatus} /></strong>
    {!changingStatus&&<>
    <p>{activity.data?.scope === "linked_gates" ? c("Shared linked-gate records", "Registros compartidos de accesos vinculados") : c("Current gate-attributed records", "Registros actuales atribuidos al acceso")}</p>
    {historical && <p>{c("Current counts; map shows a historical time.", "Cifras actuales; el mapa muestra una hora histórica.")}</p>}
    {activity.isPending ? <p role="status">{c("Loading current activity…", "Cargando actividad actual…")}</p> : activity.isError ?
      <div role="alert"><p>{c("Activity unavailable. Counts could not be loaded.", "Actividad no disponible. No se pudieron cargar las cifras.")}</p><button type="button" onClick={() => void activity.refetch()}>{c("Retry", "Reintentar")}</button></div> : <>
      <p>{c("Snapshot", "Captura")}: {formatGateMapTime(activity.data.generatedAt)}</p>
      <p>{activity.data.window === "24h" ? c("Last 24 hours", "Últimas 24 horas") : `${c("Since", "Desde")} ${formatGateMapTime(activity.data.startedAt)}`}</p>
      <GateMapDirections latitude={latitude} longitude={longitude} es={es} />
      <dl>{rows.map(([key, label, Icon]) => <div key={key}><dt><Icon aria-hidden="true" />{label}</dt><dd>{activity.data.metrics[key]}</dd></div>)}</dl>
      {activity.isFetching && <p role="status">{c("Refreshing…", "Actualizando…")}</p>}
    </>}
    </>}
  </section>;
}
