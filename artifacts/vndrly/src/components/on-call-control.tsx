import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { nativeOperationsRequest } from "@/lib/native-operations-client";
import WorkdayStatusSwitch from "./workday-status-switch";

type Status = { active?: boolean; onCallActive?: boolean; onCallWindows?: { startsAt: string; endsAt: string; consent: boolean }[]; canWorkerOperate?: boolean; policy?: { enabled: boolean } };
export default function OnCallControl({ identity, pickup = false }: { identity: string; pickup?: boolean }) {
  const { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const query = useQuery({ queryKey: ["shift-card-on-call", identity, pickup], queryFn: () => nativeOperationsRequest<Status>(pickup ? "/pickup-shifts" : "/status"), retry: false, throwOnError: false, refetchInterval: 30000 });
  const status = query.data;
  const active = pickup ? status?.active === true : status?.onCallActive === true || status?.onCallWindows?.some(window => window.consent && Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()) === true;
  async function toggle() {
    if (lock.current || !status) return;
    lock.current = true; setBusy(true); setError("");
    try { await nativeOperationsRequest(pickup ? "/pickup-shifts" : "/on-call", { method: "PUT", body: JSON.stringify({ active: !active, consent: true }) }); await query.refetch(); }
    catch { setError(pickup ? (es ? "No se pudo guardar la preferencia." : "The pickup preference could not be saved.") : (es ? "No se pudo verificar el cambio de guardia." : "The on-call change could not be verified.")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="shift-card-on-call">
    <WorkdayStatusSwitch accessibilityLabel={pickup ? (es ? "Aceptar turnos extra" : "Pickup Extra Shifts") : (es ? "Guardia" : "On Call")} active={active} label={pickup ? (es ? "Aceptar turnos extra" : "Pickup Extra Shifts") : active ? (es ? "De guardia" : "On Call") : (es ? "Sin guardia" : "Not on Call")} disabled={busy || !status || (!pickup && (!status.policy?.enabled || status.canWorkerOperate === false))} onClick={() => void toggle()} />
    {pickup && <small>{es ? "Turnos con poca anticipación, sujetos a descanso y disponibilidad." : "Short-notice shifts, subject to rest and availability checks."}</small>}
    {(query.isError || error) && <small role="status">{error || (pickup ? (es ? "Preferencia no disponible" : "Pickup preference unavailable") : (es ? "Guardia no disponible" : "On-call unavailable"))}</small>}
  </div>;
}
