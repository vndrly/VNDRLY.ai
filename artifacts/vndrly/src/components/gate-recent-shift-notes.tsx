import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type { ShiftNotesResponse } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";

export default function GateRecentShiftNotes({ stationId, siteId }: { stationId: string; siteId?: number }) {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState(false);
  const notes = useQuery({
    queryKey: ["gate-recent-shift-notes", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, stationId],
    queryFn: () => changeOverRequest<ShiftNotesResponse>(`/${stationId}/notes?limit=10`),
    enabled: Boolean(stationId && user?.userId && open), retry: false, throwOnError: false, staleTime: 0,
  });
  return <details className="gate-panel-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ClipboardList aria-hidden="true" /><span>{c("Read shift notes", "Leer notas del turno")}</span></summary>
    <div className="gate-panel-detail gate-recent-notes" aria-label={c("Recent shift notes", "Notas recientes del turno")}>
      {notes.isPending ? <p role="status">{c("Loading shift notes…", "Cargando notas del turno…")}</p>
        : notes.isError ? <p role="status">{c("Shift notes unavailable.", "Notas del turno no disponibles.")}</p>
        : !notes.data?.rows.length ? <p>{c("No filed shift notes.", "No hay notas de turno archivadas.")}</p>
        : notes.data.rows.slice(0, 10).map(note => {
          const params = new URLSearchParams({ stationId, handoffId: note.id, ...(note.site_id ? { siteId: String(note.site_id) } : {}) });
          return <Link key={note.id} href={`/gate/shift-notes?${params}`} className="gate-recent-note"
            data-own={note.outgoing_user_id === user?.userId} data-viewed={Boolean(note.viewed_at)}>
            <strong>{note.outgoing_name}</strong>
            <span>{c("Filed", "Archivada")} <time dateTime={note.filed_at ?? note.created_at ?? note.acknowledged_at}>{new Date(note.filed_at ?? note.created_at ?? note.acknowledged_at).toLocaleString()}</time></span>
          </Link>;
        })}
      <Link className="gate-all-shift-notes" href={`/gate/shift-notes?${new URLSearchParams({ stationId, ...(siteId ? { siteId: String(siteId) } : {}) })}`}>{c("All shift notes", "Todas las notas del turno")} ›</Link>
    </div>
  </details>;
}
