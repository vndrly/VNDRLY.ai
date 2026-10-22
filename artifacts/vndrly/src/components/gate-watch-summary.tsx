import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, NotebookPen, UserCheck, ClipboardList } from "lucide-react";
import { WorkspacePanel, WorkspaceRow } from "@/components/work-hub/workspace-panel";
import { useTranslation } from "react-i18next";
import type { ChangeOverState, ShiftNotesResponse } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";

export default function GateWatchSummary({ stationId, current }: { stationId: string; current?: ChangeOverState }) {
  const { user } = useAuth(), { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const notes = useQuery({ queryKey: ["gate-watch-previous-notes", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, stationId], queryFn: () => changeOverRequest<ShiftNotesResponse>(`/${stationId}/notes?days=30`), enabled: Boolean(stationId), retry: false, throwOnError: false });
  const roster = useQuery({ queryKey: ["gate-watch-own-duty", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, stationId], queryFn: () => changeOverRequest<{ roster: { userId: number; startedAt: string }[] }>(`/${stationId}/roster`), enabled: Boolean(stationId), retry: false, throwOnError: false, refetchInterval: 30000 });
  const own = roster.data?.roster?.find(duty => duty.userId === user?.userId);
  const minutes = own ? Math.max(0, Math.floor((now - Date.parse(own.startedAt)) / 60000)) : null;
  const previous = notes.data?.rows?.[0];
  const followUps = previous?.snapshot.openItems.filter(item => item.status === "open") ?? [];
  const c = (en: string, spanish: string) => es ? spanish : en;
  return <WorkspacePanel title={c("Watch & handover", "Vigilancia y relevo")} subtitle={c("Custody, your watch time, and the last handover", "Custodia, tiempo de vigilancia y último relevo")} icon={Clock3}>
    <WorkspaceRow icon={Clock3} label={c("My watch", "Mi vigilancia")} value={!current || roster.isPending || roster.isError ? c("Unavailable", "No disponible") : minutes === null ? c("Not on watch", "Sin vigilancia") : minutes >= 1440 ? c("Open watch needs review", "Revisar vigilancia abierta") : `${Math.floor(minutes / 60)}h ${minutes % 60}m`} href={`/gate/history?stationId=${stationId}&range=current_shift`} />
    {own && <p className="gate-panel-caption">{c("Assumed", "Iniciada")} {new Date(own.startedAt).toLocaleString()}</p>}
    <WorkspaceRow icon={UserCheck} label={c("On watch", "En vigilancia")} value={!current ? c("Unavailable", "No disponible") : current.shift?.operator_name ?? c("No active watch", "Sin vigilancia activa")} href={`/gate/history?stationId=${stationId}&range=current_shift`} />
    <details className="gate-panel-disclosure">
      <summary><NotebookPen aria-hidden="true" /> <span>{c("Previous watch", "Vigilancia anterior")}</span><small>{previous?.outgoing_name ?? c("Notes", "Notas")}</small></summary>
      <div className="gate-panel-detail">
        {notes.isPending ? <p>{c("Loading handoff notes…", "Cargando notas del relevo…")}</p> : notes.isError ? <p role="status">{c("Handoff notes unavailable.", "Notas del relevo no disponibles.")}</p> : previous ? <>
          <p>{previous.outgoing_name} · {new Date(previous.acknowledged_at).toLocaleString()}</p>
          <p className="whitespace-pre-wrap">{previous.notes || c("No written notes in this handoff.", "Este relevo no tiene notas escritas.")}</p>
        </> : <p>{c("No recorded handoff in the last 30 days.", "No hay relevos registrados en los últimos 30 días.")}</p>}
      </div>
    </details>
    <WorkspaceRow icon={ClipboardList} label={c("Read shift notes", "Leer notas del turno")} value={notes.isSuccess ? String(followUps.length) + c(" carried forward", " pendientes transferidos") : c("Unavailable", "No disponible")} href={`/gate/shift-notes?stationId=${stationId}`} />
  </WorkspacePanel>;
}
