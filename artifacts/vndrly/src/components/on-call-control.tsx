import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { nativeOperationsRequest } from "@/lib/native-operations-client";
import WorkdayStatusText from "./workday-status-text";

type Status = { onCallActive?: boolean; onCallWindows?: { startsAt: string; endsAt: string; consent: boolean }[]; canWorkerOperate?: boolean; policy: { enabled: boolean } };
export default function OnCallControl({ identity }: { identity: string }) {
  const { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const query = useQuery({ queryKey: ["shift-card-on-call", identity], queryFn: () => nativeOperationsRequest<Status>("/status"), retry: false, throwOnError: false, refetchInterval: 30000 });
  const status = query.data;
  const active = status?.onCallActive === true || status?.onCallWindows?.some(window => window.consent && Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()) === true;
  async function toggle() {
    if (lock.current || !status) return;
    lock.current = true; setBusy(true); setError("");
    try { await nativeOperationsRequest("/on-call", { method: "PUT", body: JSON.stringify({ active: !active, consent: true }) }); await query.refetch(); }
    catch { setError(es ? "No se pudo verificar el cambio de guardia." : "The on-call change could not be verified."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="shift-card-on-call">
    <WorkdayStatusText active={active} label={active ? (es ? "De guardia" : "On Call") : (es ? "Sin guardia" : "Not on Call")} disabled={busy || !status?.policy?.enabled || status.canWorkerOperate === false} onClick={() => void toggle()} />
    {(query.isError || error) && <small role="status">{error || (es ? "Guardia no disponible" : "On-call unavailable")}</small>}
  </div>;
}
